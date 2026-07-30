import { buildHierarchyPath, wordJaccard, type DeCSRecord, type DeCSThemes } from '@/lib/decs-pipeline';
import { buildGeminiRestUserParts } from '@/lib/gemini-question-images';
import {
  buildAgentTokenUsage,
  type AgentTokenUsage,
} from '@/lib/gemini-token-usage';

export interface ValidationItemScore {
  code: string;
  term: string;
  coerencia: number;
  aprovado: boolean;
  motivo: string;
  search_method?: 'text' | 'vector' | 'bvs';
}

export interface QuestionTermsValidationResult {
  approved: DeCSRecord[];
  rejected: DeCSRecord[];
  items: ValidationItemScore[];
  coerencia_geral: number;
  themes: DeCSThemes;
  candidates_considered: number;
  skipped_textual: number;
  agent: 'question_terms_validator';
  needs_manual_review?: boolean;
  review_reason?: string;
  is_coherent?: boolean;
  missing_primary_terms?: boolean;
  token_usage?: AgentTokenUsage;
}

function clampPct(n: unknown): number {
  const v = typeof n === 'number' ? n : parseFloat(String(n ?? ''));
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Coerência heurística: melhor Jaccard do descritor vs termos Gemini (0–100). */
export function heuristicCoherence(
  descriptor: DeCSRecord,
  themes: DeCSThemes,
): number {
  const refs = [...(themes.primary ?? []), ...(themes.secondary ?? [])];
  if (refs.length === 0) return 0;
  let best = 0;
  for (const ref of refs) {
    best = Math.max(
      best,
      wordJaccard(descriptor.term, ref),
      descriptor.name_en ? wordJaccard(descriptor.name_en, ref) : 0,
    );
  }
  return clampPct(best * 100);
}

/**
 * Filtra apenas descritores vindos de busca vetorial ou API BVS.
 * Itens sem search_method (legado) entram na validação (tratados como vector/bvs).
 */
export function filterVectorOrApiDescriptors(descriptors: DeCSRecord[]): {
  eligible: DeCSRecord[];
  skipped_textual: DeCSRecord[];
} {
  const eligible: DeCSRecord[] = [];
  const skipped_textual: DeCSRecord[] = [];
  for (const d of descriptors) {
    if (d.search_method === 'text') {
      skipped_textual.push(d);
    } else {
      eligible.push(d);
    }
  }
  return { eligible, skipped_textual };
}

function parseValidatorPayload(
  rawText: string,
  candidates: DeCSRecord[],
  themes: DeCSThemes,
): {
  items: ValidationItemScore[];
  approvedCodes: Set<string>;
  coerencia_geral: number;
  needs_manual_review?: boolean;
  review_reason?: string;
  is_coherent?: boolean;
  missing_primary_terms?: boolean;
} {
  const cleaned = rawText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const byCode = new Map(candidates.map((c) => [c.code, c]));

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = null;
  }

  // Legacy: plain array of codes
  if (Array.isArray(parsed)) {
    const approvedCodes = new Set(parsed.map(String));
    const items: ValidationItemScore[] = candidates.map((c) => {
      const coerencia = heuristicCoherence(c, themes);
      const aprovado = approvedCodes.has(c.code);
      return {
        code: c.code,
        term: c.term,
        coerencia,
        aprovado,
        motivo: aprovado
          ? 'Aprovado pelo validador'
          : 'Rejeitado pelo validador',
        search_method: c.search_method,
      };
    });
    const approvedItems = items.filter((i) => i.aprovado);
    const coerencia_geral =
      approvedItems.length > 0
        ? clampPct(
            approvedItems.reduce((s, i) => s + i.coerencia, 0) /
              approvedItems.length,
          )
        : 0;
    return { items, approvedCodes, coerencia_geral };
  }

  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;

    // Formato do agente em produção (ai_agents.question_terms_validator):
    // { validation_status, taxonomy_audit, final_decs_tags: [{term,type,justification}] }
    if (Array.isArray(obj.final_decs_tags) || obj.validation_status) {
      const status = (obj.validation_status ?? {}) as Record<string, unknown>;
      const finalTags = Array.isArray(obj.final_decs_tags)
        ? (obj.final_decs_tags as Array<Record<string, unknown>>)
        : [];
      const removed = Array.isArray(
        (obj.taxonomy_audit as Record<string, unknown> | undefined)
          ?.removed_terms,
      )
        ? (
            (obj.taxonomy_audit as Record<string, unknown>)
              .removed_terms as unknown[]
          ).map(String)
        : [];

      const approvedByTerm = new Map<string, Record<string, unknown>>();
      for (const tag of finalTags) {
        const term = String(tag.term ?? '').trim().toLowerCase();
        if (term) approvedByTerm.set(term, tag);
      }

      const approvedCodes = new Set<string>();
      const items: ValidationItemScore[] = candidates.map((c) => {
        const tag = approvedByTerm.get(c.term.trim().toLowerCase());
        const removedHit = removed.some(
          (r) =>
            r.toLowerCase() === c.term.toLowerCase() ||
            r.toLowerCase() === c.code.toLowerCase(),
        );
        const aprovado = Boolean(tag) && !removedHit;
        if (aprovado) approvedCodes.add(c.code);

        const base = heuristicCoherence(c, themes);
        // Ajustes: aprovado ganha piso; rejeitado tem teto
        let coerencia = base;
        if (aprovado) {
          const typeBoost =
            String(tag?.type ?? '').toUpperCase() === 'PRIMARY' ? 15 : 5;
          coerencia = clampPct(Math.max(base, 55) + typeBoost);
        } else {
          coerencia = clampPct(Math.min(base, 45));
        }

        return {
          code: c.code,
          term: c.term,
          coerencia,
          aprovado,
          motivo: tag
            ? String(tag.justification ?? 'Aprovado pelo validador')
            : removedHit
              ? 'Removido na auditoria taxonômica'
              : 'Não homologado pelo validador',
          search_method: c.search_method,
        };
      });

      const approvedItems = items.filter((i) => i.aprovado);
      let coerencia_geral =
        approvedItems.length > 0
          ? clampPct(
              approvedItems.reduce((s, i) => s + i.coerencia, 0) /
                approvedItems.length,
            )
          : clampPct(
              items.length
                ? items.reduce((s, i) => s + i.coerencia, 0) / items.length
                : 0,
            );

      // Incorpora o booleano is_coherent do agente na nota geral
      if (status.is_coherent === true) {
        coerencia_geral = clampPct(Math.max(coerencia_geral, 70));
      } else if (status.is_coherent === false) {
        coerencia_geral = clampPct(Math.min(coerencia_geral, 49));
      }

      // Taxa de aprovação também entra no score geral (média ponderada)
      const approvalRate =
        candidates.length > 0
          ? (approvedItems.length / candidates.length) * 100
          : 0;
      coerencia_geral = clampPct(coerencia_geral * 0.7 + approvalRate * 0.3);

      const hasPrimaryTag = finalTags.some(
        (t) => String(t.type ?? '').toUpperCase() === 'PRIMARY',
      );
      const missingPrimary =
        status.missing_primary_terms === true ||
        (finalTags.length === 0 && candidates.length > 0) ||
        (finalTags.length > 0 && !hasPrimaryTag);

      return {
        items,
        approvedCodes,
        coerencia_geral,
        needs_manual_review:
          status.needs_manual_review === true || missingPrimary,
        review_reason:
          status.review_reason != null
            ? String(status.review_reason)
            : missingPrimary
              ? 'Ausência de termos primários após validação.'
              : undefined,
        is_coherent:
          status.is_coherent === true
            ? true
            : status.is_coherent === false
              ? false
              : undefined,
        missing_primary_terms: missingPrimary,
      };
    }

    // Formato com scores explícitos (defaults / evolução)
    const approvedList = Array.isArray(obj.approved)
      ? obj.approved.map(String)
      : [];
    const approvedCodes = new Set(approvedList);
    const rawItems = Array.isArray(obj.items) ? obj.items : [];

    const itemsFromAgent: ValidationItemScore[] = [];
    for (const raw of rawItems as Array<Record<string, unknown>>) {
      const code = String(raw.code ?? '');
      if (!code || !byCode.has(code)) continue;
      const cand = byCode.get(code)!;
      const aprovado =
        raw.aprovado === true ||
        approvedCodes.has(code) ||
        String(raw.aprovado).toLowerCase() === 'true';
      if (aprovado) approvedCodes.add(code);
      itemsFromAgent.push({
        code,
        term: String(raw.term ?? cand.term),
        coerencia: clampPct(raw.coerencia),
        aprovado,
        motivo: String(raw.motivo ?? ''),
        search_method: cand.search_method,
      });
    }

    const seen = new Set(itemsFromAgent.map((i) => i.code));
    for (const c of candidates) {
      if (seen.has(c.code)) continue;
      const aprovado = approvedCodes.has(c.code);
      itemsFromAgent.push({
        code: c.code,
        term: c.term,
        coerencia: heuristicCoherence(c, themes),
        aprovado,
        motivo: aprovado ? 'Aprovado pelo validador' : 'Não listado pelo agente',
        search_method: c.search_method,
      });
    }

    let coerencia_geral = clampPct(obj.coerencia_geral);
    if (!obj.coerencia_geral && itemsFromAgent.length > 0) {
      const approvedItems = itemsFromAgent.filter((i) => i.aprovado);
      coerencia_geral =
        approvedItems.length > 0
          ? clampPct(
              approvedItems.reduce((s, i) => s + i.coerencia, 0) /
                approvedItems.length,
            )
          : clampPct(
              itemsFromAgent.reduce((s, i) => s + i.coerencia, 0) /
                itemsFromAgent.length,
            );
    }

    return { items: itemsFromAgent, approvedCodes, coerencia_geral };
  }

  // Parse failure — fail-open with heuristic scores, keep all
  const items = candidates.map((c) => ({
    code: c.code,
    term: c.term,
    coerencia: heuristicCoherence(c, themes),
    aprovado: true,
    motivo: 'Falha ao interpretar resposta do validador — mantido (fail-open)',
    search_method: c.search_method,
  }));
  const coerencia_geral =
    items.length > 0
      ? clampPct(items.reduce((s, i) => s + i.coerencia, 0) / items.length)
      : 0;
  return {
    items,
    approvedCodes: new Set(candidates.map((c) => c.code)),
    coerencia_geral,
  };
}

