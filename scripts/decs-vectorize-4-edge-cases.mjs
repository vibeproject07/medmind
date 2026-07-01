/**
 * decs-vectorize-4-edge-cases.mjs
 *
 * Extrai e revetoriza 4 descritores "casos extremos" do DeCS:
 *
 *   Termo 1 — Diabetes Mellitus
 *             Incluído SE ainda não estiver em exports/decs-vectorization-200-compact.json
 *
 *   Termo 2 — Descritor com exatamente 245 entry_terms (máximo do banco)
 *             → "Caso ruim": buildDeCSText() usa slice(0,20), logo 225 sinônimos
 *                são IGNORADOS na geração do embedding
 *
 *   Termo 3 — Descritor com o maior nº de entry_terms abaixo de 245
 *             (se nenhum tiver >230, usa o 2º lugar do ranking)
 *             → Mesmo problema do Termo 2, mas em menor escala
 *
 *   Termo 4 — Descritor com o maior scope_note do banco
 *             → "Caso ruim": scope_note é limitado a 5.000 chars + total a 8.000;
 *                textos muito longos são truncados antes do embedding
 *             Se já estiver nos 200 termos, repete-o e indica; caso seja
 *             extraído também nessa remessa, pega o próximo maior.
 *
 * Saída:
 *   1) JSON "antes" — estado atual do banco (vetores existentes + metadata)
 *   2) JSON "depois" — pós-revetorização (novos vetores + contagens de chars)
 *   Ambos no formato compacto (arrays comprimidos).
 *
 * Usage:
 *   node --env-file=.env.local scripts/decs-vectorize-4-edge-cases.mjs [--dry-run]
 */

import pg  from 'pg';
import fs  from 'fs';
import path from 'path';

const COMPACT_200    = 'exports/decs-vectorization-200-compact.json';
const OUT_BEFORE     = 'exports/edge-cases-before-revectorization.json';
const OUT_AFTER      = 'exports/edge-cases-after-revectorization.json';
const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIM   = 3072;
const DRY_RUN         = process.argv.includes('--dry-run');

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms)      { return new Promise(r => setTimeout(r, ms)); }
function vectorStr(v)   { return `[${v.join(',')}]`; }
function isStringArr(a) { return Array.isArray(a) && a.every(v => typeof v === 'string'); }
function isNumberArr(a) { return Array.isArray(a) && a.every(v => typeof v === 'number'); }

function buildDeCSText(d) {
  const terms = Array.isArray(d.entry_terms)  ? d.entry_terms  : JSON.parse(d.entry_terms  || '[]');
  const trees = Array.isArray(d.tree_numbers) ? d.tree_numbers : JSON.parse(d.tree_numbers || '[]');
  return [
    d.name_pt,
    d.name_en ? `[${d.name_en}]` : null,
    terms.length > 0 ? `Sinônimos: ${terms.slice(0, 20).join(', ')}` : null,
    d.scope_note     ? d.scope_note.slice(0, 5000) : null,
    trees.length > 0 ? `Hierarquia: ${trees.slice(0, 5).join(' | ')}` : null,
  ].filter(Boolean).join('\n').slice(0, 8000);
}

// ── Serializador compacto (igual ao decs-compress-json.mjs) ───────────────────

const INDENT          = '  ';
const VEC_PER_LINE    = 8;
const STR_PER_LINE    = 4;

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

function writeCompact(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, serialize(data, '') + '\n', 'utf-8');
  return (fs.statSync(filePath).size / 1024 / 1024).toFixed(2);
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
        body:    JSON.stringify({ content: { parts: [{ text }] }, taskType: 'RETRIEVAL_DOCUMENT' }),
      });
      if (!res.ok) {
        const err = await res.text();
        if (res.status === 429 || res.status === 503) { await sleep(attempt * 2000); continue; }
        throw new Error(`API ${res.status}: ${err.slice(0, 100)}`);
      }
      const data = await res.json();
      const vals = data?.embedding?.values;
      if (!Array.isArray(vals) || !vals.length) throw new Error('Embedding vazio');
      return vals;
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

// ── Leitura do JSON dos 200 termos ────────────────────────────────────────────

