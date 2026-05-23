/**
 * Batch DeCS Classifier for Notes — uses local pgvector (no external BVS API)
 *
 * Agentes carregados exclusivamente de ai_agents (discover_notes_terms, validate_notes_decs_terms).
 *
 * Run:
 *   node --env-file=.env.local scripts/batch-decs-classify-notes.mjs [options]
 */

import pg from 'pg';
import fs from 'fs';
import { loadRuntimeAgents, buildGeminiBody } from './lib/ai-agents-db.mjs';

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : def;
};

const LIMIT = parseInt(getArg('limit', '0'), 10);
const CONCURRENCY = parseInt(getArg('concurrency', '3'), 10);
const DELAY_MS = parseInt(getArg('delay', '400'), 10);
const RESUME = !args.includes('--no-resume');
const MIN_SCORE = parseFloat(getArg('min-score', '0.75'));

const EMBEDDING_MODEL = 'gemini-embedding-001';
const RESULTS_FILE = 'decs_notes_classification_results.json';
const MAX_DECS = 5;

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const GEMINI_KEY = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY not set');

let discoverAgent;
let validateAgent;

async function initAgents() {
  const map = await loadRuntimeAgents(pool, ['discover_notes_terms', 'validate_notes_decs_terms']);
  discoverAgent = map.get('discover_notes_terms');
  validateAgent = map.get('validate_notes_decs_terms');
  console.log(
    `Agentes DB: discover_notes_terms (${discoverAgent.model}), validate_notes_decs_terms (${validateAgent.model})\n`,
  );
}

async function callGemini(agent, userMessage, overrides = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${agent.model}:generateContent?key=${GEMINI_KEY}`;
  const body = buildGeminiBody(agent, userMessage, overrides);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err}`);
  }
  const data = await res.json();
  return (data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '').trim();
}

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

