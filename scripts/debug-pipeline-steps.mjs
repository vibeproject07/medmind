/**
 * debug-pipeline-steps.mjs
 *
 * Diagnóstico passo a passo dos pipelines V1 e V2 de classificação DeCS.
 * Para uma questão específica, executa cada etapa individualmente e imprime
 * no terminal a entrada e saída de cada bloco de forma clara e legível.
 *
 * Uso:
 *   node --env-file=.env.local scripts/debug-pipeline-steps.mjs --id 123
 *   node --env-file=.env.local scripts/debug-pipeline-steps.mjs --id 123 --pipeline v2
 *   node --env-file=.env.local scripts/debug-pipeline-steps.mjs --id 123 --pipeline both
 */

import pg from 'pg';
import { DECS_MAX_CANDIDATES } from './decs-search-limits.mjs';

// ── Config ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const questionId = parseInt(args[args.indexOf('--id') + 1] || '0');
const pipelineArg = args[args.indexOf('--pipeline') + 1] || 'both'; // 'v1' | 'v2' | 'both'

const geminiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
const decsKey = process.env.DECS_API_KEY?.trim() || '';

if (!questionId) {
  console.error('\n❌  Informe o ID da questão: --id <número>\n');
  process.exit(1);
}
if (!geminiKey) {
  console.error('\n❌  GEMINI_API_KEY não configurada\n');
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ── Formatação de terminal ────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  blue:   '\x1b[34m',
  magenta:'\x1b[35m',
  white:  '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen:'\x1b[42m',
};

function header(title) {
  const line = '═'.repeat(70);
  console.log(`\n${C.bold}${C.cyan}${line}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ${title}${C.reset}`);
  console.log(`${C.bold}${C.cyan}${line}${C.reset}\n`);
}

function step(num, title) {
  console.log(`\n${C.bold}${C.blue}┌─ ETAPA ${num}: ${title} ${'─'.repeat(Math.max(0, 55 - title.length))}┐${C.reset}`);
}

function stepEnd() {
  console.log(`${C.blue}└${'─'.repeat(68)}┘${C.reset}`);
}

function label(text) {
  console.log(`${C.bold}${C.yellow}  ▶ ${text}${C.reset}`);
}

function ok(text) {
  console.log(`  ${C.green}✓${C.reset}  ${text}`);
}

function warn(text) {
  console.log(`  ${C.yellow}⚠${C.reset}  ${text}`);
}

function err(text) {
  console.log(`  ${C.red}✗${C.reset}  ${text}`);
}

function info(text) {
  console.log(`  ${C.dim}${text}${C.reset}`);
}

function json(obj) {
  const str = JSON.stringify(obj, null, 2);
  const lines = str.split('\n').slice(0, 40);
  lines.forEach(l => console.log(`  ${C.dim}${l}${C.reset}`));
  if (str.split('\n').length > 40) console.log(`  ${C.dim}... (truncado)${C.reset}`);
}

function timer(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ── Helpers compartilhados ────────────────────────────────────────────────────

function buildQuestionText(q) {
  const letter = String(q.correct_answer ?? '').trim().toUpperCase();
  return [
    'Enunciado:', q.statement, '',
    'Alternativa A: ' + (q.option_a || ''),
    'Alternativa B: ' + (q.option_b || ''),
    q.option_c ? 'Alternativa C: ' + q.option_c : null,
    q.option_d ? 'Alternativa D: ' + q.option_d : null,
    q.option_e ? 'Alternativa E: ' + q.option_e : null,
    letter ? `Gabarito: ${letter}` : null,
  ].filter(Boolean).join('\n');
}

async function callGemini(model, systemPrompt, userMessage) {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${geminiKey}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192, responseMimeType: 'application/json' },
    }),
  });
  const elapsed = Date.now() - t0;
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  const rawText = (data?.candidates?.[0]?.content?.parts || [])
    .filter(p => !p?.thought)
    .map(p => p?.text)
    .filter(Boolean)
    .join('') ?? '';
  const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  return { parsed: JSON.parse(cleaned), raw: cleaned, elapsed };
}

