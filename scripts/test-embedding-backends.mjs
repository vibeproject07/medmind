/**
 * Teste comparativo: pgvector vs Pinecone
 * Gera embeddings para 10 questões e testa similaridade em ambos os backends.
 * Saída: embedding_test_results.json
 */

import pg from 'pg';
import { Pinecone } from '@pinecone-database/pinecone';
import fs from 'fs';

// ── Config ────────────────────────────────────────────────────────────────────
const EMBEDDING_DIM   = 3072;
const EMBEDDING_MODEL = 'gemini-embedding-001';
const OUTPUT_FILE     = 'embedding_test_results.json';
const TEST_SAMPLE     = 10;  // questões a testar
const SIMILAR_TOP_K   = 5;   // vizinhos mais próximos a recuperar

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const geminiKey = process.env.GEMINI_API_KEY?.trim();
if (!geminiKey) throw new Error('GEMINI_API_KEY not set');

const pineconeKey   = process.env.PINECONE_API_KEY?.trim();
const pineconeIdxName = process.env.PINECONE_INDEX_NAME?.trim() || 'medmind-questions';

// ── Helpers ───────────────────────────────────────────────────────────────────
async function generateEmbedding(text) {
  const trimmed = text.slice(0, 8000);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: { parts: [{ text: trimmed }] } }),
  });
  if (!res.ok) throw new Error(`Embedding API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) throw new Error('Empty embedding response');
  return values;
}

function buildText(q) {
  const parse = (f) => { try { return Array.isArray(f) ? f : JSON.parse(f || '[]'); } catch { return []; } };
  const parts = [
    q.statement,
    q.option_a ? `A) ${q.option_a}` : null,
    q.option_b ? `B) ${q.option_b}` : null,
    q.option_c ? `C) ${q.option_c}` : null,
    q.option_d ? `D) ${q.option_d}` : null,
    q.option_e ? `E) ${q.option_e}` : null,
  ].filter(Boolean).join('\n');
  const meta = [...new Set([
    ...parse(q.tags), ...parse(q.areas_conhecimento),
    ...parse(q.assuntos), ...parse(q.decs_terms),
  ])].join(', ');
  return meta ? `${parts}\n\n[${meta}]` : parts;
}

function vectorStr(v) { return `[${v.join(',')}]`; }

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function msToSeconds(ms) { return (ms / 1000).toFixed(3); }

// ── Pinecone init ─────────────────────────────────────────────────────────────
async function initPinecone() {
  if (!pineconeKey) return null;
  const pc = new Pinecone({ apiKey: pineconeKey });
  const { indexes } = await pc.listIndexes();
  const exists = (indexes ?? []).some((i) => i.name === pineconeIdxName);
  if (!exists) {
    console.log(`[pinecone] Criando índice "${pineconeIdxName}"…`);
    await pc.createIndex({
      name: pineconeIdxName,
      dimension: EMBEDDING_DIM,
      metric: 'cosine',
      spec: { serverless: { cloud: 'aws', region: 'us-east-1' } },
      waitUntilReady: true,
    });
  }
  return pc.index(pineconeIdxName);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔬 MedMind — Teste de Backends de Embedding');
  console.log('==========================================\n');

  const results = {
    metadata: {
      timestamp: new Date().toISOString(),
      embedding_model: EMBEDDING_MODEL,
      embedding_dimensions: EMBEDDING_DIM,
      test_sample_size: TEST_SAMPLE,
      similar_top_k: SIMILAR_TOP_K,
      backends_tested: [],
    },
    questions: [],
    summary: {},
    backend_comparison: null,
  };

  // 1. Fetch 10 questions ───────────────────────────────────────────────────
  console.log(`📋 Buscando ${TEST_SAMPLE} questões do banco…`);
  const { rows: questions } = await pool.query(`
    SELECT id, statement, option_a, option_b, option_c, option_d, option_e,
           tags, areas_conhecimento, assuntos, decs_terms,
           exam_year, exam_board, exam_institution, exam_region,
           embedding::text AS embedding_text
    FROM questions
    ORDER BY id
    LIMIT $1
  `, [TEST_SAMPLE]);

  console.log(`   Questões encontradas: ${questions.length}`);
  const alreadyEmbedded = questions.filter(q => q.embedding_text).length;
  console.log(`   Com embedding existente: ${alreadyEmbedded}`);
  console.log(`   Sem embedding (serão gerados): ${questions.length - alreadyEmbedded}\n`);

  // 2. Generate missing embeddings ─────────────────────────────────────────
  const embeddings = {}; // id → float[]

  for (const q of questions) {
    if (q.embedding_text) {
      embeddings[q.id] = q.embedding_text
        .replace(/^\[|\]$/g, '').split(',').map(Number);
      console.log(`  ✓ Q${q.id}: embedding carregado do pgvector (${embeddings[q.id].length} dims)`);
    } else {
      process.stdout.write(`  ⏳ Q${q.id}: gerando embedding… `);
      const t0 = Date.now();
      const text = buildText(q);
      const emb = await generateEmbedding(text);
      embeddings[q.id] = emb;
      const elapsed = Date.now() - t0;
      process.stdout.write(`✓ ${emb.length} dims em ${elapsed}ms\n`);

      // Save to pgvector
      await pool.query('UPDATE questions SET embedding = $1::vector WHERE id = $2',
        [vectorStr(emb), q.id]);
    }
  }

  console.log('\n');

  // 3. Init Pinecone ────────────────────────────────────────────────────────
  const pinecone = await initPinecone();
  if (pinecone) {
    results.metadata.backends_tested = ['pgvector', 'pinecone'];
    console.log(`✅ Pinecone conectado ao índice "${pineconeIdxName}"\n`);

    // Upsert all 10 into Pinecone
    console.log('📤 Upserting 10 questões no Pinecone…');
    const vectors = questions.map(q => {
      const meta = { question_id: q.id, statement_preview: q.statement.slice(0, 300) };
      if (q.exam_year)        meta.exam_year        = q.exam_year;
      if (q.exam_board)       meta.exam_board       = q.exam_board;
      if (q.exam_institution) meta.exam_institution = q.exam_institution;
      return { id: `q-${q.id}`, values: embeddings[q.id], metadata: meta };
    });
    console.log(`   Vetores preparados: ${vectors.length} (valores[0] dims: ${vectors[0]?.values?.length})`);
    const t0 = Date.now();
    await pinecone.upsert({ records: vectors });
    console.log(`   Upsert concluído em ${Date.now() - t0}ms\n`);

    // Wait a moment for Pinecone to index
    await new Promise(r => setTimeout(r, 3000));
  } else {
    results.metadata.backends_tested = ['pgvector'];
    console.log('⚠️  Pinecone não configurado — apenas pgvector será testado.\n');
  }

  // 4. Per-question similarity tests ────────────────────────────────────────
  console.log('🔍 Testando similaridade para cada questão…\n');

  for (const q of questions) {
    const qEmbedding = embeddings[q.id];
    const qResult = {
      id: q.id,
      statement_preview: q.statement.slice(0, 200) + (q.statement.length > 200 ? '…' : ''),
      exam_year: q.exam_year,
      exam_board: q.exam_board,
      exam_institution: q.exam_institution,
      pgvector: null,
      pinecone: null,
    };

    // ── pgvector test ───────────────────────────────────────────────────────
    const t1 = Date.now();
    const pgRes = await pool.query(`
      SELECT
        q.id,
        q.statement,
        q.exam_year,
        q.exam_board,
        q.exam_institution,
        1 - (q.embedding <=> ref.embedding) AS similarity
      FROM questions q,
           (SELECT embedding FROM questions WHERE id = $1) AS ref
      WHERE q.id != $1
        AND q.embedding IS NOT NULL
      ORDER BY q.embedding <=> ref.embedding
      LIMIT $2
    `, [q.id, SIMILAR_TOP_K]);
    const pgLatency = Date.now() - t1;

    qResult.pgvector = {
      latency_ms: pgLatency,
      results: pgRes.rows.map(r => ({
        id: r.id,
        similarity: parseFloat(parseFloat(r.similarity).toFixed(6)),
        statement_preview: r.statement.slice(0, 120) + '…',
        exam_year: r.exam_year,
        exam_board: r.exam_board,
      })),
    };

    // ── local cosine (validation) ───────────────────────────────────────────
    const localResults = questions
      .filter(oq => oq.id !== q.id)
      .map(oq => ({
        id: oq.id,
        similarity: parseFloat(cosineSimilarity(qEmbedding, embeddings[oq.id]).toFixed(6)),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, SIMILAR_TOP_K);

    qResult.local_cosine_validation = localResults;

    // ── Pinecone test ───────────────────────────────────────────────────────
    if (pinecone) {
      const t2 = Date.now();
      const pcRes = await pinecone.query({
        vector: qEmbedding,
        topK: SIMILAR_TOP_K + 1, // +1 to exclude self
        includeMetadata: true,
      });
      const pineconeLatency = Date.now() - t2;

      const filtered = (pcRes.matches ?? []).filter(m => m.id !== `q-${q.id}`).slice(0, SIMILAR_TOP_K);

      qResult.pinecone = {
        latency_ms: pineconeLatency,
        results: filtered.map(m => ({
          id: parseInt(m.id.replace('q-', '')),
          similarity: parseFloat((m.score ?? 0).toFixed(6)),
          statement_preview: (m.metadata?.statement_preview ?? '').slice(0, 120) + '…',
          exam_year: m.metadata?.exam_year ?? null,
          exam_board: m.metadata?.exam_board ?? null,
        })),
      };

      // ── Agreement score ─────────────────────────────────────────────────
      const pgIds = new Set(qResult.pgvector.results.map(r => r.id));
      const pcIds = new Set(qResult.pinecone.results.map(r => r.id));
      const intersection = [...pgIds].filter(id => pcIds.has(id)).length;
      qResult.backend_agreement = {
        shared_results: intersection,
        total_results: SIMILAR_TOP_K,
        agreement_pct: parseFloat((intersection / SIMILAR_TOP_K * 100).toFixed(1)),
      };
    }

    results.questions.push(qResult);
    const pgTop = qResult.pgvector.results[0];
    const pcTop = qResult.pinecone?.results[0];
    console.log(
      `  Q${q.id}: pgvector=${pgLatency}ms top=(Q${pgTop?.id}, ${pgTop?.similarity?.toFixed(3)})` +
      (pcTop ? ` | pinecone=${qResult.pinecone.latency_ms}ms top=(Q${pcTop?.id}, ${pcTop?.similarity?.toFixed(3)})` : '')
    );
  }

  // 5. Summary ───────────────────────────────────────────────────────────────
  const pgLatencies = results.questions.map(q => q.pgvector.latency_ms);
  const pgAvg = (pgLatencies.reduce((a,b) => a+b, 0) / pgLatencies.length).toFixed(1);
  const pgMin = Math.min(...pgLatencies);
  const pgMax = Math.max(...pgLatencies);

  results.summary = {
    pgvector: {
      avg_latency_ms: parseFloat(pgAvg),
      min_latency_ms: pgMin,
      max_latency_ms: pgMax,
      total_vectors_in_db: (await pool.query('SELECT COUNT(*) FROM questions WHERE embedding IS NOT NULL')).rows[0].count,
    },
  };

  if (pinecone) {
    const pcLatencies = results.questions.map(q => q.pinecone?.latency_ms ?? 0);
    const pcAvg = (pcLatencies.reduce((a,b) => a+b, 0) / pcLatencies.length).toFixed(1);
    const stats = await pinecone.describeIndexStats();

    results.summary.pinecone = {
      avg_latency_ms: parseFloat(pcAvg),
      min_latency_ms: Math.min(...pcLatencies),
      max_latency_ms: Math.max(...pcLatencies),
      total_vectors_in_index: stats.totalRecordCount ?? 0,
      index_fullness: stats.indexFullness ?? 0,
    };

    const agreements = results.questions
      .filter(q => q.backend_agreement)
      .map(q => q.backend_agreement.agreement_pct);
    const avgAgreement = (agreements.reduce((a,b) => a+b, 0) / agreements.length).toFixed(1);

    results.backend_comparison = {
      avg_pgvector_latency_ms: parseFloat(pgAvg),
      avg_pinecone_latency_ms: parseFloat(pcAvg),
      faster_backend: parseFloat(pgAvg) <= parseFloat(pcAvg) ? 'pgvector' : 'pinecone',
      avg_result_agreement_pct: parseFloat(avgAgreement),
      notes: [
        'pgvector roda localmente (sem latência de rede)',
        'Pinecone é serverless gerenciado — inclui latência de rede',
        'Alta concordância (>80%) confirma que ambos retornam resultados equivalentes',
      ],
    };
  }

  // 6. Save ──────────────────────────────────────────────────────────────────
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf8');

  console.log('\n');
  console.log('═══════════════════════════════════════════════');
  console.log('📊 RESUMO');
  console.log('═══════════════════════════════════════════════');
  console.log(`pgvector — avg latência: ${pgAvg}ms (min:${pgMin} max:${pgMax})`);
  if (results.summary.pinecone) {
    const s = results.summary.pinecone;
    console.log(`Pinecone  — avg latência: ${s.avg_latency_ms}ms (min:${s.min_latency_ms} max:${s.max_latency_ms})`);
    console.log(`Concordância média de resultados: ${results.backend_comparison.avg_result_agreement_pct}%`);
    console.log(`Backend mais rápido: ${results.backend_comparison.faster_backend}`);
    console.log(`Vetores no Pinecone: ${s.total_vectors_in_index}`);
  }
  console.log(`\n✅ Resultados salvos em: ${OUTPUT_FILE}`);

  await pool.end();
}

main().catch(err => { console.error('💥 Fatal:', err); process.exit(1); });
