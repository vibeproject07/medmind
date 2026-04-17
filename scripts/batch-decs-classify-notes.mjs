/**
 * Batch DeCS Classifier for Notes — uses local pgvector (no external BVS API)
 *
 * Pipeline for each note:
 *   Step 1: Gemini extracts 3–6 medical search terms from the note content
 *   Step 2: Each term is embedded (gemini-embedding-001) → cosine search against decs_descriptors
 *   Step 3: Gemini validation pass to filter false positives
 *   Step 4: Save approved descriptors to notes.decs_terms (JSONB)
 *
 * Run:
 *   node --env-file=.env.local scripts/batch-decs-classify-notes.mjs [options]
 *
 * Options:
 *   --limit N         Process only N notes (default: all pending)
 *   --concurrency N   Parallel Gemini requests (default: 3)
 *   --delay N         ms delay between batches (default: 400)
 *   --no-resume       Re-classify even notes that already have decs_terms
 *   --min-score N     Minimum cosine similarity to accept a descriptor (default: 0.75)
 */

import pg from 'pg';
import fs from 'fs';

// ── Config ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : def;
};

const LIMIT       = parseInt(getArg('limit', '0'));
const CONCURRENCY = parseInt(getArg('concurrency', '3'));
const DELAY_MS    = parseInt(getArg('delay', '400'));
const RESUME      = !args.includes('--no-resume');
const MIN_SCORE   = parseFloat(getArg('min-score', '0.75'));

const EMBEDDING_MODEL = 'gemini-embedding-001';
const GEMINI_MODEL    = 'gemini-2.5-flash-lite';
const RESULTS_FILE    = 'decs_notes_classification_results.json';
const MAX_DECS        = 5;  // top-N DeCS descriptors per search term

// ── DB ────────────────────────────────────────────────────────────────────────
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const GEMINI_KEY = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY not set');

// ── Gemini embedding ──────────────────────────────────────────────────────────
async function generateEmbedding(text) {
  const trimmed = text.slice(0, 8000);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: { parts: [{ text: trimmed }] } }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding API ${res.status}: ${err.slice(0, 150)}`);
  }
  const data = await res.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) throw new Error('Empty embedding response');
  return values;
}

// ── Gemini text generation ─────────────────────────────────────────────────────
async function callGemini(systemPrompt, userMessage, maxTokens = 512) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`Gemini ${res.status}: ${err}`); }
  const data = await res.json();
  return (data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '').trim();
}

// ── Prompts ───────────────────────────────────────────────────────────────────
const EXTRACTION_PROMPT = `Você é um especialista em classificação de conteúdo médico e no vocabulário controlado DeCS/MeSH.

Dado o título e conteúdo de uma nota de estudo médica, identifique de 3 a 6 conceitos médicos chave que representam os temas principais.

Regras:
- Use EXCLUSIVAMENTE termos que existam como descritores no vocabulário DeCS/MeSH em português.
- Prefira termos específicos: "Insuficiência Cardíaca" em vez de "Coração".
- Inclua: condições clínicas, fármacos, exames diagnósticos, procedimentos, achados anatomopatológicos.
- NÃO inclua: adjetivos genéricos, termos não-DeCS.
- Retorne SOMENTE um array JSON de strings. Sem markdown, sem explicação.

Exemplo: ["Diabetes Mellitus Tipo 2","Insulina","Hemoglobina A Glicada"]`;

const VALIDATION_PROMPT = `Você é um especialista em vocabulário controlado DeCS/MeSH.

Dado o conteúdo de uma nota de estudo médica e uma lista de descritores DeCS candidatos, filtre e mantenha APENAS os descritores CLINICAMENTE RELEVANTES para o tema central da nota.

Retorne SOMENTE um array JSON com os UI (códigos) dos descritores aprovados.
Ex: ["D003924","D007328"]
Sem explicação, sem markdown.`;

// ── Parse search terms ────────────────────────────────────────────────────────
function parseSearchTerms(raw) {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.filter(t => typeof t === 'string' && t.trim()).slice(0, 6);
  } catch {}
  const matches = raw.match(/"([^"]+)"/g);
  if (matches) return matches.map(m => m.replace(/"/g, '').trim()).filter(Boolean).slice(0, 6);
  return [];
}

// ── Local DeCS search via pgvector ────────────────────────────────────────────
async function searchDeCSLocal(termEmbedding) {
  const vecStr = `[${termEmbedding.join(',')}]`;
  const res = await pool.query(
    `SELECT ui, name_pt, name_en,
            1 - (embedding <=> $1::vector) AS score
     FROM decs_descriptors
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vecStr, MAX_DECS]
  );
  return res.rows
    .map(r => ({ ui: r.ui, name_pt: r.name_pt, name_en: r.name_en, score: parseFloat(r.score ?? 0) }))
    .filter(r => r.score >= MIN_SCORE);
}