async function loadAgent(key, defaultPrompt, defaultModel = 'gemini-2.5-flash') {
  try {
    const res = await pool.query(`SELECT system_prompt, model FROM ai_agents WHERE key = $1`, [key]);
    if (res.rows[0]?.system_prompt) {
      return { prompt: res.rows[0].system_prompt, model: res.rows[0].model || defaultModel, source: 'banco de dados' };
    }
  } catch {}
  return { prompt: defaultPrompt, model: defaultModel, source: 'padrão embutido' };
}

async function searchDeCSLocal(term, minSimilarity = 0.6, limit = DECS_MAX_CANDIDATES) {
  try {
    const embedRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'models/gemini-embedding-001', content: { parts: [{ text: term }] } }),
      }
    );
    if (!embedRes.ok) return [];
    const embedData = await embedRes.json();
    const vec = embedData?.embedding?.values;
    if (!vec) return [];
    const vecStr = `[${vec.join(',')}]`;
    const { rows } = await pool.query(
      `SELECT ui AS code, name_pt AS term, name_en, scope_note, tree_numbers,
              1 - (embedding::halfvec(3072) <=> $1::halfvec(3072)) AS similarity
       FROM decs_descriptors
       WHERE embedding IS NOT NULL
         AND (1 - (embedding::halfvec(3072) <=> $1::halfvec(3072))) >= $2
       ORDER BY embedding::halfvec(3072) <=> $1::halfvec(3072)
       LIMIT $3`,
      [vecStr, minSimilarity, limit]
    );
    return rows.map(r => ({
      code: r.code, term: r.term, name_en: r.name_en, scope_note: r.scope_note,
      tree_ids: Array.isArray(r.tree_numbers) ? r.tree_numbers : JSON.parse(r.tree_numbers || '[]'),
      similarity: parseFloat(r.similarity),
      source: 'pgvector',
    }));
  } catch {
    return [];
  }
}

async function searchDeCSByText(term, limit = DECS_MAX_CANDIDATES) {
  try {
    const { rows } = await pool.query(
      `SELECT ui AS code, name_pt AS term, name_en, scope_note, tree_numbers
       FROM decs_descriptors
       WHERE name_pt ILIKE $1 OR name_en ILIKE $1
       ORDER BY CASE WHEN LOWER(name_pt) = LOWER($2) THEN 0 WHEN name_pt ILIKE $2 THEN 1 ELSE 2 END
       LIMIT $3`,
      [`%${term.trim()}%`, term.trim(), limit]
    );
    return rows.map(r => ({
      code: r.code, term: r.term, name_en: r.name_en, scope_note: r.scope_note,
      tree_ids: Array.isArray(r.tree_numbers) ? r.tree_numbers : JSON.parse(r.tree_numbers || '[]'),
      source: 'texto ILIKE',
    }));
  } catch {
    return [];
  }
}

