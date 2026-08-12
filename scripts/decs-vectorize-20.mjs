/**
 * decs-vectorize-20.mjs
 *
 * Vetoriza 20 descritores DeCS, priorizando os que ainda NÃO têm embedding.
 * Se todos já foram vetorizados, seleciona os 20 mais antigos (menor id).
 *
 * Exporta diretamente no formato compacto (strings 4/linha, vetores 8/linha),
 * sem necessidade de rodar decs-compress-json.mjs separadamente.
 *
 * Usage:
 *   node --env-file=.env.local scripts/decs-vectorize-20.mjs [--dry-run] [--out <arquivo>]
 *
 * Options:
 *   --dry-run    Exibe os 20 descritores selecionados sem chamar a API
 *   --out <f>    Caminho de saída (padrão: exports/decs-vectorization-20.json)
 */

import pg   from 'pg';
import fs   from 'fs';
import path from 'path';

const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIM   = 3072;
const TARGET_COUNT    = 20;
const CONCURRENCY     = 4;
const DELAY_MS        = 350;

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const outIdx  = args.indexOf('--out');
const OUT_FILE = outIdx !== -1 ? args[outIdx + 1] : 'exports/decs-vectorization-20.json';

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms)      { return new Promise(r => setTimeout(r, ms)); }
function vectorStr(v)   { return `[${v.join(',')}]`; }

function buildDeCSText(d) {
  const terms = Array.isArray(d.entry_terms)  ? d.entry_terms  : JSON.parse(d.entry_terms  || '[]');
  const trees = Array.isArray(d.tree_numbers) ? d.tree_numbers : JSON.parse(d.tree_numbers || '[]');
  return [
    d.name_pt,
    d.name_en ? `[${d.name_en}]` : null,
    terms.length > 0 ? `Sinônimos: ${terms.slice(0, 245).join(', ')}` : null,
    d.scope_note     ? d.scope_note.slice(0, 5000) : null,
    trees.length > 0 ? `Hierarquia: ${trees.slice(0, 5).join(' | ')}` : null,
  ].filter(Boolean).join('\n').slice(0, 8000);
}

// ── Serializador compacto (inline — sem dependência externa) ──────────────────

const INDENT         = '  ';
const VEC_PER_LINE   = 8;
const STR_PER_LINE   = 4;

function isStringArr(a) { return Array.isArray(a) && a.every(v => typeof v === 'string'); }
function isNumberArr(a) { return Array.isArray(a) && a.every(v => typeof v === 'number'); }

function fmtStrArr(arr, base) {
  if (!arr.length) return '[]';
  const inn = base + INDENT;
  const chunks = [];
  for (let i = 0; i < arr.length; i += STR_PER_LINE)
    chunks.push(inn + arr.slice(i, i + STR_PER_LINE).map(s => JSON.stringify(s)).join(', '));
  return '[\n' + chunks.join(',\n') + '\n' + base + ']';
}

function fmtVec(arr, base) {
  if (!arr.length) return '[]';
  const inn = base + INDENT;
  const chunks = [];
  for (let i = 0; i < arr.length; i += VEC_PER_LINE)
    chunks.push(inn + arr.slice(i, i + VEC_PER_LINE).join(', '));
  return '[\n' + chunks.join(',\n') + '\n' + base + ']';
}

function serialize(value, indent, key) {
  if (value === null)             return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number')  return String(value);
  if (typeof value === 'string')  return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (key === 'embedding_vector' && isNumberArr(value)) return fmtVec(value, indent);
    if (isStringArr(value)) return fmtStrArr(value, indent);
    if (!value.length) return '[]';
    const inn   = indent + INDENT;
    const items = value.map(v => inn + serialize(v, inn, null));
    return '[\n' + items.join(',\n') + '\n' + indent + ']';
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    const inn   = indent + INDENT;
    const lines = entries.map(([k, v]) => `${inn}${JSON.stringify(k)}: ${serialize(v, inn, k)}`);
    return '{\n' + lines.join(',\n') + '\n' + indent + '}';
  }
  return JSON.stringify(value);
}

// ── Gemini embedding ──────────────────────────────────────────────────────────

async function generateEmbedding(text, retries = 3) {
  const key = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '').trim();
  if (!key) throw new Error('GEMINI_API_KEY não definida.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${key}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          content:  { parts: [{ text }] },
          taskType: 'RETRIEVAL_DOCUMENT',
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        if (res.status === 429 || res.status === 503) { await sleep(attempt * 2000); continue; }
        throw new Error(`API ${res.status}: ${err.slice(0, 100)}`);
      }
      const data   = await res.json();
      const values = data?.embedding?.values;
      if (!Array.isArray(values) || !values.length) throw new Error('Embedding vazio');
      return values;
    } catch (e) {
      if (attempt === retries) throw e;
      await sleep(attempt * 1500);
    }
  }
}

