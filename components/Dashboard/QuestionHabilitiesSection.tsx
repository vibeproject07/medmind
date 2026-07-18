'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Brain,
  ExternalLink,
  Loader2,
  Sparkles,
  Target,
} from 'lucide-react';

interface CompetenciaGroup {
  competencia: string;
  conteudos: string[];
  justificativa?: string;
  principal?: boolean;
  id?: string;
}

interface NovaCompetencia {
  nome: string;
  descricao?: string;
  categoria?: string;
  justificativa_criacao?: string;
}

interface HabilitiesResult {
  competencias: CompetenciaGroup[];
  novas_competencias?: NovaCompetencia[];
}

interface SimilarQuestion {
  id: number;
  statement: string;
  tags?: string[];
  areas_conhecimento?: string[];
  exam_year?: number | null;
  exam_board?: string | null;
  exam_institution?: string | null;
  similarity: number;
  matched_terms?: string[];
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default function QuestionHabilitiesSection({
  questionId,
  isAdmin,
  initialResult,
}: {
  questionId: string;
  isAdmin: boolean;
  initialResult?: HabilitiesResult | null;
}) {
  const router = useRouter();
  const [result, setResult] = useState<HabilitiesResult | null>(initialResult ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [similar, setSimilar] = useState<SimilarQuestion[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [pendingNote, setPendingNote] = useState('');

  useEffect(() => {
    setResult(initialResult ?? null);
  }, [initialResult]);

  const loadSimilar = useCallback(async () => {
    setSimilarLoading(true);
    try {
      const res = await fetch(`/api/questions/${questionId}/habilities/similar`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (res.ok) setSimilar(data.questions ?? []);
    } catch {
      /* ignore */
    } finally {
      setSimilarLoading(false);
    }
  }, [questionId]);

  useEffect(() => {
    if (result?.competencias?.length || result?.novas_competencias?.length) {
      loadSimilar();
    } else {
      setSimilar([]);
    }
  }, [result, loadSimilar]);

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    setPendingNote('');
    try {
      const res = await fetch(`/api/questions/${questionId}/habilities`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha na classificação');
      setResult(data.result);
      if (data.pending_inserted > 0) {
        setPendingNote(
          `${data.pending_inserted} termo(s) enviado(s) para validação em Competências e conteúdos.`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-rose-500" />
          <h3 className="text-lg font-semibold text-gray-800">Competências e conteúdos — IA</h3>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            habilities_agent
          </span>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50 transition"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {loading ? 'Gerando…' : 'Gerar classificação'}
          </button>
        )}
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}
      {pendingNote && <p className="text-amber-700 text-sm bg-amber-50 border border-amber-100 rounded-md px-3 py-2">{pendingNote}</p>}
      {loading && (
        <p className="text-sm text-rose-500 italic flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Executando habilities_agent…
        </p>
      )}

      {!result?.competencias?.length && !(result?.novas_competencias?.length) ? (
        <p className="text-gray-400 italic text-sm">
          Nenhuma competência/conteúdo gerado ainda.
          {isAdmin ? ' Use o botão acima para classificar esta questão.' : ''}
        </p>
      ) : (
        <div className="space-y-4">
          {(result?.competencias?.length ?? 0) > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="text-left py-2 px-3 bg-rose-50 border border-rose-100 text-xs font-semibold text-rose-700 uppercase tracking-wide w-2/5">
                      Competência
                    </th>
                    <th className="text-left py-2 px-3 bg-orange-50 border border-orange-100 text-xs font-semibold text-orange-700 uppercase tracking-wide">
                      Conteúdos / detalhes
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result!.competencias.map((g, i) => (
                    <tr key={`${g.competencia}-${i}`} className="align-top">
                      <td className="py-2 px-3 border border-rose-100 bg-rose-50/40">
                        <div className="flex items-start gap-2">
                          <span className="font-semibold text-rose-900">{g.competencia}</span>
                          {g.principal && (
                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-600 text-white">
                              principal
                            </span>
                          )}
                        </div>
                        {g.justificativa && (
                          <p className="text-xs text-rose-400 mt-1 line-clamp-3">{g.justificativa}</p>
                        )}
                      </td>
                      <td className="py-2 px-3 border border-orange-100 bg-orange-50/30">
                        {(g.conteudos?.length ?? 0) > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {g.conteudos.map((c) => (
                              <span
                                key={c}
                                className="inline-block px-2 py-0.5 text-xs bg-white border border-orange-200 text-orange-800 rounded-full"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(result?.novas_competencias?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">
                Novas competências propostas (fila de validação)
              </p>
              <div className="flex flex-wrap gap-2">
                {result!.novas_competencias!.map((n) => (
                  <span
                    key={n.nome}
                    className="inline-flex flex-col gap-0.5 px-3 py-1.5 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg"
                  >
                    <span className="font-semibold">{n.nome}</span>
                    {(n.categoria || n.descricao) && (
                      <span className="text-amber-700/80">{n.categoria || n.descricao}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Busca por questões com competências/conteúdos compartilhados */}
      <div className="pt-2 border-t border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <Brain className="h-4 w-4 text-rose-400" />
          <h4 className="text-sm font-semibold text-gray-800">
            Questões relacionadas (competências/conteúdos)
          </h4>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            busca por termos compartilhados
          </span>
        </div>

        {similarLoading ? (
          <p className="text-sm text-gray-500 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
          </p>
        ) : !(result?.competencias?.length || result?.novas_competencias?.length) ? (
          <p className="text-gray-400 italic text-sm">
            Classifique a questão para habilitar a busca por competências compartilhadas.
          </p>
        ) : similar.length === 0 ? (
          <p className="text-gray-400 italic text-sm">
            Nenhuma outra questão com competências/conteúdos em comum.
          </p>
        ) : (
          <div className="space-y-3">
            {similar.map((sq) => (
              <div
                key={sq.id}
                className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:border-rose-200 hover:bg-rose-50/30 transition group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 line-clamp-2">{sq.statement}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {sq.exam_year && <span className="text-xs text-gray-500">{sq.exam_year}</span>}
                    {sq.exam_board && <span className="text-xs text-gray-500">· {sq.exam_board}</span>}
                    {sq.matched_terms?.slice(0, 3).map((t) => (
                      <span
                        key={t}
                        className="text-xs px-1.5 py-0.5 bg-rose-50 text-rose-600 rounded-full"
                      >
                        {t}
                      </span>
                    ))}
                    <span className="ml-auto text-xs font-medium text-rose-600">
                      {Math.round(sq.similarity * 100)}% overlap
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => router.push(`/dashboard/questions/${sq.id}`)}
                  className="flex-shrink-0 p-1.5 text-gray-400 hover:text-rose-600 transition opacity-0 group-hover:opacity-100"
                  title="Ver questão"
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
