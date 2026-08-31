/**
 * decs-pipeline-v1-run.mjs — Replica standalone do botão "Gerar V1" (POST /api/questions/[id]/decs-ai)
 *
 * Baseado em lib/decs-pipeline.ts (runDeCSPipeline), mas com o ORDENAMENTO DE BUSCA INVERTIDO
 * a pedido: prioriza busca TEXTUAL (entry_terms/name_pt) sobre a busca vetorial.
 *
 * Fluxo por termo (primary/secondary) extraído pelo agente decs_classifier:
 *
 *   1. [TEXTO]   Busca em entry_terms + name_pt via ILIKE (padrão de decs-entry-terms-search.mjs)
 *   2. Avalia:   match de qualidade (Jaccard termo × nome do descritor) + coerência com a questão
 *                (mesmo filtro de categoria de lib/decs-pipeline.ts — isCategoryAcceptable)
 *   3. Se BOM MATCH e COERENTE  → aceita via texto (accepted_by_text)
 *      Se NÃO                   → cai no [VETOR]: embedding do termo (gemini-embedding-001,
 *                                  padrão decs-embed-search.mjs/decs-entry-terms-search.mjs --vector)
 *                                  + busca por similaridade coseno (halfvec)
 *   4. Se ainda assim não houver candidato aceitável e DECS_API_KEY estiver definida,
 *      tenta a API pública do BVS como último recurso (fidelidade ao pipeline original).
 *   5. Deduplicação por código (ui) — primary tem prioridade sobre secondary.
 *
 * Fontes reaproveitadas (ver explicação completa ao final do script):
 *   - lib/decs-pipeline.ts            → DECS_CATEGORY_LABELS, isCategoryAcceptable, wordJaccard,
 *                                        BIO_KEYWORD_RE, parseDeCSRecord/BVS, formato do artifact
 *   - scripts/decs-entry-terms-search.mjs → searchEntryTerms (SQL ILIKE), searchByVector (SQL halfvec)
 *   - scripts/decs-embed-search.mjs   → generateEmbedding (Gemini REST, sem taskType)
 *   - scripts/decs-vectorize-20.mjs   → estrutura de CLI args, createPool, export em JSON
 *   - scripts/embed-decs-descriptors.mjs → buildDeCSText (referência, não usado diretamente aqui
 *                                           pois aqui vetorizamos o TERMO de busca, não o descritor)
 *
 * Cada descritor no resultado inclui `branches` — TODAS as ramificações (tree_numbers)
 * a que ele pertence (não só a primeira, como `hierarchy_path`).
 *
 * Uso e opções: ver bloco "COMANDOS DISPONÍVEIS" ao final deste arquivo.
 */

import pg   from 'pg';
import fs   from 'fs';
import path from 'path';
import { DECS_MAX_CANDIDATES } from './decs-search-limits.mjs';

// ══════════════════════════════════════════════════════════════════════════════
// Configuração
// ══════════════════════════════════════════════════════════════════════════════

const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIM   = 3072;
const CLASSIFIER_KEY  = 'decs_classifier';

// ── Categorias DeCS (idêntico a lib/decs-pipeline.ts) ─────────────────────────

const DECS_CATEGORY_LABELS = {
  A:  'Anatomia',
  B:  'Organismos',
  C:  'Doenças',
  D:  'Compostos Químicos e Drogas',
  E:  'Técnicas e Equipamentos Analíticos',
  F:  'Psiquiatria e Psicologia',
  G:  'Fenômenos Biológicos',
  H:  'Disciplinas e Ocupações',
  I:  'Antropologia, Educação, Sociologia',
  J:  'Tecnologia, Indústria, Agricultura',
  K:  'Humanidades',
  L:  'Ciência da Informação',
  M:  'Grupos Identificados',
  N:  'Saúde',
  SP: 'Saúde Pública',
  VS: 'Vigilância Sanitária',
};

function treeCategory(treeId) {
  return (treeId ?? '').split('.')[0].replace(/[0-9]/g, '');
}

function buildHierarchyPath(treeId) {
  if (!treeId) return '';
  const cat   = treeCategory(treeId);
  const label = DECS_CATEGORY_LABELS[cat] ?? cat;
  return treeId.split('.').length <= 1 ? label : `${label} › ${treeId}`;
}

