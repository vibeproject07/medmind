/**
 * decs-vectorize-200.mjs
 *
 * Vetoriza exatamente 200 descritores DeCS:
 *   - 6 obrigatórios (epilepsia/neurologia)
 *   - 194 complementares do ramo C10 (Doenças do Sistema Nervoso)
 *
 * Salva embeddings na coluna decs_descriptors.embedding (vector 3072).
 * Exporta documento JSON com todas as informações + vetores gerados.
 *
 * Usage:
 *   node --env-file=.env.local scripts/decs-vectorize-200.mjs [--dry-run] [--out <arquivo>]
 *
 * Options:
 *   --dry-run    Seleciona e exibe os 200 termos sem gerar embeddings
 *   --out <f>    Caminho do arquivo de saída (padrão: exports/decs-vectorization-200.json)
 */

import pg      from 'pg';
import fs      from 'fs';
import path    from 'path';

const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIM   = 3072;
const TARGET_COUNT    = 200;
const CONCURRENCY     = 4;
const DELAY_MS        = 350;

const MANDATORY_NAMES = [
  'espasmos infantis',
  'síndrome de lennox-gastaut',
  'síndromes epilépticas',
  'epilepsia mioclônica juvenil',
  'eletroencefalografia',
  'epilepsias mioclônicas',
];

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const outIdx  = args.indexOf('--out');
const OUT_FILE = outIdx !== -1 ? args[outIdx + 1] : 'exports/decs-vectorization-200.json';

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function vectorStr(v) { return `[${v.join(',')}]`; }

function buildDeCSText(d) {
  const terms = Array.isArray(d.entry_terms)  ? d.entry_terms  : JSON.parse(d.entry_terms  || '[]');
  const trees  = Array.isArray(d.tree_numbers) ? d.tree_numbers : JSON.parse(d.tree_numbers || '[]');
  const parts = [
    d.name_pt,
    d.name_en ? `[${d.name_en}]` : null,
    terms.length > 0  ? `Sinônimos: ${terms.slice(0, 20).join(', ')}` : null,
    d.scope_note      ? d.scope_note.slice(0, 5000) : null,
    trees.length > 0  ? `Hierarquia: ${trees.slice(0, 5).join(' | ')}` : null,
  ].filter(Boolean);
  return parts.join('\n').slice(0, 8000);
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
        const errBody = await res.text();
        if (res.status === 429 || res.status === 503) { await sleep(attempt * 2000); continue; }
        throw new Error(`API ${res.status}: ${errBody.slice(0, 100)}`);
      }
      const data   = await res.json();
      const values = data?.embedding?.values;
      if (!Array.isArray(values) || values.length === 0) throw new Error('Embedding vazio');
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

// ── Seleção dos 200 descritores ───────────────────────────────────────────────

async function selectDescriptors(pool) {
  // 1. Obrigatórios: busca pelos nomes (ILIKE case-insensitive)
  const mandatoryPlaceholders = MANDATORY_NAMES.map((_, i) => `$${i + 1}`).join(', ');
  const { rows: mandatory } = await pool.query(
    `SELECT id, ui, name_pt, name_en, entry_terms, tree_numbers, scope_note
     FROM decs_descriptors
     WHERE LOWER(name_pt) = ANY(ARRAY[${mandatoryPlaceholders}])
     ORDER BY name_pt`,
    MANDATORY_NAMES,
  );

  const foundNames = mandatory.map(r => r.name_pt.toLowerCase());
  const missing    = MANDATORY_NAMES.filter(n => !foundNames.includes(n));
  if (missing.length > 0) {
    console.warn(`⚠️  Termos obrigatórios não encontrados (verifique a grafia): ${missing.join(', ')}`);
  }

  const mandatoryIds = mandatory.map(r => r.id);

  // 2. Complementares: ramo C10 (Doenças do Sistema Nervoso), excluindo os obrigatórios
  const needed = TARGET_COUNT - mandatory.length;
  const excludePlaceholders = mandatoryIds.length > 0
    ? `AND id NOT IN (${mandatoryIds.map((_, i) => `$${i + 2}`).join(', ')})`
    : '';

  const { rows: complement } = await pool.query(
    `SELECT id, ui, name_pt, name_en, entry_terms, tree_numbers, scope_note
     FROM decs_descriptors
     WHERE EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(tree_numbers) AS tn
       WHERE tn LIKE 'C10%'
     )
     ${excludePlaceholders}
     ORDER BY id
     LIMIT $1`,
    [needed, ...mandatoryIds],
  );

  const all = [...mandatory, ...complement];
  console.log(`\n📋 Seleção:`);
  console.log(`   Obrigatórios encontrados : ${mandatory.length}/${MANDATORY_NAMES.length}`);
  console.log(`   Complementares (C10)     : ${complement.length}`);
  console.log(`   Total                    : ${all.length}\n`);

  return all;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const pool = createPool();

  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await pool.query(
      `ALTER TABLE decs_descriptors ADD COLUMN IF NOT EXISTS embedding vector(${EMBEDDING_DIM})`,
    );

    const descriptors = await selectDescriptors(pool);

    if (DRY_RUN) {
      console.log('── DRY RUN — descritores selecionados ──');
      descriptors.forEach((d, i) => {
        const mandatory = MANDATORY_NAMES.includes(d.name_pt.toLowerCase()) ? ' ★' : '';
        console.log(`  ${String(i + 1).padStart(3)}. [${d.ui}] ${d.name_pt}${mandatory}`);
      });
      await pool.end();
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

        const terms  = Array.isArray(d.entry_terms)  ? d.entry_terms  : JSON.parse(d.entry_terms  || '[]');
        const trees  = Array.isArray(d.tree_numbers)  ? d.tree_numbers : JSON.parse(d.tree_numbers || '[]');
        const isMandatory = MANDATORY_NAMES.includes(d.name_pt.toLowerCase());

        exportRows.push({
          mandatory:    isMandatory,
          id:           d.id,
          ui:           d.ui,
          name_pt:      d.name_pt,
          name_en:      d.name_en   ?? null,
          scope_note:   d.scope_note ?? null,
          entry_terms:  terms,
          tree_numbers: trees,
          embedding_model:    EMBEDDING_MODEL,
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

    // ── Exportar documento ───────────────────────────────────────────────────

    const document = {
      metadata: {
        generated_at:        new Date().toISOString(),
        total_descriptors:   descriptors.length,
        success:             success,
        failed:              failed,
        duration_seconds:    parseFloat(duration),
        embedding_model:     EMBEDDING_MODEL,
        embedding_task_type: 'RETRIEVAL_DOCUMENT',
        embedding_dims:      EMBEDDING_DIM,
        mandatory_terms:     MANDATORY_NAMES,
        mandatory_found:     exportRows.filter(r => r.mandatory).map(r => r.name_pt),
        errors:              errors,
      },
      descriptors: exportRows.sort((a, b) => b.mandatory - a.mandatory || a.name_pt.localeCompare(b.name_pt)),
    };

    const outDir = path.dirname(OUT_FILE);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(document, null, 2), 'utf-8');

    const sizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2);
    console.log(`\n📄 Documento exportado: ${OUT_FILE}  (${sizeMB} MB)`);
    console.log(`   Campos por descritor : ui, name_pt, name_en, scope_note,`);
    console.log(`                          entry_terms, tree_numbers,`);
    console.log(`                          embedding_text_used, embedding_vector`);

  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error('\n💥 Fatal:', e.message); process.exit(1); });
