/**
 * Classificação DeCS em lote via API (mesmo fluxo da UI).
 *
 * Para cada id: GET /api/questions/[id] (question + decs_before), depois POST decs-ai.
 * Saída: classification-output/ na raiz do repo (manifest + questions/ + errors/).
 *
 * Pré-requisito: npm run dev (porta 5000) com .env.local no servidor.
 *
 * Uso (a partir da raiz do repo):
 *   node matheus/classify-decs-via-api.mjs
 *   node matheus/classify-decs-via-api.mjs --force
 *   node matheus/classify-decs-via-api.mjs --dry-run
 */

import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';

// ── Configuração (editar antes de rodar) ─────────────────────────────────────

const ADMIN_TOKEN_PASTED = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwibmFtZSI6IkFkbWluaXN0cmFkb3IiLCJ1c2VybmFtZSI6ImFkbWluIiwiZW1haWwiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImNvbXBhbnlfaWQiOm51bGwsImlhdCI6MTc3OTkwOTcxMiwiZXhwIjoxNzgwNTE0NTEyfQ.ELulSuxEDy1r-_BnO8Lmlg_R1ggc44rh1x0hZdlsmbE';
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || ADMIN_TOKEN_PASTED).trim();

const API_BASE_URL = 'http://127.0.0.1:5000';

/** IDs das questões já existentes em `questions` */
const QUESTION_IDS = [
  25452, 25453, 25454, 25455, 25456, 25457, 25458, 25459, 25460,
  25461, 25462, 25463, 25464, 25465, 25466, 25467, 25468, 25469, 25470,
  25471, 25472, 25473, 25474, 25475, 25476, 25477, 25478, 25479, 25480,
  25481, 25482, 25483, 25484, 25485, 25486, 25487, 25488, 25489, 25490,
  25491, 25492, 25493, 25494, 25495, 25496, 25497, 25498, 25499, 25500,
  25501, 25502, 25503, 25504, 25505, 25506, 25507, 25508, 25509, 25510,
  25511, 25512, 25513, 25514, 25515, 25516, 25517, 25518, 25519, 25520,
  25521, 25522, 25523, 25524, 25525, 25526, 25527, 25528, 25529, 25530,
  25531, 25532, 25533, 25534, 25535, 25536, 25537, 25538, 25539, 25540,
  25541, 25542, 25543, 25544, 25545, 25546, 25547, 25548, 25549, 25550,
  25551, 25552, 25553, 25554, 25555, 25556, 25557, 25558, 25559, 25560,
  25561, 25562, 25563, 25564, 25565, 25566, 25567, 25568, 25569, 25570,
  25571, 25572, 25573, 25574, 25575, 25576, 25577, 25578, 25579, 25580,
  25581, 25582, 25583, 25584, 25585, 25586, 25587, 25588, 25589, 25590,
  25591, 25592, 25593, 25594, 25595, 25596, 25597, 25598, 25599, 25600,
  25601, 25602, 25603, 25604, 25605, 25606, 25607, 25608, 25609, 25610,
  25611, 25612, 25613, 25614, 25615, 25616, 25617, 25618, 25619, 25620,
  25621, 25622, 25623, 25624, 25625, 25626, 25627, 25628, 25629, 25630,
  25631, 25632, 25633, 25634, 25635, 25636, 25637, 25638, 25639, 25640,
  25641, 25642, 25643, 25644, 25645, 25646, 25647, 25648, 25649, 25650,
  25651
];

const DELAY_MS = 2000;
const MAX_RETRIES = 3;

// ── Paths (raiz do repo = cwd ao executar da raiz) ───────────────────────────

const REPO_ROOT = process.cwd();
const OUTPUT_DIR = join(REPO_ROOT, 'classification-output');
const QUESTIONS_DIR = join(OUTPUT_DIR, 'questions');
const ERRORS_DIR = join(OUTPUT_DIR, 'errors');
const MANIFEST_PATH = join(OUTPUT_DIR, 'manifest.jsonl');

// ── CLI ────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureDirs() {
  mkdirSync(QUESTIONS_DIR, { recursive: true });
  mkdirSync(ERRORS_DIR, { recursive: true });
}

