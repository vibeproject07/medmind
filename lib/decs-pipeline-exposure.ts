/**
 * Funções de exposição do pipeline DeCS V1 para o frontend.
 * Cada função formata uma camada do fluxo (Gemini → texto → vetor → BVS).
 */

import type { DeCSRecord, DeCSThemes, DeCSPipelineTermTrace } from '@/lib/decs-pipeline';

/** Termos parciais gerados pelo Gemini (primary + secondary). */
export interface GeminiPartialTermsExposure {
  source: 'decs_classifier';
  primary: string[];
  secondary: string[];
  all_partial_terms: Array<{ term: string; role: 'primary' | 'secondary' }>;
}

/** Um candidato visto na busca textual (sem hierarquia até aceite). */
export interface TextSearchCandidateExposure {
  code: string;
  official_term_pt: string;
  name_en?: string;
  matched_via: 'name_pt' | 'name_en' | 'entry_terms' | null;
  matched_entry_term?: string;
  similarity?: number;
  exact_entry_term_match?: boolean;
  /** Preenchido somente quando o candidato é o aceito pela busca textual. */
  hierarchy_path?: string;
  branches?: DeCSRecord['branches'];
  /** Regras aplicadas na comparação deste candidato. */
  rules_applied?: string[];
  accepted_candidate?: boolean;
}

export interface TextSearchLayerExposure {
  gemini_query_term: string;
  role: 'primary' | 'secondary';
  columns_used: readonly ['name_pt', 'name_en', 'entry_terms'];
  candidates: TextSearchCandidateExposure[];
  accepted: boolean;
  accept_reason?: string;
  accepted_descriptor?: DeCSRecord | null;
  skipped?: boolean;
  skip_reason?: string;
  rules_summary?: string[];
}

export interface VectorSearchLayerExposure {
  gemini_query_term: string;
  role: 'primary' | 'secondary';
  embedded_query_term: string;
  candidates: Array<{
    code: string;
    term: string;
    name_en?: string;
    similarity?: number;
    hierarchy_path?: string;
    branches?: DeCSRecord['branches'];
  }>;
  accepted: boolean;
  accepted_descriptor?: DeCSRecord | null;
}

export interface BvsSearchLayerExposure {
  gemini_query_term: string;
  role: 'primary' | 'secondary';
  api_query_term: string;
  candidates: Array<{
    code: string;
    term: string;
    similarity?: number;
    hierarchy_path?: string;
    branches?: DeCSRecord['branches'];
  }>;
  accepted: boolean;
  accepted_descriptor?: DeCSRecord | null;
}

/** 1 — Termos parciais do Gemini. */
export function exposeGeminiPartialTerms(themes: DeCSThemes): GeminiPartialTermsExposure {
  const primary = themes.primary ?? [];
  const secondary = themes.secondary ?? [];
  return {
    source: 'decs_classifier',
    primary,
    secondary,
    all_partial_terms: [
      ...primary.map((term) => ({ term, role: 'primary' as const })),
      ...secondary.map((term) => ({ term, role: 'secondary' as const })),
    ],
  };
}

/** 2 — Busca textual local (name_pt, name_en, entry_terms). */
export function exposeTextSearchLayer(trace: DeCSPipelineTermTrace[]): TextSearchLayerExposure[] {
  return trace.map((t) => ({
    gemini_query_term: t.gemini_partial_term,
    role: t.role,
    columns_used: ['name_pt', 'name_en', 'entry_terms'],
    candidates: t.text_search.candidates,
    accepted: t.text_search.accepted,
    accept_reason: t.text_search.accept_reason,
    accepted_descriptor: t.text_search.accepted_descriptor ?? null,
    skipped: t.text_search.skipped,
    skip_reason: t.text_search.skip_reason,
    rules_summary: t.text_search.rules_summary,
  }));
}

/** 3 — Busca vetorial no banco (pgvector / decs_descriptors). */
export function exposeVectorSearchLayer(trace: DeCSPipelineTermTrace[]): VectorSearchLayerExposure[] {
  return trace.map((t) => ({
    gemini_query_term: t.gemini_partial_term,
    role: t.role,
    embedded_query_term: t.gemini_partial_term,
    candidates: t.vector_search.candidates,
    accepted: t.vector_search.accepted,
    accepted_descriptor: t.vector_search.accepted_descriptor ?? null,
  }));
}

/** 4 — Busca na API BVS DeCS. */
export function exposeBvsSearchLayer(trace: DeCSPipelineTermTrace[]): BvsSearchLayerExposure[] {
  return trace.map((t) => ({
    gemini_query_term: t.gemini_partial_term,
    role: t.role,
    api_query_term: t.gemini_partial_term,
    candidates: t.bvs_search.candidates,
    accepted: t.bvs_search.accepted,
    accepted_descriptor: t.bvs_search.accepted_descriptor ?? null,
  }));
}

/** Pacote completo para o frontend. */
export function buildPipelineFrontendExposure(
  themes: DeCSThemes,
  termTrace: DeCSPipelineTermTrace[],
) {
  return {
    gemini_partial_terms: exposeGeminiPartialTerms(themes),
    text_search: exposeTextSearchLayer(termTrace),
    vector_search: exposeVectorSearchLayer(termTrace),
    bvs_search: exposeBvsSearchLayer(termTrace),
    term_resolution: termTrace,
  };
}
