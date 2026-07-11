/**
 * Classificação DeCS em lote — mesmo fluxo conceitual de app/api/questions/[id]/decs-ai/route.ts
 *
 * - Lê questões do PostgreSQL em ordem DECRESCENTE (mais novas primeiro: created_at DESC, id DESC).
 * - Processa uma questão por vez (sequencial).
 * - Persiste apenas no banco: coluna TEXT `ai_decs_classified_text` (temas Gemini + descritores finais),
 *   com separação por vírgula e espaço, sem quebras de linha no valor gravado.
 * - Não grava arquivos JSON nem chama saveClassificationArtifact / pasta data/decs-classification.
 *
 * Requer: DATABASE_URL, DECS_API_KEY, GEMINI_API_KEY ou GOOGLE_API_KEY (.env.local)
 *
 * Uso:
 *   node scripts/batch-decs-ai-db.mjs
 *   node scripts/batch-decs-ai-db.mjs --limit 50 --offset 0
 *   node scripts/batch-decs-ai-db.mjs --include-classified
 *   node scripts/batch-decs-ai-db.mjs --min-id 100 --max-id 5000
 *
 * Cota / 429 (Gemini): use --delay-ms entre questões (padrão 8s) e, se precisar,
 * --embed-stagger-ms entre buscas por tema (evita muitos embeddings em paralelo).
 * Em plano gratuito o limite diário por modelo é baixo — além do código, pode ser
 * necessário ativar faturamento no Google AI Studio ou reduzir --limit / rodar em dias diferentes.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';
import { GoogleGenAI } from '@google/genai';
import { loadRuntimeAgents, buildGeminiBody } from './lib/ai-agents-db.mjs';
import { DECS_MAX_CANDIDATES } from './decs-search-limits.mjs';

// ── .env.local ───────────────────────────────────────────────────────────────
function loadEnv(path) {
  try {
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
  } catch {
    /* optional file */
  }
}
loadEnv(resolve(process.cwd(), '.env.local'));

const GEMINI_KEY = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)?.trim();
const DECS_KEY = process.env.DECS_API_KEY?.trim();
const DB_URL = process.env.DATABASE_URL?.trim();

if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY ou GOOGLE_API_KEY não configurada');
if (!DECS_KEY) throw new Error('DECS_API_KEY não configurada');
if (!DB_URL) throw new Error('DATABASE_URL não configurada');

const _args = process.argv.slice(2);
const _getArg = (flag, def) => {
  const i = _args.indexOf(flag);
  return i !== -1 && _args[i + 1] ? _args[i + 1] : def;
};
const _hasFlag = (flag) => _args.includes(flag);

const LIMIT = parseInt(_getArg('--limit', '100'), 10);
const OFFSET = parseInt(_getArg('--offset', '0'), 10);
const MIN_ID = _getArg('--min-id', null) ? parseInt(_getArg('--min-id', null), 10) : null;
const MAX_ID = _getArg('--max-id', null) ? parseInt(_getArg('--max-id', null), 10) : null;
const INCLUDE_CLASSIFIED = _hasFlag('--include-classified');
/** Pausa entre o fim de uma questão e o início da próxima (reduz picos RPM e ajuda em 429). */
const DELAY_BETWEEN_QUESTIONS_MS = parseInt(_getArg('--delay-ms', '8000'), 10);
/** Entre cada busca por tema (cada uma pode chamar embedding no índice local). */
const EMBED_STAGGER_MS = parseInt(_getArg('--embed-stagger-ms', '400'), 10);
const GEMINI_MAX_RETRIES = parseInt(_getArg('--gemini-retries', '8'), 10);

const DECS_BASE = 'https://api.bvsalud.org/decs/v2';
const MAX_CANDIDATES = DECS_MAX_CANDIDATES;
const MIN_SIMILARITY = 0.15;
const EMBED_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';

