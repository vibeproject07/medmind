/**
 * test-classification-sample.mjs
 *
 * Testa a classificação de 100 questões usando o banco vetorizado.
 * Para cada questão executa 3 etapas:
 *
 *   [1] GEMINI  → extrai 3–5 termos médicos centrais do enunciado
 *   [2] DECS    → busca descritores DeCS na API BVS para cada termo (graceful fallback)
 *   [3] PGVECTOR→ encontra as 5 questões mais similares via cosine distance
 *
 * Saída: classification_test_results.json
 *
 * Uso:
 *   node --env-file=.env.local scripts/test-classification-sample.mjs [--concurrency 3] [--delay 1200]
 */

import pg from 'pg';
import fs from 'fs';

// ── Config ───────────────────────────────────────────────────────────────────
const SAMPLE_SIZE   = 100;
const CONCURRENCY   = parseInt(process.argv[process.argv.indexOf('--concurrency') + 1] || '3');
const DELAY_MS      = parseInt(process.argv[process.argv.indexOf('--delay') + 1] || '1200');
const OUTPUT_FILE   = 'classification_test_results.json';
const PARTIAL_FILE  = 'classification_test_partial.json';

const geminiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
const decsKey   = process.env.DECS_API_KEY?.trim();

if (!geminiKey) { console.error('❌ GEMINI_API_KEY não configurada'); process.exit(1); }

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let decsAvailable = true; // será definido na primeira tentativa

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function vectorStr(v) { return `[${v.join(',')}]`; }

// ── Agent prompt loader ───────────────────────────────────────────────────────

const DEFAULT_CLASSIFIER_PROMPT = `Você é um especialista em classificação médica e no vocabulário controlado DeCS (Descritores em Ciências da Saúde) / MeSH.

Analise o enunciado e as alternativas da questão médica abaixo. Compreenda o contexto clínico completo.

Identifique:
- TEMAS PRINCIPAIS (1 a 3): os conceitos médicos CENTRAIS da questão — diagnóstico principal, condição tratada, fármaco central ou procedimento chave.
- TEMAS SECUNDÁRIOS (0 a 6, se aplicável): conceitos médicos relevantes mas não centrais — fisiopatologia associada, complicações, achados diagnósticos secundários, contexto clínico.

Regras IMPORTANTES:
- Use EXCLUSIVAMENTE termos que existam como descritores no vocabulário DeCS/MeSH em português (pt-BR).
- Prefira termos específicos: "Insuficiência Cardíaca Congestiva" em vez de "Coração".
- Inclua: condições clínicas, fármacos, exames diagnósticos, procedimentos, achados anatomopatológicos.
- NÃO inclua: adjetivos genéricos ("crônico", "agudo"), o formato da questão, termos não-DeCS.
- NÃO combine termos em frases compostas que não existam no DeCS.

Retorne SOMENTE um JSON com esta estrutura (sem markdown, sem explicação):
{"primary":["tema principal 1","tema principal 2"],"secondary":["tema secundário 1","tema secundário 2"]}`;

let classifierPrompt = DEFAULT_CLASSIFIER_PROMPT;
let classifierModel = 'gemini-2.5-flash';

async function loadClassifierAgent() {
  try {
    const res = await pool.query(
      `SELECT system_prompt, model FROM ai_agents WHERE key = 'decs_classifier'`
    );
    if (res.rows.length > 0 && res.rows[0].system_prompt) {
      classifierPrompt = res.rows[0].system_prompt;
      classifierModel = res.rows[0].model ?? 'gemini-2.5-flash';
      console.log(`   ✓ Agente decs_classifier carregado do banco (model: ${classifierModel})`);
    } else {
      console.log(`   ℹ Usando prompt padrão do decs_classifier (model: ${classifierModel})`);
    }
  } catch {
    console.log(`   ⚠ Tabela ai_agents não encontrada — usando prompt padrão`);
  }
}

// ── [1] Gemini — identificação de temas DeCS (primary + secondary) ───────────
/**
 * Usa o agente decs_classifier (mesmo da API de produção) para extrair temas
 * primários e secundários da questão no formato DeCS/MeSH.
 *
 * Função: extractDeCSThemes(questionText) → { primary: string[], secondary: string[] }
 * Modelo : classifierModel (lido do agente no DB, padrão: gemini-2.5-flash)
 * Chave  : GEMINI_API_KEY
 */
