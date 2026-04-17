/**
 * Batch embedding script for MedMind notes
 * Generates Google gemini-embedding-001 embeddings for all notes
 * and stores them in pgvector (notes.embedding column).
 *
 * Usage:
 *   node --env-file=.env.local scripts/embed-notes.mjs [options]
 *
 * Options:
 *   --limit N         Process only N notes (default: all)
 *   --concurrency N   Parallel embedding requests (default: 3)
 *   --delay N         ms delay between batches (default: 350)
 *   --no-resume       Re-embed even if embedding already exists
 */

import pg from 'pg';
import fs from 'fs';

// ── Config ────────────────────────────────────────────────────────────────────
const EMBEDDING_DIM   = 3072;
const EMBEDDING_MODEL = 'gemini-embedding-001';
const RESULTS_FILE    = 'embed_notes_results.json';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : def;
};

const LIMIT       = parseInt(getArg('limit', '0'));
const CONCURRENCY = parseInt(getArg('concurrency', '3'));
const DELAY_MS    = parseInt(getArg('delay', '350'));
const RESUME      = !args.includes('--no-resume');

// ── DB setup ──────────────────────────────────────────────────────────────────
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Gemini embedding ──────────────────────────────────────────────────────────
const geminiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
if (!geminiKey) throw new Error('GEMINI_API_KEY is not set');

async function generateEmbedding(text) {
  const trimmed = text.slice(0, 8000);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: { parts: [{ text: trimmed }] } }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`API error ${res.status}: ${errBody.slice(0, 150)}`);
  }
  const data = await res.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) throw new Error('Empty embedding response');
  return values;
}

// ── Text builder ──────────────────────────────────────────────────────────────
function buildText(n) {
  const parse = (f) => {
    if (!f) return [];
    if (Array.isArray(f)) return f;
    try { return JSON.parse(f); } catch { return []; }
  };
  const body = [n.title, n.description].filter(Boolean).join('\n\n');
  const tags = parse(n.tags);
  const areas = parse(n.areas_conhecimento);
  const assuntos = parse(n.assuntos);
  const meta = [...new Set([...tags, ...areas, ...assuntos])].join(', ');
  return meta ? `${body}\n\n[${meta}]` : body;
}

function vectorStr(v) { return `[${v.join(',')}]`; }
function sleep(ms)    { return new Promise((r) => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Ensure pgvector extension + columns
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS embedding vector(${EMBEDDING_DIM})`);
  await pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS decs_terms JSONB DEFAULT '[]'::jsonb`);

  // Create HNSW index (halfvec for dims > 2000, pgvector 0.8+)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS notes_embedding_hnsw_idx
    ON notes USING hnsw ((embedding::halfvec(${EMBEDDING_DIM})) halfvec_cosine_ops)
    WHERE embedding IS NOT NULL
  `).catch(e => {
    console.warn('⚠️ HNSW index warning:', e.message);
  });

  // Count notes to process
  const whereClause = RESUME ? 'WHERE embedding IS NULL' : '';
  const { rows: [{ count }] } = await pool.query(
    `SELECT COUNT(*) FROM notes ${whereClause}`
  );
  const totalTodo = LIMIT > 0 ? Math.min(LIMIT, parseInt(count)) : parseInt(count);
  console.log(`\n📊 Total a embeddar: ${totalTodo} notas (resume=${RESUME}, concurrency=${CONCURRENCY})\n`);

  if (totalTodo === 0) {
    console.log('✅ Todas as notas já têm embeddings!');
    await pool.end();
    return;
  }

  // Fetch notes to process
  const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
  const { rows: toProcess } = await pool.query(
    `SELECT id, title, description, tags, areas_conhecimento, assuntos
     FROM notes ${whereClause} ORDER BY id ${limitClause}`
  );

  let done = 0, success = 0, failed = 0;
  const failures = [];
  const startTime = Date.now();

  const printProgress = () => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate    = done > 0 ? (done / ((Date.now() - startTime) / 1000)).toFixed(1) : 0;
    const eta     = rate > 0 ? Math.round((totalTodo - done) / rate) : '?';
    process.stdout.write(
      `\r⏳ ${done}/${totalTodo} | ✅ ${success} ❌ ${failed} | ${rate}/s | ETA ~${eta}s | ${elapsed}s    `
    );
  };

  async function processOne(n) {
    try {
      const text      = buildText(n);
      const embedding = await generateEmbedding(text);
      await pool.query('UPDATE notes SET embedding = $1::vector WHERE id = $2',
        [vectorStr(embedding), n.id]);
      success++;
    } catch (err) {
      failed++;
      failures.push({ id: n.id, error: err.message });
      console.error(`\n❌ note${n.id}: ${err.message}`);
    } finally {
      done++;
      printProgress();
    }
  }

  // Process in batches of CONCURRENCY
  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(processOne));
    if (i + CONCURRENCY < toProcess.length) await sleep(DELAY_MS);
  }

  // Save results
  const results = {
    timestamp: new Date().toISOString(),
    total: totalTodo,
    success,
    failed,
    failures,
    duration_s: ((Date.now() - startTime) / 1000).toFixed(1),
  };
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

  console.log(`\n\n🎉 Concluído! ${success}/${totalTodo} embeddings gerados para notas.`);
  if (failed > 0) console.log(`   ${failed} falhas salvas em ${RESULTS_FILE}`);

  await pool.end();
}

main().catch((err) => {
  console.error('\n💥 Fatal:', err);
  process.exit(1);
});