const CATEGORY_LABELS = {
  A: 'Anatomia',
  B: 'Organismos',
  C: 'Doenças',
  D: 'Compostos Químicos e Drogas',
  E: 'Técnicas e Equipamentos Analíticos',
  F: 'Psiquiatria e Psicologia',
  G: 'Fenômenos Biológicos',
  H: 'Disciplinas e Ocupações',
  I: 'Antropologia, Educação, Sociologia',
  J: 'Tecnologia, Indústria, Agricultura',
  K: 'Humanidades',
  L: 'Ciência da Informação',
  M: 'Grupos Identificados',
  N: 'Saúde',
  SP: 'Saúde Pública',
  VS: 'Vigilância Sanitária',
};

const BIO_KEYWORD_RE =
  /\b(vírus|virus|bactéria|bacteria|bacilo|fungo|fung|parasita|parasit|microbiol|infectol|viral|bacteria|antibiótic|antibiotic|vaccin|vacin|patógen|patogen|prion|rickettsia|protozoár|helmint|coccídio|coccidi|tripanossom|leishman|plasmodium|schistosoma)\b/i;

const pool = new pg.Pool({ connectionString: DB_URL });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Detecta limite de taxa / cota (429, RESOURCE_EXHAUSTED). */
function isGeminiRateLimitError(err) {
  const s = JSON.stringify(err ?? '');
  const msg = `${err?.message ?? ''}${err?.status ?? ''}${err?.code ?? ''}${s}`;
  return (
    /429|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(msg) ||
    err?.status === 429 ||
    err?.code === 429
  );
}

/** Extrai segundos sugeridos pela API ("Please retry in 28.03s") ou RetryInfo. */
function parseRetryDelaySecondsFromError(err) {
  const msg = typeof err?.message === 'string' ? err.message : JSON.stringify(err ?? '');
  const m1 = msg.match(/retry in ([0-9.]+)\s*s/i);
  if (m1) return Math.ceil(parseFloat(m1[1], 10) + 1.5);
  try {
    const j = JSON.parse(msg);
    const details = j?.error?.details ?? j?.details;
    const retry = Array.isArray(details)
      ? details.find((d) => d?.['@type']?.includes?.('RetryInfo') || d?.retryDelay)
      : null;
    const rd = retry?.retryDelay;
    if (typeof rd === 'string' && rd.endsWith('s')) {
      const n = parseFloat(rd, 10);
      if (!Number.isNaN(n)) return Math.ceil(n + 1.5);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Reexecuta em 429 com backoff (usa o "retry in Xs" do Google quando existir).
 */
async function withGemini429Retry(label, fn, { maxAttempts = GEMINI_MAX_RETRIES } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isGeminiRateLimitError(err) || attempt >= maxAttempts) throw err;
      const fromApi = parseRetryDelaySecondsFromError(err);
      const exp = Math.min(120, Math.ceil(6 * 2 ** (attempt - 1)));
      const waitSec = fromApi ?? exp;
      console.warn(`[${label}] Limite Gemini (429/cota). Aguardando ${waitSec}s antes da tentativa ${attempt + 1}/${maxAttempts}...`);
      await sleep(waitSec * 1000);
    }
  }
  throw lastErr;
}

let classifierAgent;
let validatorAgent;

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v != null) return [v];
  return [];
}

function treeCategory(treeId) {
  return String(treeId).split('.')[0].replace(/[0-9]/g, '');
}

function buildHierarchyPath(treeId) {
  if (!treeId) return '';
  const cat = treeCategory(treeId);
  const label = CATEGORY_LABELS[cat] ?? cat;
  return treeId.split('.').length <= 1 ? label : `${label} › ${treeId}`;
}

/**
 * Resolve TODAS as ramificações (tree_ids) de um descritor, não só a primeira.
 * Mesmo comportamento de buildBranches em lib/decs-pipeline.ts — mantido aqui
 * localmente pois scripts .mjs não resolvem imports "@/lib/*" do Next.
 */
function buildBranches(treeIds) {
  return (treeIds ?? []).filter(Boolean).map((tree_id) => ({ tree_id, hierarchy_path: buildHierarchyPath(tree_id) }));
}