function load200UIs() {
  if (!fs.existsSync(COMPACT_200)) return new Set();
  try {
    const raw  = fs.readFileSync(COMPACT_200, 'utf-8');
    const data = JSON.parse(raw);
    return new Set((data.descriptors ?? []).map(d => d.ui));
  } catch { return new Set(); }
}

// ── Seleção dos 4 descritores ─────────────────────────────────────────────────

async function selectFour(pool) {
  const uisIn200 = load200UIs();
  const report   = [];

  // ── Termo 1: Diabetes Mellitus ───────────────────────────────────────────
  const { rows: [diab] } = await pool.query(
    `SELECT id, ui, name_pt, name_en, entry_terms, tree_numbers, scope_note, embedding::text AS emb_raw
     FROM decs_descriptors WHERE LOWER(name_pt) = 'diabetes mellitus' LIMIT 1`,
  );
  const diabInList = uisIn200.has(diab?.ui);
  report.push({
    slot:       1,
    label:      'Diabetes Mellitus',
    reason:     diabInList
      ? `⚠️  Já está nos 200 termos (${diab.ui}) — incluído mesmo assim conforme instrução.`
      : `✅ Não estava nos 200 termos — incluído.`,
    descriptor: diab,
  });

  // ── Termos 2 e 3: entry_terms extremos ───────────────────────────────────
  // Busca os 3 maiores para ter flexibilidade
  const { rows: topET } = await pool.query(
    `SELECT id, ui, name_pt, name_en, entry_terms, tree_numbers, scope_note, embedding::text AS emb_raw,
            jsonb_array_length(entry_terms) AS n_entry_terms
     FROM decs_descriptors
     WHERE entry_terms IS NOT NULL AND jsonb_array_length(entry_terms) > 0
     ORDER BY jsonb_array_length(entry_terms) DESC
     LIMIT 3`,
  );

  const top1 = topET[0]; // 245 entry_terms (Convulsões)
  const top2 = topET[1]; // maior abaixo de 245

  const noSecondAbove230 = parseInt(top2?.n_entry_terms ?? 0) <= 230;

  report.push({
    slot:  2,
    label: 'Máximo de entry_terms (245)',
    reason: noSecondAbove230
      ? `ℹ️  [${top1.ui}] "${top1.name_pt}" — ${top1.n_entry_terms} entry_terms. ` +
        `Caso ruim: buildDeCSText() usa slice(0,20) → ${top1.n_entry_terms - 20} sinônimos IGNORADOS no embedding.`
      : `[${top1.ui}] "${top1.name_pt}" — ${top1.n_entry_terms} entry_terms.`,
    descriptor: top1,
  });

  report.push({
    slot:  3,
    label: 'Segundo maior em entry_terms',
    reason: noSecondAbove230
      ? `⚠️  Não existe segundo descritor com >230 entry_terms no banco. ` +
        `Próximo mais alto: [${top2.ui}] "${top2.name_pt}" com ${top2.n_entry_terms} entry_terms.`
      : `[${top2.ui}] "${top2.name_pt}" — ${top2.n_entry_terms} entry_terms.`,
    descriptor: top2,
  });

  // ── Termo 4: maior scope_note ────────────────────────────────────────────
  const { rows: scopeRows } = await pool.query(
    `SELECT id, ui, name_pt, name_en, entry_terms, tree_numbers, scope_note, embedding::text AS emb_raw,
            LENGTH(scope_note) AS len_scope
     FROM decs_descriptors WHERE scope_note IS NOT NULL
     ORDER BY LENGTH(scope_note) DESC LIMIT 5`,
  );

  // Tenta encontrar um que não tenha sido selecionado nessa remessa
  const remessaUIs = new Set([diab?.ui, top1?.ui, top2?.ui]);
  let scopeCandidate = null;
  let scopeNotes = [];

  for (const r of scopeRows) {
    const alreadyIn200     = uisIn200.has(r.ui);
    const alreadyInRemessa = remessaUIs.has(r.ui);

    scopeNotes.push({
      ui:        r.ui,
      name_pt:   r.name_pt,
      len_scope: parseInt(r.len_scope),
      in_200:    alreadyIn200,
      in_remessa: alreadyInRemessa,
    });

    if (!scopeCandidate && !alreadyInRemessa) {
      scopeCandidate = r;
    }
  }

  const scopeFirstInRemessa = scopeRows[0] && remessaUIs.has(scopeRows[0].ui);

  report.push({
    slot:  4,
    label: 'Maior scope_note do banco',
    reason: (() => {
      const best = scopeRows[0];
      const chosen = scopeCandidate;
      const parts = [];
      if (uisIn200.has(best?.ui)) parts.push(`ℹ️  [${best.ui}] "${best.name_pt}" (${parseInt(best.len_scope)} chars) já estava nos 200 termos — repetido conforme instrução.`);
      if (scopeFirstInRemessa)    parts.push(`⚠️  [${best.ui}] "${best.name_pt}" foi extraído nessa remessa (Termo ${[...remessaUIs].indexOf(best.ui) + 1}). Próximo sem repetição: [${chosen?.ui}] "${chosen?.name_pt}" (${parseInt(chosen?.len_scope ?? '0')} chars).`);
      if (!parts.length)          parts.push(`✅ [${chosen?.ui}] "${chosen?.name_pt}" — ${parseInt(chosen?.len_scope ?? '0')} chars de scope_note. Caso ruim: texto truncado após 5.000 chars antes do embedding.`);
      return parts.join(' ') + `\n     Ranking scope_note: ${scopeNotes.map(s => `"${s.name_pt}" (${s.len_scope})`).join(' > ')}`;
    })(),
    descriptor: scopeCandidate ?? scopeRows[0],
  });

  return report;
}