function parseThemes(raw) {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return { primary: parsed.filter((t) => typeof t === 'string' && t.trim()).slice(0, 3), secondary: [] };
    }
    if (parsed && typeof parsed === 'object') {
      return {
        primary: (Array.isArray(parsed.primary) ? parsed.primary : [])
          .filter((t) => typeof t === 'string' && t.trim())
          .slice(0, 3),
        secondary: (Array.isArray(parsed.secondary) ? parsed.secondary : [])
          .filter((t) => typeof t === 'string' && t.trim())
          .slice(0, 6),
      };
    }
  } catch {}
  const matches = raw.match(/"([^"]+)"/g);
  if (matches) {
    return { primary: matches.map((m) => m.replace(/"/g, '').trim()).filter(Boolean).slice(0, 3), secondary: [] };
  }
  return { primary: [], secondary: [] };
}

async function searchDeCSLocal(termEmbedding) {
  const vecStr = `[${termEmbedding.join(',')}]`;
  const res = await pool.query(
    `SELECT ui, name_pt, name_en,
            1 - (embedding <=> $1::vector) AS score
     FROM decs_descriptors
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vecStr, MAX_DECS],
  );
  return res.rows
    .map((r) => ({ ui: r.ui, name_pt: r.name_pt, name_en: r.name_en, score: parseFloat(r.score ?? 0) }))
    .filter((r) => r.score >= MIN_SCORE);
}

async function validateDescriptors(descriptors, noteText) {
  if (descriptors.length === 0) return [];
  const candidateList = descriptors.map((d) => ({ code: d.code, term: d.term }));
  const userMessage = ['Nota:', noteText, '', 'Candidatos:', JSON.stringify(candidateList, null, 2)].join('\n');
  try {
    const raw = await callGemini(validateAgent, userMessage, { maxOutputTokens: 256 });
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const approved = JSON.parse(cleaned);
    if (!Array.isArray(approved)) return descriptors;
    const approvedSet = new Set(approved.map(String));
    const filtered = descriptors.filter((d) => approvedSet.has(d.code));
    return filtered.length > 0 ? filtered : descriptors;
  } catch {
    return descriptors;
  }
}

function buildNoteText(n) {
  const parse = (f) => {
    if (!f) return [];
    if (Array.isArray(f)) return f;
    try {
      return JSON.parse(f);
    } catch {
      return [];
    }
  };
  const body = [n.title, n.description].filter(Boolean).join('\n\n');
  const meta = [...parse(n.tags), ...parse(n.areas_conhecimento), ...parse(n.assuntos)]
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(', ');
  return meta ? `${body}\n\n[${meta}]` : body;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function processNote(n, idx, total) {
  const noteText = buildNoteText(n).slice(0, 4000);
  let descriptors = [];
  let error = null;

  try {
    const rawTerms = await callGemini(
      discoverAgent,
      `Título: ${n.title}\n\nConteúdo: ${noteText}`,
      { responseMimeType: 'application/json' },
    );
    const themes = parseThemes(rawTerms);
    const totalTerms = themes.primary.length + themes.secondary.length;

    if (totalTerms === 0) {
      error = 'No themes extracted';
    } else {
      const seen = new Set();
      const afterSearch = [];
      const searchAll = [
        ...themes.primary.map((term) => ({ term, role: 'primary' })),
        ...themes.secondary.map((term) => ({ term, role: 'secondary' })),
      ];
      await Promise.allSettled(
        searchAll.map(async ({ term, role }) => {
          try {
            const emb = await generateEmbedding(term);
            const matches = await searchDeCSLocal(emb);
            const best = matches[0];
            if (best && !seen.has(best.ui)) {
              seen.add(best.ui);
              afterSearch.push({
                term: best.name_pt,
                code: best.ui,
                name_en: best.name_en,
                role,
              });
            }
          } catch {
            /* skip term on error */
          }
        }),
      );

      const afterValidation = await validateDescriptors(afterSearch, noteText);
      const primary = afterValidation.filter((d) => d.role === 'primary');
      const secondary = afterValidation.filter((d) => d.role !== 'primary');
      descriptors = [...primary, ...secondary];
    }
  } catch (e) {
    error = e.message;
  }

  const status = error ? `✗ — ${error}` : `✓ ${descriptors.length} descritores`;
  console.log(`[${String(idx + 1).padStart(4)}/${total}] Note#${n.id} "${n.title?.slice(0, 40)}" ${status}`);

  const legacyTerms = descriptors.map((d) => ({
    ui: d.code,
    name_pt: d.term,
    name_en: d.name_en ?? d.term,
    role: d.role ?? 'secondary',
  }));
  return { id_note: n.id, ai_decs_descriptors: descriptors, decs_terms: legacyTerms, error };
}

async function main() {
  console.log(`\n📝 MedMind — Batch DeCS Classifier para Notas`);
  console.log(`   Agentes do banco · pgvector local · min-score=${MIN_SCORE}\n`);

  await initAgents();

  const {
    rows: [{ count: decsCount }],
  } = await pool.query(`SELECT COUNT(*) FROM decs_descriptors WHERE embedding IS NOT NULL`);
  if (parseInt(decsCount, 10) === 0) {
    console.error('❌ decs_descriptors não tem embeddings. Execute embed-decs-descriptors.mjs primeiro.');
    await pool.end();
    process.exit(1);
  }
  console.log(`✅ DeCS local pronto: ${decsCount} descritores vetorizados\n`);

  await pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS decs_terms JSONB DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_decs_descriptors TEXT`);

  const whereClause = RESUME
    ? `WHERE (ai_decs_descriptors IS NULL OR btrim(ai_decs_descriptors) = '' OR ai_decs_descriptors = '[]')`
    : '';
  const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
  const { rows: toProcess } = await pool.query(
    `SELECT id, title, description, tags, areas_conhecimento, assuntos
     FROM notes ${whereClause} ORDER BY id ${limitClause}`,
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
    const batchResults = await Promise.all(batch.map((n, bIdx) => processNote(n, i + bIdx, toProcess.length)));
    results.push(...batchResults);

    for (const r of batchResults) {
      await pool.query(
        `UPDATE notes
         SET ai_decs_descriptors = $1,
             decs_terms = $2::jsonb,
             updated_at = NOW()
         WHERE id = $3`,
        [JSON.stringify(r.ai_decs_descriptors), JSON.stringify(r.decs_terms), r.id_note],
      );
    }

    if (i + CONCURRENCY < toProcess.length) await sleep(DELAY_MS);
  }

  fs.writeFileSync(
    RESULTS_FILE,
    JSON.stringify(
      results.map((r) => ({
        id_note: r.id_note,
        ai_decs_descriptors: r.ai_decs_descriptors,
        decs_terms: r.decs_terms,
      })),
      null,
      2,
    ),
  );

  const withDesc = results.filter((r) => r.decs_terms.length > 0).length;
  const failed = results.filter((r) => r.error).length;
  const totalDesc = results.flatMap((r) => r.decs_terms).length;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n✅ Concluído em ${elapsed}s!`);
  console.log(`   Com descritores: ${withDesc} / ${results.length}`);
  console.log(`   Falhas:          ${failed}`);
  console.log(`   Total descritores: ${totalDesc} · média ${(totalDesc / (withDesc || 1)).toFixed(2)}/nota`);
  console.log(`   Arquivo: ${RESULTS_FILE}\n`);

  await pool.end();
}

main().catch((e) => {
  console.error('\n💥 Fatal:', e);
  process.exit(1);
});