function wordJaccard(a, b) {
  const tokenise = (s) =>
    new Set(
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/\W+/)
        .filter((w) => w.length > 3),
    );
  const A = tokenise(a);
  const B = tokenise(b);
  let inter = 0;
  A.forEach((w) => {
    if (B.has(w)) inter++;
  });
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}

function isCategoryAcceptable(record, questionText) {
  if (!record.tree_ids || record.tree_ids.length === 0) return true;
  const cats = record.tree_ids.map(treeCategory);
  const allOrganism = cats.every((c) => c === 'B');
  if (!allOrganism) return true;
  return BIO_KEYWORD_RE.test(questionText);
}

async function ensureColumns() {
  await pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_decs_classified_text TEXT`);
}

async function loadAgentsFromDb() {
  const map = await loadRuntimeAgents(pool, ['decs_classifier', 'decs_validator']);
  classifierAgent = map.get('decs_classifier');
  validatorAgent = map.get('decs_validator');
  console.log(`Agentes DB: decs_classifier (${classifierAgent.model}), decs_validator (${validatorAgent.model})`);
}

let localDeCSAvailable = null;

async function isLocalDeCSAvailable() {
  if (localDeCSAvailable !== null) return localDeCSAvailable;
  try {
    const { rows } = await pool.query(`SELECT 1 FROM decs_descriptors LIMIT 1`);
    localDeCSAvailable = rows.length > 0;
  } catch {
    localDeCSAvailable = false;
  }
  return localDeCSAvailable;
}

async function generateEmbedding(text) {
  try {
    const res = await fetch(`${EMBED_BASE}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text: String(text).substring(0, 2000) }] },
        taskType: 'RETRIEVAL_QUERY',
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.embedding?.values ?? null;
  } catch {
    return null;
  }
}

async function searchDeCSLocal(searchTerm, maxCandidates = DECS_MAX_CANDIDATES, minSimilarity = 0.6) {
  try {
    if (!(await isLocalDeCSAvailable())) return [];
    const embedding = await generateEmbedding(searchTerm);
    if (!embedding) return [];
    const vec = `[${embedding.join(',')}]`;
    const { rows } = await pool.query(
      `
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
    `,
      [vec, minSimilarity, maxCandidates],
    );
    return rows.map((r) => {
      const tree_ids = Array.isArray(r.tree_numbers) ? r.tree_numbers : JSON.parse(r.tree_numbers ?? '[]');
      return {
        term: r.term,
        code: r.code,
        tree_ids,
        hierarchy_path: buildHierarchyPath(tree_ids[0] ?? ''),
        branches: buildBranches(tree_ids),
        similarity: parseFloat(r.similarity ?? '0'),
        scope_note: r.scope_note ?? undefined,
        name_en: r.name_en ?? undefined,
      };
    });
  } catch {
    return [];
  }
}