async function extractDeCSThemes(questionText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${classifierModel}:generateContent?key=${geminiKey}`;

  const body = {
    system_instruction: { parts: [{ text: classifierPrompt }] },
    contents: [{ role: 'user', parts: [{ text: questionText.slice(0, 3000) }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024, responseMimeType: 'application/json' },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Gemini error ${res.status}`);
  const data = await res.json();
  const rawText = (data?.candidates?.[0]?.content?.parts
    ?.filter(p => !p?.thought)
    ?.map(p => p?.text)
    .filter(Boolean)
    .join('') ?? '');
  const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return { primary: parsed.filter(t => typeof t === 'string').slice(0, 3), secondary: [] };
    }
    if (parsed && typeof parsed === 'object') {
      return {
        primary: (Array.isArray(parsed.primary) ? parsed.primary : [])
          .filter(t => typeof t === 'string' && t.trim()).slice(0, 3),
        secondary: (Array.isArray(parsed.secondary) ? parsed.secondary : [])
          .filter(t => typeof t === 'string' && t.trim()).slice(0, 6),
      };
    }
  } catch {
    const match = cleaned.match(/\[[\s\S]*?\]/);
    if (match) {
      const arr = JSON.parse(match[0]);
      return { primary: arr.filter(t => typeof t === 'string').slice(0, 3), secondary: [] };
    }
  }
  return { primary: [], secondary: [] };
}

// ── [2] DeCS API — busca de descritores ──────────────────────────────────────
/**
 * Busca descritores DeCS na API BVS para um termo de busca.
 * Retorna o melhor match (ou null se bloqueado/sem resultado).
 *
 * Função: searchDeCS(term) → { term, code, tree_ids, hierarchy_path } | null
 * API   : https://api.bvsalud.org/decs/v2/search-by-words
 * Chave : DECS_API_KEY
 */
async function searchDeCS(term) {
  if (!decsKey) return null;

  try {
    const url = `https://api.bvsalud.org/decs/v2/search-by-words?words=${encodeURIComponent(term)}&lang=pt&format=json`;
    const res = await fetch(url, {
      headers: { apikey: decsKey },
      signal: AbortSignal.timeout(6000),
    });

    if (res.status === 403) { decsAvailable = false; return null; }
    if (!res.ok) return null;

    const data = await res.json();
    const objects = data?.objects;
    if (!Array.isArray(objects) || objects.length === 0) return null;

    const resp      = objects[0]?.decsws_response;
    const recordList = resp?.record_list;
    if (!recordList) return null;

    const rawRecords = Array.isArray(recordList.record)
      ? recordList.record
      : recordList.record ? [recordList.record] : [];

    for (const rec of rawRecords.slice(0, 200)) {
      const descriptors = Array.isArray(rec.descriptor_list)
        ? rec.descriptor_list.flatMap(d => Array.isArray(d) ? d : [d])
        : rec.descriptor_list ? [rec.descriptor_list] : [];

      let ptTerm = '';
      for (const lang of ['pt-br', 'pt']) {
        const found = descriptors.find(d => d?.attr?.lang === lang);
        if (found?.descriptor) { ptTerm = String(found.descriptor).trim(); break; }
      }
      if (!ptTerm) continue;

      const treeList = Array.isArray(rec.tree_id_list)
        ? rec.tree_id_list.flatMap(t => Array.isArray(t) ? t : [t])
        : rec.tree_id_list ? [rec.tree_id_list] : [];
      const tree_ids = treeList.map(t => String(t?.tree_id ?? '')).filter(Boolean);
      const code     = String(rec.attr?.mfn ?? '');
      const category = tree_ids[0]?.split('.')?.[0]?.replace(/[0-9]/g, '') ?? '';

      return { term: ptTerm, code, tree_ids, category, search_input: term };
    }
    return null;
  } catch {
    return null;
  }
}

// ── [3] pgvector — questões similares ────────────────────────────────────────
/**
 * Encontra as 5 questões mais semanticamente similares usando cosine distance.
 *
 * Função: findSimilarById(questionId, embedding) → SimilarQuestion[]
 * Método : SELECT ... ORDER BY embedding <=> $ref::vector LIMIT 5
 * Coluna : questions.embedding vector(3072)
 */