// ── Snapshot do banco (estado atual) ─────────────────────────────────────────

function buildSnapshot(report) {
  return {
    metadata: {
      generated_at: new Date().toISOString(),
      description:  'Estado atual dos descritores no banco ANTES da revetorização',
      note:         'embedding_vector extraído da coluna vector do PostgreSQL (pode ser null se não vetorizado)',
    },
    terms: report.map(r => {
      const d     = r.descriptor;
      const terms = Array.isArray(d.entry_terms)  ? d.entry_terms  : JSON.parse(d.entry_terms  || '[]');
      const trees = Array.isArray(d.tree_numbers) ? d.tree_numbers : JSON.parse(d.tree_numbers || '[]');
      let   vec   = null;
      if (d.emb_raw) {
        try { vec = d.emb_raw.replace(/^\[|\]$/g, '').split(',').map(Number); } catch { /* null */ }
      }
      return {
        slot:           r.slot,
        label:          r.label,
        selection_note: r.reason,
        ui:             d.ui,
        name_pt:        d.name_pt,
        name_en:        d.name_en ?? null,
        scope_note:     d.scope_note ?? null,
        entry_terms:    terms,
        tree_numbers:   trees,
        embedding_vector: vec,
      };
    }),
  };
}

// ── Revetorização + contagens ─────────────────────────────────────────────────