/**
 * Resolve TODAS as ramificações (tree_ids) de um descritor, não só a primeira
 * (hierarchy_path mostra apenas tree_ids[0]). Idêntico a buildBranches em
 * lib/decs-pipeline.ts — replicado aqui pois scripts .mjs não resolvem "@/lib/*".
 */
function buildBranches(treeIds) {
  return (treeIds ?? []).filter(Boolean).map((tree_id) => ({ tree_id, hierarchy_path: buildHierarchyPath(tree_id) }));
}

// Categoria B (organismos) só é aceita se a questão tiver contexto bio/micro explícito
// (idêntico a lib/decs-pipeline.ts)
const BIO_KEYWORD_RE =
  /\b(vírus|virus|bactéria|bacteria|bacilo|fungo|fung|parasita|parasit|microbiol|infectol|viral|antibiótic|antibiotic|vaccin|vacin|patógen|patogen|prion|rickettsia|protozoár|helmint|coccídio|coccidi|tripanossom|leishman|plasmodium|schistosoma)\b/i;

function isCategoryAcceptable(record, questionText) {
  if (!record.tree_ids || record.tree_ids.length === 0) return true;
  const cats = record.tree_ids.map(treeCategory);
  const allOrganism = cats.every((c) => c === 'B');
  if (!allOrganism) return true;
  return BIO_KEYWORD_RE.test(questionText);
}

// ── Similaridade textual (idêntico a lib/decs-pipeline.ts) ────────────────────

function tokenise(s) {
  return new Set(
    (s ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/\W+/)
      .filter((w) => w.length > 3),
  );
}

function wordJaccard(a, b) {
  const A = tokenise(a);
  const B = tokenise(b);
  let inter = 0;
  A.forEach((w) => { if (B.has(w)) inter++; });
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}

function normalizeExact(s) {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .trim();
}

// ══════════════════════════════════════════════════════════════════════════════
// Gemini — geração de embedding do TERMO de busca (fallback vetorial)
// Referência: scripts/decs-embed-search.mjs (generateEmbedding)
// Sem taskType → SEMANTIC_SIMILARITY, compatível com os embeddings existentes
// em decs_descriptors (ver nota de migração em replit.md).
// ══════════════════════════════════════════════════════════════════════════════

async function generateEmbedding(text, geminiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ content: { parts: [{ text: text.slice(0, 8000) }] } }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini embedContent ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data   = await res.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Resposta de embedding vazia ou inválida da API Gemini.');
  }
  return values;
}

// ══════════════════════════════════════════════════════════════════════════════
// Gemini — chamada ao agente decs_classifier (Etapa 1) via REST generateContent
// Reproduz app/api/questions/[id]/decs-ai/route.ts sem depender do SDK @google/genai
// nem de imports "@/lib/*" (scripts .mjs rodam fora do resolvedor de módulos do Next).
// ══════════════════════════════════════════════════════════════════════════════

async function loadClassifierAgent(pool) {
  const { rows } = await pool.query(`SELECT * FROM ai_agents WHERE key = $1`, [CLASSIFIER_KEY]);
  if (rows.length === 0) {
    throw new Error(
      `Agente "${CLASSIFIER_KEY}" não encontrado em ai_agents. ` +
      'Configure no Editor de Agentes ou rode POST /api/admin/seed-ai-agents.',
    );
  }
  const row = rows[0];
  if (row.is_active === false) {
    throw new Error(`Agente "${CLASSIFIER_KEY}" está inativo e não pode ser executado.`);
  }
  if (!row.system_prompt) {
    throw new Error(`Agente "${CLASSIFIER_KEY}" existe mas system_prompt está vazio.`);
  }
  return {
    system_instruction: row.system_prompt,
    model:              row.model ?? 'gemini-2.5-flash',
    temperature:        parseFloat(row.temperature ?? 0.1),
    max_output_tokens:  parseInt(row.max_output_tokens ?? 8192, 10),
  };
}