async function findSimilarById(questionId, embeddingStr, topK = 5) {
  const { rows } = await pool.query(
    `SELECT
       q.id,
       q.exam_board,
       q.exam_year,
       LEFT(q.statement, 100) AS statement_preview,
       q.decs_terms,
       q.tags,
       q.areas_conhecimento,
       ROUND(CAST(1 - (q.embedding <=> $1::vector) AS numeric), 4) AS similarity
     FROM questions q
     WHERE q.id != $2
       AND q.embedding IS NOT NULL
     ORDER BY q.embedding <=> $1::vector
     LIMIT $3`,
    [embeddingStr, questionId, topK]
  );

  return rows.map(r => ({
    id: r.id,
    exam_board: r.exam_board,
    exam_year: r.exam_year,
    statement_preview: r.statement_preview,
    similarity: parseFloat(r.similarity),
    existing_decs: r.decs_terms ? JSON.parse(r.decs_terms) : [],
    existing_tags: r.tags ? JSON.parse(r.tags) : [],
    existing_areas: r.areas_conhecimento ? JSON.parse(r.areas_conhecimento) : [],
  }));
}

// ── Pipeline por questão ─────────────────────────────────────────────────────

async function classifyQuestion(q) {
  const result = {
    question_id:       q.id,
    exam_board:        q.exam_board,
    exam_year:         q.exam_year,
    statement_preview: q.statement.slice(0, 150),

    // [1] decs_classifier agent (same as production API)
    gemini_status:   'pending',
    gemini_themes:   { primary: [], secondary: [] },
    gemini_terms:    [], // flat list for backward-compat summary

    // [2] DeCS
    decs_status:    decsAvailable ? 'pending' : 'api_unavailable',
    decs_results:   [],

    // [3] pgvector
    similar_questions: [],
  };

  // ── [1] Gemini: identify primary + secondary DeCS themes ──────────────────
  try {
    const letter = String(q.correct_answer ?? '').trim().toUpperCase();
    const questionText = [
      'Enunciado:', q.statement, '',
      'Alternativa A: ' + (q.option_a ?? ''),
      'Alternativa B: ' + (q.option_b ?? ''),
      q.option_c ? 'Alternativa C: ' + q.option_c : null,
      q.option_d ? 'Alternativa D: ' + q.option_d : null,
      q.option_e ? 'Alternativa E: ' + q.option_e : null,
      letter ? `Gabarito: ${letter}` : null,
    ].filter(Boolean).join('\n');

    result.gemini_themes  = await extractDeCSThemes(questionText);
    result.gemini_terms   = [...result.gemini_themes.primary, ...result.gemini_themes.secondary];
    result.gemini_status  = result.gemini_terms.length > 0 ? 'ok' : 'no_terms';
  } catch (e) {
    result.gemini_status = `error: ${e.message.slice(0, 80)}`;
  }

  // ── [2] DeCS lookup for each term ─────────────────────────────────────────
  if (decsAvailable && result.gemini_terms.length > 0) {
    const decsHits = [];
    for (const term of result.gemini_terms.slice(0, 6)) { // up to 6 terms (3p+3s)
      const hit = await searchDeCS(term);
      if (hit) decsHits.push(hit);
      if (!decsAvailable) break; // blocked — skip remaining terms
    }
    result.decs_results = decsHits;
    result.decs_status  = !decsAvailable ? 'api_blocked'
      : decsHits.length > 0             ? 'ok'
      :                                    'no_match';
  }

  // ── [3] pgvector similar questions ────────────────────────────────────────
  try {
    // embedding::text from pg returns '[val1,val2,...]' — use directly as ::vector literal
    const embStr = q.embedding;
    result.similar_questions = await findSimilarById(q.id, embStr, 5);
  } catch (e) {
    result.similar_questions = [];
    result.pgvector_error = e.message.slice(0, 80);
  }

  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔬 Teste de Classificação DeCS — ${SAMPLE_SIZE} questões`);
  console.log(`   Gemini: ${geminiKey ? '✅' : '❌'}  |  DeCS API: ${decsKey ? '✅' : '❌ (sem chave)'}`);
  console.log(`   Concorrência: ${CONCURRENCY}  |  Delay: ${DELAY_MS}ms\n`);

  console.log(`Carregando agente decs_classifier...`);
  await loadClassifierAgent();
  console.log();

  // Seleciona 100 questões com embedding, distribuídas por banca
  const { rows: questions } = await pool.query(`
    WITH ranked AS (
      SELECT
        id, statement, option_a, option_b, option_c, option_d, option_e, correct_answer,
        exam_board, exam_year,
        embedding::text AS embedding,
        ROW_NUMBER() OVER (PARTITION BY COALESCE(exam_board, 'UNKNOWN') ORDER BY RANDOM()) AS rn
      FROM questions
      WHERE embedding IS NOT NULL
    )
    SELECT id, statement, option_a, option_b, option_c, option_d, option_e, correct_answer,
           exam_board, exam_year, embedding
    FROM ranked
    WHERE rn <= 4
    ORDER BY RANDOM()
    LIMIT ${SAMPLE_SIZE}
  `);

  console.log(`📋 ${questions.length} questões selecionadas de ${new Set(questions.map(q => q.exam_board)).size} bancas distintas\n`);

  const results       = [];
  const startTime     = Date.now();
  let done = 0, ok = 0, failed = 0;

  const printProgress = () => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate    = done > 0 ? (done / ((Date.now() - startTime) / 1000)).toFixed(1) : 0;
    process.stdout.write(
      `\r⏳ ${done}/${questions.length} | ✅ ${ok} ❌ ${failed} | ${rate}q/s | ${elapsed}s | DeCS: ${decsAvailable ? '🟢' : '🔴 bloqueada'}   `
    );
  };

  for (let i = 0; i < questions.length; i += CONCURRENCY) {
    const batch = questions.slice(i, i + CONCURRENCY);

    await Promise.all(batch.map(async (q) => {
      try {
        const res = await classifyQuestion(q);
        results.push(res);
        ok++;
      } catch (e) {
        results.push({ question_id: q.id, error: e.message });
        failed++;
      } finally {
        done++;
        printProgress();
      }
    }));

    // Save partial results every 10 questions
    if (done % 10 === 0) {
      fs.writeFileSync(PARTIAL_FILE, JSON.stringify({ done, total: questions.length, results }, null, 2));
    }

    if (i + CONCURRENCY < questions.length) await sleep(DELAY_MS);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const bancas      = [...new Set(results.map(r => r.exam_board).filter(Boolean))].sort();
  const withDecs    = results.filter(r => r.decs_status === 'ok').length;
  const withGemini  = results.filter(r => r.gemini_status === 'ok').length;
  const avgSimilars = results
    .filter(r => r.similar_questions?.length > 0)
    .reduce((s, r) => s + (r.similar_questions?.[0]?.similarity ?? 0), 0) / (ok || 1);

  // Top DeCS terms across the sample
  const termFreq = {};
  results.forEach(r => {
    (r.decs_results ?? []).forEach(d => {
      termFreq[d.term] = (termFreq[d.term] ?? 0) + 1;
    });
  });
  const topTerms = Object.entries(termFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([term, count]) => ({ term, count }));

  const summary = {
    tested:               questions.length,
    success:              ok,
    failed,
    bancas_cobertas:      bancas,
    gemini_ok:            withGemini,
    decs_ok:              withDecs,
    decs_status:          decsAvailable ? 'available' : 'blocked_403',
    top_decs_terms:       topTerms,
    avg_top_similarity:   parseFloat(avgSimilars.toFixed(4)),
    duration_s:           parseFloat(((Date.now() - startTime) / 1000).toFixed(1)),
    timestamp:            new Date().toISOString(),
    results,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(summary, null, 2));

  // Clean up partial file
  try { fs.unlinkSync(PARTIAL_FILE); } catch {}

  console.log(`\n\n📊 Resultado:`);
  console.log(`   Questões testadas    : ${questions.length}`);
  console.log(`   Termos Gemini        : ${withGemini}/${ok} com sucesso`);
  console.log(`   Descritores DeCS     : ${withDecs}/${ok} com match | API ${decsAvailable ? '🟢 disponível' : '🔴 bloqueada'}`);
  console.log(`   Questões similares   : similarity média top-1 = ${avgSimilars.toFixed(3)}`);
  console.log(`   Bancas cobertas      : ${bancas.slice(0, 10).join(', ')}${bancas.length > 10 ? '...' : ''}`);

  if (topTerms.length > 0) {
    console.log(`\n🏷️  Top termos DeCS na amostra:`);
    topTerms.slice(0, 8).forEach(t => console.log(`   ${t.count}x  ${t.term}`));
  }

  console.log(`\n✅ Salvo em: ${OUTPUT_FILE}  (${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(0)} KB)\n`);

  await pool.end();
}

main().catch(e => {
  console.error('\n💥 Fatal:', e);
  process.exit(1);
});
