'use client';

import { useState } from 'react';
import { Search, Plus, X, Play, Hash, Filter, ChevronDown } from 'lucide-react';

// ── tipos ──────────────────────────────────────────────────────────────────
interface FilterRow {
  id: number;
  field: string;
  operator: string;
  value: string;
}

interface Question {
  id: number;
  statement: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e: string;
  correct_answer: string;
  explanation: string;
  exam_year: number;
  exam_board: string;
  exam_institution: string;
  exam_region: string;
  tags: string;
  areas_conhecimento: string;
  assuntos: string;
  anulada: boolean;
  ai_decs_descriptors: string;
}

// ── configurações ──────────────────────────────────────────────────────────
const FIELDS = [
  { value: 'id',                label: 'id',                type: 'integer' },
  { value: 'statement',         label: 'statement',         type: 'text'    },
  { value: 'option_a',          label: 'option_a',          type: 'text'    },
  { value: 'option_b',          label: 'option_b',          type: 'text'    },
  { value: 'option_c',          label: 'option_c',          type: 'text'    },
  { value: 'option_d',          label: 'option_d',          type: 'text'    },
  { value: 'option_e',          label: 'option_e',          type: 'text'    },
  { value: 'correct_answer',    label: 'correct_answer',    type: 'text'    },
  { value: 'exam_year',         label: 'exam_year',         type: 'integer' },
  { value: 'exam_board',        label: 'exam_board',        type: 'text'    },
  { value: 'exam_institution',  label: 'exam_institution',  type: 'text'    },
  { value: 'exam_region',       label: 'exam_region',       type: 'text'    },
  { value: 'tags',              label: 'tags',              type: 'text'    },
  { value: 'areas_conhecimento',label: 'areas_conhecimento',type: 'text'    },
  { value: 'assuntos',          label: 'assuntos',          type: 'text'    },
  { value: 'anulada',           label: 'anulada',           type: 'boolean' },
  { value: 'ai_decs_descriptors', label: 'ai_decs_descriptors', type: 'text' },
];

const OPERATORS_FOR = {
  text: [
    { value: 'equals',      label: 'equals'      },
    { value: 'not_equals',  label: 'not equals'  },
    { value: 'contains',    label: 'contains'    },
    { value: 'starts_with', label: 'starts with' },
    { value: 'ends_with',   label: 'ends with'   },
    { value: 'is_null',     label: 'is null'     },
    { value: 'is_not_null', label: 'is not null' },
  ],
  integer: [
    { value: 'equals',      label: 'equals'         },
    { value: 'not_equals',  label: 'not equals'     },
    { value: 'gt',          label: 'greater than'   },
    { value: 'gte',         label: 'greater or eq'  },
    { value: 'lt',          label: 'less than'      },
    { value: 'lte',         label: 'less or eq'     },
    { value: 'is_null',     label: 'is null'        },
    { value: 'is_not_null', label: 'is not null'    },
  ],
  boolean: [
    { value: 'equals',      label: 'equals'      },
    { value: 'not_equals',  label: 'not equals'  },
    { value: 'is_null',     label: 'is null'     },
    { value: 'is_not_null', label: 'is not null' },
  ],
};

const NO_VALUE_OPS = new Set(['is_null', 'is_not_null']);

const DISPLAY_COLS = ['id', 'statement', 'option_a', 'option_b', 'correct_answer',
  'exam_year', 'exam_board', 'exam_institution'];

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token')?.trim().replace(/^["']|["']$/g, '') ?? null;
}

function safeParse(val: string) {
  try { return JSON.parse(val); } catch { return val; }
}

let rowSeq = 0;

