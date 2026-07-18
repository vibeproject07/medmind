'use client';

import type { DeCSPipelineExposurePayload } from '@/lib/decs-pipeline-exposure';
import type { DeCSRecord } from '@/lib/decs-pipeline';

interface Props {
  exposure: DeCSPipelineExposurePayload | null;
}

function MethodBadge({ method }: { method?: string }) {
  if (!method) return null;
  const colors: Record<string, string> = {
    text: 'bg-sky-100 text-sky-800',
    vector: 'bg-violet-100 text-violet-800',
    bvs: 'bg-amber-100 text-amber-800',
  };
  return (
    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${colors[method] ?? 'bg-gray-100 text-gray-700'}`}>
      {method}
    </span>
  );
}

function CandidateList({
  candidates,
  exactMatchMode = false,
}: {
  candidates: Array<{
    code: string;
    term: string;
    name_en?: string;
    similarity?: number;
    hierarchy_path?: string;
    exact_match?: boolean;
  }>;
  exactMatchMode?: boolean;
}) {
  if (candidates.length === 0) {
    return <p className="text-xs text-gray-400 italic">Nenhum candidato</p>;
  }
  return (
    <ul className="space-y-1.5 max-h-48 overflow-y-auto">
      {candidates.map((c) => (
        <li key={c.code} className="border-l-2 border-gray-200 pl-2 text-xs text-gray-700">
          <span className="font-medium">{c.term}</span>
          <span className="text-gray-400 ml-1">({c.code})</span>
          {typeof c.similarity === 'number' && (
            <span className="text-indigo-500 ml-1">sim={c.similarity.toFixed(3)}</span>
          )}
          {exactMatchMode && (
            <span
              className={`ml-1 text-[10px] font-semibold ${
                c.exact_match ? 'text-emerald-600' : 'text-gray-400'
              }`}
            >
              {c.exact_match ? 'string exata' : 'não exata'}
            </span>
          )}
          {c.hierarchy_path && (
            <span className="block text-gray-400 mt-0.5">{c.hierarchy_path}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function DescriptorChips({ items, emptyLabel }: { items: DeCSRecord[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <p className="text-xs text-gray-400 italic">{emptyLabel}</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((d) => (
        <span
          key={`${d.code}-${d.role ?? ''}`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-indigo-100 text-xs text-gray-800"
        >
          <span className="font-medium">{d.term}</span>
          <span className="text-gray-400">({d.code})</span>
          {d.role && (
            <span className="text-[10px] uppercase text-indigo-500">{d.role}</span>
          )}
          <MethodBadge method={d.search_method} />
        </span>
      ))}
    </div>
  );
}

export default function DeCSPipelineTracePanel({ exposure }: Props) {
  if (!exposure) return null;

  const {
    gemini_partial_terms,
    text_search,
    vector_search,
    bvs_search,
    after_search,
  } = exposure;

  return (
    <div className="mb-4 space-y-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-indigo-900">Rastreio do pipeline V1</h3>
        <span className="text-[10px] uppercase tracking-wide text-indigo-400 bg-white/70 px-2 py-0.5 rounded">
          só nesta sessão
        </span>
      </div>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-indigo-600 mb-2">
          1. Termos parciais (Gemini / decs_classifier)
        </h4>
        <div className="flex flex-wrap gap-2">
          {gemini_partial_terms.all_partial_terms.length === 0 ? (
            <p className="text-xs text-gray-400 italic">Nenhum termo parcial</p>
          ) : (
            gemini_partial_terms.all_partial_terms.map(({ term, role }) => (
              <span
                key={`${role}-${term}`}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                  role === 'primary'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-indigo-800 border border-indigo-100'
                }`}
              >
                {term}
                <span className="opacity-70 ml-1">({role})</span>
              </span>
            ))
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
          2. Buscas DeCS por termo parcial
        </h4>
        {text_search.map((row, idx) => {
          const vector = vector_search[idx];
          const bvs = bvs_search[idx];
          return (
            <div key={`${row.role}-${row.gemini_query_term}`} className="rounded-lg border border-white bg-white/80 p-3 space-y-3">
              <p className="text-xs font-semibold text-gray-800">
                Query: <span className="text-indigo-700">{row.gemini_query_term}</span>
                <span className="ml-2 text-[10px] uppercase text-gray-400">{row.role}</span>
              </p>

              <div className="grid md:grid-cols-3 gap-3">
                <div>
                  <p className="text-[11px] font-semibold text-sky-700 mb-1">
                    Textual {!row.executed && <span className="font-normal text-gray-400">(não executada)</span>}
                  </p>
                  <p className="mb-1 text-[10px] text-gray-400">
                    Aceitação somente quando o termo parcial e o nome oficial são strings iguais.
                  </p>
                  <CandidateList candidates={row.candidates} exactMatchMode />
                  {row.accepted && row.accepted_descriptor && (
                    <p className="mt-1 text-[11px] text-emerald-600">
                      Aceito: {row.accepted_descriptor.term}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-violet-700 mb-1">
                    Vetorial {!vector?.executed && <span className="font-normal text-gray-400">(não executada)</span>}
                  </p>
                  <CandidateList candidates={vector?.candidates ?? []} />
                  {vector?.accepted && vector.accepted_descriptor && (
                    <p className="mt-1 text-[11px] text-emerald-600">
                      Aceito: {vector.accepted_descriptor.term}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-amber-700 mb-1">
                    BVS {!bvs?.executed && <span className="font-normal text-gray-400">(não executada)</span>}
                  </p>
                  <CandidateList candidates={bvs?.candidates ?? []} />
                  {bvs?.accepted && bvs.accepted_descriptor && (
                    <p className="mt-1 text-[11px] text-emerald-600">
                      Aceito: {bvs.accepted_descriptor.term}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-indigo-600 mb-2">
          3. Resultado final após as buscas
        </h4>
        <DescriptorChips items={after_search} emptyLabel="Nenhum descritor após a busca" />
      </section>
    </div>
  );
}
