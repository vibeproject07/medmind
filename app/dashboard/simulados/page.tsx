'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardList, Calendar, CheckCircle, XCircle, Trash2, RotateCcw, Play, Circle } from 'lucide-react';
import { useDashboardSearch } from '@/contexts/DashboardSearchContext';

interface SimulateResult {
  id: number;
  status?: 'completed' | 'in_progress';
  total_questions: number;
  correct_answers: number;
  percentage: number;
  tags: string[];
  created_at: string;
  name?: string;
  user_id?: number;
  user_name?: string;
  user_username?: string;
  user_email?: string;
  current_index?: number;
  selected_answers?: Record<number, string>;
  /** Questões do simulado em andamento (para calcular corretas/incorretas) */
  simulate_questions?: { id: number; correct_answer: string }[];
}

export default function SimuladosPage() {
  const router = useRouter();
  const { searchQuery } = useDashboardSearch();
  const [results, setResults] = useState<SimulateResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

  const filteredResults = useMemo(() => {
    if (!searchQuery.trim()) return results;
    const q = searchQuery.trim().toLowerCase();
    return results.filter((r) => {
      const name = (r.name?.trim() || 'Simulado').toLowerCase();
      return name.includes(q);
    });
  }, [results, searchQuery]);

  useEffect(() => {
    // Obter role do usuário do token JWT
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUserRole(payload.role || 'regular');
      } catch (error) {
        console.error('Erro ao decodificar token:', error);
        setUserRole('regular');
      }
    }
    fetchResults();
  }, []);

  const fetchResults = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login');
        return;
      }

      // Por enquanto, vamos simular dados ou buscar do localStorage
      // Quando houver uma API de resultados de simulados, podemos buscar aqui
      const savedResults = localStorage.getItem('simulateResults');
      if (savedResults) {
        setResults(JSON.parse(savedResults));
      }
    } catch (error) {
      console.error('Erro ao buscar resultados:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  /** Para simulado em andamento: calcula corretas, incorretas e não realizadas (não respondidas). */
  const getProgressCounts = (
    result: SimulateResult
  ): { correct: number; incorrect: number; notDone: number; responded: number; hasBreakdown: boolean } => {
    const total = result.total_questions;
    const selected = result.selected_answers ?? {};
    const questions = result.simulate_questions;
    if (questions && questions.length > 0) {
      let correct = 0;
      let incorrect = 0;
      for (const q of questions) {
        const answer = selected[q.id];
        if (answer == null || answer === '') continue;
        if (answer === q.correct_answer) correct++;
        else incorrect++;
      }
      return { correct, incorrect, notDone: total - correct - incorrect, responded: correct + incorrect, hasBreakdown: true };
    }
    const responded = Object.keys(selected).filter((k) => selected[Number(k)] != null && selected[Number(k)] !== '').length;
    return { correct: 0, incorrect: 0, notDone: total - responded, responded, hasBreakdown: false };
  };

  const handleDelete = (resultId: number) => {
    if (!confirm('Tem certeza que deseja excluir este simulado?')) {
      return;
    }

    try {
      const savedResults = localStorage.getItem('simulateResults');
      if (savedResults) {
        const results = JSON.parse(savedResults);
        const filteredResults = results.filter((r: SimulateResult) => r.id !== resultId);
        localStorage.setItem('simulateResults', JSON.stringify(filteredResults));
        setResults(filteredResults);
      }
    } catch (error) {
      console.error('Erro ao deletar simulado:', error);
      alert('Erro ao deletar o simulado');
    }
  };

  const handleRefazer = (result: SimulateResult) => {
    router.push('/dashboard/simulados/novo');
  };

  const handleContinuar = (result: SimulateResult) => {
    router.push(`/dashboard/simulados/novo?resume=${result.id}`);
  };


  return (
    <div className="max-w-6xl mx-auto space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-8 h-8 text-primary-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Resultados dos Simulados feitos</h1>
            <p className="text-gray-600 mt-1">Visualize o histórico dos seus simulados</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="text-gray-600 mt-4">Carregando resultados...</p>
        </div>
      ) : results.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <ClipboardList className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 text-lg mb-2">Nenhum simulado realizado ainda</p>
          <p className="text-gray-500 text-sm">
            Realize simulados através das notas ou questões para ver seus resultados aqui
          </p>
        </div>
      ) : filteredResults.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-lg">Nenhum simulado encontrado com &quot;{searchQuery}&quot;</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredResults.map((result) => (
            <div
              key={result.id}
              className="bg-white rounded-xl shadow-md border border-gray-200 p-6 flex flex-col gap-4"
            >
              {/* Top row: título à esquerda; percentual + lixeira à direita */}
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-xl font-bold text-gray-900 flex-1 min-w-0">
                  {result.name?.trim() || 'Simulado'}
                </h3>
                <div className="flex items-start gap-2 flex-shrink-0">
                  {result.status === 'in_progress' ? (
                    <div className="flex flex-col items-end">
                      <span className="inline-block px-2.5 py-1 text-xs font-medium bg-amber-100 text-amber-800 rounded-full">
                        Em andamento
                      </span>
                      <p className="text-xs text-gray-600 mt-1">
                        {result.selected_answers ? Object.keys(result.selected_answers).length : result.current_index ?? 0} de {result.total_questions} questões
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-end">
                      <div className="text-2xl font-bold text-primary-600 leading-none">
                        {result.percentage}%
                      </div>
                      <p className="text-xs text-gray-600 mt-1">
                        {result.correct_answers} de {result.total_questions} questões
                      </p>
                    </div>
                  )}
                  <button
                    onClick={() => handleDelete(result.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition flex-shrink-0"
                    aria-label="Excluir simulado"
                    title="Excluir simulado"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Data e hora */}
              <div className="flex items-center gap-2 text-gray-600 text-sm">
                <Calendar className="w-4 h-4 flex-shrink-0 text-gray-500" />
                <span>{formatDate(result.created_at)}</span>
              </div>

              {/* Realizado por (admin) */}
              {userRole === 'admin' && result.user_name && (
                <p className="text-sm text-gray-700">
                  Realizado por: <span className="font-semibold text-primary-700">
                    {result.user_name}
                    {result.user_username && ` (@${result.user_username})`}
                  </span>
                </p>
              )}

              {/* Tags / categorias em pill */}
              {result.tags && result.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {result.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Resumo: corretas / incorretas (concluído) ou corretas / incorretas / não realizadas (em andamento) */}
              {result.status === 'in_progress' ? (
                (() => {
                  const { correct, incorrect, notDone, responded, hasBreakdown } = getProgressCounts(result);
                  return (
                    <div className="flex flex-wrap items-center gap-6 text-sm text-gray-800 pt-1 border-t border-gray-200">
                      {hasBreakdown ? (
                        <>
                          <div className="flex items-center gap-1.5">
                            <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                            <span>{correct} corretas</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                            <span>{incorrect} incorretas</span>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <CheckCircle className="w-4 h-4 text-gray-500 flex-shrink-0" />
                          <span>{responded} respondidas</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <Circle className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <span>{notDone} não realizadas</span>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="flex items-center gap-6 text-sm text-gray-800 pt-1 border-t border-gray-200">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                    <span>{result.correct_answers} corretas</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                    <span>{result.total_questions - result.correct_answers} incorretas</span>
                  </div>
                </div>
              )}

              {/* Botões: Continuar (se em andamento) + Refazer */}
              <div className="flex flex-col sm:flex-row gap-2 mt-auto pt-2">
                {result.status === 'in_progress' && (
                  <button
                    type="button"
                    onClick={() => handleContinuar(result)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition font-semibold text-sm"
                  >
                    <Play className="w-4 h-4" />
                    Continuar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleRefazer(result)}
                  className={result.status === 'in_progress'
                    ? 'flex-1 flex items-center justify-center gap-2 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-semibold text-sm'
                    : 'w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition font-semibold text-sm'}
                >
                  <RotateCcw className="w-4 h-4" />
                  Refazer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
