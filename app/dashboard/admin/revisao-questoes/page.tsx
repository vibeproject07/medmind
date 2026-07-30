'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';

const PAGE_SIZE = 20;

interface ReviewItem {
  id: number;
  statement_preview: string;
  correct_answer?: string | null;
  exam_year?: number | null;
  exam_board?: string | null;
  exam_institution?: string | null;
  tags?: string[];
  areas_conhecimento?: string[];
  descriptors_count: number;
  primary_count: number;
  decs_validation_meta?: {
    missing_primary_terms?: boolean;
    needs_manual_review?: boolean;
    review_reason?: string | null;
    coerencia_geral?: number;
    validated_at?: string;
    removed_count?: number;
    kept_count?: number;
    dismissed_at?: string | null;
  } | null;
  updated_at?: string;
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function pluralQuestao(n: number) {
  return n === 1 ? '1 questão' : `${n} questões`;
}

export default function RevisaoQuestoesPage() {
  const router = useRouter();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState<number | null>(null);
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = includeDismissed ? '?include_dismissed=1' : '';
      const res = await fetch(`/api/admin/questions-review${qs}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao carregar');
      setItems(data.items ?? []);
      setPage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, [includeDismissed]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDismiss = async (id: number) => {
    setActionId(id);
    try {
      const res = await fetch('/api/admin/questions-review', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ id, action: 'dismiss' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao marcar como revisada');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao atualizar');
    } finally {
      setActionId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const firstIdx = items.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const lastIdx = Math.min(safePage * PAGE_SIZE, items.length);

  // Page number list with ellipsis
  function pageNumbers(): (number | '…')[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const nums: (number | '…')[] = [1];
    if (safePage > 3) nums.push('…');
    for (let p = Math.max(2, safePage - 1); p <= Math.min(totalPages - 1, safePage + 1); p++) nums.push(p);
    if (safePage < totalPages - 2) nums.push('…');
    nums.push(totalPages);
    return nums;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-amber-600" />
            <h1 className="text-2xl font-bold text-gray-900">Revisão de Questões</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Questões sinalizadas para auditoria manual por{' '}
            <strong>ausência de termos DeCS primários</strong> após a validação
            (pipeline V1).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={includeDismissed}
              onChange={(e) => setIncludeDismissed(e.target.checked)}
              className="rounded border-gray-300"
            />
            Incluir já revisadas
          </label>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 text-amber-700 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900">
          <p className="font-medium">Critério da fila</p>
          <p className="mt-0.5 text-amber-800/90">
            Entram questões com <code className="text-xs bg-amber-100 px-1 rounded">missing_primary_terms</code> após
            a validação DeCS — tipicamente quando não resta nenhum descritor com papel primário no resultado V1.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">
            {loading
              ? 'Carregando…'
              : `${pluralQuestao(items.length)} no total`}
          </h2>
          {!loading && items.length > 0 && (
            <span className="text-xs text-gray-500">
              Exibindo {firstIdx}–{lastIdx} de {items.length}
            </span>
          )}
        </div>

        {loading ? (
          <p className="p-8 text-sm text-gray-500 flex items-center gap-2 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando fila de revisão…
          </p>
        ) : items.length === 0 ? (
          <p className="p-8 text-sm text-gray-400 italic text-center">
            Nenhuma questão pendente de revisão por ausência de termos primários.
          </p>
        ) : (
          <>
            <div className="divide-y divide-gray-100">
              {pageItems.map((item) => {
                const meta = item.decs_validation_meta;
                const dismissed = Boolean(meta?.dismissed_at);
                return (
                  <div
                    key={item.id}
                    className={`p-4 hover:bg-gray-50/80 transition ${dismissed ? 'opacity-70' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="font-mono text-xs text-gray-500">#{item.id}</span>
                          {dismissed && (
                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
                              revisada
                            </span>
                          )}
                          {meta?.coerencia_geral != null && (
                            <span className="text-xs text-amber-800 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
                              Coerência {meta.coerencia_geral}%
                            </span>
                          )}
                          <span className="text-xs text-gray-500">
                            {item.descriptors_count} descritor(es) · {item.primary_count} primário(s)
                          </span>
                        </div>
                        <p className="text-sm text-gray-800 line-clamp-3">{item.statement_preview}</p>
                        <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500">
                          {item.exam_year && <span>{item.exam_year}</span>}
                          {item.exam_board && <span>· {item.exam_board}</span>}
                          {item.exam_institution && <span>· {item.exam_institution}</span>}
                          {item.correct_answer && (
                            <span className="text-emerald-700">· Gabarito {item.correct_answer}</span>
                          )}
                        </div>
                        {meta?.review_reason && (
                          <p className="mt-2 text-xs text-amber-800 bg-amber-50/80 border border-amber-100 rounded-md px-2.5 py-1.5">
                            {meta.review_reason}
                          </p>
                        )}
                        {meta?.validated_at && (
                          <p className="mt-1 text-[11px] text-gray-400">
                            Validado em {new Date(meta.validated_at).toLocaleString('pt-BR')}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => router.push(`/dashboard/questions/${item.id}`)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Abrir
                        </button>
                        {!dismissed && (
                          <button
                            type="button"
                            onClick={() => handleDismiss(item.id)}
                            disabled={actionId === item.id}
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                          >
                            {actionId === item.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            Marcar revisada
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination controls */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-gray-500">
                  Página {safePage} de {totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                    className="p-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Página anterior"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>

                  {pageNumbers().map((n, i) =>
                    n === '…' ? (
                      <span key={`ellipsis-${i}`} className="px-1 text-gray-400 text-sm select-none">…</span>
                    ) : (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setPage(n)}
                        className={`min-w-[2rem] h-8 rounded-lg text-sm font-medium border transition ${
                          n === safePage
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {n}
                      </button>
                    )
                  )}

                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                    className="p-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Próxima página"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