async function classifyThemes(questionText, agent, geminiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${agent.model}:generateContent?key=${geminiKey}`;
  const body = {
    system_instruction: { parts: [{ text: agent.system_instruction }] },
    contents: [{ role: 'user', parts: [{ text: questionText }] }],
    generationConfig: {
      temperature:      agent.temperature,
      maxOutputTokens:  agent.max_output_tokens,
      responseMimeType: 'application/json',
    },
  };
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini generateContent ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const rawText =
    data?.candidates?.[0]?.content?.parts
      ?.filter((p) => !p?.thought)
      ?.map((p) => p?.text)
      .filter(Boolean)
      .join('') ?? '';

  const themes = { primary: [], secondary: [] };
  try {
    const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      themes.primary = parsed.filter((t) => typeof t === 'string' && t.trim()).slice(0, 3);
    } else if (parsed && typeof parsed === 'object') {
      themes.primary = (Array.isArray(parsed.primary) ? parsed.primary : [])
        .filter((t) => typeof t === 'string' && t.trim()).slice(0, 3);
      themes.secondary = (Array.isArray(parsed.secondary) ? parsed.secondary : [])
        .filter((t) => typeof t === 'string' && t.trim()).slice(0, 6);
    }
  } catch {
    const matches = rawText.match(/"([^"]+)"/g);
    if (matches) themes.primary = matches.map((m) => m.replace(/"/g, '').trim()).filter(Boolean).slice(0, 3);
  }
  return { themes, raw: rawText };
}

// ══════════════════════════════════════════════════════════════════════════════
// [TEXTO] Busca em entry_terms + name_pt via ILIKE
// Referência: scripts/decs-entry-terms-search.mjs (searchEntryTerms), estendida
// para casar também contra o próprio name_pt do descritor.
// ══════════════════════════════════════════════════════════════════════════════

async function searchTextual(pool, term, limit) {
  const pattern = `%${term}%`;
  const { rows } = await pool.query(
    `SELECT
       d.ui, d.name_pt, d.name_en, d.scope_note, d.entry_terms, d.tree_numbers,
       (
         SELECT jsonb_agg(t)
         FROM jsonb_array_elements_text(d.entry_terms) AS t
         WHERE t ILIKE $1
       ) AS matched_terms
     FROM decs_descriptors d
     WHERE d.name_pt ILIKE $1
        OR EXISTS (
             SELECT 1 FROM jsonb_array_elements_text(d.entry_terms) AS t WHERE t ILIKE $1
           )
     ORDER BY (d.name_pt ILIKE $1) DESC, name_pt
     LIMIT $2`,
    [pattern, limit],
  );

  return rows.map((r) => {
    const tree_ids = Array.isArray(r.tree_numbers) ? r.tree_numbers : JSON.parse(r.tree_numbers ?? '[]');
    const allTerms = Array.isArray(r.entry_terms)  ? r.entry_terms  : JSON.parse(r.entry_terms  ?? '[]');
    const matched  = Array.isArray(r.matched_terms) ? r.matched_terms : JSON.parse(r.matched_terms ?? '[]');
    return {
      code:           r.ui,
      term:           r.name_pt,
      name_en:        r.name_en ?? undefined,
      scope_note:     r.scope_note ?? undefined,
      tree_ids,
      hierarchy_path: buildHierarchyPath(tree_ids[0] ?? ''),
      branches:       buildBranches(tree_ids),
      matched_terms:  matched,
      all_entry_terms: allTerms,
    };
  });
}

/** Melhor candidato textual + veredito de aceitação. */
function evaluateTextual(term, candidates, questionText, minSimilarity) {
  const scored = candidates.map((c) => {
    const jaccard = wordJaccard(term, c.term);
    const exact = normalizeExact(term) === normalizeExact(c.term) ||
      c.all_entry_terms.some((t) => normalizeExact(t).includes(normalizeExact(term)) && normalizeExact(term).length > 3);
    return { ...c, similarity: jaccard, exact_entry_term_match: exact };
  });

  const eligible = scored
    .filter((c) => isCategoryAcceptable(c, questionText))
    .sort((a, b) => {
      if (a.exact_entry_term_match !== b.exact_entry_term_match) return a.exact_entry_term_match ? -1 : 1;
      return b.similarity - a.similarity;
    });

  if (eligible.length === 0) {
    return { accepted: false, best: null, reason: candidates.length === 0
      ? 'nenhum candidato textual encontrado'
      : 'candidatos existem mas todos rejeitados pelo filtro de categoria (organismo sem contexto bio)' };
  }

  const best = eligible[0];
  const goodMatch = best.exact_entry_term_match || best.similarity >= minSimilarity;

  if (!goodMatch) {
    return {
      accepted: false,
      best,
      reason: `melhor candidato "${best.term}" tem similaridade ${best.similarity.toFixed(2)} < mínimo ${minSimilarity} (sem match exato em entry_terms)`,
    };
  }

  return { accepted: true, best, reason: best.exact_entry_term_match ? 'match exato em entry_terms/nome' : `similaridade ${best.similarity.toFixed(2)} ≥ mínimo ${minSimilarity}` };
}

// ══════════════════════════════════════════════════════════════════════════════
// [VETOR] Busca por similaridade coseno (fallback)
// Referência: scripts/decs-entry-terms-search.mjs (searchByVector) /
//             scripts/decs-embed-search.mjs (searchDeCS)
// ══════════════════════════════════════════════════════════════════════════════

async function searchVector(pool, embedding, limit, minSimilarity) {
  const vec = '[' + embedding.join(',') + ']';
  const { rows } = await pool.query(
    `SELECT
       ui AS code, name_pt AS term, name_en, scope_note, tree_numbers,
       1 - (embedding::halfvec(${EMBEDDING_DIM}) <=> $1::halfvec(${EMBEDDING_DIM})) AS similarity
     FROM decs_descriptors
     WHERE embedding IS NOT NULL
       AND (1 - (embedding::halfvec(${EMBEDDING_DIM}) <=> $1::halfvec(${EMBEDDING_DIM}))) >= $2
     ORDER BY embedding::halfvec(${EMBEDDING_DIM}) <=> $1::halfvec(${EMBEDDING_DIM})
     LIMIT $3`,
    [vec, minSimilarity, limit],
  );
  return rows.map((r) => {
    const tree_ids = Array.isArray(r.tree_numbers) ? r.tree_numbers : JSON.parse(r.tree_numbers ?? '[]');
    return {
      code:           r.code,
      term:           r.term,
      name_en:        r.name_en ?? undefined,
      scope_note:     r.scope_note ?? undefined,
      tree_ids,
      hierarchy_path: buildHierarchyPath(tree_ids[0] ?? ''),
      branches:       buildBranches(tree_ids),
      similarity:     parseFloat(r.similarity ?? '0'),
    };
  });
}

function evaluateVector(candidates, questionText) {
  const eligible = candidates
    .filter((c) => isCategoryAcceptable(c, questionText))
    .sort((a, b) => b.similarity - a.similarity);

  if (eligible.length === 0) {
    return { accepted: false, best: null, reason: candidates.length === 0
      ? 'nenhum candidato vetorial acima do limiar de similaridade'
      : 'candidatos existem mas todos rejeitados pelo filtro de categoria' };
  }
  return { accepted: true, best: eligible[0], reason: `similaridade coseno ${eligible[0].similarity.toFixed(4)}` };
}

// ══════════════════════════════════════════════════════════════════════════════
// [BVS] Fallback terciário — API pública, só roda se DECS_API_KEY estiver definida
// e as duas camadas locais (texto + vetor) não resolverem. Mantido por fidelidade
// ao pipeline original (lib/decs-pipeline.ts sempre teve BVS como rede de segurança).
// ══════════════════════════════════════════════════════════════════════════════

const DECS_BASE = 'https://api.bvsalud.org/decs/v2';

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v != null) return [v];
  return [];
}

function parseBvsRecord(rec) {
  const attrObj = rec.attr;
  const code = attrObj?.mfn ?? '';
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
  const tree_ids = treeList.map((t) => (t?.tree_id ?? '').trim()).filter(Boolean);
  return { code, term, tree_ids, hierarchy_path: buildHierarchyPath(tree_ids[0] ?? ''), branches: buildBranches(tree_ids) };
}

async function searchBvs(term, decsApiKey, maxCandidates) {
  const url = `${DECS_BASE}/search-by-words?words=${encodeURIComponent(term)}&lang=pt&format=json`;
  const res = await fetch(url, { headers: { apikey: decsApiKey } });
  if (!res.ok) return [];
  const data = await res.json();
  const objects = data?.objects;
  if (!Array.isArray(objects) || objects.length === 0) return [];
  const recordList = objects[0]?.decsws_response?.record_list;
  if (!recordList) return [];
  const rawRecords = toArray(recordList?.record).slice(0, maxCandidates);
  return rawRecords.map(parseBvsRecord).filter(Boolean);
}

function evaluateBvs(term, candidates, questionText, minSimilarity) {
  const scored = candidates
    .map((c) => ({ ...c, similarity: wordJaccard(term, c.term) }))
    .filter((c) => c.similarity >= minSimilarity)
    .filter((c) => isCategoryAcceptable(c, questionText))
    .sort((a, b) => b.similarity - a.similarity);
  if (scored.length === 0) return { accepted: false, best: null, reason: 'BVS sem candidato aceitável' };
  return { accepted: true, best: scored[0], reason: `BVS — similaridade ${scored[0].similarity.toFixed(2)}` };
}

// ══════════════════════════════════════════════════════════════════════════════
// Orquestração de um termo (texto → vetor → BVS)
// ══════════════════════════════════════════════════════════════════════════════

async function resolveTerm(pool, term, role, questionText, seenCodes, geminiKey, decsApiKey, opts) {
  const log = { term, role };

  // ── 1. TEXTO (prioridade) ────────────────────────────────────────────────────
  const textCandidates = await searchTextual(pool, term, opts.textLimit);
  const textEval = evaluateTextual(term, textCandidates, questionText, opts.minTextSimilarity);
  log.text_search = {
    candidates_found: textCandidates.length,
    accepted:         textEval.accepted,
    reason:           textEval.reason,
    best_candidate:   textEval.best ? { code: textEval.best.code, term: textEval.best.term, similarity: textEval.best.similarity } : null,
  };

  let winner = null;
  let method = null;

  if (textEval.accepted) {
    winner = textEval.best;
    method = 'text';
  } else {
    // ── 2. VETOR (fallback) ────────────────────────────────────────────────────
    try {
      const embedding = await generateEmbedding(term, geminiKey);
      const vectorCandidates = await searchVector(pool, embedding, opts.vectorLimit, opts.minVectorSimilarity);
      const vectorEval = evaluateVector(vectorCandidates, questionText);
      log.vector_search = {
        candidates_found: vectorCandidates.length,
        accepted:         vectorEval.accepted,
        reason:           vectorEval.reason,
        best_candidate:   vectorEval.best ? { code: vectorEval.best.code, term: vectorEval.best.term, similarity: vectorEval.best.similarity } : null,
      };
      if (vectorEval.accepted) {
        winner = vectorEval.best;
        method = 'vector';
      }
    } catch (e) {
      log.vector_search = { error: e.message };
    }

    // ── 3. BVS (último recurso, só com DECS_API_KEY) ────────────────────────────
    if (!winner && decsApiKey) {
      try {
        const bvsCandidates = await searchBvs(term, decsApiKey, opts.vectorLimit);
        const bvsEval = evaluateBvs(term, bvsCandidates, questionText, 0.15);
        log.bvs_search = {
          candidates_found: bvsCandidates.length,
          accepted:         bvsEval.accepted,
          reason:           bvsEval.reason,
        };
        if (bvsEval.accepted) {
          winner = bvsEval.best;
          method = 'bvs';
        }
      } catch (e) {
        log.bvs_search = { error: e.message };
      }
    }
  }

  if (!winner) {
    log.outcome = 'no_candidate';
    return { log, record: null };
  }

  if (seenCodes.has(winner.code)) {
    log.outcome = 'deduped';
    return { log, record: null };
  }
  seenCodes.add(winner.code);

  log.outcome = 'accepted';
  log.search_method = method;

  const record = {
    term:           winner.term,
    code:           winner.code,
    tree_ids:       winner.tree_ids ?? [],
    hierarchy_path: winner.hierarchy_path ?? '',
    branches:       winner.branches ?? buildBranches(winner.tree_ids ?? []),
    role,
    search_method:  method,
    similarity:     winner.similarity ?? null,
    scope_note:     winner.scope_note ?? undefined,
    name_en:        winner.name_en ?? undefined,
  };

  return { log, record };
}

// ══════════════════════════════════════════════════════════════════════════════
// Banco de dados
// ══════════════════════════════════════════════════════════════════════════════

function createPool() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL não definida.');
  const { Pool } = pg;
  return new Pool({ connectionString: url });
}

async function loadQuestionText(pool, id) {
  const { rows } = await pool.query('SELECT * FROM questions WHERE id = $1', [id]);
  if (rows.length === 0) throw new Error(`Questão ${id} não encontrada.`);
  const q = rows[0];
  return [
    'Enunciado:',
    q.statement,
    '',
    'Alternativa A: ' + q.option_a,
    'Alternativa B: ' + q.option_b,
    q.option_c ? 'Alternativa C: ' + q.option_c : null,
    q.option_d ? 'Alternativa D: ' + q.option_d : null,
    q.option_e ? 'Alternativa E: ' + q.option_e : null,
  ].filter(Boolean).join('\n');
}

async function saveResult(pool, questionId, descriptors, artifact) {
  await pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_decs_descriptors TEXT`);
  await pool.query(
    'UPDATE questions SET ai_decs_descriptors = $1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(descriptors), questionId],
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS decs_classification_runs (
      id BIGSERIAL PRIMARY KEY,
      question_id INTEGER NOT NULL,
      pipeline VARCHAR(10) NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    'INSERT INTO decs_classification_runs (question_id, pipeline, payload) VALUES ($1, $2, $3)',
    [questionId, 'v1-script', JSON.stringify(artifact)],
  );
}