async function searchDeCSBVS(term, limit = DECS_MAX_CANDIDATES) {
  if (!decsKey) return [];
  try {
    const url = `https://api.bvsalud.org/decs/v2/search-by-words?words=${encodeURIComponent(term)}&lang=pt&format=json`;
    const res = await fetch(url, { headers: { apikey: decsKey }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    const objects = data?.objects;
    if (!Array.isArray(objects) || !objects[0]) return [];
    const records = objects[0]?.decsws_response?.record_list?.record;
    const rawList = Array.isArray(records) ? records : records ? [records] : [];
    return rawList.slice(0, limit).map(rec => {
      const descs = [rec.descriptor_list].flat(3);
      let term = '';
      for (const lang of ['pt-br', 'pt']) {
        const f = descs.find(d => d?.attr?.lang === lang);
        if (f?.descriptor) { term = String(f.descriptor).trim(); break; }
      }
      const treeList = [rec.tree_id_list].flat(3);
      const tree_ids = treeList.map(t => String(t?.tree_id || '')).filter(Boolean);
      return { code: String(rec.attr?.mfn || ''), term, tree_ids, source: 'API BVS' };
    }).filter(r => r.term);
  } catch {
    return [];
  }
}

const BIO_RE = /\b(vírus|virus|bactéria|bacteria|bacilo|fungo|parasita|microbiol|infectol|viral|antibiótic|antibiotic|vacin|patógen|prion|rickettsia|protozoár|helmint)\b/i;
function isCategoryAcceptable(record, questionText) {
  if (!record.tree_ids?.length) return true;
  const cats = record.tree_ids.map(t => t.split('.')[0].replace(/[0-9]/g, ''));
  if (!cats.every(c => c === 'B')) return true;
  return BIO_RE.test(questionText);
}

// ── Pipeline V1 — passo a passo ───────────────────────────────────────────────

async function runV1Debug(question) {
  const questionText = buildQuestionText(question);

  header(`PIPELINE V1 — Questão #${question.id} (${question.exam_board || 'sem banca'} ${question.exam_year || ''})`);

  // ── ETAPA 1: Extração de temas (Gemini decs_classifier) ────────────────────
  step(1, 'Extração de temas médicos (Gemini — decs_classifier)');
  label('Carregando agente decs_classifier...');
  const classifier = await loadAgent('decs_classifier', '');
  ok(`Fonte: ${classifier.source} | Modelo: ${classifier.model}`);
  info(`Prompt (primeiros 200 chars): ${classifier.prompt.slice(0, 200)}...`);

  label('Texto enviado ao Gemini:');
  info(questionText.slice(0, 400) + (questionText.length > 400 ? '...' : ''));

  let themes = { primary: [], secondary: [] };
  let step1Time = 0;
  try {
    const t0 = Date.now();
    const { parsed, elapsed } = await callGemini(classifier.model, classifier.prompt, questionText);
    step1Time = elapsed;
    themes.primary = (Array.isArray(parsed?.primary) ? parsed.primary : []).filter(t => typeof t === 'string').slice(0, 3);
    themes.secondary = (Array.isArray(parsed?.secondary) ? parsed.secondary : []).filter(t => typeof t === 'string').slice(0, 6);
    ok(`Resposta recebida em ${timer(elapsed)}`);
    label('Temas PRIMÁRIOS identificados:');
    themes.primary.forEach((t, i) => console.log(`  ${C.green}  [${i + 1}] ${t}${C.reset}`));
    label('Temas SECUNDÁRIOS identificados:');
    if (themes.secondary.length === 0) warn('Nenhum tema secundário.');
    themes.secondary.forEach((t, i) => console.log(`  ${C.yellow}  [${i + 1}] ${t}${C.reset}`));
  } catch (e) {
    err(`Erro: ${e.message}`);
  }
  stepEnd();

  if (themes.primary.length === 0) {
    err('Nenhum tema extraído — abortando pipeline V1');
    return;
  }

  // ── ETAPA 2: Busca de candidatos DeCS por tema ────────────────────────────
  step(2, 'Busca de candidatos DeCS (pgvector → API BVS)');
  const allTerms = [
    ...themes.primary.map(t => ({ term: t, role: 'primário' })),
    ...themes.secondary.map(t => ({ term: t, role: 'secundário' })),
  ];

  const candidatesByTerm = {};
  for (const { term, role } of allTerms) {
    label(`Buscando: "${term}" (${role})`);
    let candidates = [];
    let usedSource = '';

    const local = await searchDeCSLocal(term, 0.6, DECS_MAX_CANDIDATES);
    if (local.length > 0) {
      candidates = local;
      usedSource = 'pgvector (vetorial)';
    } else {
      warn('Sem resultados locais — tentando API BVS...');
      const bvs = await searchDeCSBVS(term, DECS_MAX_CANDIDATES);
      if (bvs.length > 0) {
        candidates = bvs;
        usedSource = 'API BVS (fallback)';
      }
    }

    if (candidates.length === 0) {
      err('Sem candidatos encontrados para este termo');
    } else {
      ok(`${candidates.length} candidato(s) via ${usedSource}:`);
      candidates.forEach(c => {
        const catOk = isCategoryAcceptable(c, questionText);
        const catIcon = catOk ? C.green + '✓' : C.red + '✗';
        console.log(`  ${catIcon}${C.reset}  ${C.bold}${c.term}${C.reset} [${c.code}]`);
        info(`    Árvore: ${c.tree_ids?.slice(0, 2).join(', ') || 'N/A'} | Sim: ${(c.similarity || 0).toFixed(3)}`);
        if (!catOk) info('    → REJEITADO pelo filtro de categoria B (organismo sem contexto bio)');
      });
    }
    candidatesByTerm[term] = { role, candidates: candidates.filter(c => isCategoryAcceptable(c, questionText)) };
  }
  stepEnd();

  // ── ETAPA 3: Enriquecimento com scope_note do banco ───────────────────────
  step(3, 'Enriquecimento com scope_note / name_en (banco local)');
  const allAccepted = Object.values(candidatesByTerm).flatMap(({ candidates, role }) =>
    candidates.map(c => ({ ...c, role }))
  );
  const needEnrich = allAccepted.filter(c => !c.scope_note && c.code);
  if (needEnrich.length === 0) {
    ok('Todos os candidatos já possuem scope_note (vieram do pgvector)');
  } else {
    const codes = needEnrich.map(c => c.code);
    try {
      const { rows } = await pool.query(
        `SELECT ui, name_en, scope_note FROM decs_descriptors WHERE ui = ANY($1)`, [codes]
      );
      ok(`Enriquecidos ${rows.length}/${needEnrich.length} candidatos:`);
      rows.forEach(r => info(`  ${r.ui}: scope "${(r.scope_note || '').slice(0, 80)}..."`));
    } catch (e) {
      err(`Erro no enriquecimento: ${e.message}`);
    }
  }
  // Deduplicação
  const seenCodes = new Set();
  const deduped = allAccepted.filter(c => {
    if (seenCodes.has(c.code)) { warn(`  Duplicata removida: ${c.term} [${c.code}]`); return false; }
    seenCodes.add(c.code); return true;
  });
  ok(`Candidatos após deduplicação: ${deduped.length}`);
  stepEnd();

  // ── ETAPA 4: Validação Gemini (question_terms_validator) ───────────────────
  step(4, 'Validação pelo Gemini (question_terms_validator)');
  label('Carregando agente question_terms_validator...');
  const validator = await loadAgent('question_terms_validator', '');
  ok(`Fonte: ${validator.source} | Modelo: ${validator.model}`);

  const candidateList = deduped.map(d => ({
    code: d.code, term: d.term, term_en: d.name_en,
    scope: d.scope_note ? d.scope_note.slice(0, 180) : undefined,
    categoria: (d.tree_ids?.[0] || '').split('.')[0],
  }));
  label('Candidatos enviados ao validador:');
  json(candidateList);

  let validated = deduped;
  try {
    const userMsg = `Questão:\n${questionText}\n\nCandidatos:\n${JSON.stringify(candidateList, null, 2)}`;
    const { parsed, elapsed } = await callGemini(validator.model, validator.prompt, userMsg);
    ok(`Resposta em ${timer(elapsed)}`);
    if (Array.isArray(parsed)) {
      const approvedSet = new Set(parsed.map(String));
      const before = deduped.length;
      validated = deduped.filter(d => approvedSet.has(d.code));
      if (validated.length === 0) validated = deduped;
      label('Códigos aprovados pelo validador:');
      console.log(`  ${C.green}${parsed.join(', ')}${C.reset}`);
      ok(`Aprovados: ${validated.length}/${before} candidatos`);
      deduped.filter(d => !approvedSet.has(d.code)).forEach(d =>
        warn(`  Rejeitado: ${d.term} [${d.code}]`)
      );
    } else {
      warn('Resposta inesperada do validador — mantendo todos os candidatos');
    }
  } catch (e) {
    err(`Erro na validação: ${e.message} — mantendo candidatos`);
  }
  stepEnd();

  // ── RESULTADO FINAL V1 ────────────────────────────────────────────────────
  header('RESULTADO FINAL — Pipeline V1');
  const primary = validated.filter(d => d.role === 'primário');
  const secondary = validated.filter(d => d.role !== 'primário');
  console.log(`${C.bold}${C.green}  Descritores PRIMÁRIOS (${primary.length}):${C.reset}`);
  primary.forEach(d => console.log(`    • ${C.bold}${d.term}${C.reset} [${d.code}] — ${d.hierarchy_path || d.tree_ids?.[0] || ''}`));
  console.log(`\n${C.bold}${C.yellow}  Descritores SECUNDÁRIOS (${secondary.length}):${C.reset}`);
  if (secondary.length === 0) console.log('    (nenhum)');
  secondary.forEach(d => console.log(`    • ${C.bold}${d.term}${C.reset} [${d.code}] — ${d.hierarchy_path || d.tree_ids?.[0] || ''}`));
}

// ── Pipeline V2 — passo a passo ───────────────────────────────────────────────

async function runV2Debug(question) {
  const questionText = buildQuestionText(question);

  header(`PIPELINE V2 (RAG) — Questão #${question.id} (${question.exam_board || 'sem banca'} ${question.exam_year || ''})`);

  // ── ETAPA 1: Extração de conceitos (decs_indexer_v2) ─────────────────────
  step(1, 'Extração de conceitos semânticos (Gemini — decs_indexer_v2)');
  label('Carregando agente decs_indexer_v2...');
  const indexer = await loadAgent('decs_indexer_v2', '');
  ok(`Fonte: ${indexer.source} | Modelo: ${indexer.model}`);

  let themes = { primary: [], secondary: [] };
  try {
    const { parsed, elapsed } = await callGemini(indexer.model, indexer.prompt, questionText);
    themes.primary = (Array.isArray(parsed?.primary) ? parsed.primary : []).filter(t => typeof t === 'string').slice(0, 3);
    themes.secondary = (Array.isArray(parsed?.secondary) ? parsed.secondary : []).filter(t => typeof t === 'string').slice(0, 6);
    ok(`Resposta em ${timer(elapsed)}`);
    label('Conceitos PRIMÁRIOS:');
    themes.primary.forEach((t, i) => console.log(`  ${C.green}  [${i + 1}] ${t}${C.reset}`));
    label('Conceitos SECUNDÁRIOS:');
    if (themes.secondary.length === 0) warn('Nenhum.');
    themes.secondary.forEach((t, i) => console.log(`  ${C.yellow}  [${i + 1}] ${t}${C.reset}`));
  } catch (e) {
    err(`Erro: ${e.message}`);
  }
  stepEnd();

  // ── ETAPA 2: Busca de candidatos (vector → text → BVS) ───────────────────
  step(2, 'Busca de candidatos por conceito (pgvector → texto → API BVS)');
  const allConcepts = [
    ...themes.primary.map(t => ({ term: t, role: 'primário' })),
    ...themes.secondary.map(t => ({ term: t, role: 'secundário' })),
  ];
  const candidatesMap = {};

  for (const { term, role } of allConcepts) {
    label(`Conceito: "${term}" (${role})`);
    let candidates = [];

    const local = await searchDeCSLocal(term, 0.55, DECS_MAX_CANDIDATES);
    const localFiltered = local.filter(c => isCategoryAcceptable(c, questionText));
    if (localFiltered.length > 0) {
      candidates = localFiltered;
      ok(`${candidates.length} resultado(s) via pgvector:`);
    } else {
      warn('pgvector sem resultados — tentando busca por texto...');
      const text = await searchDeCSByText(term, DECS_MAX_CANDIDATES);
      const textFiltered = text.filter(c => isCategoryAcceptable(c, questionText));
      if (textFiltered.length > 0) {
        candidates = textFiltered;
        ok(`${candidates.length} resultado(s) via busca textual:`);
      } else {
        warn('Texto sem resultados — tentando API BVS...');
        const bvs = await searchDeCSBVS(term, DECS_MAX_CANDIDATES);
        candidates = bvs.filter(c => isCategoryAcceptable(c, questionText));
        if (candidates.length > 0) {
          ok(`${candidates.length} resultado(s) via API BVS:`);
        } else {
          err('Nenhum candidato encontrado — conceito será ignorado');
        }
      }
    }

    candidates.forEach(c => {
      console.log(`    • ${C.bold}${c.term}${C.reset} [${c.code}] (${c.source || ''}) sim=${(c.similarity || 0).toFixed(3)}`);
      if (c.scope_note) info(`      "${c.scope_note.slice(0, 100)}"`);
    });
    if (candidates.length > 0) candidatesMap[term] = { role, candidates };
  }
  stepEnd();

  // ── ETAPA 3: Enriquecimento ───────────────────────────────────────────────
  step(3, 'Enriquecimento com scope_note / name_en (banco local)');
  const allCandidates = Object.values(candidatesMap).flatMap(({ candidates }) => candidates);
  const needEnrich = allCandidates.filter(c => !c.scope_note && c.code);
  if (needEnrich.length === 0) {
    ok('Todos os candidatos já possuem scope_note');
  } else {
    const codes = needEnrich.map(c => c.code);
    const { rows } = await pool.query(
      `SELECT ui, name_en, scope_note FROM decs_descriptors WHERE ui = ANY($1)`, [codes]
    );
    ok(`Enriquecidos ${rows.length}/${needEnrich.length} candidatos`);
    rows.forEach(r => info(`  ${r.ui}: "${(r.scope_note || '').slice(0, 80)}"`));
  }
  stepEnd();

  // ── ETAPA 4: Seleção pelo Gemini (decs_selector_v2) ──────────────────────
  step(4, 'Seleção do melhor descritor por conceito (Gemini — decs_selector_v2)');
  label('Carregando agente decs_selector_v2...');
  const selector = await loadAgent('decs_selector_v2', '');
  ok(`Fonte: ${selector.source} | Modelo: ${selector.model}`);

  const primaryMap = Object.fromEntries(
    Object.entries(candidatesMap).filter(([, v]) => v.role === 'primário').map(([k, v]) => [k, v.candidates])
  );
  const secondaryMap = Object.fromEntries(
    Object.entries(candidatesMap).filter(([, v]) => v.role === 'secundário').map(([k, v]) => [k, v.candidates])
  );

  const contextInput = {
    questao: questionText.slice(0, 1500),
    temas_primarios: Object.entries(primaryMap).map(([concept, cands]) => ({
      conceito_buscado: concept,
      candidatos: cands.map(c => ({ id: c.code, term: c.term, scope: c.scope_note?.slice(0, 200) })),
    })),
    temas_secundarios: Object.entries(secondaryMap).map(([concept, cands]) => ({
      conceito_buscado: concept,
      candidatos: cands.map(c => ({ id: c.code, term: c.term, scope: c.scope_note?.slice(0, 200) })),
    })),
  };

  label('JSON enviado ao seletor:');
  json(contextInput);

  let selected = { primary: [], secondary: [] };
  try {
    const { parsed, elapsed } = await callGemini(selector.model, selector.prompt, JSON.stringify(contextInput, null, 2));
    ok(`Resposta em ${timer(elapsed)}`);
    label('Seleção do Gemini:');
    json(parsed);

    const allCandMap = new Map(allCandidates.map(c => [c.code, c]));
    selected.primary = (parsed?.decs_primary || []).map(x => allCandMap.get(x.id)).filter(Boolean);
    selected.secondary = (parsed?.decs_secondary || []).map(x => allCandMap.get(x.id)).filter(Boolean);
    ok(`Selecionados: ${selected.primary.length} primários, ${selected.secondary.length} secundários`);
  } catch (e) {
    err(`Erro no seletor: ${e.message}`);
  }
  stepEnd();

  // ── ETAPA 5: Resolução de hierarquia (pais/filhos) ────────────────────────
  step(5, 'Resolução de hierarquia (pais e filhos) no banco');
  const allSelected = [...selected.primary, ...selected.secondary];
  for (const d of allSelected.slice(0, 6)) {
    label(`Hierarquia de: "${d.term}" [${d.code}]`);
    try {
      for (const treeId of (d.tree_ids || []).slice(0, 2)) {
        const parts = treeId.split('.');
        if (parts.length > 1) {
          const parentPath = parts.slice(0, -1).join('.');
          const { rows: pr } = await pool.query(
            `SELECT ui, name_pt FROM decs_descriptors WHERE tree_numbers @> $1::jsonb LIMIT 1`,
            [JSON.stringify([parentPath])]
          );
          if (pr[0]) ok(`  Pai: ${pr[0].name_pt} [${pr[0].ui}]`);
        }
        const { rows: cr } = await pool.query(
          `SELECT ui, name_pt FROM decs_descriptors WHERE tree_numbers::text LIKE $1 AND ui != $2 LIMIT 3`,
          [`%"${treeId}.%`, d.code]
        );
        cr.forEach(r => info(`  Filho: ${r.name_pt} [${r.ui}]`));
      }
    } catch (e) {
      err(`Erro: ${e.message}`);
    }
  }
  stepEnd();

  // ── RESULTADO FINAL V2 ────────────────────────────────────────────────────
  header('RESULTADO FINAL — Pipeline V2 (RAG)');
  console.log(`${C.bold}${C.green}  Descritores PRIMÁRIOS (${selected.primary.length}):${C.reset}`);
  if (selected.primary.length === 0) console.log('    (nenhum)');
  selected.primary.forEach(d => console.log(`    • ${C.bold}${d.term}${C.reset} [${d.code}]`));
  console.log(`\n${C.bold}${C.yellow}  Descritores SECUNDÁRIOS (${selected.secondary.length}):${C.reset}`);
  if (selected.secondary.length === 0) console.log('    (nenhum)');
  selected.secondary.forEach(d => console.log(`    • ${C.bold}${d.term}${C.reset} [${d.code}]`));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${C.bold}${C.magenta}🔬 MedMind — Diagnóstico de Pipeline DeCS${C.reset}`);
  console.log(`${C.dim}   Questão: #${questionId} | Pipeline: ${pipelineArg} | Gemini: ${geminiKey ? '✅' : '❌'} | DeCS API: ${decsKey ? '✅' : '❌ (sem chave)'}${C.reset}\n`);

  const { rows } = await pool.query(
    `SELECT id, statement, option_a, option_b, option_c, option_d, option_e,
            correct_answer, exam_board, exam_year, exam_institution
     FROM questions WHERE id = $1`, [questionId]
  );

  if (!rows[0]) {
    console.error(`\n❌  Questão #${questionId} não encontrada no banco.\n`);
    await pool.end();
    process.exit(1);
  }

  const question = rows[0];
  console.log(`${C.bold}Questão encontrada:${C.reset} ${question.exam_board || ''} ${question.exam_year || ''} ${question.exam_institution || ''}`);
  console.log(`${C.dim}${question.statement.slice(0, 200)}...${C.reset}\n`);

  if (pipelineArg === 'v1' || pipelineArg === 'both') {
    await runV1Debug(question);
  }
  if (pipelineArg === 'v2' || pipelineArg === 'both') {
    await runV2Debug(question);
  }

  console.log(`\n${C.bold}${C.green}✅  Diagnóstico concluído.${C.reset}\n`);
  await pool.end();
}

main().catch(async e => {
  console.error(`\n${C.red}💥 Erro fatal:${C.reset}`, e.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
