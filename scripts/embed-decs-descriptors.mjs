/**
 * Batch embedding script for DeCS 2026 descriptors.
 * Reads decs_descriptors rows without embeddings, generates
 * gemini-embedding-001 (3072 dims) and saves back to the table.
 *
 * Usage:
 *   node --env-file=.env.local scripts/embed-decs-descriptors.mjs [options]
 *
 * Options:
 *   --limit N       Process only N descriptors (default: all pending)
 *   --concurrency N Parallel requests (default: 4)
 *   --delay N       ms delay between batches (default: 300)
 *   --no-resume     Re-embed even descriptors that already have embeddings
 */

import pg from 'pg';

const EMBEDDING_DIM   = 3072;
const EMBEDDING_MODEL = 'gemini-embedding-001';

const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(`--${name}`); return i !== -1 ? args[i+1] : def; };

const LIMIT       = parseInt(getArg('limit', '0'));
const CONCURRENCY = parseInt(getArg('concurrency', '4'));
const DELAY_MS    = parseInt(getArg('delay', '300'));
const RESUME      = !args.includes('--no-resume');

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const geminiKey = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '').trim();
if (!geminiKey) throw new Error('GEMINI_API_KEY is not set');

// ── Text builder ──────────────────────────────────────────────────────────────

function buildDeCSText(d) {
  const terms = Array.isArray(d.entry_terms) ? d.entry_terms : JSON.parse(d.entry_terms || '[]');
  const trees  = Array.isArray(d.tree_numbers) ? d.tree_numbers : JSON.parse(d.tree_numbers || '[]');

  const parts = [
    d.name_pt,
    d.name_en ? `[${d.name_en}]` : null,
    terms.length > 0 ? `Sinônimos: ${terms.slice(0, 20).join(', ')}` : null, //de 10 para 20
    d.scope_note ? d.scope_note.slice(0, 5000) : null, // de 1000 para 5000
    trees.length > 0 ? `Hierarquia: ${trees.slice(0, 5).join(' | ')}` : null,
  ].filter(Boolean);

  return parts.join('\n').slice(0, 8000);
}

// ── Embedding ─────────────────────────────────────────────────────────────────

async function generateEmbedding(text, retries = 3) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        if (res.status === 429 || res.status === 503) {
          const wait = attempt * 2000;
          await sleep(wait);
          continue;
        }
        throw new Error(`API ${res.status}: ${errBody.slice(0, 100)}`);
      }
      const data = await res.json();
      const values = data?.embedding?.values;
      if (!Array.isArray(values) || values.length === 0) throw new Error('Empty embedding response');
      return values;
    } catch (e) {
      if (attempt === retries) throw e;
      await sleep(attempt * 1500);
    }
  }
}

function vectorStr(v) { return `[${v.join(',')}]`; }
function sleep(ms)    { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Ensure table has embedding column (idempotent)
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  await pool.query(`ALTER TABLE decs_descriptors ADD COLUMN IF NOT EXISTS embedding vector(${EMBEDDING_DIM})`);

  // Count
  const where = RESUME ? 'WHERE embedding IS NULL' : '';
  const { rows: [{ count }] } = await pool.query(`SELECT COUNT(*) FROM decs_descriptors ${where}`);
  const total = LIMIT > 0 ? Math.min(LIMIT, parseInt(count)) : parseInt(count);

  console.log(`\n🧠 DeCS 2026 — Vetorização com ${EMBEDDING_MODEL}`);
  console.log(`   Pendentes : ${count} | A processar: ${total}`);
  console.log(`   Concorrência: ${CONCURRENCY} | Delay: ${DELAY_MS}ms\n`);

  if (total === 0) {
    console.log('✅ Todos os descritores já têm embeddings!');
    await pool.end();
    return;
  }

  const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
  const { rows } = await pool.query(
    `SELECT id, ui, name_pt, name_en, entry_terms, tree_numbers, scope_note
     FROM decs_descriptors ${where} ORDER BY id ${limitClause}`
  );

  let done = 0, success = 0, failed = 0;
  const startTime = Date.now();

  const printProgress = () => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = done > 0 ? (done / ((Date.now() - startTime) / 1000)).toFixed(1) : 0;
    const eta  = rate > 0 ? Math.round((total - done) / rate) : '?';
    process.stdout.write(`\r⏳ ${done}/${total} | ✅ ${success} ❌ ${failed} | ${rate}/s | ETA ~${eta}s | ${elapsed}s    `);
  };

  async function processOne(d) {
    try {
      const text = buildDeCSText(d);
      const embedding = await generateEmbedding(text);
      await pool.query(
        'UPDATE decs_descriptors SET embedding = $1::vector WHERE id = $2',
        [vectorStr(embedding), d.id]
      );
      success++;
    } catch (e) {
      failed++;
      process.stdout.write(`\n❌ ${d.ui}: ${e.message}\n`);
    } finally {
      done++;
      printProgress();
    }
  }

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(processOne));
    if (i + CONCURRENCY < rows.length) await sleep(DELAY_MS);
  }

  // Create halfvec HNSW index after embedding
  // pgvector 0.8+: HNSW max 2000 dims for vector, but halfvec supports up to 4000 dims
  if (success > 0) {
    process.stdout.write('\n🔧 Criando índice halfvec HNSW...\n');
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS decs_descriptors_embedding_hnsw_idx
        ON decs_descriptors USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
        WHERE embedding IS NOT NULL
      `);
      console.log('✅ Índice halfvec HNSW criado');
    } catch (e) {
      console.error('⚠️  Erro ao criar índice:', e.message);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n🎉 Vetorização concluída!`);
  console.log(`   Sucesso  : ${success}/${total}`);
  console.log(`   Erros    : ${failed}`);
  console.log(`   Duração  : ${duration}s`);
  if (failed > 0) console.log(`\n💡 Re-execute com --no-resume para tentar novamente os erros.`);

  await pool.end();
}

main().catch(e => { console.error('\n💥 Fatal:', e); process.exit(1); });
