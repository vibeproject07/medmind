/**
 * Batch embedding script for MedMind questions
 * Generates Google gemini-embedding-001 embeddings for all questions
 * and stores them in pgvector + Pinecone (when PINECONE_API_KEY is set).
 *
 * Usage:
 *   node scripts/batch-embed-questions.mjs [options]
 *
 * Options:
 *   --limit N         Process only N questions (default: all)
 *   --concurrency N   Parallel embedding requests (default: 3)
 *   --delay N         ms delay between batches (default: 350)
 *   --no-resume       Re-embed even if embedding already exists
 *   --pinecone-batch N  Pinecone upsert batch size (default: 100)
 *
 * Rate limits (Gemini free tier):
 *   Safe: concurrency=3, delay=350ms → ~8 req/s
 */

import pg from 'pg';
import fs from 'fs';

// ── Config ────────────────────────────────────────────────────────────────────
const EMBEDDING_DIM   = 3072;
const EMBEDDING_MODEL = 'gemini-embedding-001';
const RESULTS_FILE    = 'embedding_results.json';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : def;
};

const LIMIT           = parseInt(getArg('limit', '0'));
const CONCURRENCY     = parseInt(getArg('concurrency', '3'));
const DELAY_MS        = parseInt(getArg('delay', '350'));
const RESUME          = !args.includes('--no-resume');
const PINECONE_BATCH  = parseInt(getArg('pinecone-batch', '100'));

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

// ── Pinecone setup (optional) ─────────────────────────────────────────────────
const pineconeKey  = process.env.PINECONE_API_KEY?.trim();
const pineconeIndex = process.env.PINECONE_INDEX_NAME?.trim() || 'medmind-questions';
let pineconeIdx = null; // will be set in main() if key is available

async function initPinecone() {
  if (!pineconeKey) return null;
  const { Pinecone } = await import('@pinecone-database/pinecone');
  const pc = new Pinecone({ apiKey: pineconeKey });

  // Create index if not exists
  const { indexes } = await pc.listIndexes();
  const exists = (indexes ?? []).some((i) => i.name === pineconeIndex);
  if (!exists) {
    console.log(`[pinecone] Creating serverless index "${pineconeIndex}"…`);
    await pc.createIndex({
      name: pineconeIndex,
      dimension: EMBEDDING_DIM,
      metric: 'cosine',
      spec: { serverless: { cloud: 'aws', region: 'us-east-1' } },
      waitUntilReady: true,
    });
    console.log('[pinecone] Index ready.');
  } else {
    console.log(`[pinecone] Using existing index "${pineconeIndex}"`);
  }

  return pc.index(pineconeIndex);
}

// Batch upsert to Pinecone
async function pineconeUpsertBatch(vectors) {
  if (!pineconeIdx || vectors.length === 0) return;
  for (let i = 0; i < vectors.length; i += PINECONE_BATCH) {
    const chunk = vectors.slice(i, i + PINECONE_BATCH);
    await pineconeIdx.upsert(chunk);
  }
}

// ── Text builder ──────────────────────────────────────────────────────────────
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
  const meta = [...new Set([
    ...parse(q.tags),
    ...parse(q.areas_conhecimento),
    ...parse(q.assuntos),
    ...parse(q.decs_terms),
  ])].join(', ');
  return meta ? `${parts}\n\n[${meta}]` : parts;
}

