/**
 * Classifica UMA questão N vezes via POST decs-ai.
 * Salva apenas themes (primary / secondary); cada rodada acrescenta uma entrada ao JSON.
 *
 * Pré-requisito: npm run dev com .env.local no servidor.
 *
 * Uso (a partir da raiz do repo):
 *   node matheus/classify-decs-repeat.mjs 25452 10
 *   node matheus/classify-decs-repeat.mjs --id=25452 --n=10
 *   node matheus/classify-decs-repeat.mjs --id=25452 --n=5 --out=matheus/output/q25452-5x.json
 *   node matheus/classify-decs-repeat.mjs --dry-run
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

// ── Configuração padrão (sobrescrita por CLI) ────────────────────────────────

const ADMIN_TOKEN_PASTED = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwibmFtZSI6IkFkbWluaXN0cmFkb3IiLCJ1c2VybmFtZSI6ImFkbWluIiwiZW1haWwiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImNvbXBhbnlfaWQiOm51bGwsImlhdCI6MTc3OTgyOTY2MiwiZXhwIjoxNzgwNDM0NDYyfQ.UE7zycFlxUjmkX_A4nRkd5dCDf1DahRR3iF6HcsvsCg';
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || ADMIN_TOKEN_PASTED).trim();

const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:5001';

const DEFAULT_QUESTION_ID = 25467;
const DEFAULT_RUNS = 10;

const DELAY_MS = 1000;
const MAX_RETRIES = 3;

const REPO_ROOT = process.cwd();
const DEFAULT_OUTPUT_DIR = join(REPO_ROOT, 'classification-output', 'repeat');

// ── CLI ────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function parseArg(name) {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return null;
}

const positional = args.filter((a) => !a.startsWith('--'));
const questionId = Number(parseArg('--id') ?? positional[0] ?? DEFAULT_QUESTION_ID);
const runs = Number(parseArg('--n') ?? positional[1] ?? DEFAULT_RUNS);
const outArg = parseArg('--out');

function defaultOutputPath(id, n) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return join(DEFAULT_OUTPUT_DIR, `q${id}-${n}x-${stamp}.json`);
}

const outputPath = outArg
  ? join(REPO_ROOT, outArg)
  : defaultOutputPath(questionId, runs);

// ── Helpers ────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function authHeaders() {
  return {
    Authorization: `Bearer ${ADMIN_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

/** Apenas primary / secondary de themes_identified. */
function simplifyThemes(apiBody) {
  const themes = apiBody?.themes_identified;
  if (!themes || typeof themes !== 'object') {
    return { primary: [], secondary: [] };
  }
  const asStrings = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .filter((t) => typeof t === 'string' && t.trim())
      .map((t) => t.trim());
  return {
    primary: asStrings(themes.primary),
    secondary: asStrings(themes.secondary),
  };
}

function initOutputFile() {
  mkdirSync(dirname(outputPath), { recursive: true });
  const doc = { question_id: questionId, runs: [] };
  writeFileSync(outputPath, JSON.stringify(doc, null, 2), 'utf8');
  return doc;
}

function loadOutputFile() {
  if (!existsSync(outputPath)) return initOutputFile();
  try {
    const doc = JSON.parse(readFileSync(outputPath, 'utf8'));
    if (!Array.isArray(doc.runs)) doc.runs = [];
    if (doc.question_id == null) doc.question_id = questionId;
    return doc;
  } catch {
    return initOutputFile();
  }
}

/** Acrescenta uma rodada; não altera entradas anteriores. */
function appendRun(entry) {
  const doc = loadOutputFile();
  doc.runs.push(entry);
  writeFileSync(outputPath, JSON.stringify(doc, null, 2), 'utf8');
  return doc.runs.length;
}

async function classifyOne(id) {
  const url = `${API_BASE_URL.replace(/\/$/, '')}/api/questions/${id}/decs-ai`;

  let lastStatus = 0;
  let lastBody = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(),
    });

    lastStatus = res.status;
    const text = await res.text();
    try {
      lastBody = text ? JSON.parse(text) : null;
    } catch {
      lastBody = { raw: text };
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

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nMedMind — classificação DeCS repetida (decs-ai)\n');
  console.log(`API:     ${API_BASE_URL}`);
  console.log(`Questão: ${questionId}`);
  console.log(`Runs:    ${runs}`);
  console.log(`Saída:   ${outputPath}`);
  console.log(`dry-run=${DRY_RUN} delay=${DELAY_MS}ms\n`);

  if (!Number.isFinite(questionId) || questionId <= 0) {
    console.error('ID inválido. Use: node matheus/classify-decs-repeat.mjs <id> <n>');
    process.exit(1);
  }

  if (!Number.isFinite(runs) || runs < 1) {
    console.error('N inválido (deve ser >= 1). Use --n=10 ou segundo argumento posicional.');
    process.exit(1);
  }

  if (!ADMIN_TOKEN.trim() && !DRY_RUN) {
    console.error('ADMIN_TOKEN vazio. Cole em ADMIN_TOKEN_PASTED ou exporte ADMIN_TOKEN=...');
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log(`would POST decs-ai ${runs}x → ${outputPath} (append primary/secondary por rodada)`);
    return;
  }

  if (existsSync(outputPath)) {
    console.warn(`Arquivo já existe — novas rodadas serão acrescentadas: ${outputPath}\n`);
  } else {
    initOutputFile();
    console.log(`Arquivo criado: ${outputPath}\n`);
  }

  let ok = 0;
  let err = 0;

  for (let i = 0; i < runs; i++) {
    const runNum = loadOutputFile().runs.length + 1;
    const label = `[${i + 1}/${runs}] run #${runNum}`;
    console.log(`${label} classificando...`);

    const result = await classifyOne(questionId);

    let entry;
    if (result.ok) {
      const { primary, secondary } = simplifyThemes(result.body);
      entry = { run: runNum, primary, secondary };
      ok++;
      console.log(
        `${label} ok — ${primary.length} primary, ${secondary.length} secondary`
      );
    } else {
      const message = result.body?.error ?? `HTTP ${result.status}`;
      entry = { run: runNum, error: message };
      err++;
      console.log(`${label} erro — ${message}`);
      if (result.fatal) {
        console.error('Erro fatal (auth). Interrompendo.');
        appendRun(entry);
        process.exit(1);
      }
    }

    const total = appendRun(entry);
    console.log(`${label} acrescentado (${total} no arquivo) → ${outputPath}`);

    if (i + 1 < runs) await sleep(DELAY_MS);
  }

  console.log('\nResumo:');
  console.log(`  ok:    ${ok}`);
  console.log(`  erro:  ${err}`);
  console.log(`  total: ${loadOutputFile().runs.length} entrada(s) em ${outputPath}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
