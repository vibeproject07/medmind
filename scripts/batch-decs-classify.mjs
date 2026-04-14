/**
 * Batch DeCS Classifier — processes 100 questions using Gemini + DeCS API
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

// ── Config ───────────────────────────────────────────────────────────────────
const CONCURRENCY  = 5;   // parallel questions at a time
const LIMIT        = 100; // total questions to process
const OUTPUT_FILE  = 'decs_classification_results.json';
const GEMINI_MODEL = 'gemini-2.5-flash';
const DECS_BASE    = 'https://api.bvsalud.org/decs/v2';

const SYSTEM_PROMPT = `Você é um especialista em classificação de conteúdo médico e no vocabulário controlado DeCS (Descritores em Ciências da Saúde) / MeSH.

Dado o enunciado e as alternativas de uma questão médica, identifique de 3 a 5 conceitos médicos chave que representam os temas principais da questão.

Regras:
- Use os nomes técnicos padronizados em português (pt-BR), como aparecem no vocabulário DeCS/MeSH.
- Prefira termos mais específicos e menos genéricos (ex: "Insuficiência Cardíaca" ao invés de "Coração").
- Inclua condições clínicas, medicamentos relevantes, exames diagnósticos e procedimentos quando aplicável.
- Não inclua termos relacionados ao formato da questão (ex: "múltipla escolha", "Residência Médica").
- Retorne SOMENTE um array JSON de strings, sem mais nenhum texto, markdown ou explicação.

Exemplo de resposta válida:
["Diabetes Mellitus Tipo 2","Insulina","Hemoglobina Glicada","Nefropatia Diabética"]`;

// ── DB ───────────────────────────────────────────────────────────────────────
const pool = new pg.Pool({ connectionString: DB_URL });

async function fetchQuestions() {
  const res = await pool.query(
    `SELECT id, statement, option_a, option_b, option_c, option_d, option_e
     FROM questions
     ORDER BY id ASC
     LIMIT $1`,
    [LIMIT]
  );
  return res.rows;
}

// ── Gemini ───────────────────────────────────────────────────────────────────
async function callGemini(questionText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: questionText }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '';
  return text.trim();
}

function parseSearchTerms(raw) {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.filter(t => typeof t === 'string' && t.trim()).slice(0, 5);
  } catch {}
  // fallback: extract quoted strings
  const matches = raw.match(/"([^"]+)"/g);
  if (matches) return matches.map(m => m.replace(/"/g, '').trim()).filter(Boolean).slice(0, 5);
  return [];
}

// ── DeCS API ─────────────────────────────────────────────────────────────────
const CATEGORY_LABELS = {
  A: 'Anatomia', B: 'Organismos', C: 'Doenças',
  D: 'Compostos Químicos e Drogas', E: 'Técnicas e Equipamentos Analíticos',
  F: 'Psiquiatria e Psicologia', G: 'Fenômenos Biológicos',
  SP: 'Saúde Pública', VS: 'Vigilância Sanitária',
};

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v != null) return [v];
  return [];
}

function buildHierarchyPath(treeId) {
  if (!treeId) return '';
  const topCode = treeId.split('.')[0].replace(/[0-9]/g, '');
  const label = CATEGORY_LABELS[topCode] ?? topCode;
  return treeId.split('.').length <= 1 ? label : `${label} › ${treeId}`;
}

async function searchDeCS(term) {
  try {
    const url = `${DECS_BASE}/search-by-words?words=${encodeURIComponent(term)}&lang=pt&format=json`;
    const res = await fetch(url, { headers: { apikey: DECS_KEY } });
    if (!res.ok) return null;
    const data = await res.json();
    const objects = data?.objects;
    if (!Array.isArray(objects) || objects.length === 0) return null;
    const resp = objects[0]?.decsws_response?.record_list;
    if (!resp) return null;
    const rawRecords = toArray(resp.record);
    if (rawRecords.length === 0) return null;
    const rec = rawRecords[0];
    const code = rec?.attr?.mfn ?? '';
    const descriptors = toArray(rec.descriptor_list).flatMap(d => toArray(d));
    let term_ = '';
    for (const pl of ['pt-br', 'pt']) {
      const found = descriptors.find(d => d?.attr?.lang === pl);
      if (found && typeof found.descriptor === 'string' && found.descriptor.trim()) {
        term_ = found.descriptor.trim();
        break;
      }
    }
    if (!term_) return null;
    const treeList = toArray(rec.tree_id_list).flatMap(t => toArray(t));
    const tree_ids = treeList.map(t => t?.tree_id?.trim()).filter(Boolean);
    return { term: term_, code, tree_ids, hierarchy_path: buildHierarchyPath(tree_ids[0] ?? '') };
  } catch {
    return null;
  }
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
  let error = null;

  try {
    const rawText = await callGemini(questionText);
    const searchTerms = parseSearchTerms(rawText);

    if (searchTerms.length === 0) {
      error = 'No search terms extracted';
    } else {
      const results = await Promise.allSettled(searchTerms.map(t => searchDeCS(t)));
      const seen = new Set();
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value && !seen.has(r.value.code)) {
          seen.add(r.value.code);
          descriptors.push(r.value);
        }
      }
    }
  } catch (e) {
    error = e.message;
  }

  const status = error ? '✗' : `✓ (${descriptors.length} descritores)`;
  console.log(`[${idx + 1}/${total}] Q${q.id} ${status}${error ? ' — ' + error : ''}`);

  return { id_question: q.id, ai_decs_descriptors: descriptors, error };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔬 MedMind — Batch DeCS Classifier`);
  console.log(`Processando ${LIMIT} questões com concorrência ${CONCURRENCY}\n`);

  // Ensure column exists
  await pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_decs_descriptors TEXT`);

  const questions = await fetchQuestions();
  console.log(`Questões carregadas: ${questions.length}\n`);

  const results = [];

  // Process in batches of CONCURRENCY
  for (let i = 0; i < questions.length; i += CONCURRENCY) {
    const batch = questions.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((q, bIdx) => processQuestion(q, i + bIdx, questions.length))
    );
    results.push(...batchResults);

    // Save to DB for each question in the batch
    for (const r of batchResults) {
      if (r.ai_decs_descriptors.length > 0) {
        await pool.query(
          `UPDATE questions SET ai_decs_descriptors = $1, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(r.ai_decs_descriptors), r.id_question]
        );
      }
    }

    // Small pause between batches to avoid rate limits
    if (i + CONCURRENCY < questions.length) {
      await new Promise(res => setTimeout(res, 300));
    }
  }

  // Build output JSON (clean format without error field)
  const output = results.map(r => ({
    id_question: r.id_question,
    ai_decs_descriptors: r.ai_decs_descriptors,
  }));

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');

  const succeeded = results.filter(r => r.ai_decs_descriptors.length > 0).length;
  const failed = results.filter(r => r.error).length;

  console.log(`\n✅ Concluído!`);
  console.log(`   Sucesso: ${succeeded} / ${results.length}`);
  console.log(`   Falhas:  ${failed}`);
  console.log(`   Arquivo: ${OUTPUT_FILE}\n`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
