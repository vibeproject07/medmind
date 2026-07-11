/**
 * Batch DeCS Classifier — 5-step pipeline with primary/secondary theme extraction
 *
 *   Step 1: Gemini reads the full question context and identifies:
 *             • 1–3 TEMAS PRINCIPAIS (diagnóstico central, fármaco, procedimento)
 *             • 0–6 TEMAS SECUNDÁRIOS (fisiopatologia, complicações, contexto clínico)
 *   Step 2: Each theme is searched in the DeCS API (or local pgvector index).
 *             Each result is tagged with its role (primary / secondary).
 *   Step 3a: Category filter — rejects organism (Categoria B) descriptors without
 *              explicit biomed context in the question.
 *   Step 3b: Word-Jaccard similarity threshold (min 0.15).
 *   Step 4: Gemini validation — second pass to drop false positives.
 *             Role tags are preserved through validation.
 *   Step 5: Results saved to DB (ai_decs_descriptors) and exported to JSON.
 *
 * Output format (per descriptor): { term, code, tree_ids, hierarchy_path, role }
 *
 * Run: node scripts/batch-decs-classify.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';
import { loadRuntimeAgents, buildGeminiBody } from './lib/ai-agents-db.mjs';
import { DECS_MAX_CANDIDATES } from './decs-search-limits.mjs';

// ── Load .env.local ──────────────────────────────────────────────────────────
function loadEnv(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv(resolve(process.cwd(), '.env.local'));

const GEMINI_KEY = process.env.GEMINI_API_KEY?.trim();
const DECS_KEY   = process.env.DECS_API_KEY?.trim();
const DB_URL     = process.env.DATABASE_URL?.trim();

if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY not set');
if (!DECS_KEY)   throw new Error('DECS_API_KEY not set');
if (!DB_URL)     throw new Error('DATABASE_URL not set');

// ── CLI args ─────────────────────────────────────────────────────────────────
const _args = process.argv.slice(2);
const _getArg = (flag, def) => { const i = _args.indexOf(flag); return i !== -1 && _args[i+1] ? _args[i+1] : def; };
const _hasFlag = (flag) => _args.includes(flag);

// ── Config ───────────────────────────────────────────────────────────────────
const CONCURRENCY      = 5;
const LIMIT            = parseInt(_getArg('--limit', '90'));
const OFFSET           = parseInt(_getArg('--offset', '0'));
const MIN_ID           = _getArg('--min-id', null) ? parseInt(_getArg('--min-id', null)) : null;
const MAX_ID           = _getArg('--max-id', null) ? parseInt(_getArg('--max-id', null)) : null;
const SKIP_CLASSIFIED  = !_hasFlag('--include-classified');
const OUTPUT_FILE      = _getArg('--output', 'decs_classification_results.json');
const GEMINI_MODEL     = 'gemini-2.5-flash';
const DECS_BASE        = 'https://api.bvsalud.org/decs/v2';
const MAX_CANDIDATES   = DECS_MAX_CANDIDATES;   // DeCS records fetched per search term
const MIN_SIMILARITY   = 0.15; // minimum word-Jaccard to accept a DeCS result

let classifierAgent;
let validatorAgent;

// ── DB ───────────────────────────────────────────────────────────────────────
const pool = new pg.Pool({ connectionString: DB_URL });

async function loadAgentsFromDb() {
  const map = await loadRuntimeAgents(pool, ['decs_classifier', 'decs_validator']);
  classifierAgent = map.get('decs_classifier');
  validatorAgent = map.get('decs_validator');
  console.log(`   ✓ Agentes DB: decs_classifier (${classifierAgent.model}), decs_validator (${validatorAgent.model})`);
}

async function fetchQuestions() {
  const conditions = [];
  if (SKIP_CLASSIFIED) conditions.push(`ai_decs_descriptors IS NULL`);
  if (MIN_ID !== null) conditions.push(`id >= ${MIN_ID}`);
  if (MAX_ID !== null) conditions.push(`id <= ${MAX_ID}`);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await pool.query(
    `SELECT id, statement, option_a, option_b, option_c, option_d, option_e
     FROM questions ${whereClause} ORDER BY id ASC LIMIT $1 OFFSET $2`,
    [LIMIT, OFFSET]
  );
  return res.rows;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v != null) return [v];
  return [];
}

const CATEGORY_LABELS = {
  A: 'Anatomia', B: 'Organismos', C: 'Doenças',
  D: 'Compostos Químicos e Drogas', E: 'Técnicas e Equipamentos Analíticos',
  F: 'Psiquiatria e Psicologia', G: 'Fenômenos Biológicos',
  SP: 'Saúde Pública', VS: 'Vigilância Sanitária',
};

function treeCategory(treeId) {
  return treeId.split('.')[0].replace(/[0-9]/g, '');
}

function buildHierarchyPath(treeId) {
  if (!treeId) return '';
  const cat = treeCategory(treeId);
  const label = CATEGORY_LABELS[cat] ?? cat;
  return treeId.split('.').length <= 1 ? label : `${label} › ${treeId}`;
}

// ── Layer 1: Word-Jaccard similarity ─────────────────────────────────────────
function wordJaccard(a, b) {
  const tokenise = s => new Set(
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\W+/).filter(w => w.length > 3)
  );
  const A = tokenise(a); const B = tokenise(b);
  let inter = 0;
  A.forEach(w => { if (B.has(w)) inter++; });
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}

// ── Layer 2: Category filter ─────────────────────────────────────────────────
const BIO_RE = /\b(vírus|virus|bactéria|bacteria|bacilo|fungo|fung|parasita|parasit|microbiol|infectol|viral|antibiótic|antibiotic|vaccin|vacin|patógen|patogen|prion|rickettsia|protozoár|helmint|coccídio|tripanossom|leishman|plasmodium|schistosoma)\b/i;

function isCategoryAcceptable(record, questionText) {
  if (!record.tree_ids || record.tree_ids.length === 0) return true;
  const cats = record.tree_ids.map(treeCategory);
  const allOrganism = cats.every(c => c === 'B');
  if (!allOrganism) return true;
  return BIO_RE.test(questionText);
}

// ── Local pgvector search (decs_descriptors) ─────────────────────────────────
const EMBED_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';

async function generateEmbedding(text) {
  try {
    const res = await fetch(`${EMBED_BASE}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text: text.substring(0, 2000) }] },
        taskType: 'RETRIEVAL_QUERY',
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.embedding?.values ?? null;
  } catch { return null; }
}

let localDeCSAvailable = null; // null = not checked yet

async function checkLocalDeCS() {
  if (localDeCSAvailable !== null) return localDeCSAvailable;
  try {
    const { rows } = await pool.query(`SELECT 1 FROM decs_descriptors WHERE embedding IS NOT NULL LIMIT 1`);
    localDeCSAvailable = rows.length > 0;
  } catch { localDeCSAvailable = false; }
  return localDeCSAvailable;
}

async function searchDeCSLocal(searchTerm, maxCandidates = DECS_MAX_CANDIDATES, minSimilarity = 0.60) {
  try {
    if (!await checkLocalDeCS()) return [];
    const embedding = await generateEmbedding(searchTerm);
    if (!embedding) return [];
    const vec = `[${embedding.join(',')}]`;
    const { rows } = await pool.query(`
      SELECT
        ui AS code,
        name_pt AS term,
        name_en,
        scope_note,
        tree_numbers,
        1 - (embedding::halfvec(3072) <=> $1::halfvec(3072)) AS similarity
      FROM decs_descriptors
      WHERE embedding IS NOT NULL
        AND (1 - (embedding::halfvec(3072) <=> $1::halfvec(3072))) >= $2
      ORDER BY embedding::halfvec(3072) <=> $1::halfvec(3072)
      LIMIT $3
    `, [vec, minSimilarity, maxCandidates]);
    return rows.map(r => {
      const tree_ids = Array.isArray(r.tree_numbers) ? r.tree_numbers : JSON.parse(r.tree_numbers ?? '[]');
      return {
        term: r.term,
        code: r.code,
        tree_ids,
        hierarchy_path: buildHierarchyPath(tree_ids[0] ?? ''),
        similarity: parseFloat(r.similarity ?? '0'),
        scope_note: r.scope_note ?? undefined,
        name_en: r.name_en ?? undefined,
      };
    });
  } catch { return []; }
}

// ── DeCS BVS API search ───────────────────────────────────────────────────────
function parseDeCSRecord(rec) {
  const code = rec?.attr?.mfn ?? '';
  const descriptors = toArray(rec.descriptor_list).flatMap(d => toArray(d));
  let term = '';
  for (const pl of ['pt-br', 'pt']) {
    const found = descriptors.find(d => d?.attr?.lang === pl);
    if (found && typeof found.descriptor === 'string' && found.descriptor.trim()) {
      term = found.descriptor.trim(); break;
    }
  }
  if (!term) return null;
  const treeList = toArray(rec.tree_id_list).flatMap(t => toArray(t));
  const tree_ids = treeList.map(t => t?.tree_id?.trim()).filter(Boolean);
  return { term, code, tree_ids, hierarchy_path: buildHierarchyPath(tree_ids[0] ?? '') };
}

async function searchDeCSCandidates(searchTerm) {
  try {
    const url = `${DECS_BASE}/search-by-words?words=${encodeURIComponent(searchTerm)}&lang=pt&format=json`;
    const res = await fetch(url, { headers: { apikey: DECS_KEY } });
    if (!res.ok) return [];
    const data = await res.json();
    const objects = data?.objects;
    if (!Array.isArray(objects) || objects.length === 0) return [];
    const resp = objects[0]?.decsws_response?.record_list;
    if (!resp) return [];
    return toArray(resp.record).slice(0, MAX_CANDIDATES).map(parseDeCSRecord).filter(Boolean);
  } catch { return []; }
}

/**
 * Find the best DeCS match for a search term.
 * Strategy:
 *   1. Local pgvector search on decs_descriptors (fast, offline, semantic)
 *   2. Fallback to BVS API (slower, requires DECS_API_KEY)
 */
