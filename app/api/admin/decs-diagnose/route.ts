/**
 * POST /api/admin/decs-diagnose
 *
 * Executa o pipeline V1 ou V2 passo a passo para uma questão específica,
 * retornando o trace completo de cada etapa com entradas e saídas.
 *
 * Body: { questionId: number, pipeline: 'v1' | 'v2' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

export const runtime = 'nodejs';
export const maxDuration = 120;

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const BIO_RE = /\b(vírus|virus|bactéria|bacteria|bacilo|fungo|parasita|microbiol|infectol|viral|antibiótic|antibiotic|vacin|patógen|prion|rickettsia|protozoár|helmint)\b/i;

// ── Auth ────────────────────────────────────────────────────────────────────

function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  if (!token) return null;
  return verifyToken(token);
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function buildQuestionText(q: Record<string, unknown>): string {
  return [
    'Enunciado:',
    q.statement as string,
    '',
    'Alternativa A: ' + (q.option_a as string || ''),
    'Alternativa B: ' + (q.option_b as string || ''),
    q.option_c ? 'Alternativa C: ' + (q.option_c as string) : null,
    q.option_d ? 'Alternativa D: ' + (q.option_d as string) : null,
    q.option_e ? 'Alternativa E: ' + (q.option_e as string) : null,
  ].filter(Boolean).join('\n');
}

async function loadAgent(key: string) {
  try {
    const res = await query(`SELECT system_prompt, model FROM ai_agents WHERE key = $1`, [key]);
    if (res.rows[0]?.system_prompt) {
      return { prompt: res.rows[0].system_prompt as string, model: (res.rows[0].model as string) || 'gemini-2.5-flash', source: 'banco de dados' };
    }
  } catch {}
  return { prompt: '', model: 'gemini-2.5-flash', source: 'padrão embutido' };
}

async function callGemini(model: string, systemPrompt: string, userMessage: string, geminiKey: string) {
  const t0 = Date.now();
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${geminiKey}`;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as any;
  const rawText: string = (data?.candidates?.[0]?.content?.parts || [])
    .filter((p: Record<string, unknown>) => !p?.thought)
    .map((p: Record<string, unknown>) => p?.text)
    .filter(Boolean)
    .join('') ?? '';
  const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  return { parsed: JSON.parse(cleaned), raw: cleaned, elapsed_ms: elapsed };
}

function isCategoryAcceptable(treeIds: string[], questionText: string): boolean {
  if (!treeIds?.length) return true;
  const cats = treeIds.map(t => t.split('.')[0].replace(/[0-9]/g, ''));
  if (!cats.every(c => c === 'B')) return true;
  return BIO_RE.test(questionText);
}

async function searchDeCSLocal(term: string, geminiKey: string, minSimilarity = 0.6, limit = 5) {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const embedData = await embedRes.json() as any;
    const vec: number[] = embedData?.embedding?.values;
    if (!vec) return [];
    const vecStr = `[${vec.join(',')}]`;
    const res = await query(
      `SELECT ui AS code, name_pt AS term, name_en, scope_note, tree_numbers,
              1 - (embedding::halfvec(3072) <=> $1::halfvec(3072)) AS similarity
       FROM decs_descriptors
       WHERE embedding IS NOT NULL
         AND (1 - (embedding::halfvec(3072) <=> $1::halfvec(3072))) >= $2
       ORDER BY embedding::halfvec(3072) <=> $1::halfvec(3072)
       LIMIT $3`,
      [vecStr, minSimilarity, limit]
    );
    return res.rows.map(r => ({
      code: r.code as string,
      term: r.term as string,
      name_en: r.name_en as string | undefined,
      scope_note: r.scope_note as string | undefined,
      tree_ids: Array.isArray(r.tree_numbers) ? r.tree_numbers as string[] : JSON.parse((r.tree_numbers as string) || '[]'),
      similarity: parseFloat(r.similarity as string),
      source: 'pgvector' as const,
    }));
  } catch {
    return [];
  }
}

async function searchDeCSByText(term: string, limit = 5) {
  try {
    const res = await query(
      `SELECT ui AS code, name_pt AS term, name_en, scope_note, tree_numbers
       FROM decs_descriptors
       WHERE name_pt ILIKE $1 OR name_en ILIKE $1
       ORDER BY CASE WHEN LOWER(name_pt) = LOWER($2) THEN 0 WHEN name_pt ILIKE $2 THEN 1 ELSE 2 END
       LIMIT $3`,
      [`%${term.trim()}%`, term.trim(), limit]
    );
    return res.rows.map(r => ({
      code: r.code as string,
      term: r.term as string,
      name_en: r.name_en as string | undefined,
      scope_note: r.scope_note as string | undefined,
      tree_ids: Array.isArray(r.tree_numbers) ? r.tree_numbers as string[] : JSON.parse((r.tree_numbers as string) || '[]'),
      source: 'texto' as const,
    }));
  } catch {
    return [];
  }
}

async function searchDeCSBVS(term: string, decsKey: string, limit = 5) {
  if (!decsKey) return [];
  try {
    const url = `https://api.bvsalud.org/decs/v2/search-by-words?words=${encodeURIComponent(term)}&lang=pt&format=json`;
    const res = await fetch(url, { headers: { apikey: decsKey }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    const objects = data?.objects;
    if (!Array.isArray(objects) || !objects[0]) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records: any[] = [objects[0]?.decsws_response?.record_list?.record].flat(3).filter(Boolean).slice(0, limit);
    return records.map(rec => {
      const descs = [rec.descriptor_list].flat(3) as Record<string, unknown>[];
      let termPt = '';
      for (const lang of ['pt-br', 'pt']) {
        const f = descs.find(d => (d?.attr as Record<string, string>)?.lang === lang);
        if (f?.descriptor) { termPt = String(f.descriptor).trim(); break; }
      }
      const treeList = [rec.tree_id_list].flat(3) as Record<string, unknown>[];
      const tree_ids = treeList.map(t => String((t as Record<string, unknown>)?.tree_id || '')).filter(Boolean);
      return { code: String(rec.attr?.mfn || ''), term: termPt, tree_ids, source: 'API BVS' as const };
    }).filter(r => r.term);
  } catch {
    return [];
  }
}

// ── V1 trace ────────────────────────────────────────────────────────────────

async function runV1Trace(question: Record<string, unknown>, geminiKey: string, decsKey: string) {
  const questionText = buildQuestionText(question);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const steps: any[] = [];

  // Step 1 — Classifier
  const classifierAgent = await loadAgent('decs_classifier');
  let themes: { primary: string[]; secondary: string[] } = { primary: [], secondary: [] };
  let step1Error: string | null = null;
  let step1Ms = 0;
  try {
    const { parsed, elapsed_ms } = await callGemini(classifierAgent.model, classifierAgent.prompt, questionText, geminiKey);
    step1Ms = elapsed_ms;
    themes.primary = (Array.isArray(parsed?.primary) ? parsed.primary as string[] : []).filter(t => typeof t === 'string').slice(0, 3);
    themes.secondary = (Array.isArray(parsed?.secondary) ? parsed.secondary as string[] : []).filter(t => typeof t === 'string').slice(0, 6);
  } catch (e) {
    step1Error = (e as Error).message;
  }
  steps.push({
    step: 1,
    title: 'Extração de temas (Gemini — decs_classifier)',
    agent: { key: 'decs_classifier', model: classifierAgent.model, source: classifierAgent.source },
    input_preview: questionText.slice(0, 400),
    output: { themes_primary: themes.primary, themes_secondary: themes.secondary },
    elapsed_ms: step1Ms,
    error: step1Error,
    status: step1Error ? 'error' : themes.primary.length > 0 ? 'ok' : 'empty',
  });

  if (themes.primary.length === 0) {
    return { pipeline: 'v1', question_id: question.id, steps, final: null, error: 'Nenhum tema extraído na etapa 1' };
  }

  // Step 2 — Search candidates
  const allTerms = [
    ...themes.primary.map(t => ({ term: t, role: 'primary' as const })),
    ...themes.secondary.map(t => ({ term: t, role: 'secondary' as const })),
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const termResults: any[] = [];
  for (const { term, role } of allTerms) {
    let candidates: ReturnType<typeof searchDeCSLocal> extends Promise<infer T> ? T : never = [];
    let searchSource = '';
    let filterRemoved = 0;

    const local = await searchDeCSLocal(term, geminiKey, 0.6, 5);
    const localFiltered = local.filter(c => isCategoryAcceptable(c.tree_ids, questionText));
    filterRemoved += local.length - localFiltered.length;

    if (localFiltered.length > 0) {
      candidates = localFiltered;
      searchSource = 'pgvector';
    } else {
      const bvs = await searchDeCSBVS(term, decsKey, 5);
      const bvsFiltered = bvs.filter(c => isCategoryAcceptable(c.tree_ids, questionText));
      filterRemoved += bvs.length - bvsFiltered.length;
      candidates = bvsFiltered as unknown as typeof candidates;
      searchSource = bvsFiltered.length > 0 ? 'API BVS' : 'nenhum';
    }

    termResults.push({
      term, role, search_source: searchSource,
      candidates_found: local.length || 0,
      category_filtered_out: filterRemoved,
      accepted: candidates.map(c => ({ code: c.code, term: c.term, tree_ids: c.tree_ids?.slice(0, 2), similarity: (c as { similarity?: number }).similarity })),
    });
  }
  steps.push({
    step: 2,
    title: 'Busca de candidatos DeCS (pgvector → API BVS)',
    input: { terms_searched: allTerms.map(t => t.term) },
    output: { term_results: termResults },
    status: termResults.some(t => t.accepted.length > 0) ? 'ok' : 'empty',
  });

  // Step 3 — Enrich + dedup
  const seenCodes = new Set<string>();
  const flatCandidates = termResults.flatMap(r => r.accepted.map((c: Record<string, unknown>) => ({ ...c, role: r.role })));
  const enrichInput = flatCandidates.filter(c => c.code);
  const codes = enrichInput.map(c => c.code as string);
  let enriched: Record<string, { name_en?: string; scope_note?: string }>= {};
  try {
    const res = await query(`SELECT ui, name_en, scope_note FROM decs_descriptors WHERE ui = ANY($1)`, [codes]);
    enriched = Object.fromEntries(res.rows.map(r => [r.ui, { name_en: r.name_en, scope_note: r.scope_note }]));
  } catch {}

  const deduped = flatCandidates.filter((c: Record<string, unknown>) => {
    const code = c.code as string;
    if (seenCodes.has(code)) return false;
    seenCodes.add(code);
    return true;
  }).map((c: Record<string, unknown>) => ({
    ...c,
    ...(enriched[c.code as string] || {}),
  }));

  steps.push({
    step: 3,
    title: 'Enriquecimento e deduplicação',
    input: { candidates_before: flatCandidates.length },
    output: {
      enriched_count: Object.keys(enriched).length,
      deduped_count: deduped.length,
      duplicates_removed: flatCandidates.length - deduped.length,
      candidates: deduped.map((c: Record<string, unknown>) => ({
        code: c.code, term: c.term, role: c.role,
        has_scope_note: !!(c as { scope_note?: string }).scope_note,
      })),
    },
    status: deduped.length > 0 ? 'ok' : 'empty',
  });

  // Step 4 — Gemini validation
  const validatorAgent = await loadAgent('decs_validator');
  const candidateList = deduped.map((d: Record<string, unknown>) => ({
    code: d.code, term: d.term,
    scope: (d as { scope_note?: string }).scope_note ? (d.scope_note as string).slice(0, 180) : undefined,
    categoria: ((d.tree_ids as string[] | undefined)?.[0] || '').split('.')[0],
  }));

  let validated = deduped;
  let step4Error: string | null = null;
  let step4Ms = 0;
  let approvedCodes: string[] = [];
  let rejectedCodes: string[] = [];
  try {
    const userMsg = `Questão:\n${questionText}\n\nCandidatos:\n${JSON.stringify(candidateList, null, 2)}`;
    const { parsed, elapsed_ms } = await callGemini(validatorAgent.model, validatorAgent.prompt, userMsg, geminiKey);
    step4Ms = elapsed_ms;
    if (Array.isArray(parsed)) {
      const approvedSet = new Set(parsed.map(String));
      approvedCodes = parsed.map(String);
      rejectedCodes = deduped.filter((d: Record<string, unknown>) => !approvedSet.has(d.code as string)).map((d: Record<string, unknown>) => d.code as string);
      const filtered = deduped.filter((d: Record<string, unknown>) => approvedSet.has(d.code as string));
      if (filtered.length > 0) validated = filtered;
    }
  } catch (e) {
    step4Error = (e as Error).message;
  }
  steps.push({
    step: 4,
    title: 'Validação pelo Gemini (decs_validator)',
    agent: { key: 'decs_validator', model: validatorAgent.model, source: validatorAgent.source },
    input: { candidates_sent: candidateList.length },
    output: {
      approved_codes: approvedCodes,
      rejected_codes: rejectedCodes,
      final_count: validated.length,
    },
    elapsed_ms: step4Ms,
    error: step4Error,
    status: step4Error ? 'error' : 'ok',
  });

  const final = {
    primary: validated.filter((d: Record<string, unknown>) => d.role === 'primary').map((d: Record<string, unknown>) => ({ code: d.code, term: d.term })),
    secondary: validated.filter((d: Record<string, unknown>) => d.role !== 'primary').map((d: Record<string, unknown>) => ({ code: d.code, term: d.term })),
  };

  return { pipeline: 'v1', question_id: question.id, steps, final };
}

// ── V2 trace ────────────────────────────────────────────────────────────────

async function runV2Trace(question: Record<string, unknown>, geminiKey: string, decsKey: string) {
  const questionText = buildQuestionText(question);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const steps: any[] = [];

  // Step 1 — Indexer
  const indexerAgent = await loadAgent('decs_indexer_v2');
  let themes: { primary: string[]; secondary: string[] } = { primary: [], secondary: [] };
  let step1Error: string | null = null;
  let step1Ms = 0;
  try {
    const { parsed, elapsed_ms } = await callGemini(indexerAgent.model, indexerAgent.prompt, questionText, geminiKey);
    step1Ms = elapsed_ms;
    themes.primary = (Array.isArray(parsed?.primary) ? parsed.primary as string[] : []).filter(t => typeof t === 'string').slice(0, 3);
    themes.secondary = (Array.isArray(parsed?.secondary) ? parsed.secondary as string[] : []).filter(t => typeof t === 'string').slice(0, 6);
  } catch (e) {
    step1Error = (e as Error).message;
  }
  steps.push({
    step: 1,
    title: 'Extração de conceitos semânticos (Gemini — decs_indexer_v2)',
    agent: { key: 'decs_indexer_v2', model: indexerAgent.model, source: indexerAgent.source },
    input_preview: questionText.slice(0, 400),
    output: { themes_primary: themes.primary, themes_secondary: themes.secondary },
    elapsed_ms: step1Ms,
    error: step1Error,
    status: step1Error ? 'error' : themes.primary.length > 0 ? 'ok' : 'empty',
  });

  if (themes.primary.length === 0) {
    return { pipeline: 'v2', question_id: question.id, steps, final: null, error: 'Nenhum conceito extraído na etapa 1' };
  }

  // Step 2+3 — Search + enrich per concept
  const allConcepts = [
    ...themes.primary.map(t => ({ term: t, role: 'primary' as const })),
    ...themes.secondary.map(t => ({ term: t, role: 'secondary' as const })),
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conceptResults: any[] = [];

  for (const { term, role } of allConcepts) {
    let candidates: Array<{ code: string; term: string; name_en?: string; scope_note?: string; tree_ids: string[]; source: string; similarity?: number }> = [];
    let searchPath = '';

    const local = await searchDeCSLocal(term, geminiKey, 0.55, 5);
    const localFiltered = local.filter(c => isCategoryAcceptable(c.tree_ids, questionText));
    if (localFiltered.length > 0) {
      candidates = localFiltered;
      searchPath = 'pgvector';
    } else {
      const text = await searchDeCSByText(term, 5);
      const textFiltered = text.filter(c => isCategoryAcceptable(c.tree_ids, questionText));
      if (textFiltered.length > 0) {
        candidates = textFiltered;
        searchPath = 'texto';
      } else {
        const bvs = await searchDeCSBVS(term, decsKey, 5);
        candidates = bvs.filter(c => isCategoryAcceptable(c.tree_ids, questionText));
        searchPath = candidates.length > 0 ? 'API BVS' : 'nenhum';
      }
    }

    // Enrich
    const needEnrich = candidates.filter(c => !c.scope_note && c.code);
    if (needEnrich.length > 0) {
      try {
        const res = await query(`SELECT ui, name_en, scope_note FROM decs_descriptors WHERE ui = ANY($1)`, [needEnrich.map(c => c.code)]);
        const map = new Map(res.rows.map(r => [r.ui, { name_en: r.name_en, scope_note: r.scope_note }]));
        candidates = candidates.map(c => ({ ...c, ...(map.get(c.code) || {}) }));
      } catch {}
    }

    conceptResults.push({
      term, role, search_path: searchPath,
      local_found: local.length,
      local_after_filter: localFiltered.length,
      candidates: candidates.slice(0, 5).map(c => ({
        code: c.code, term: c.term, source: c.source,
        similarity: c.similarity,
        has_scope_note: !!c.scope_note,
        tree_ids: c.tree_ids?.slice(0, 2),
      })),
    });
  }

  steps.push({
    step: 2,
    title: 'Busca e enriquecimento de candidatos por conceito (pgvector → texto → API BVS)',
    input: { concepts_searched: allConcepts.map(c => `${c.term} (${c.role})`) },
    output: { concept_results: conceptResults },
    status: conceptResults.some(c => c.candidates.length > 0) ? 'ok' : 'empty',
  });

  // Step 3 — Selector
  const selectorAgent = await loadAgent('decs_selector_v2');
  const candidatesWithData = Object.fromEntries(conceptResults.map(cr => [cr.term, cr.candidates]));
  const contextInput = {
    questao: questionText.slice(0, 1500),
    temas_primarios: conceptResults.filter(c => c.role === 'primary').map(c => ({
      conceito_buscado: c.term,
      candidatos: c.candidates.map((x: Record<string, unknown>) => ({ id: x.code, term: x.term })),
    })),
    temas_secundarios: conceptResults.filter(c => c.role === 'secondary').map(c => ({
      conceito_buscado: c.term,
      candidatos: c.candidates.map((x: Record<string, unknown>) => ({ id: x.code, term: x.term })),
    })),
  };

  let selected: { primary: Array<{ code: string; term: string }>; secondary: Array<{ code: string; term: string }> } = { primary: [], secondary: [] };
  let step3Error: string | null = null;
  let step3Ms = 0;
  let rawSelectorOutput: unknown = null;
  try {
    const { parsed, elapsed_ms } = await callGemini(selectorAgent.model, selectorAgent.prompt, JSON.stringify(contextInput, null, 2), geminiKey);
    step3Ms = elapsed_ms;
    rawSelectorOutput = parsed;
    const allCandMap = new Map(conceptResults.flatMap(cr => cr.candidates).map((c: Record<string, unknown>) => [c.code, c]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    selected.primary = (parsed?.decs_primary || []).map((x: any) => allCandMap.get(x.id)).filter(Boolean) as Array<{ code: string; term: string }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    selected.secondary = (parsed?.decs_secondary || []).map((x: any) => allCandMap.get(x.id)).filter(Boolean) as Array<{ code: string; term: string }>;
  } catch (e) {
    step3Error = (e as Error).message;
  }
  steps.push({
    step: 3,
    title: 'Seleção do melhor descritor por conceito (Gemini — decs_selector_v2)',
    agent: { key: 'decs_selector_v2', model: selectorAgent.model, source: selectorAgent.source },
    input: { context_summary: contextInput.temas_primarios.map((t: Record<string, unknown>) => t.conceito_buscado) },
    output: {
      gemini_raw: rawSelectorOutput,
      selected_primary: selected.primary.map(d => ({ code: d.code, term: d.term })),
      selected_secondary: selected.secondary.map(d => ({ code: d.code, term: d.term })),
    },
    elapsed_ms: step3Ms,
    error: step3Error,
    status: step3Error ? 'error' : 'ok',
  });

  // Step 4 — Hierarchy
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hierarchyResults: any[] = [];
  for (const d of [...selected.primary, ...selected.secondary].slice(0, 8)) {
    const code = (d as Record<string, unknown>).code as string;
    const term = (d as Record<string, unknown>).term as string;
    const treeIds: string[] = (candidatesWithData[term] || [])
      .find((c: Record<string, unknown>) => c.code === code)?.tree_ids || [];
    const parents: Array<{ id: string; term: string }> = [];
    const children: Array<{ id: string; term: string }> = [];
    try {
      for (const treeId of treeIds.slice(0, 2)) {
        const parts = treeId.split('.');
        if (parts.length > 1) {
          const parentPath = parts.slice(0, -1).join('.');
          const pr = await query(`SELECT ui, name_pt FROM decs_descriptors WHERE tree_numbers @> $1::jsonb LIMIT 1`, [JSON.stringify([parentPath])]);
          if (pr.rows[0]) parents.push({ id: pr.rows[0].ui, term: pr.rows[0].name_pt });
        }
        const cr = await query(`SELECT ui, name_pt FROM decs_descriptors WHERE tree_numbers::text LIKE $1 AND ui != $2 LIMIT 3`, [`%"${treeId}.%`, code]);
        cr.rows.forEach(r => children.push({ id: r.ui, term: r.name_pt }));
      }
    } catch {}
    hierarchyResults.push({ code, term, tree_ids: treeIds.slice(0, 2), parents, children });
  }
  steps.push({
    step: 4,
    title: 'Resolução de hierarquia (pais e filhos no banco)',
    input: { descriptors: hierarchyResults.map(d => d.term) },
    output: { hierarchy: hierarchyResults },
    status: 'ok',
  });

  const final = {
    primary: selected.primary.map(d => ({ code: (d as Record<string, unknown>).code, term: (d as Record<string, unknown>).term })),
    secondary: selected.secondary.map(d => ({ code: (d as Record<string, unknown>).code, term: (d as Record<string, unknown>).term })),
  };

  return { pipeline: 'v2', question_id: question.id, steps, final };
}

// ── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = getUser(req);
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  const decsKey = process.env.DECS_API_KEY?.trim() || '';
  if (!geminiKey) return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 });

  let body: { questionId?: number; pipeline?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const { questionId, pipeline = 'v1' } = body;
  if (!questionId) return NextResponse.json({ error: 'questionId obrigatório' }, { status: 400 });
  if (pipeline !== 'v1' && pipeline !== 'v2') return NextResponse.json({ error: 'pipeline deve ser v1 ou v2' }, { status: 400 });

  const { rows } = await query(
    `SELECT id, statement, option_a, option_b, option_c, option_d, option_e,
            exam_board, exam_year, exam_institution
     FROM questions WHERE id = $1`, [questionId]
  );
  if (!rows[0]) return NextResponse.json({ error: `Questão #${questionId} não encontrada` }, { status: 404 });

  try {
    const result = pipeline === 'v1'
      ? await runV1Trace(rows[0], geminiKey, decsKey)
      : await runV2Trace(rows[0], geminiKey, decsKey);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
