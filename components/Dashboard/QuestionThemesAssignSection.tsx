'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Brain,
  ExternalLink,
  Layers,
  Loader2,
  Sparkles,
} from 'lucide-react';

interface TemaGroup {
  tema: string;
  subtemas: string[];
}

interface ThemesResult {
  temas: TemaGroup[];
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

export default function QuestionThemesAssignSection({
  questionId,
  isAdmin,
  initialResult,
}: {
  questionId: string;
  isAdmin: boolean;
  initialResult?: ThemesResult | null;
}) {
  const router = useRouter();
  const [result, setResult] = useState<ThemesResult | null>(initialResult ?? null);
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
      const res = await fetch(
        `/api/questions/${questionId}/themes-assign/similar`,
        { headers: authHeaders() },
      );
      const data = await res.json();
      if (res.ok) setSimilar(data.questions ?? []);
    } catch {
      /* ignore */
    } finally {
      setSimilarLoading(false);
    }
  }, [questionId]);

  useEffect(() => {
    if (result?.temas?.length) {
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
      const res = await fetch(`/api/questions/${questionId}/themes-assign`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha na classificação');
      setResult(data.result);
      if (data.pending_inserted > 0) {
        setPendingNote(
          `${data.pending_inserted} termo(s) enviado(s) para validação em Temas e Subtemas.`,
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
          <Layers className="h-4 w-4 text-sky-500" />
          <h3 className="text-lg font-semibold text-gray-800">Temas e subtemas — IA</h3>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            question_themes_assigner
          </span>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50 transition"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {loading ? 'Gerando…' : 'Gerar classificação'}
          </button>
        )}
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}
      {pendingNote && (
        <p className="text-amber-700 text-sm bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
          {pendingNote}
        </p>
      )}
      {loading && (
        <p className="text-sm text-sky-500 italic flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Executando question_themes_assigner…
        </p>
      )}

      {!result?.temas?.length ? (
        <p className="text-gray-400 italic text-sm">
          Nenhum tema/subtema gerado ainda.
          {isAdmin ? ' Use o botão acima para classificar esta questão.' : ''}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="text-left py-2 px-3 bg-sky-50 border border-sky-100 text-xs font-semibold text-sky-700 uppercase tracking-wide w-2/5">
                  Tema
                </th>
                <th className="text-left py-2 px-3 bg-cyan-50 border border-cyan-100 text-xs font-semibold text-cyan-700 uppercase tracking-wide">
                  Subtemas
                </th>
              </tr>
            </thead>
            <tbody>
              {result.temas.map((g, i) => (
                <tr key={`${g.tema}-${i}`} className="align-top">
                  <td className="py-2 px-3 border border-sky-100 bg-sky-50/40 font-semibold text-sky-900">
                    {g.tema}
                  </td>
                  <td className="py-2 px-3 border border-cyan-100 bg-cyan-50/30">
                    <div className="flex flex-wrap gap-1.5">
                      {g.subtemas.map((s) => (
                        <span
                          key={s}
                          className="inline-block px-2 py-0.5 text-xs bg-white border border-cyan-200 text-cyan-800 rounded-full"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pt-2 border-t border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <Brain className="h-4 w-4 text-sky-400" />
          <h4 className="text-sm font-semibold text-gray-800">
            Questões relacionadas (temas/subtemas)
          </h4>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            busca por termos compartilhados
          </span>
        </div>

        {similarLoading ? (
          <p className="text-sm text-gray-500 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
          </p>
        ) : !result?.temas?.length ? (
          <p className="text-gray-400 italic text-sm">
            Classifique a questão para habilitar a busca por temas compartilhados.
          </p>
        ) : similar.length === 0 ? (
          <p className="text-gray-400 italic text-sm">
            Nenhuma outra questão com temas/subtemas em comum.
          </p>
        ) : (
          <div className="space-y-3">
            {similar.map((sq) => (
              <div
                key={sq.id}
                className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:border-sky-200 hover:bg-sky-50/30 transition group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 line-clamp-2">{sq.statement}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {sq.exam_year && <span className="text-xs text-gray-500">{sq.exam_year}</span>}
                    {sq.exam_board && <span className="text-xs text-gray-500">· {sq.exam_board}</span>}
                    {sq.matched_terms?.slice(0, 3).map((t) => (
                      <span
                        key={t}
                        className="text-xs px-1.5 py-0.5 bg-sky-50 text-sky-600 rounded-full"
                      >
                        {t}
                      </span>
                    ))}
                    <span className="ml-auto text-xs font-medium text-sky-600">
                      {Math.round(sq.similarity * 100)}% overlap
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => router.push(`/dashboard/questions/${sq.id}`)}
                  className="flex-shrink-0 p-1.5 text-gray-400 hover:text-sky-600 transition opacity-0 group-hover:opacity-100"
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