async function revectorize(pool, report) {
  console.log('\n🧠 Revetorizando 4 descritores...\n');

  const results = [];

  for (const r of report) {
    const d     = r.descriptor;
    const text  = buildDeCSText(d);
    const terms = Array.isArray(d.entry_terms)  ? d.entry_terms  : JSON.parse(d.entry_terms  || '[]');
    const trees = Array.isArray(d.tree_numbers) ? d.tree_numbers : JSON.parse(d.tree_numbers || '[]');

    // Contagens de caracteres
    const scopeLen       = d.scope_note ? d.scope_note.length : 0;
    const entryTermsLen  = terms.reduce((acc, t) => acc + t.length, 0);
    const textLen        = text.length;
    const textTruncated  = textLen === 8000;

    // Detalhes de truncamento por campo
    const termsUsed       = terms.slice(0, 20).length;
    const termsIgnored    = Math.max(0, terms.length - 20);
    const scopeUsed       = d.scope_note ? Math.min(d.scope_note.length, 5000) : 0;
    const scopeTruncated  = d.scope_note ? d.scope_note.length > 5000 : false;

    console.log(`⏳ [${d.ui}] ${d.name_pt}`);

    let embedding = null;
    if (!DRY_RUN) {
      embedding = await generateEmbedding(text);
      await pool.query(
        'UPDATE decs_descriptors SET embedding = $1::vector WHERE id = $2',
        [vectorStr(embedding), d.id],
      );
      console.log(`   ✅ Embedding gerado (${embedding.length} dims)`);
    } else {
      console.log(`   (dry-run — sem chamada à API)`);
    }

    results.push({
      slot:           r.slot,
      label:          r.label,
      selection_note: r.reason,
      ui:             d.ui,
      name_pt:        d.name_pt,
      name_en:        d.name_en ?? null,
      scope_note:     d.scope_note ?? null,
      entry_terms:    terms,
      tree_numbers:   trees,

      char_counts: {
        scope_note_total:      scopeLen,
        scope_note_used_in_embedding: scopeUsed,
        scope_note_truncated:  scopeTruncated,
        entry_terms_count:     terms.length,
        entry_terms_used_in_embedding: termsUsed,
        entry_terms_ignored_by_slice:  termsIgnored,
        entry_terms_total_chars:       entryTermsLen,
        embedding_text_total_chars:    textLen,
        embedding_text_truncated_at_8000: textTruncated,
      },

      embedding_model:     EMBEDDING_MODEL,
      embedding_task_type: 'RETRIEVAL_DOCUMENT',
      embedding_dims:      EMBEDDING_DIM,
      embedding_text_used: text,
      embedding_vector:    embedding,
    });

    if (!DRY_RUN) await sleep(500);
  }

  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const pool = createPool();

  try {
    console.log('\n🔍 Selecionando 4 descritores edge-case...');
    const report = await selectFour(pool);

    console.log('\n── Seleção ──────────────────────────────────────────────────');
    for (const r of report) {
      console.log(`\n  Termo ${r.slot}: ${r.label}`);
      console.log(`  ${r.reason.split('\n').join('\n  ')}`);
    }
    console.log('\n─────────────────────────────────────────────────────────────');

    if (DRY_RUN) {
      console.log('\n(--dry-run: pulando extração, revetorização e exportação)\n');
      await pool.end();
      return;
    }

    // ── Antes: snapshot do banco ──────────────────────────────────────────
    console.log('\n📸 Exportando estado ANTES da revetorização...');
    const snapshot = buildSnapshot(report);
    const szBefore = writeCompact(OUT_BEFORE, snapshot);
    console.log(`   ✅ ${OUT_BEFORE}  (${szBefore} MB)`);

    // ── Revetorizar ───────────────────────────────────────────────────────
    const afterData = await revectorize(pool, report);

    // ── Depois: pós-revetorização ─────────────────────────────────────────
    const afterDoc = {
      metadata: {
        generated_at:        new Date().toISOString(),
        description:         'Descritores após revetorização com gemini-embedding-001 (RETRIEVAL_DOCUMENT)',
        embedding_model:     EMBEDDING_MODEL,
        embedding_task_type: 'RETRIEVAL_DOCUMENT',
        embedding_dims:      EMBEDDING_DIM,
        warning_entry_terms: 'buildDeCSText() usa apenas os primeiros 20 entry_terms; os excedentes são ignorados.',
        warning_scope_note:  'scope_note é truncada após 5.000 chars; texto total truncado após 8.000 chars.',
      },
      descriptors: afterData,
    };

    const szAfter = writeCompact(OUT_AFTER, afterDoc);
    console.log(`\n📄 Exportado APÓS revetorização: ${OUT_AFTER}  (${szAfter} MB)`);

    console.log('\n── Resumo dos casos extremos ────────────────────────────────');
    for (const d of afterData) {
      const c = d.char_counts;
      console.log(`\n  [${d.ui}] ${d.name_pt}`);
      console.log(`    entry_terms     : ${c.entry_terms_count} total | ${c.entry_terms_used_in_embedding} usados | ${c.entry_terms_ignored_by_slice} ignorados`);
      console.log(`    scope_note chars: ${c.scope_note_total} total | ${c.scope_note_used_in_embedding} usados${c.scope_note_truncated ? ' ⚠️ truncado' : ''}`);
      console.log(`    embedding text  : ${c.embedding_text_total_chars} chars${c.embedding_text_truncated_at_8000 ? ' ⚠️ truncado em 8000' : ''}`);
    }
    console.log('');

  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error('\n💥 Fatal:', e.message); process.exit(1); });
