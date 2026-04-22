/**
 * Batch DeCS Classifier — 3-layer quality pipeline
 *
 *   Layer 1: Multi-candidate DeCS search + word-Jaccard similarity ranking
 *   Layer 2: Category filter (reject B-tree descriptors without biomed context)
 *   Layer 3: Gemini validation (one extra pass to drop false positives)
 *
 * Run: node scripts/batch-decs-classify.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

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
const SKIP_CLASSIFIED  = !_hasFlag('--include-classified');
const OUTPUT_FILE      = _getArg('--output', 'decs_classification_results.json');
const GEMINI_MODEL     = 'gemini-2.5-flash';
const DECS_BASE        = 'https://api.bvsalud.org/decs/v2';
const MAX_CANDIDATES   = 5;   // DeCS records fetched per search term
const MIN_SIMILARITY   = 0.15; // minimum word-Jaccard to accept a DeCS result

// ── Prompts ──────────────────────────────────────────────────────────────────
const EXTRACTION_PROMPT = `Você é um especialista em classificação de conteúdo médico e no vocabulário controlado DeCS (Descritores em Ciências da Saúde) / MeSH.

Dado o enunciado e as alternativas de uma questão médica, identifique de 3 a 6 conceitos médicos chave que representam os temas principais da questão.

Regras IMPORTANTES:
- Use EXCLUSIVAMENTE termos que existam como descritores no vocabulário DeCS/MeSH em português (pt-BR).
- Prefira termos específicos: "Insuficiência Cardíaca Congestiva" em vez de "Coração".
- Inclua: condições clínicas, fármacos, exames diagnósticos, procedimentos cirúrgicos, achados anatomopatológicos.
- NÃO inclua: adjetivos genéricos ("crônico", "agudo"), termos epidemiológicos não-DeCS, o formato da questão.
- NÃO combine termos em frases compostas que não existam no DeCS (ex: "síndrome inflamatória reprodutiva" não é um descritor real).
- Retorne SOMENTE um array JSON de strings. Sem markdown, sem explicação.

Exemplo correto:
["Diabetes Mellitus Tipo 2","Insulina","Hemoglobina A Glicada","Nefropatias Diabéticas"]`;

const VALIDATION_PROMPT = `Você é um especialista em vocabulário controlado DeCS/MeSH.

Dado o enunciado de uma questão médica e uma lista de descritores DeCS candidatos, filtre e mantenha APENAS os descritores CLINICAMENTE RELEVANTES para o tema central da questão.

Critérios:
- Deve representar um conceito clínico central (condição, fármaco, exame, procedimento).
- Organismos (vírus, bactérias, animais) só são relevantes se a questão tratar de infectologia/microbiologia explicitamente.
- Descritores de categoria não relacionada ao tema devem ser removidos.

Retorne SOMENTE um array JSON com os CÓDIGOS dos descritores aprovados.
Ex: ["292","4794"]
Sem explicação, sem markdown.`;

// ── DB ───────────────────────────────────────────────────────────────────────
const pool = new pg.Pool({ connectionString: DB_URL });

async function fetchQuestions() {
  const whereClause = SKIP_CLASSIFIED
    ? `WHERE ai_decs_descriptors IS NULL`
    : '';
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

// ── DeCS search (multi-candidate) ────────────────────────────────────────────
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

async function findBestDeCSMatch(searchTerm, questionText) {
  const candidates = await searchDeCSCandidates(searchTerm);
  const scored = candidates
    .map(c => ({ ...c, similarity: wordJaccard(searchTerm, c.term) }))
    .filter(c => c.similarity >= MIN_SIMILARITY)
    .filter(c => isCategoryAcceptable(c, questionText))
    .sort((a, b) => b.similarity - a.similarity);
  return scored.length > 0 ? scored[0] : null;
}

// ── Gemini helpers ────────────────────────────────────────────────────────────
async function callGemini(systemPrompt, userMessage, maxTokens = 512) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens },
  };
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`Gemini ${res.status}: ${err}`); }
  const data = await res.json();
  return (data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '').trim();
}

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

// ── Layer 3: Gemini validation ────────────────────────────────────────────────
async function validateDescriptors(descriptors, questionText) {
  if (descriptors.length === 0) return [];
  const candidateList = descriptors.map(d => ({
    code: d.code, term: d.term,
    categoria: (buildHierarchyPath(d.tree_ids[0] ?? '')).split(' › ')[0],
  }));
  const userMessage = ['Questão:', questionText, '', 'Candidatos:', JSON.stringify(candidateList, null, 2)].join('\n');
  try {
    const raw = await callGemini(VALIDATION_PROMPT, userMessage, 256);
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
    // Step 1: extract search terms
    const rawText = await callGemini(EXTRACTION_PROMPT, questionText);
    const searchTerms = parseSearchTerms(rawText);

    if (searchTerms.length === 0) {
      error = 'No search terms extracted';
    } else {
      // Step 2: multi-candidate search + category filter
      const seen = new Set();
      const afterSearch = [];
      await Promise.allSettled(searchTerms.map(async term => {
        const match = await findBestDeCSMatch(term, questionText);
        if (match && !seen.has(match.code)) { seen.add(match.code); afterSearch.push(match); }
      }));

      // Step 3: Gemini validation
      const afterValidation = await validateDescriptors(afterSearch, questionText);
      descriptors = afterValidation.map(({ similarity: _s, ...rest }) => rest);

      stats = {
        terms_sent: searchTerms.length,
        after_search: afterSearch.length,
        after_validation: descriptors.length,
        dropped_filter: searchTerms.length - afterSearch.length,
        dropped_gemini: afterSearch.length - descriptors.length,
      };
    }
  } catch (e) { error = e.message; }

  const status = error
    ? `✗ — ${error}`
    : `✓ ${descriptors.length} desc (−${stats.dropped_filter ?? 0} filtro, −${stats.dropped_gemini ?? 0} gemini)`;
  console.log(`[${String(idx + 1).padStart(3)}/${total}] Q${q.id} ${status}`);

  return { id_question: q.id, ai_decs_descriptors: descriptors, error };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔬 MedMind — Batch DeCS Classifier v2 (3-layer pipeline)`);
  console.log(`limit=${LIMIT} offset=${OFFSET} skip-classified=${SKIP_CLASSIFIED} (use --include-classified to reprocess) concurrency=${CONCURRENCY}\n`);

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

  const processed = results.length;
  const withDesc  = results.filter(r => r.ai_decs_descriptors.length > 0).length;
  const withoutDesc = processed - withDesc;
  const failed    = results.filter(r => r.error).length;
  const totalDesc = results.flatMap(r => r.ai_decs_descriptors).length;

  console.log(`\n✅ Concluído!`);
  console.log(`   Processadas:     ${processed}`);
  console.log(`   Com descritores: ${withDesc} (${((withDesc / (processed || 1)) * 100).toFixed(1)}%)`);
  console.log(`   Sem descritores: ${withoutDesc} (${((withoutDesc / (processed || 1)) * 100).toFixed(1)}%)`);
  console.log(`   Falhas API:      ${failed}`);
  console.log(`   Total descritores salvos: ${totalDesc}`);
  console.log(`   Média por questão processada: ${(totalDesc / (processed || 1)).toFixed(2)}`);
  console.log(`   Arquivo: ${OUTPUT_FILE}\n`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