// ── componente principal ───────────────────────────────────────────────────
export default function QueryPage() {

  // ── card 1: busca por ID ─────────────────────────────────────────────────
  const [idInput, setIdInput] = useState('');
  const [idLoading, setIdLoading] = useState(false);
  const [idResult, setIdResult] = useState<Question | null>(null);
  const [idError, setIdError] = useState<string | null>(null);

  const searchById = async () => {
    const id = idInput.trim();
    if (!id) return;
    setIdLoading(true);
    setIdError(null);
    setIdResult(null);
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/query?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { setIdError(data.error ?? `HTTP ${res.status}`); return; }
      setIdResult(data.question);
    } catch (e) {
      setIdError(e instanceof Error ? e.message : 'Erro inesperado');
    } finally {
      setIdLoading(false);
    }
  };

  // ── card 2: filtros SQL ──────────────────────────────────────────────────
  const [filters, setFilters] = useState<FilterRow[]>([
    { id: ++rowSeq, field: 'id', operator: 'equals', value: '' },
  ]);
  const [limit, setLimit] = useState(50);
  const [sqlLoading, setSqlLoading] = useState(false);
  const [sqlRows, setSqlRows] = useState<Question[]>([]);
  const [sqlTotal, setSqlTotal] = useState<number | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);

  const addFilter = () =>
    setFilters(prev => [...prev, { id: ++rowSeq, field: 'id', operator: 'equals', value: '' }]);

  const removeFilter = (id: number) =>
    setFilters(prev => prev.filter(f => f.id !== id));

  const updateFilter = (id: number, patch: Partial<FilterRow>) =>
    setFilters(prev => prev.map(f => {
      if (f.id !== id) return f;
      const next = { ...f, ...patch };
      if (patch.field) {
        const fieldType = FIELDS.find(x => x.value === patch.field)?.type ?? 'text';
        const ops = OPERATORS_FOR[fieldType as keyof typeof OPERATORS_FOR];
        if (!ops.find(o => o.value === next.operator)) next.operator = ops[0].value;
      }
      return next;
    }));

  const runQuery = async () => {
    setSqlLoading(true);
    setSqlError(null);
    setSqlRows([]);
    setSqlTotal(null);
    try {
      const token = getToken();
      const res = await fetch('/api/admin/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          filters: filters.map(({ field, operator, value }) => ({ field, operator, value })),
          limit,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSqlError(data.error ?? `HTTP ${res.status}`); return; }
      setSqlRows(data.rows);
      setSqlTotal(data.total);
    } catch (e) {
      setSqlError(e instanceof Error ? e.message : 'Erro inesperado');
    } finally {
      setSqlLoading(false);
    }
  };

  // ── helpers de render ────────────────────────────────────────────────────
  const renderFieldType = (field: string) =>
    FIELDS.find(f => f.value === field)?.type ?? 'text';

  const truncate = (s: string | null | undefined, n = 80) => {
    if (!s) return '—';
    const str = String(s);
    return str.length > n ? str.slice(0, n) + '…' : str;
  };

  // ── JSX ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Consulta de Questões</h1>

      {/* ── Card 1: Busca por ID ─────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Hash className="w-5 h-5 text-primary-600" />
          <h2 className="text-lg font-semibold text-gray-800">Busca por ID</h2>
        </div>

        <div className="flex gap-3">
          <input
            type="number"
            min={1}
            value={idInput}
            onChange={e => setIdInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchById()}
            placeholder="Ex: 25609"
            className="w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            onClick={searchById}
            disabled={idLoading || !idInput.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm transition"
          >
            <Search className="w-4 h-4" />
            {idLoading ? 'Buscando…' : 'Buscar'}
          </button>
        </div>

        {idError && (
          <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {idError}
          </p>
        )}

        {idResult && (
          <div className="mt-4 rounded-lg border border-gray-200 overflow-hidden text-sm">
            <table className="w-full">
              <tbody className="divide-y divide-gray-100">
                {[
                  ['ID', idResult.id],
                  ['Enunciado', idResult.statement],
                  ['Opção A', idResult.option_a],
                  ['Opção B', idResult.option_b],
                  ['Opção C', idResult.option_c],
                  ['Opção D', idResult.option_d],
                  ['Opção E', idResult.option_e],
                  ['Resposta correta', idResult.correct_answer],
                  ['Explicação', idResult.explanation],
                  ['Banca', idResult.exam_board],
                  ['Instituição', idResult.exam_institution],
                  ['Região', idResult.exam_region],
                  ['Ano', idResult.exam_year],
                  ['Tags', Array.isArray(safeParse(idResult.tags)) ? (safeParse(idResult.tags) as string[]).join(', ') : idResult.tags],
                  ['Áreas', Array.isArray(safeParse(idResult.areas_conhecimento)) ? (safeParse(idResult.areas_conhecimento) as string[]).join(', ') : idResult.areas_conhecimento],
                  ['Anulada', idResult.anulada ? 'Sim' : 'Não'],
                  ['DeCS (AI)', idResult.ai_decs_descriptors
                    ? (() => {
                        try {
                          const d = JSON.parse(idResult.ai_decs_descriptors);
                          return Array.isArray(d) ? d.map((x: { term: string }) => x.term).join(', ') : idResult.ai_decs_descriptors;
                        } catch { return idResult.ai_decs_descriptors; }
                      })()
                    : '—'],
                ].map(([label, val]) => (
                  <tr key={String(label)} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-500 whitespace-nowrap w-40 align-top">{label}</td>
                    <td className="px-4 py-2 text-gray-800 break-words max-w-xl">{val ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Card 2: Filtros SQL ──────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-800">Filtros SQL</h2>
        </div>

        {/* linhas de filtro */}
        <div className="space-y-2 mb-3">
          {filters.map((f, idx) => {
            const fieldType = renderFieldType(f.field) as keyof typeof OPERATORS_FOR;
            const ops = OPERATORS_FOR[fieldType] ?? OPERATORS_FOR.text;
            const needsVal = !NO_VALUE_OPS.has(f.operator);

            return (
              <div key={f.id} className="flex items-center gap-2 flex-wrap">
                {/* label where / and */}
                <span className="text-xs font-mono text-gray-400 w-8 text-right select-none">
                  {idx === 0 ? 'where' : 'and'}
                </span>

                {/* campo */}
                <div className="relative">
                  <select
                    value={f.field}
                    onChange={e => updateFilter(f.id, { field: e.target.value })}
                    className="appearance-none pl-3 pr-8 py-1.5 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 font-mono"
                  >
                    {FIELDS.map(fld => (
                      <option key={fld.value} value={fld.value}>{fld.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                </div>

                {/* operador */}
                <div className="relative">
                  <select
                    value={f.operator}
                    onChange={e => updateFilter(f.id, { operator: e.target.value })}
                    className="appearance-none pl-3 pr-8 py-1.5 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {ops.map(op => (
                      <option key={op.value} value={op.value}>{op.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                </div>

                {/* valor */}
                {needsVal && (
                  fieldType === 'boolean' ? (
                    <div className="relative">
                      <select
                        value={f.value}
                        onChange={e => updateFilter(f.id, { value: e.target.value })}
                        className="appearance-none pl-3 pr-8 py-1.5 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                    </div>
                  ) : (
                    <input
                      type={fieldType === 'integer' ? 'number' : 'text'}
                      value={f.value}
                      onChange={e => updateFilter(f.id, { value: e.target.value })}
                      placeholder="valor"
                      className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 w-40 font-mono"
                    />
                  )
                )}

                {/* remover */}
                {filters.length > 1 && (
                  <button
                    onClick={() => removeFilter(f.id)}
                    className="p-1 text-gray-400 hover:text-red-500 transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* rodapé do construtor */}
        <div className="flex items-center gap-3 flex-wrap border-t border-gray-100 pt-3">
          <button
            onClick={addFilter}
            className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800 transition"
          >
            <Plus className="w-4 h-4" />
            Add filter
          </button>

          <span className="text-gray-300">|</span>

          <label className="text-sm text-gray-500 flex items-center gap-2">
            Limite
            <input
              type="number"
              min={1}
              max={200}
              value={limit}
              onChange={e => setLimit(Math.min(200, Math.max(1, parseInt(e.target.value) || 50)))}
              className="w-16 px-2 py-1 border border-gray-300 rounded text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </label>

          <button
            onClick={runQuery}
            disabled={sqlLoading}
            className="ml-auto flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm transition"
          >
            <Play className="w-3.5 h-3.5" />
            {sqlLoading ? 'Executando…' : 'Run query'}
          </button>
        </div>

        {sqlError && (
          <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {sqlError}
          </p>
        )}

        {/* resultados */}
        {sqlTotal !== null && (
          <div className="mt-4">
            <p className="text-xs text-gray-400 mb-2">
              {sqlTotal} row{sqlTotal !== 1 ? 's' : ''} · {sqlRows.length} displayed
            </p>

            {sqlRows.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Nenhum resultado encontrado.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {DISPLAY_COLS.map(col => (
                        <th key={col} className="px-3 py-2 text-left font-medium text-gray-500 font-mono whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {sqlRows.map(row => (
                      <tr key={row.id} className="hover:bg-gray-50">
                        {DISPLAY_COLS.map(col => (
                          <td
                            key={col}
                            className="px-3 py-2 text-gray-700 font-mono max-w-xs"
                            title={String((row as Record<string, unknown>)[col] ?? '')}
                          >
                            {truncate(String((row as Record<string, unknown>)[col] ?? ''), col === 'statement' ? 100 : 40)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