// ── Gemini validation ─────────────────────────────────────────────────────────
async function validateDescriptors(descriptors, noteText) {
  if (descriptors.length === 0) return [];
  const candidateList = descriptors.map(d => ({ ui: d.ui, term: d.name_pt }));
  const userMessage = ['Nota:', noteText, '', 'Candidatos:', JSON.stringify(candidateList, null, 2)].join('\n');
  try {
    const raw = await callGemini(VALIDATION_PROMPT, userMessage, 256);
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const approved = JSON.parse(cleaned);
    if (!Array.isArray(approved)) return descriptors;
    const approvedSet = new Set(approved.map(String));
    const filtered = descriptors.filter(d => approvedSet.has(d.ui));
    return filtered.length > 0 ? filtered : descriptors;
  } catch { return descriptors; }
}

// ── Build note text ───────────────────────────────────────────────────────────
function buildNoteText(n) {
  const parse = (f) => {
    if (!f) return [];
    if (Array.isArray(f)) return f;
    try { return JSON.parse(f); } catch { return []; }
  };
  const body = [n.title, n.description].filter(Boolean).join('\n\n');
  const meta = [...parse(n.tags), ...parse(n.areas_conhecimento), ...parse(n.assuntos)]
    .filter((v, i, a) => a.indexOf(v) === i).join(', ');
  return meta ? `${body}\n\n[${meta}]` : body;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Process one note ──────────────────────────────────────────────────────────
async function processNote(n, idx, total) {
  const noteText = buildNoteText(n).slice(0, 4000);
  let descriptors = [];
  let error = null;

  try {
    // Step 1: extract search terms via Gemini
    const rawTerms = await callGemini(EXTRACTION_PROMPT, `Título: ${n.title}\n\nConteúdo: ${noteText}`);
    const searchTerms = parseSearchTerms(rawTerms);

    if (searchTerms.length === 0) {
      error = 'No search terms extracted';
    } else {
      // Step 2: embed each term → local DeCS cosine search
      const seen = new Set();
      const afterSearch = [];
      await Promise.allSettled(searchTerms.map(async (term) => {
        try {
          const emb = await generateEmbedding(term);
          const matches = await searchDeCSLocal(emb);
          for (const m of matches) {
            if (!seen.has(m.ui)) { seen.add(m.ui); afterSearch.push(m); }
          }
        } catch { /* skip term on error */ }
      }));

      // Step 3: Gemini validation pass
      const afterValidation = await validateDescriptors(afterSearch, noteText);
      descriptors = afterValidation.map(({ score: _s, ...rest }) => rest);
    }
  } catch (e) { error = e.message; }

  const status = error
    ? `✗ — ${error}`
    : `✓ ${descriptors.length} descritores`;
  console.log(`[${String(idx + 1).padStart(4)}/${total}] Note#${n.id} "${n.title?.slice(0, 40)}" ${status}`);

  return { id_note: n.id, decs_terms: descriptors, error };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📝 MedMind — Batch DeCS Classifier para Notas`);
  console.log(`   Usando pgvector local (sem API externa) · min-score=${MIN_SCORE}\n`);

  // Verify local DeCS is ready
  const { rows: [{ count: decsCount }] } = await pool.query(
    `SELECT COUNT(*) FROM decs_descriptors WHERE embedding IS NOT NULL`
  );
  if (parseInt(decsCount) === 0) {
    console.error('❌ decs_descriptors não tem embeddings. Execute embed-decs-descriptors.mjs primeiro.');
    await pool.end();
    process.exit(1);
  }
  console.log(`✅ DeCS local pronto: ${decsCount} descritores vetorizados\n`);

  // Ensure notes.decs_terms column exists
  await pool.query(
    `ALTER TABLE notes ADD COLUMN IF NOT EXISTS decs_terms JSONB DEFAULT '[]'::jsonb`
  );

  // Fetch notes to process
  const whereClause = RESUME
    ? `WHERE (decs_terms IS NULL OR decs_terms = '[]'::jsonb)`
    : '';
  const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
  const { rows: toProcess } = await pool.query(
    `SELECT id, title, description, tags, areas_conhecimento, assuntos
     FROM notes ${whereClause} ORDER BY id ${limitClause}`
  );

  if (toProcess.length === 0) {
    console.log('✅ Nenhuma nota pendente de classificação!');
    await pool.end();
    return;
  }

  console.log(`📊 Processando ${toProcess.length} notas · concorrência ${CONCURRENCY}\n`);

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((n, bIdx) => processNote(n, i + bIdx, toProcess.length))
    );
    results.push(...batchResults);

    for (const r of batchResults) {
      await pool.query(
        `UPDATE notes SET decs_terms = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(r.decs_terms), r.id_note]
      );
    }

    if (i + CONCURRENCY < toProcess.length) await sleep(DELAY_MS);
  }

  // Write results file
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results.map(r => ({
    id_note: r.id_note, decs_terms: r.decs_terms
  })), null, 2));

  const withDesc = results.filter(r => r.decs_terms.length > 0).length;
  const failed   = results.filter(r => r.error).length;
  const totalDesc = results.flatMap(r => r.decs_terms).length;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n✅ Concluído em ${elapsed}s!`);
  console.log(`   Com descritores: ${withDesc} / ${results.length}`);
  console.log(`   Falhas:          ${failed}`);
  console.log(`   Total descritores: ${totalDesc} · média ${(totalDesc / (withDesc || 1)).toFixed(2)}/nota`);
  console.log(`   Arquivo: ${RESULTS_FILE}\n`);

  await pool.end();
}

main().catch(e => { console.error('\n💥 Fatal:', e); process.exit(1); });