/** Última linha por question_id com status ok */
function loadOkIds() {
  const ok = new Set();
  if (!existsSync(MANIFEST_PATH)) return ok;
  const lines = readFileSync(MANIFEST_PATH, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (row.status === 'ok' && row.question_id != null) {
        ok.add(Number(row.question_id));
      }
    } catch {
      /* ignore malformed lines */
    }
  }
  return ok;
}

function appendManifest(entry) {
  appendFileSync(MANIFEST_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
}

function questionOutputPath(id) {
  return join(QUESTIONS_DIR, `${id}.json`);
}

function round1QuestionOutputPath(id) {
  return join(QUESTIONS_DIR, 'round1', `${id}.json`);
}


function errorOutputPath(id) {
  return join(ERRORS_DIR, `${id}.json`);
}

function shouldSkip(id, okIds) {
  if (FORCE) return false;
  if (!okIds.has(id)) return false;
  return existsSync(round1QuestionOutputPath(id)) || existsSync(questionOutputPath(id));
}

function authHeaders() {
  return {
    Authorization: `Bearer ${ADMIN_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function normalizeJsonArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Enunciado, alternativas e gabarito (sem texto da alternativa correta). */
function buildQuestionFromApi(data) {
  return {
    id: data.id,
    statement: data.statement ?? '',
    alternatives: {
      A: data.option_a ?? '',
      B: data.option_b ?? '',
      C: data.option_c ?? null,
      D: data.option_d ?? null,
      E: data.option_e ?? null,
    },
    correct_answer: data.correct_answer ?? null,
  };
}

/** Estado DeCS no banco imediatamente antes do POST decs-ai. */
function buildDecsBefore(data) {
  return {
    ai_decs_descriptors: normalizeJsonArray(data.ai_decs_descriptors),
    decs_terms: normalizeJsonArray(data.decs_terms),
  };
}

/**
 * GET /api/questions/:id — captura questão e descritores anteriores ao POST.
 */
async function fetchQuestionSnapshot(id) {
  const url = `${API_BASE_URL.replace(/\/$/, '')}/api/questions/${id}`;
  const res = await fetch(url, { headers: authHeaders() });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (res.ok && body && typeof body === 'object') {
    return {
      ok: true,
      question: buildQuestionFromApi(body),
      decs_before: buildDecsBefore(body),
    };
  }

  return {
    ok: false,
    status: res.status,
    body,
    fatal: res.status === 401 || res.status === 403,
  };
}

async function classifyOne(id) {
  const url = `${API_BASE_URL.replace(/\/$/, '')}/api/questions/${id}/decs-ai`;

  let lastStatus = 0;
  let lastBody = null;
  let lastText = '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(),
    });

    lastStatus = res.status;
    lastText = await res.text();
    try {
      lastBody = lastText ? JSON.parse(lastText) : null;
    } catch {
      lastBody = { raw: lastText };
    }

    if (res.ok) {
      return { ok: true, status: res.status, body: lastBody };
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, body: lastBody, fatal: true };
    }

    if (res.status === 429 || res.status === 503) {
      if (attempt < MAX_RETRIES) {
        const waitSec = 6 * 2 ** (attempt - 1);
        console.warn(`  HTTP ${res.status} — aguardando ${waitSec}s (tentativa ${attempt}/${MAX_RETRIES})`);
        await sleep(waitSec * 1000);
        continue;
      }
    }

    return { ok: false, status: res.status, body: lastBody, fatal: false };
  }

  return { ok: false, status: lastStatus, body: lastBody, fatal: false };
}

function writeSuccess(id, status, body, snapshot) {
  const at = new Date().toISOString();
  const rel = `questions/${id}.json`;
  const payload = {
    question_id: id,
    classified_at: at,
    http_status: status,
    question: snapshot?.question ?? null,
    decs_before: snapshot?.decs_before ?? {
      ai_decs_descriptors: [],
      decs_terms: [],
    },
    api_response: body,
  };
  writeFileSync(questionOutputPath(id), JSON.stringify(payload, null, 2), 'utf8');
  appendManifest({
    question_id: id,
    status: 'ok',
    at,
    output: rel,
  });
}

function writeError(id, status, body, errorMessage, snapshot = null) {
  const at = new Date().toISOString();
  const rel = `errors/${id}.json`;
  const payload = {
    question_id: id,
    classified_at: at,
    http_status: status,
    error: errorMessage,
    question: snapshot?.question ?? null,
    decs_before: snapshot?.decs_before ?? {
      ai_decs_descriptors: [],
      decs_terms: [],
    },
    api_response: body,
  };
  writeFileSync(errorOutputPath(id), JSON.stringify(payload, null, 2), 'utf8');
  appendManifest({
    question_id: id,
    status: 'error',
    at,
    output: rel,
    http_status: status,
    error: errorMessage,
  });
}

async function main() {
  console.log('\nMedMind — classificação DeCS via API (decs-ai)\n');
  console.log(`API: ${API_BASE_URL}`);
  console.log(`Questões no lote: ${QUESTION_IDS.length}`);
  console.log(`force=${FORCE} dry-run=${DRY_RUN} delay=${DELAY_MS}ms\n`);

  if (!ADMIN_TOKEN.trim() && !DRY_RUN) {
    console.error('ADMIN_TOKEN vazio. Cole em ADMIN_TOKEN_PASTED ou exporte ADMIN_TOKEN=...');
    process.exit(1);
  }

  if (QUESTION_IDS.length === 0) {
    console.error('QUESTION_IDS está vazio. Adicione ids no script.');
    process.exit(1);
  }

  ensureDirs();
  const okIds = loadOkIds();

  const stats = { skip: 0, ok: 0, error: 0, fatal: false };

  for (let i = 0; i < QUESTION_IDS.length; i++) {
    const id = QUESTION_IDS[i];
    const label = `[${i + 1}/${QUESTION_IDS.length}] Q${id}`;

    if (shouldSkip(id, okIds)) {
      console.log(`${label} skip (já classificada)`);
      stats.skip++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`${label} would POST`);
      continue;
    }

    console.log(`${label} lendo questão (decs_before)...`);
    const snap = await fetchQuestionSnapshot(id);
    let snapshot = null;

    if (snap.ok) {
      snapshot = { question: snap.question, decs_before: snap.decs_before };
      const prevAi = snap.decs_before.ai_decs_descriptors.length;
      const prevTerms = snap.decs_before.decs_terms.length;
      console.log(`${label} decs_before: ${prevAi} ai + ${prevTerms} decs_terms`);
    } else if (snap.fatal) {
      const msg = snap.body?.error ?? `GET HTTP ${snap.status} (auth)`;
      writeError(id, snap.status, snap.body, msg, null);
      console.error(`${label} FATAL (GET): ${msg}`);
      stats.error++;
      stats.fatal = true;
      break;
    } else if (snap.status === 404) {
      const msg = snap.body?.error ?? 'Questão não encontrada';
      writeError(id, snap.status, snap.body, msg, null);
      console.log(`${label} erro — ${msg}`);
      stats.error++;
      if (i + 1 < QUESTION_IDS.length) await sleep(DELAY_MS);
      continue;
    } else {
      console.warn(`${label} GET falhou (${snap.status}); POST sem snapshot completo`);
    }

    console.log(`${label} classificando...`);
    const result = await classifyOne(id);

    if (result.ok) {
      writeSuccess(id, result.status, result.body, snapshot);
      const count = result.body?.result?.length ?? 0;
      console.log(`${label} ok — ${count} descritor(es)`);
      stats.ok++;
    } else if (result.fatal) {
      const msg =
        result.body?.error ?? `HTTP ${result.status} (auth)`;
      writeError(id, result.status, result.body, msg, snapshot);
      console.error(`${label} FATAL: ${msg}`);
      stats.error++;
      stats.fatal = true;
      break;
    } else {
      const msg = result.body?.error ?? `HTTP ${result.status}`;
      writeError(id, result.status, result.body, msg, snapshot);
      console.log(`${label} erro — ${msg}`);
      stats.error++;
    }

    if (i + 1 < QUESTION_IDS.length && !DRY_RUN) {
      await sleep(DELAY_MS);
    }
  }

  console.log('\nResumo:');
  console.log(`  skip:  ${stats.skip}`);
  if (!DRY_RUN) {
    console.log(`  ok:    ${stats.ok}`);
    console.log(`  erro:  ${stats.error}`);
    if (stats.fatal) console.log('  (lote interrompido por erro de autenticação)');
  }
  console.log(`  saída: ${OUTPUT_DIR}\n`);

  if (stats.fatal) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