function parseDeCSRecord(rec) {
  const code = rec?.attr?.mfn ?? '';
  const descriptors = toArray(rec.descriptor_list).flatMap((d) => toArray(d));
  let term = '';
  for (const pl of ['pt-br', 'pt']) {
    const found = descriptors.find((d) => d?.attr?.lang === pl);
    if (found && typeof found.descriptor === 'string' && found.descriptor.trim()) {
      term = found.descriptor.trim();
      break;
    }
  }
  if (!term) return null;
  const treeList = toArray(rec.tree_id_list).flatMap((t) => toArray(t));
  const tree_ids = treeList.map((t) => t?.tree_id?.trim()).filter(Boolean);
  return { term, code, tree_ids, hierarchy_path: buildHierarchyPath(tree_ids[0] ?? ''), branches: buildBranches(tree_ids) };
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
    return toArray(resp.record)
      .slice(0, MAX_CANDIDATES)
      .map(parseDeCSRecord)
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function enrichFromDB(records) {
  if (records.length === 0) return records;
  const missing = records.filter((r) => !r.scope_note && r.code);
  if (missing.length === 0) return records;
  try {
    const codes = missing.map((r) => r.code);
    const res = await pool.query(`SELECT ui, name_en, scope_note FROM decs_descriptors WHERE ui = ANY($1)`, [codes]);
    const map = new Map(res.rows.map((r) => [r.ui, { name_en: r.name_en, scope_note: r.scope_note }]));
    return records.map((r) => {
      const extra = map.get(r.code);
      return extra ? { ...r, ...extra } : r;
    });
  } catch {
    return records;
  }
}

async function validateDescriptorsWithGemini(descriptors, questionText) {
  if (descriptors.length === 0) return [];
  const candidateList = descriptors.map((d) => ({
    code: d.code,
    term: d.term,
    term_en: d.name_en ?? undefined,
    scope: d.scope_note ? String(d.scope_note).substring(0, 180) : undefined,
    categoria: buildHierarchyPath(d.tree_ids[0] ?? '').split(' › ')[0],
  }));
  const userMessage = ['Questão:', questionText, '', 'Candidatos:', JSON.stringify(candidateList, null, 2)].join('\n');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${validatorAgent.model}:generateContent?key=${GEMINI_KEY}`;
  const body = buildGeminiBody(validatorAgent, userMessage, { responseMimeType: 'application/json' });
  try {
    let data;
    for (let attempt = 1; attempt <= GEMINI_MAX_RETRIES; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const textBody = await res.text();
      if (res.status === 429) {
        const waitSec =
          parseRetryDelaySecondsFromError({ message: textBody }) ??
          Math.min(120, Math.ceil(6 * 2 ** (attempt - 1)));
        if (attempt >= GEMINI_MAX_RETRIES) return descriptors;
        console.warn(
          `[gemini validate] HTTP 429 — aguardando ${waitSec}s (tentativa ${attempt}/${GEMINI_MAX_RETRIES})...`,
        );
        await sleep(waitSec * 1000);
        continue;
      }
      if (!res.ok) return descriptors;
      try {
        data = JSON.parse(textBody);
      } catch {
        return descriptors;
      }
      break;
    }
    if (data == null) return descriptors;
    const rawText =
      data?.candidates?.[0]?.content?.parts
        ?.filter((p) => !p?.thought)
        ?.map((p) => p?.text)
        .filter(Boolean)
        .join('') ?? '';
    const cleaned = rawText
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const approved = JSON.parse(cleaned);
    if (!Array.isArray(approved)) return descriptors;
    const approvedSet = new Set(approved.map(String));
    const filtered = descriptors.filter((d) => approvedSet.has(d.code));
    return filtered.length > 0 ? filtered : descriptors;
  } catch {
    return descriptors;
  }
}

/**
 * Equivalente a runDeCSPipeline (lib/decs-pipeline.ts): busca multi-candidata, filtro de categoria, validação Gemini.
 */
async function runDeCSPipeline(themes, questionText) {
  const seenCodes = new Set();
  const afterSearch = [];
  const searchAll = [
    ...themes.primary.map((term) => ({ term, role: 'primary' })),
    ...themes.secondary.map((term) => ({ term, role: 'secondary' })),
  ];

  /** Uma busca por vez + pausa reduz rajadas de embedding (Gemini) no índice local. */
  const outcomes = [];
  for (let i = 0; i < searchAll.length; i++) {
    if (i > 0 && EMBED_STAGGER_MS > 0) await sleep(EMBED_STAGGER_MS);
    const { term, role } = searchAll[i];
    let rawCandidates = [];
    if (GEMINI_KEY && (await isLocalDeCSAvailable())) {
      rawCandidates = await searchDeCSLocal(term, DECS_MAX_CANDIDATES, 0.6);
    }
    if (rawCandidates.length === 0) {
      const apiResults = await searchDeCSCandidates(term);
      rawCandidates = apiResults
        .map((c) => ({ ...c, similarity: wordJaccard(term, c.term) }))
        .filter((c) => (c.similarity ?? 0) >= MIN_SIMILARITY)
        .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
    }
    if (rawCandidates.length === 0) {
      outcomes.push({ status: 'no_candidate' });
      continue;
    }
    const accepted = rawCandidates.filter((c) => isCategoryAcceptable(c, questionText));
    if (accepted.length === 0) {
      outcomes.push({ status: 'category_filtered' });
      continue;
    }
    const best = accepted[0];
    if (seenCodes.has(best.code)) {
      outcomes.push({ status: 'deduped' });
      continue;
    }
    seenCodes.add(best.code);
    outcomes.push({ status: 'accepted', role, match: best });
  }

  let droppedByFilter = 0;
  for (const outcome of outcomes) {
    if (outcome.status === 'accepted') {
      afterSearch.push({ ...outcome.match, role: outcome.role });
    } else if (outcome.status === 'category_filtered') {
      droppedByFilter++;
    }
  }

  const enriched = await enrichFromDB(afterSearch);
  const afterValidation = await validateDescriptorsWithGemini(enriched, questionText);
  const droppedByGemini = afterSearch.length - afterValidation.length;

  const primary = afterValidation
    .filter((d) => d.role === 'primary')
    .map(({ similarity: _s, ...rest }) => rest);
  const secondary = afterValidation
    .filter((d) => d.role !== 'primary')
    .map(({ similarity: _s, ...rest }) => rest);
  const descriptors = [...primary, ...secondary];

  return { descriptors, dropped_by_filter: droppedByFilter, dropped_by_gemini: droppedByGemini };
}

function buildQuestionText(q) {
  return [
    'Enunciado:',
    q.statement,
    '',
    'Alternativa A: ' + (q.option_a ?? ''),
    'Alternativa B: ' + (q.option_b ?? ''),
    q.option_c ? 'Alternativa C: ' + q.option_c : null,
    q.option_d ? 'Alternativa D: ' + q.option_d : null,
    q.option_e ? 'Alternativa E: ' + q.option_e : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Remove quebras de linha e vírgulas internas para o texto único armazenado no banco (lista externa separada por ", "). */
function sanitizeFlatToken(s) {
  return String(s)
    .replace(/\r?\n/g, ' ')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildFlatClassificationText(themes, descriptors) {
  const geminiTerms = [...themes.primary, ...themes.secondary].map(sanitizeFlatToken).filter(Boolean);
  const descParts = descriptors.map((d) => sanitizeFlatToken(`${d.term} (${d.code})`)).filter(Boolean);
  return [...geminiTerms, ...descParts].join(', ');
}

function parseThemesFromRaw(rawText) {
  let themes = { primary: [], secondary: [] };
  try {
    const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      themes.primary = parsed.filter((t) => typeof t === 'string' && t.trim()).slice(0, 3);
    } else if (parsed && typeof parsed === 'object') {
      themes.primary = (Array.isArray(parsed.primary) ? parsed.primary : [])
        .filter((t) => typeof t === 'string' && t.trim())
        .slice(0, 3);
      themes.secondary = (Array.isArray(parsed.secondary) ? parsed.secondary : [])
        .filter((t) => typeof t === 'string' && t.trim())
        .slice(0, 6);
    }
  } catch {
    const matches = rawText.match(/"([^"]+)"/g);
    if (matches) {
      themes.primary = matches.map((m) => m.replace(/"/g, '').trim()).filter(Boolean).slice(0, 3);
    }
  }
  return themes;
}

async function extractThemesWithGoogleGenAI(questionText) {
  return withGemini429Retry('gemini temas', async () => {
    const ai = new GoogleGenAI({ apiKey: GEMINI_KEY, apiVersion: 'v1beta' });
    const response = await ai.models.generateContent({
      model: classifierAgent.model,
      contents: [{ role: 'user', parts: [{ text: questionText }] }],
      config: {
        systemInstruction: classifierAgent.system_instruction,
        temperature: classifierAgent.temperature,
        maxOutputTokens: classifierAgent.max_output_tokens,
        responseMimeType: 'application/json',
      },
    });
    const resp = response;
    const rawText =
      (typeof resp?.text === 'string' ? resp.text : '') ||
      (resp?.candidates?.[0]?.content?.parts
        ?.map((p) => p?.text)
        .filter(Boolean)
        .join('') ??
        '');
    return parseThemesFromRaw(rawText);
  });
}

async function fetchQuestionBatch() {
  const conditions = [];
  const params = [];
  if (!INCLUDE_CLASSIFIED) {
    conditions.push(`(ai_decs_classified_text IS NULL OR btrim(ai_decs_classified_text) = '')`);
  }
  if (MIN_ID !== null) {
    conditions.push(`id >= $${params.length + 1}`);
    params.push(MIN_ID);
  }
  if (MAX_ID !== null) {
    conditions.push(`id <= $${params.length + 1}`);
    params.push(MAX_ID);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(LIMIT, OFFSET);
  const lim = params.length - 1;
  const off = params.length;
  const sql = `
    SELECT id, statement, option_a, option_b, option_c, option_d, option_e, created_at
    FROM questions
    ${whereClause}
    ORDER BY created_at DESC NULLS LAST, id DESC
    LIMIT $${lim} OFFSET $${off}
  `;
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function processOneQuestion(q, index, total) {
  const questionText = buildQuestionText(q);
  const label = `[${String(index + 1).padStart(4)}/${total}] id=${q.id}`;

  if (!classifierAgent.system_instruction?.trim()) {
    console.log(`${label} ✗ Agente decs_classifier sem system_instruction/system_prompt no banco`);
    return { ok: false, reason: 'no_classifier_prompt' };
  }
  if (!validatorAgent.system_instruction?.trim()) {
    console.log(`${label} ✗ Agente decs_validator sem system_instruction/system_prompt no banco`);
    return { ok: false, reason: 'no_validator_prompt' };
  }

  let themes;
  try {
    themes = await extractThemesWithGoogleGenAI(questionText);
  } catch (e) {
    console.log(`${label} ✗ Gemini (temas): ${e?.message ?? e}`);
    return { ok: false, reason: 'gemini_themes' };
  }

  if (themes.primary.length === 0 && themes.secondary.length === 0) {
    console.log(`${label} ✗ Nenhum tema identificado`);
    return { ok: false, reason: 'no_themes' };
  }

  let descriptors;
  let stats;
  try {
    const out = await runDeCSPipeline(themes, questionText);
    descriptors = out.descriptors;
    stats = out;
  } catch (e) {
    console.log(`${label} ✗ Pipeline: ${e?.message ?? e}`);
    return { ok: false, reason: 'pipeline' };
  }

  const flat = buildFlatClassificationText(themes, descriptors);
  await pool.query(`UPDATE questions SET ai_decs_classified_text = $1, updated_at = NOW() WHERE id = $2`, [flat, q.id]);

  console.log(
    `${label} ✓ flat_len=${flat.length} desc=${descriptors.length} filt=${stats.dropped_by_filter} gemini_drop=${stats.dropped_by_gemini}`,
  );
  return { ok: true, flat_len: flat.length, descriptors: descriptors.length };
}

async function main() {
  console.log('\nMedMind — batch DeCS (DB-only, ordem: mais novas primeiro)\n');
  await ensureColumns();
  await loadAgentsFromDb();

  const questions = await fetchQuestionBatch();
  console.log(`Questões neste lote: ${questions.length} (limit=${LIMIT} offset=${OFFSET})`);
  console.log(
    `Pacing: delay entre questões=${DELAY_BETWEEN_QUESTIONS_MS}ms, embed-stagger=${EMBED_STAGGER_MS}ms, retries=${GEMINI_MAX_RETRIES}\n`,
  );

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < questions.length; i++) {
    const r = await processOneQuestion(questions[i], i, questions.length);
    if (r.ok) ok++;
    else fail++;
    if (i + 1 < questions.length && DELAY_BETWEEN_QUESTIONS_MS > 0) {
      await sleep(DELAY_BETWEEN_QUESTIONS_MS);
    }
  }

  console.log(`\nConcluído. Sucesso: ${ok}, falhas: ${fail}\n`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