// ── Parser de argumentos CLI ──────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    id: null,
    text: null,
    minTextSimilarity: 0.5,
    minVectorSimilarity: 0.6,
    textLimit: DECS_MAX_CANDIDATES,
    vectorLimit: DECS_MAX_CANDIDATES,
    save: false,
    json: false,
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if      (a === '--id')                     args.id = argv[++i];
    else if (a === '--text')                   args.text = argv[++i];
    else if (a === '--min-text-similarity')    args.minTextSimilarity = parseFloat(argv[++i]);
    else if (a === '--min-vector-similarity')  args.minVectorSimilarity = parseFloat(argv[++i]);
    else if (a === '--text-limit')             args.textLimit = parseInt(argv[++i]);
    else if (a === '--vector-limit')           args.vectorLimit = parseInt(argv[++i]);
    else if (a === '--save')                   args.save = true;
    else if (a === '--json')                   args.json = true;
    else if (a === '--out')                    args.out = argv[++i];
  }
  return args;
}

// ══════════════════════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.id && !args.text) {
    console.error(
      'Uso: node --env-file=.env.local scripts/decs-pipeline-v1-run.mjs --id <question_id> [opções]\n' +
      '  ou node --env-file=.env.local scripts/decs-pipeline-v1-run.mjs --text "<enunciado>" [opções]\n\n' +
      'Ver todas as opções e exemplos no bloco "COMANDOS DISPONÍVEIS" ao final do script.',
    );
    process.exit(1);
  }

  const geminiKey = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '').trim();
  if (!geminiKey) throw new Error('GEMINI_API_KEY não definida.');
  const decsApiKey = process.env.DECS_API_KEY?.trim() || null;

  const pool = createPool();

  try {
    const questionText = args.id ? await loadQuestionText(pool, args.id) : args.text;

    console.error(`⏳ Classificando temas com o agente "${CLASSIFIER_KEY}"...`);
    const classifierAgent = await loadClassifierAgent(pool);
    const { themes } = await classifyThemes(questionText, classifierAgent, geminiKey);

    if (themes.primary.length === 0 && themes.secondary.length === 0) {
      throw new Error('O agente não conseguiu identificar temas para busca.');
    }
    console.error(`✓ Temas — primary: [${themes.primary.join(', ')}] | secondary: [${themes.secondary.join(', ')}]\n`);

    const seenCodes = new Set();
    const logs = [];
    const descriptors = [];

    const searchAll = [
      ...themes.primary.map((term) => ({ term, role: 'primary' })),
      ...themes.secondary.map((term) => ({ term, role: 'secondary' })),
    ];

    // Processamento SEQUENCIAL (não paralelo como em lib/decs-pipeline.ts) para
    // manter a deduplicação determinística e permitir log passo a passo do
    // raciocínio texto→vetor→BVS de cada termo.
    for (const { term, role } of searchAll) {
      console.error(`── [${role}] "${term}"`);
      const { log, record } = await resolveTerm(
        pool, term, role, questionText, seenCodes, geminiKey, decsApiKey,
        { textLimit: args.textLimit, vectorLimit: args.vectorLimit,
          minTextSimilarity: args.minTextSimilarity, minVectorSimilarity: args.minVectorSimilarity },
      );
      logs.push(log);

      if (log.outcome === 'accepted') {
        console.error(`   ✅ aceito via ${log.search_method.toUpperCase()} → [${record.code}] ${record.term}`);
        descriptors.push(record);
      } else if (log.outcome === 'deduped') {
        console.error(`   ↩︎  já incluído por outro termo (dedup)`);
      } else {
        console.error(`   ❌ nenhum candidato aceitável (texto${log.vector_search ? ' + vetor' : ''}${log.bvs_search ? ' + BVS' : ''})`);
      }
    }

    const acceptedByText   = logs.filter((l) => l.outcome === 'accepted' && l.search_method === 'text').length;
    const acceptedByVector = logs.filter((l) => l.outcome === 'accepted' && l.search_method === 'vector').length;
    const acceptedByBvs    = logs.filter((l) => l.outcome === 'accepted' && l.search_method === 'bvs').length;
    const noCandidate      = logs.filter((l) => l.outcome === 'no_candidate').length;
    const deduped          = logs.filter((l) => l.outcome === 'deduped').length;

    console.error(`\n📊 Resumo:`);
    console.error(`   Aceitos via texto  : ${acceptedByText}`);
    console.error(`   Aceitos via vetor  : ${acceptedByVector}`);
    console.error(`   Aceitos via BVS    : ${acceptedByBvs}`);
    console.error(`   Sem candidato      : ${noCandidate}`);
    console.error(`   Deduplicados       : ${deduped}`);
    console.error(`   Total de descritores finais: ${descriptors.length}\n`);

    const artifact = {
      result: descriptors.map(({ similarity: _s, ...rest }) => rest),
      themes_identified: themes,
      pipeline_stats: {
        primary_terms:    themes.primary.length,
        secondary_terms:  themes.secondary.length,
        accepted_by_text:   acceptedByText,
        accepted_by_vector: acceptedByVector,
        accepted_by_bvs:    acceptedByBvs,
        no_candidate:       noCandidate,
        deduped:            deduped,
        final_count:        descriptors.length,
      },
    };

    if (args.save) {
      if (!args.id) throw new Error('--save requer --id (não é possível salvar com --text).');
      await saveResult(pool, args.id, artifact.result, artifact);
      console.error(`💾 Salvo em questions.ai_decs_descriptors (id=${args.id}) e decs_classification_runs`);
    }

    const outFile = args.out ?? `exports/decs-pipeline-v1-run-${args.id ?? Date.now()}.json`;
    const document = {
      metadata: {
        generated_at:  new Date().toISOString(),
        question_id:   args.id ? parseInt(args.id) : null,
        question_text: questionText,
        classifier_model: classifierAgent.model,
        search_order:  'texto (entry_terms/name_pt) → vetor (cosseno, gemini-embedding-001) → BVS API (se DECS_API_KEY definida)',
        thresholds: {
          min_text_similarity:   args.minTextSimilarity,
          min_vector_similarity: args.minVectorSimilarity,
          text_limit:             args.textLimit,
          vector_limit:           args.vectorLimit,
        },
      },
      themes_identified: themes,
      term_resolution_log: logs,
      pipeline_stats: artifact.pipeline_stats,
      result: artifact.result,
    };

    const outDir = path.dirname(outFile);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(document, null, 2) + '\n', 'utf-8');
    console.error(`📄 Exportado: ${outFile}`);

    if (args.json) process.stdout.write(JSON.stringify(document, null, 2) + '\n');

  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error('\n💥 Fatal:', e.message); process.exit(1); });