/**
 * Executa o agente question_terms_validator sobre candidatos vector/API.
 */
export async function runQuestionTermsValidation(opts: {
  questionText: string;
  correctAnswer?: string | null;
  themes: DeCSThemes;
  descriptors: DeCSRecord[];
  geminiKey: string;
  /** Imagens da questão (data URLs / base64), quando houver. */
  images?: unknown;
}): Promise<QuestionTermsValidationResult> {
  const { eligible, skipped_textual } = filterVectorOrApiDescriptors(
    opts.descriptors,
  );

  if (eligible.length === 0) {
    return {
      approved: [],
      rejected: [],
      items: [],
      coerencia_geral: 0,
      themes: opts.themes,
      candidates_considered: 0,
      skipped_textual: skipped_textual.length,
      agent: 'question_terms_validator',
      needs_manual_review: true,
      review_reason:
        'Nenhum descritor vetorial/API disponível para validação (apenas textuais ou lista vazia).',
    };
  }

  const candidateList = eligible.map((d) => ({
    code: d.code,
    term: d.term,
    term_en: d.name_en ?? undefined,
    scope: d.scope_note ? d.scope_note.substring(0, 180) : undefined,
    categoria: buildHierarchyPath(d.tree_ids[0] ?? '').split(' › ')[0],
    search_method: d.search_method ?? 'vector',
    role: d.role,
  }));

  const userMessage = [
    'Questão completa:',
    opts.questionText,
    '',
    opts.correctAnswer
      ? `Gabarito (alternativa correta): ${String(opts.correctAnswer).trim().toUpperCase()}`
      : 'Gabarito: (não informado)',
    '',
    'Termos parciais do Gemini:',
    JSON.stringify(opts.themes, null, 2),
    '',
    'Candidatos DeCS (apenas busca vetorial ou API BVS):',
    JSON.stringify(candidateList, null, 2),
  ].join('\n');

  const { getRuntimeAgent } = await import('@/lib/ai-agent-runtime');
  const validator = await getRuntimeAgent('question_terms_validator');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${validator.model}:generateContent?key=${opts.geminiKey}`;
  const body = {
    system_instruction: { parts: [{ text: validator.system_instruction }] },
    contents: [
      {
        role: 'user',
        parts: buildGeminiRestUserParts(userMessage, opts.images),
      },
    ],
    generationConfig: {
      temperature: validator.temperature,
      maxOutputTokens: validator.max_output_tokens,
      responseMimeType: 'application/json',
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Falha no question_terms_validator (HTTP ${res.status}): ${errText.slice(0, 200)}`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;
  const token_usage = buildAgentTokenUsage(
    'question_terms_validator',
    validator.model,
    data,
  );
  const rawText: string =
    data?.candidates?.[0]?.content?.parts
      ?.filter((p: Record<string, unknown>) => !p?.thought)
      ?.map((p: Record<string, unknown>) => p?.text)
      .filter(Boolean)
      .join('') ?? '';

  const { items, approvedCodes, coerencia_geral, needs_manual_review, review_reason, is_coherent, missing_primary_terms } =
    parseValidatorPayload(rawText, eligible, opts.themes);

  const approved = eligible.filter((d) => approvedCodes.has(d.code));
  const rejected = eligible.filter((d) => !approvedCodes.has(d.code));

  const missingPrimary = missing_primary_terms === true;

  return {
    approved,
    rejected,
    items,
    coerencia_geral,
    themes: opts.themes,
    candidates_considered: eligible.length,
    skipped_textual: skipped_textual.length,
    agent: 'question_terms_validator',
    needs_manual_review: needs_manual_review === true || missingPrimary,
    review_reason:
      review_reason ||
      (missingPrimary
        ? 'Ausência de termos primários após validação.'
        : undefined),
    is_coherent,
    missing_primary_terms: missingPrimary,
    token_usage,
  };
}