// ── Banco de dados ────────────────────────────────────────────────────────────

function createPool() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL não definida.');
  const { Pool } = pg;
  return new Pool({ connectionString: url });
}

// ── Seleção dos 20 descritores ────────────────────────────────────────────────

async function selectDescriptors(pool) {
  // Contagem total e de não-vetorizados
  const { rows: [stats] } = await pool.query(`
    SELECT
      COUNT(*)                          AS total,
      COUNT(*) FILTER (WHERE embedding IS NULL) AS sem_embedding
    FROM decs_descriptors
  `);

  const total        = parseInt(stats.total);
  const semEmbedding = parseInt(stats.sem_embedding);

  console.log(`\n📊 Estado do banco:`);
  console.log(`   Total de descritores     : ${total}`);
  console.log(`   Sem embedding (pendentes): ${semEmbedding}`);
  console.log(`   Com embedding            : ${total - semEmbedding}`);

  let rows, mode;

  if (semEmbedding >= TARGET_COUNT) {
    // Caso preferencial: há pelo menos 20 sem embedding → pega os primeiros 20 (menor id)
    const { rows: r } = await pool.query(`
      SELECT id, ui, name_pt, name_en, entry_terms, tree_numbers, scope_note
      FROM decs_descriptors
      WHERE embedding IS NULL
      ORDER BY id
      LIMIT $1
    `, [TARGET_COUNT]);
    rows = r;
    mode = `${semEmbedding} descritores sem embedding — selecionando os ${TARGET_COUNT} primeiros (menor id)`;
  } else if (semEmbedding > 0) {
    // Poucos sem embedding: pega todos os sem + complementa com os mais antigos COM embedding
    const { rows: semEmb } = await pool.query(`
      SELECT id, ui, name_pt, name_en, entry_terms, tree_numbers, scope_note
      FROM decs_descriptors
      WHERE embedding IS NULL
      ORDER BY id
    `);
    const needed = TARGET_COUNT - semEmb.length;
    const semEmbIds = semEmb.map(r => r.id);
    const placeholders = semEmbIds.map((_, i) => `$${i + 2}`).join(', ');
    const excludeClause = semEmbIds.length > 0 ? `AND id NOT IN (${placeholders})` : '';
    const { rows: comEmb } = await pool.query(`
      SELECT id, ui, name_pt, name_en, entry_terms, tree_numbers, scope_note
      FROM decs_descriptors
      WHERE embedding IS NOT NULL ${excludeClause}
      ORDER BY id
      LIMIT $1
    `, [needed, ...semEmbIds]);
    rows = [...semEmb, ...comEmb];
    mode = `${semEmb.length} sem embedding + ${comEmb.length} já vetorizados (para completar ${TARGET_COUNT})`;
  } else {
    // Todos já têm embedding → seleciona os 20 de menor id (revetoriza)
    const { rows: r } = await pool.query(`
      SELECT id, ui, name_pt, name_en, entry_terms, tree_numbers, scope_note
      FROM decs_descriptors
      WHERE embedding IS NOT NULL
      ORDER BY id
      LIMIT $1
    `, [TARGET_COUNT]);
    rows = r;
    mode = `Todos os ${total} descritores já têm embedding — revetorizando os ${TARGET_COUNT} de menor id`;
  }

  console.log(`\n📋 Modo de seleção: ${mode}`);
  console.log(`   Descritores a vetorizar  : ${rows.length}\n`);

  return { rows, semEmbedding, total };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const pool = createPool();

  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await pool.query(
      `ALTER TABLE decs_descriptors ADD COLUMN IF NOT EXISTS embedding vector(${EMBEDDING_DIM})`,
    );

    const { rows: descriptors, semEmbedding, total } = await selectDescriptors(pool);

    if (DRY_RUN) {
      console.log('── DRY RUN — descritores selecionados ──');
      descriptors.forEach((d, i) => {
        console.log(`  ${String(i + 1).padStart(2)}. [${d.ui}] ${d.name_pt}`);
      });
      return;
    }

    console.log(`🧠 Iniciando vetorização de ${descriptors.length} descritores`);
    console.log(`   Modelo : ${EMBEDDING_MODEL} (RETRIEVAL_DOCUMENT, ${EMBEDDING_DIM} dims)`);
    console.log(`   Conc.  : ${CONCURRENCY} | Delay: ${DELAY_MS}ms\n`);

    let done = 0, success = 0, failed = 0;
    const startTime  = Date.now();
    const exportRows = [];
    const errors     = [];

    const printProgress = () => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate    = done > 0 ? (done / ((Date.now() - startTime) / 1000)).toFixed(1) : 0;
      const eta     = rate > 0 ? Math.round((descriptors.length - done) / rate) : '?';
      process.stdout.write(
        `\r⏳ ${done}/${descriptors.length} | ✅ ${success} ❌ ${failed} | ${rate}/s | ETA ~${eta}s | ${elapsed}s    `,
      );
    };

    async function processOne(d) {
      const text = buildDeCSText(d);
      try {
        const embedding = await generateEmbedding(text);

        await pool.query(
          'UPDATE decs_descriptors SET embedding = $1::vector WHERE id = $2',
          [vectorStr(embedding), d.id],
        );

        const terms = Array.isArray(d.entry_terms)  ? d.entry_terms  : JSON.parse(d.entry_terms  || '[]');
        const trees = Array.isArray(d.tree_numbers) ? d.tree_numbers : JSON.parse(d.tree_numbers || '[]');

        exportRows.push({
          id:                  d.id,
          ui:                  d.ui,
          name_pt:             d.name_pt,
          name_en:             d.name_en ?? null,
          scope_note:          d.scope_note ?? null,
          entry_terms:         terms,
          tree_numbers:        trees,
          embedding_model:     EMBEDDING_MODEL,
          embedding_task_type: 'RETRIEVAL_DOCUMENT',
          embedding_dims:      EMBEDDING_DIM,
          embedding_text_used: text,
          embedding_vector:    embedding,
        });

        success++;
      } catch (e) {
        failed++;
        errors.push({ ui: d.ui, name_pt: d.name_pt, error: e.message });
        process.stdout.write(`\n❌ [${d.ui}] ${d.name_pt}: ${e.message}\n`);
      } finally {
        done++;
        printProgress();
      }
    }

    for (let i = 0; i < descriptors.length; i += CONCURRENCY) {
      const batch = descriptors.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(processOne));
      if (i + CONCURRENCY < descriptors.length) await sleep(DELAY_MS);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write('\n\n');
    console.log(`🎉 Vetorização concluída!`);
    console.log(`   Sucesso  : ${success}/${descriptors.length}`);
    console.log(`   Erros    : ${failed}`);
    console.log(`   Duração  : ${duration}s`);

    // Contagem final de vetorizados
    const { rows: [after] } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS com_embedding FROM decs_descriptors`,
    );
    const comEmbeddingAfter = parseInt(after.com_embedding);
    console.log(`\n📊 Pós-vetorização: ${comEmbeddingAfter}/${total} descritores com embedding`);

    // ── Exportar documento compacto ───────────────────────────────────────────

    exportRows.sort((a, b) => a.id - b.id);

    const document = {
      metadata: {
        generated_at:          new Date().toISOString(),
        total_descriptors:     descriptors.length,
        success:               success,
        failed:                failed,
        duration_seconds:      parseFloat(duration),
        embedding_model:       EMBEDDING_MODEL,
        embedding_task_type:   'RETRIEVAL_DOCUMENT',
        embedding_dims:        EMBEDDING_DIM,
        db_total_descriptors:  total,
        db_with_embedding_after: comEmbeddingAfter,
        db_pending_after:      total - comEmbeddingAfter,
        selection_note:        semEmbedding >= TARGET_COUNT
          ? `Selecionados entre ${semEmbedding} descritores sem embedding (os ${TARGET_COUNT} de menor id)`
          : semEmbedding > 0
            ? `${semEmbedding} sem embedding + complementados com já-vetorizados`
            : `Todos vetorizados — revetorizados os ${TARGET_COUNT} de menor id`,
        errors:                errors,
      },
      descriptors: exportRows,
    };

    const outDir = path.dirname(OUT_FILE);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(OUT_FILE, serialize(document, '') + '\n', 'utf-8');

    const sizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2);
    console.log(`\n📄 Exportado (compacto): ${OUT_FILE}  (${sizeMB} MB)`);

    if (errors.length > 0) {
      console.log(`\n⚠️  Erros:`);
      errors.forEach(e => console.log(`   [${e.ui}] ${e.name_pt}: ${e.error}`));
    }

  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error('\n💥 Fatal:', e.message); process.exit(1); });
