/**
 * Formatação do rastreio do pipeline DeCS V1 para o frontend (apenas em memória).
 */

import type { DeCSRecord, DeCSThemes, DeCSPipelineTermTrace } from '@/lib/decs-pipeline';

export interface DeCSPipelineExposurePayload {
  gemini_partial_terms: {
    source: 'decs_classifier';
    primary: string[];
    secondary: string[];
    all_partial_terms: Array<{ term: string; role: 'primary' | 'secondary' }>;
  };
  text_search: Array<{
    gemini_query_term: string;
    role: 'primary' | 'secondary';
    executed: boolean;
    candidates: Array<{
      code: string;
      term: string;
      name_en?: string;
      similarity?: number;
      hierarchy_path?: string;
      exact_match: boolean;
    }>;
    accepted: boolean;
    accepted_descriptor?: DeCSRecord | null;
  }>;
  vector_search: Array<{
    gemini_query_term: string;
    role: 'primary' | 'secondary';
    executed: boolean;
    candidates: Array<{
      code: string;
      term: string;
      name_en?: string;
      similarity?: number;
      hierarchy_path?: string;
    }>;
    accepted: boolean;
    accepted_descriptor?: DeCSRecord | null;
  }>;
  bvs_search: Array<{
    gemini_query_term: string;
    role: 'primary' | 'secondary';
    executed: boolean;
    candidates: Array<{
      code: string;
      term: string;
      similarity?: number;
      hierarchy_path?: string;
    }>;
    accepted: boolean;
    accepted_descriptor?: DeCSRecord | null;
  }>;
  after_search: DeCSRecord[];
  term_trace: DeCSPipelineTermTrace[];
}

export function buildPipelineFrontendExposure(
  themes: DeCSThemes,
  termTrace: DeCSPipelineTermTrace[],
  afterSearch: DeCSRecord[],
): DeCSPipelineExposurePayload {
  const primary = themes.primary ?? [];
  const secondary = themes.secondary ?? [];

  return {
    gemini_partial_terms: {
      source: 'decs_classifier',
      primary,
      secondary,
      all_partial_terms: [
        ...primary.map((term) => ({ term, role: 'primary' as const })),
        ...secondary.map((term) => ({ term, role: 'secondary' as const })),
      ],
    },
    text_search: termTrace.map((t) => ({
      gemini_query_term: t.gemini_partial_term,
      role: t.role,
      executed: t.text_search.executed,
      candidates: t.text_search.candidates,
      accepted: t.text_search.accepted,
      accepted_descriptor: t.text_search.accepted_descriptor ?? null,
    })),
    vector_search: termTrace.map((t) => ({
      gemini_query_term: t.gemini_partial_term,
      role: t.role,
      executed: t.vector_search.executed,
      candidates: t.vector_search.candidates,
      accepted: t.vector_search.accepted,
      accepted_descriptor: t.vector_search.accepted_descriptor ?? null,
    })),
    bvs_search: termTrace.map((t) => ({
      gemini_query_term: t.gemini_partial_term,
      role: t.role,
      executed: t.bvs_search.executed,
      candidates: t.bvs_search.candidates,
      accepted: t.bvs_search.accepted,
      accepted_descriptor: t.bvs_search.accepted_descriptor ?? null,
    })),
    after_search: afterSearch,
    term_trace: termTrace,
  };
}