async function findBestDeCSMatch(searchTerm, questionText) {
  // ── Try local pgvector first ──────────────────────────────────────────────
  const localCandidates = await searchDeCSLocal(searchTerm, MAX_CANDIDATES);
  const localFiltered = localCandidates
    .filter(c => isCategoryAcceptable(c, questionText))
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
  if (localFiltered.length > 0) return localFiltered[0];

  // ── Fallback: BVS API ─────────────────────────────────────────────────────
  const candidates = await searchDeCSCandidates(searchTerm);
  const scored = candidates
    .map(c => ({ ...c, similarity: wordJaccard(searchTerm, c.term) }))
    .filter(c => c.similarity >= MIN_SIMILARITY)
    .filter(c => isCategoryAcceptable(c, questionText))
    .sort((a, b) => b.similarity - a.similarity);
  return scored.length > 0 ? scored[0] : null;
}

// ── Gemini helpers ────────────────────────────────────────────────────────────
async function callGeminiWithAgent(agent, userMessage, genOverrides = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${agent.model}:generateContent?key=${GEMINI_KEY}`;
  const body = buildGeminiBody(agent, userMessage, genOverrides);
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`Gemini ${res.status}: ${err}`); }
  const data = await res.json();
  return (data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '').trim();
}

function parseThemes(raw) {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      // Legacy format — treat all as primary
      return { primary: parsed.filter(t => typeof t === 'string' && t.trim()).slice(0, 3), secondary: [] };
    }
    if (parsed && typeof parsed === 'object') {
      return {
        primary: (Array.isArray(parsed.primary) ? parsed.primary : [])
          .filter(t => typeof t === 'string' && t.trim()).slice(0, 3),
        secondary: (Array.isArray(parsed.secondary) ? parsed.secondary : [])
          .filter(t => typeof t === 'string' && t.trim()).slice(0, 6),
      };
    }
  } catch {}
  const matches = raw.match(/"([^"]+)"/g);
  if (matches) {
    return { primary: matches.map(m => m.replace(/"/g, '').trim()).filter(Boolean).slice(0, 3), secondary: [] };
  }
  return { primary: [], secondary: [] };
}

// ── Layer 3: Gemini validation ────────────────────────────────────────────────
async function validateDescriptors(descriptors, questionText) {
  if (descriptors.length === 0) return [];
  const candidateList = descriptors.map(d => ({
    code: d.code, term: d.term,
    categoria: (buildHierarchyPath(d.tree_ids[0] ?? '')).split(' › ')[0],
  }));
  const userMessage = ['Questão:', questionText, '', 'Candidatos:', JSON.stringify(candidateList, null, 2)].join('\n');
  try {
    const raw = await callGeminiWithAgent(validatorAgent, userMessage, { maxOutputTokens: 256 });
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const approved = JSON.parse(cleaned);
    if (!Array.isArray(approved)) return descriptors;
    const approvedSet = new Set(approved.map(String));
    const filtered = descriptors.filter(d => approvedSet.has(d.code));
    return filtered.length > 0 ? filtered : descriptors; // fail-open
  } catch { return descriptors; }
}

// ── Process one question ──────────────────────────────────────────────────────
async function processQuestion(q, idx, total) {
  const questionText = [
    'Enunciado:', q.statement, '',
    'Alternativa A: ' + (q.option_a ?? ''),
    'Alternativa B: ' + (q.option_b ?? ''),
    q.option_c ? 'Alternativa C: ' + q.option_c : null,
    q.option_d ? 'Alternativa D: ' + q.option_d : null,
    q.option_e ? 'Alternativa E: ' + q.option_e : null,
  ].filter(Boolean).join('\n');

  let descriptors = [];
  let stats = {};
  let error = null;

  try {
    // Step 1: Gemini identifies primary + secondary themes
    const rawText = await callGeminiWithAgent(classifierAgent, questionText, { responseMimeType: 'application/json' });
    const themes = parseThemes(rawText);
    const totalTerms = themes.primary.length + themes.secondary.length;

    if (totalTerms === 0) {
      error = 'No themes extracted';
    } else {
      // Step 2: multi-candidate search + category filter, tagged by role
      const seen = new Set();
      const afterSearch = [];
      const searchAll = [
        ...themes.primary.map(term => ({ term, role: 'primary' })),
        ...themes.secondary.map(term => ({ term, role: 'secondary' })),
      ];
      await Promise.allSettled(searchAll.map(async ({ term, role }) => {
        const match = await findBestDeCSMatch(term, questionText);
        if (match && !seen.has(match.code)) {
          seen.add(match.code);
          afterSearch.push({ ...match, role });
        }
      }));

      // Step 3: Gemini validation (role is preserved through validation)
      const afterValidation = await validateDescriptors(afterSearch, questionText);

      // Primary first, then secondary; strip similarity
      const primary = afterValidation.filter(d => d.role === 'primary').map(({ similarity: _s, ...r }) => r);
      const secondary = afterValidation.filter(d => d.role !== 'primary').map(({ similarity: _s, ...r }) => r);
      descriptors = [...primary, ...secondary];

      stats = {
        primary_terms: themes.primary.length,
        secondary_terms: themes.secondary.length,
        after_search: afterSearch.length,
        after_validation: descriptors.length,
        dropped_filter: totalTerms - afterSearch.length,
        dropped_gemini: afterSearch.length - descriptors.length,
      };
    }
  } catch (e) { error = e.message; }

  const status = error
    ? `✗ — ${error}`
    : `✓ ${descriptors.length} desc [${stats.primary_terms ?? 0}p+${stats.secondary_terms ?? 0}s → −${stats.dropped_filter ?? 0}filtro −${stats.dropped_gemini ?? 0}gemini]`;
  console.log(`[${String(idx + 1).padStart(3)}/${total}] Q${q.id} ${status}`);

  return { id_question: q.id, ai_decs_descriptors: descriptors, error };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔬 MedMind — Batch DeCS Classifier v2 (3-layer pipeline)`);
  console.log(`limit=${LIMIT} offset=${OFFSET} skip-classified=${SKIP_CLASSIFIED} (use --include-classified to reprocess) concurrency=${CONCURRENCY}\n`);

  console.log(`Carregando agentes do banco (ai_agents)…`);
  await loadAgentsFromDb();

  await pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_decs_descriptors TEXT`);
  const questions = await fetchQuestions();
  console.log(`Questões carregadas: ${questions.length}\n`);

  const results = [];

  for (let i = 0; i < questions.length; i += CONCURRENCY) {
    const batch = questions.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((q, bIdx) => processQuestion(q, i + bIdx, questions.length))
    );
    results.push(...batchResults);

    for (const r of batchResults) {
      await pool.query(
        `UPDATE questions SET ai_decs_descriptors = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(r.ai_decs_descriptors), r.id_question]
      );
    }

    if (i + CONCURRENCY < questions.length) {
      await new Promise(res => setTimeout(res, 400));
    }
  }

  const output = results.map(r => ({ id_question: r.id_question, ai_decs_descriptors: r.ai_decs_descriptors }));
  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');

  const processed   = results.length;
  const withDesc    = results.filter(r => r.ai_decs_descriptors.length > 0).length;
  const withoutDesc = processed - withDesc;
  const failed      = results.filter(r => r.error).length;
  const allDesc     = results.flatMap(r => r.ai_decs_descriptors);
  const totalDesc   = allDesc.length;
  const totalPrimary   = allDesc.filter(d => d.role === 'primary').length;
  const totalSecondary = allDesc.filter(d => d.role === 'secondary').length;

  console.log(`\n✅ Concluído!`);
  console.log(`   Processadas:          ${processed}`);
  console.log(`   Com descritores:      ${withDesc} (${((withDesc / (processed || 1)) * 100).toFixed(1)}%)`);
  console.log(`   Sem descritores:      ${withoutDesc} (${((withoutDesc / (processed || 1)) * 100).toFixed(1)}%)`);
  console.log(`   Falhas API:           ${failed}`);
  console.log(`   Total descritores:    ${totalDesc} (${totalPrimary} principais + ${totalSecondary} secundários)`);
  console.log(`   Média por questão processada: ${(totalDesc / (processed || 1)).toFixed(2)}`);
  console.log(`   Arquivo: ${OUTPUT_FILE}\n`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
