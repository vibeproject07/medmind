/**
 * Batch embedding script for MedMind questions
 * Generates Google text-embedding-004 embeddings for all questions
 * that don't have one yet, and stores them in the pgvector column.
 *
 * Usage:
 *   node scripts/batch-embed-questions.mjs [--limit N] [--concurrency N] [--resume]
 *
 * Defaults: limit=all, concurrency=5, resume=true (skips questions with embeddings)
 *
 * Rate limits:
 *   - Google Embedding API: ~1500 requests/min on free tier
 *   - With concurrency=5 and ~100ms delay each = ~50/s = 3000/min (needs paid tier)
 *   - Safe setting: concurrency=3, delay=300ms ≈ 10/s = 600/min (free tier)
 */

import pg from 'pg';
import fs from 'fs';

// ── Config ───────────────────────────────────────────────────────────────────
const EMBEDDING_DIM = 3072;
const EMBEDDING_MODEL = 'gemini-embedding-001';
const RESULTS_FILE = 'embedding_results.json';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : def;
};

const LIMIT     = parseInt(getArg('limit', '0'));      // 0 = no limit
const CONCURRENCY = parseInt(getArg('concurrency', '3'));
const DELAY_MS  = parseInt(getArg('delay', '350'));    // ms between requests (same slot)
const RESUME    = !args.includes('--no-resume');       // skip already-embedded by default

// ── DB + API setup ────────────────────────────────────────────────────────────
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const geminiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
if (!geminiKey) throw new Error('GEMINI_API_KEY is not set');

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildText(q) {
  const parse = (f) => {
    if (!f) return [];
    if (Array.isArray(f)) return f;
    try { return JSON.parse(f); } catch { return []; }
  };

  const parts = [
    q.statement,
    q.option_a ? `A) ${q.option_a}` : null,
    q.option_b ? `B) ${q.option_b}` : null,
    q.option_c ? `C) ${q.option_c}` : null,
    q.option_d ? `D) ${q.option_d}` : null,
    q.option_e ? `E) ${q.option_e}` : null,
  ].filter(Boolean).join('\n');

  const tags   = parse(q.tags);
  const areas  = parse(q.areas_conhecimento);
  const assuntos = parse(q.assuntos);
  const decs   = parse(q.decs_terms);
  const meta   = [...new Set([...tags, ...areas, ...assuntos, ...decs])].join(', ');

  return meta ? `${parts}\n\n[${meta}]` : parts;
}

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
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Empty embedding response');
  }
  return values;
}

function vectorStr(v) {
  return `[${v.join(',')}]`;
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Ensure extension + column exist
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pool.query(
    `ALTER TABLE questions ADD COLUMN IF NOT EXISTS embedding vector(${EMBEDDING_DIM})`
  );

  // Count total
  const countQ = RESUME
    ? `SELECT COUNT(*) FROM questions WHERE embedding IS NULL`
    : `SELECT COUNT(*) FROM questions`;
  const { rows: [{ count }] } = await pool.query(countQ);
  const totalTodo = LIMIT > 0 ? Math.min(LIMIT, parseInt(count)) : parseInt(count);

  console.log(`\n📊 Total a embeddar: ${totalTodo} questões (resume=${RESUME}, concurrency=${CONCURRENCY})\n`);

  if (totalTodo === 0) {
    console.log('✅ Todas as questões já têm embeddings!');
    await pool.end();
    return;
  }

  // Fetch IDs to process
  const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
  const whereClause = RESUME ? 'WHERE embedding IS NULL' : '';
  const { rows: toProcess } = await pool.query(
    `SELECT id, statement, option_a, option_b, option_c, option_d, option_e,
            tags, areas_conhecimento, assuntos, decs_terms
     FROM questions ${whereClause} ORDER BY id ${limitClause}`
  );

  // State tracking
  let done = 0, success = 0, failed = 0;
  const failures = [];
  const startTime = Date.now();

  const printProgress = () => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = done > 0 ? (done / ((Date.now() - startTime) / 1000)).toFixed(1) : 0;
    const eta  = rate > 0 ? Math.round((totalTodo - done) / rate) : '?';
    process.stdout.write(
      `\r⏳ ${done}/${totalTodo} | ✅ ${success} ❌ ${failed} | ${rate}/s | ETA ~${eta}s | elapsed ${elapsed}s    `
    );
  };

  // Process in concurrent slots
  async function processOne(q) {
    try {
      const text = buildText(q);
      const embedding = await generateEmbedding(text);
      await pool.query(
        'UPDATE questions SET embedding = $1::vector WHERE id = $2',
        [vectorStr(embedding), q.id]
      );
      success++;
    } catch (err) {
      failed++;
      failures.push({ id: q.id, error: err.message });
      console.error(`\n❌ q${q.id}: ${err.message}`);
    } finally {
      done++;
      printProgress();
    }
  }

  // Chunk into batches of CONCURRENCY
  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((q) => processOne(q)));
    if (i + CONCURRENCY < toProcess.length) await sleep(DELAY_MS);
  }

  // Create HNSW index if not exists (only if we have ≥1 embedding)
  if (success > 0) {
    process.stdout.write('\n🔧 Criando índice HNSW (pode demorar)...\n');
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS questions_embedding_hnsw_idx
        ON questions USING hnsw (embedding vector_cosine_ops)
      `);
      console.log('✅ Índice HNSW criado');
    } catch (e) {
      console.error('⚠️ Erro ao criar índice:', e.message);
    }
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

  console.log(`\n\n🎉 Concluído! ${success}/${totalTodo} embeddings gerados.`);
  if (failed > 0) console.log(`   ${failed} falhas salvas em ${RESULTS_FILE}`);

  await pool.end();
}

main().catch((err) => {
  console.error('\n💥 Fatal:', err);
  process.exit(1);
});