function vectorStr(v) { return `[${v.join(',')}]`; }
function sleep(ms)    { return new Promise((r) => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Ensure pgvector extension + column
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS embedding vector(${EMBEDDING_DIM})`);

  // Init Pinecone (if key set)
  pineconeIdx = await initPinecone();
  if (pineconeIdx) {
    console.log('✅ Pinecone habilitado — vectors serão enviados para Pinecone + pgvector');
  } else {
    console.log('⚠️  Pinecone não configurado — apenas pgvector');
  }

  // Count questions to process
  const whereClause = RESUME ? 'WHERE embedding IS NULL' : '';
  const { rows: [{ count }] } = await pool.query(
    `SELECT COUNT(*) FROM questions ${whereClause}`
  );
  const totalTodo = LIMIT > 0 ? Math.min(LIMIT, parseInt(count)) : parseInt(count);
  console.log(`\n📊 Total a embeddar: ${totalTodo} questões (resume=${RESUME}, concurrency=${CONCURRENCY})\n`);

  if (totalTodo === 0) {
    console.log('✅ Todas as questões já têm embeddings!');
    await pool.end();
    return;
  }

  // Fetch questions to process
  const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
  const { rows: toProcess } = await pool.query(
    `SELECT id, statement, option_a, option_b, option_c, option_d, option_e,
            tags, areas_conhecimento, assuntos, decs_terms,
            exam_year, exam_board, exam_institution
     FROM questions ${whereClause} ORDER BY id ${limitClause}`
  );

  let done = 0, success = 0, failed = 0;
  const failures = [];
  const startTime = Date.now();
  const pendingPinecone = []; // accumulated Pinecone vectors for batch upsert

  const printProgress = () => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate    = done > 0 ? (done / ((Date.now() - startTime) / 1000)).toFixed(1) : 0;
    const eta     = rate > 0 ? Math.round((totalTodo - done) / rate) : '?';
    process.stdout.write(
      `\r⏳ ${done}/${totalTodo} | ✅ ${success} ❌ ${failed} | ${rate}/s | ETA ~${eta}s | ${elapsed}s    `
    );
  };

  async function processOne(q) {
    try {
      const text      = buildText(q);
      const embedding = await generateEmbedding(text);

      // pgvector
      await pool.query('UPDATE questions SET embedding = $1::vector WHERE id = $2',
        [vectorStr(embedding), q.id]);

      // Queue for Pinecone batch
      if (pineconeIdx) {
        const parse = (f) => { try { return JSON.parse(f || '[]'); } catch { return []; } };
        pendingPinecone.push({
          id: `q-${q.id}`,
          values: embedding,
          metadata: {
            question_id: q.id,
            statement_preview: q.statement.slice(0, 300),
            exam_year: q.exam_year,
            exam_board: q.exam_board,
            exam_institution: q.exam_institution,
            tags: JSON.stringify(parse(q.tags)),
            areas_conhecimento: JSON.stringify(parse(q.areas_conhecimento)),
          },
        });
        // Flush Pinecone in chunks of PINECONE_BATCH
        if (pendingPinecone.length >= PINECONE_BATCH) {
          const batch = pendingPinecone.splice(0, PINECONE_BATCH);
          await pineconeIdx.upsert(batch);
        }
      }

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

  // Process in batches of CONCURRENCY
  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(processOne));
    if (i + CONCURRENCY < toProcess.length) await sleep(DELAY_MS);
  }

  // Flush remaining Pinecone vectors
  if (pineconeIdx && pendingPinecone.length > 0) {
    process.stdout.write('\n📤 Enviando últimas vectors para Pinecone…\n');
    await pineconeUpsertBatch(pendingPinecone);
  }

  // Create pgvector HNSW index
  if (success > 0) {
    process.stdout.write('\n🔧 Criando índice HNSW no pgvector…\n');
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
    backends: pineconeIdx ? ['pgvector', 'pinecone'] : ['pgvector'],
  };
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

  console.log(`\n\n🎉 Concluído! ${success}/${totalTodo} embeddings gerados.`);
  if (pineconeIdx) console.log(`   Vectors upserted para Pinecone (index: ${pineconeIndex})`);
  if (failed > 0) console.log(`   ${failed} falhas salvas em ${RESULTS_FILE}`);

  await pool.end();
}

main().catch((err) => {
  console.error('\n💥 Fatal:', err);
  process.exit(1);
});