// ─────────────────────────────────────────────────────────────────────────────
// RACIOCÍNIO DO PIPELINE (resumo)
// ─────────────────────────────────────────────────────────────────────────────
//
// 1. O agente decs_classifier (mesmo do botão "Gerar V1") lê o enunciado e as
//    alternativas e devolve {primary, secondary} — temas médicos centrais e de apoio.
//
// 2. Para CADA termo, a busca TEXTUAL roda primeiro (prioridade pedida):
//      - ILIKE contra name_pt e entry_terms (mesma tabela/consulta de
//        decs-entry-terms-search.mjs, sem exigir GEMINI_API_KEY nessa etapa).
//      - Um candidato só é aceito se: (a) match exato normalizado em
//        entry_terms/nome, OU (b) similaridade de Jaccard (termo × nome do
//        descritor) ≥ --min-text-similarity; E (c) passar no filtro de
//        categoria de lib/decs-pipeline.ts (isCategoryAcceptable — descarta
//        organismos da categoria B sem contexto de infecção/microbiologia
//        na questão). O item (c) é a checagem de "coerência com a questão".
//
// 3. Se a busca textual não encontrar candidato bom o suficiente ou coerente,
//    cai no fallback VETORIAL: o termo é vetorizado com gemini-embedding-001
//    (mesma chamada de decs-embed-search.mjs, sem taskType — compatível com os
//    embeddings já gravados em decs_descriptors) e comparado por cosseno via
//    halfvec (mesmo índice/consulta de decs-entry-terms-search.mjs --vector).
//    O mesmo filtro de categoria é reaplicado.
//
// 4. Como rede de segurança final (fidelidade ao pipeline original, que sempre
//    teve a API do BVS como fallback), se DECS_API_KEY estiver configurada e
//    nem texto nem vetor resolverem, tenta a API pública do BVS.
//
// 5. Deduplicação por código do descritor: o primeiro termo a "reivindicar"
//    um código vence; termos primary são processados antes dos secondary,
//    preservando a mesma prioridade de lib/decs-pipeline.ts.
//
// 6. Diferença deliberada em relação a lib/decs-pipeline.ts: lá a ORDEM é
//    vetor→BVS (texto nunca é tentado isoladamente). Aqui a ordem é
//    texto→vetor→BVS, por pedido explícito, pois entry_terms/name_pt costuma
//    achar o descritor exato mais rápido e sem custo de API quando o termo do
//    Gemini já corresponde a um sinônimo cadastrado — reservando a busca
//    vetorial (mais cara e mais "nebulosa") para os casos em que o termo não
//    tem correspondência textual direta ou boa o bastante.
//
// 7. Cada descritor aceito carrega `branches`: TODAS as ramificações
//    (tree_numbers) a que ele pertence, resolvidas via buildBranches — não
//    apenas a primeira, como `hierarchy_path` mostra isoladamente.
// ─────────────────────────────────────────────────────────────────────────────
//
// MODO DE USO
// ─────────────────────────────────────────────────────────────────────────────
//
//   node --env-file=.env.local scripts/decs-pipeline-v1-run.mjs --id <question_id> [opções]
//   node --env-file=.env.local scripts/decs-pipeline-v1-run.mjs --text "<enunciado completo>" [opções]
//
// ─────────────────────────────────────────────────────────────────────────────
// FUNCIONALIDADES (opções)
// ─────────────────────────────────────────────────────────────────────────────
//
//   Opção                        Padrão                                Descrição
//   ────────────────────────────────────────────────────────────────────────────
//   --id <n>                     —        ID da questão (busca statement + alternativas no banco)
//   --text "<texto>"             —        Texto livre da questão (alternativa a --id)
//   --min-text-similarity <f>    0.5      Jaccard mínimo termo×descritor para aceitar via texto
//   --min-vector-similarity <f>  0.6      Similaridade coseno mínima para aceitar via vetor
//   --text-limit <n>             200      Máx. candidatos na busca textual
//   --vector-limit <n>           200      Máx. candidatos na busca vetorial
//   --save                       (não)    Grava em questions.ai_decs_descriptors + decs_classification_runs (requer --id)
//   --json                       (não)    Saída em JSON puro (para piping)
//   --out <arquivo>              auto     Caminho de exportação (padrão: exports/decs-pipeline-v1-run-<id|ts>.json)
//
// ─────────────────────────────────────────────────────────────────────────────
// COMANDOS DISPONÍVEIS
// ─────────────────────────────────────────────────────────────────────────────
//
// ── Rodar a partir de uma questão já cadastrada no banco ──────────────────────
//
//   node --env-file=.env.local scripts/decs-pipeline-v1-run.mjs --id 42
//   node --env-file=.env.local scripts/decs-pipeline-v1-run.mjs --id 42 --json
//   node --env-file=.env.local scripts/decs-pipeline-v1-run.mjs --id 42 --save
//
// ── Rodar a partir de um texto livre (sem gravar nada, sem precisar de --id) ──
//
//   node --env-file=.env.local scripts/decs-pipeline-v1-run.mjs --text "Paciente com dispneia e febre, com foco em tuberculose pulmonar"
//
// ── Ajustando limiares e limites de busca ──────────────────────────────────────
//
//   node --env-file=.env.local scripts/decs-pipeline-v1-run.mjs --id 42 --min-text-similarity 0.6
//   node --env-file=.env.local scripts/decs-pipeline-v1-run.mjs --id 42 --min-vector-similarity 0.7 --vector-limit 8
//   node --env-file=.env.local scripts/decs-pipeline-v1-run.mjs --id 42 --text-limit 10
//
// ── Exportando para um arquivo específico ──────────────────────────────────────
//
//   node --env-file=.env.local scripts/decs-pipeline-v1-run.mjs --id 42 --out exports/questao-42-v1.json
//
// ─────────────────────────────────────────────────────────────────────────────
