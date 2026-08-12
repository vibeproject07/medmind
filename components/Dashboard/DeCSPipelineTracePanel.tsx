'use client';

import type {
  BvsSearchLayerExposure,
  GeminiPartialTermsExposure,
  TextSearchLayerExposure,
  VectorSearchLayerExposure,
} from '@/lib/decs-pipeline-exposure';

export interface DeCSPipelineExposurePayload {
  gemini_partial_terms: GeminiPartialTermsExposure;
  text_search: TextSearchLayerExposure[];
  vector_search: VectorSearchLayerExposure[];
  bvs_search: BvsSearchLayerExposure[];
}

interface Props {
  exposure: DeCSPipelineExposurePayload | null;
}

function LayerBadge({ method }: { method?: string }) {
  if (!method) return null;
  const colors: Record<string, string> = {
    text: 'bg-sky-100 text-sky-800',
    vector: 'bg-violet-100 text-violet-800',
    bvs: 'bg-amber-100 text-amber-800',
  };
  return (
    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${colors[method] ?? 'bg-gray-100'}`}>
      {method}
    </span>
  );
}

export default function DeCSPipelineTracePanel({ exposure }: Props) {
  if (!exposure) return null;

  const { gemini_partial_terms, text_search, vector_search, bvs_search } = exposure;

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-indigo-100 bg-indigo-50/30 p-4 text-sm">
      <h3 className="font-semibold text-indigo-900">Rastreio do pipeline V1</h3>

      {/* 1 — Gemini */}
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-indigo-600 mb-2">
          1. Termos parciais (Gemini / decs_classifier)
        </h4>
        <div className="flex flex-wrap gap-2">
          {gemini_partial_terms.all_partial_terms.length === 0 ? (
            <span className="text-gray-400 italic">Nenhum termo</span>
          ) : (
            gemini_partial_terms.all_partial_terms.map((t) => (
              <span
                key={`${t.role}-${t.term}`}
                className={`px-2 py-1 rounded-lg text-xs font-medium ${
                  t.role === 'primary' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {t.term}
                <span className="ml-1 opacity-60">({t.role})</span>
              </span>
            ))
          )}
        </div>
      </section>

      {/* 2 — Texto */}
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-sky-600 mb-2">
          2. Busca textual (name_pt, name_en, entry_terms)
        </h4>
        <div className="space-y-3">
          {text_search.map((row) => (
            <div key={`text-${row.gemini_query_term}`} className="rounded-lg border border-sky-100 bg-white p-3">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="font-medium text-sky-900">Query: {row.gemini_query_term}</span>
                <span className="text-xs text-gray-400">({row.role})</span>
                {row.skipped && (
                  <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                    pulado → vetor
                  </span>
                )}
                {row.accepted && <LayerBadge method="text" />}
              </div>

              {(row.rules_summary?.length ?? 0) > 0 && (
                <div className="mb-2 rounded-md bg-sky-50 border border-sky-100 px-2 py-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700 mb-1">
                    Regras (termo Gemini)
                  </p>
                  <ul className="text-[11px] text-sky-900/80 space-y-0.5 list-disc list-inside">
                    {row.rules_summary!.map((r, i) => (
                      <li key={`${row.gemini_query_term}-rule-${i}`}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {row.skipped ? (
                <p className="text-xs text-slate-500 italic">
                  {row.skip_reason || 'Busca textual não executada para este termo.'}
                </p>
              ) : row.candidates.length === 0 ? (
                <p className="text-xs text-gray-400 italic">Sem candidatos</p>
              ) : (
                <ul className="text-xs space-y-2 mt-2">
                  {row.candidates.map((c) => (
                    <li
                      key={c.code}
                      className={`border-l-2 pl-2 ${
                        c.accepted_candidate ? 'border-green-400' : 'border-sky-200'
                      }`}
                    >
                      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold">{c.official_term_pt}</span>
                          <span className="text-gray-400 font-mono ml-1">({c.code})</span>
                          {c.matched_via && (
                            <span className="ml-1 text-sky-600">via {c.matched_via}</span>
                          )}
                          {c.accepted_candidate === false && (
                            <span className="ml-1 text-[10px] uppercase text-red-500 font-semibold">
                              rejeitado
                            </span>
                          )}
                          {c.accepted_candidate === true && (
                            <span className="ml-1 text-[10px] uppercase text-green-600 font-semibold">
                              elegível
                            </span>
                          )}
                          {c.matched_entry_term && (
                            <span className="block text-gray-500">entry_term: {c.matched_entry_term}</span>
                          )}
                          {c.hierarchy_path && (
                            <span className="block text-indigo-500 mt-0.5">{c.hierarchy_path}</span>
                          )}
                        </div>
                        {(c.rules_applied?.length ?? 0) > 0 && (
                          <div className="w-full sm:w-auto sm:max-w-xs rounded bg-slate-50 border border-slate-100 px-2 py-1">
                            <p className="text-[10px] font-semibold text-slate-600 uppercase mb-0.5">
                              Regras aplicadas
                            </p>
                            <ul className="text-[10px] text-slate-600 space-y-0.5 list-disc list-inside">
                              {c.rules_applied!.map((r, i) => (
                                <li key={`${c.code}-r-${i}`}>{r}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {row.accept_reason && !row.skipped && (
                <p className="text-xs text-green-700 mt-1">✓ {row.accept_reason}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 3 — Vetor */}
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-violet-600 mb-2">
          3. Busca vetorial (pgvector / decs_descriptors)
        </h4>
        <div className="space-y-3">
          {vector_search.map((row) => (
            <div key={`vec-${row.gemini_query_term}`} className="rounded-lg border border-violet-100 bg-white p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-violet-900">Embed: {row.embedded_query_term}</span>
                {row.accepted && <LayerBadge method="vector" />}
              </div>
              {row.candidates.length === 0 ? (
                <p className="text-xs text-gray-400 italic">Não executada ou sem candidatos</p>
              ) : (
                <ul className="text-xs space-y-1 mt-2">
                  {row.candidates.map((c) => (
                    <li key={c.code} className="border-l-2 border-violet-200 pl-2">
                      {c.term} <span className="font-mono text-gray-400">({c.code})</span>
                      {c.similarity != null && (
                        <span className="ml-1 text-violet-600">sim {c.similarity.toFixed(3)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 4 — BVS */}
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-2">
          4. Busca API BVS
        </h4>
        <div className="space-y-3">
          {bvs_search.map((row) => (
            <div key={`bvs-${row.gemini_query_term}`} className="rounded-lg border border-amber-100 bg-white p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-amber-900">API: {row.api_query_term}</span>
                {row.accepted && <LayerBadge method="bvs" />}
              </div>
              {row.candidates.length === 0 ? (
                <p className="text-xs text-gray-400 italic">Não executada ou sem candidatos</p>
              ) : (
                <ul className="text-xs space-y-1 mt-2">
                  {row.candidates.map((c) => (
                    <li key={c.code} className="border-l-2 border-amber-200 pl-2">
                      {c.term} <span className="font-mono text-gray-400">({c.code})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
