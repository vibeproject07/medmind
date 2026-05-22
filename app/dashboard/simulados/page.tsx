'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ClipboardList, Calendar, CheckCircle, XCircle, Trash2,
  RotateCcw, Play, Circle, Plus, Search, X,
  GraduationCap, Sparkles, ChevronDown, ChevronUp, BarChart3,
} from 'lucide-react';
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
  simulate_questions?: { id: number; correct_answer: string }[];
  is_tutorial?: boolean;
}

const PAGE_SIZE = 20;
type Tab = 'simulados' | 'resultados';

function SimuladosPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { searchQuery } = useDashboardSearch();

  const [activeTab, setActiveTab] = useState<Tab>(() =>
    searchParams?.get('tab') === 'resultados' ? 'resultados' : 'simulados'
  );

  const [results, setResults] = useState<SimulateResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [tutorialCompleted, setTutorialCompleted] = useState(false);
  const [tutorialInProgress, setTutorialInProgress] = useState(false);
  const [tutorialLoading, setTutorialLoading] = useState(false);
  const [inProgressOpen, setInProgressOpen] = useState(true);

  // Sync tab from URL
  useEffect(() => {
    const t = searchParams?.get('tab');
    if (t === 'resultados') setActiveTab('resultados');
    else if (t === 'simulados') setActiveTab('simulados');
  }, [searchParams]);

  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    setCurrentPage(1);
    router.replace(`/dashboard/simulados${tab === 'resultados' ? '?tab=resultados' : ''}`, { scroll: false });
  };

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(searchText); setCurrentPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchText]);

  const activeSearch = debouncedSearch || searchQuery;

  const filteredResults = useMemo(() => {
    if (!activeSearch.trim()) return results;
    const q = activeSearch.trim().toLowerCase();
    return results.filter(r => (r.name?.trim() || 'Simulado').toLowerCase().includes(q));
  }, [results, activeSearch]);

  const inProgress = useMemo(() => filteredResults.filter(r => r.status === 'in_progress'), [filteredResults]);
  const completed  = useMemo(() => filteredResults.filter(r => r.status !== 'in_progress'), [filteredResults]);

  const totalCompleted = completed.length;
  const totalPages = Math.ceil(totalCompleted / PAGE_SIZE);
  const paginatedCompleted = completed.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => { setCurrentPage(1); }, [searchQuery, debouncedSearch]);

  const getToken = () => typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  useEffect(() => {
    const token = getToken();
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUserRole(payload.role || 'regular');
      } catch { setUserRole('regular'); }
    }
    fetchResults();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchResults = () => {
    setLoading(true);
    try {
      const token = getToken();
      if (!token) { router.push('/login'); return; }
      const raw = localStorage.getItem('simulateResults');
      const all: SimulateResult[] = raw ? JSON.parse(raw) : [];
      setResults(all);
      setTutorialCompleted(all.some(r => r.is_tutorial && r.status === 'completed'));
      setTutorialInProgress(all.some(r => r.is_tutorial && r.status === 'in_progress'));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const formatDate = (s: string) =>
    new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const getProgressCounts = (result: SimulateResult) => {
    const total = result.total_questions;
    const selected = result.selected_answers ?? {};
    const questions = result.simulate_questions;
    if (questions && questions.length > 0) {
      let correct = 0; let incorrect = 0;
      for (const q of questions) {
        const answer = selected[q.id];
        if (!answer) continue;
        if (answer === q.correct_answer) correct++; else incorrect++;
      }
      return { correct, incorrect, notDone: total - correct - incorrect, responded: correct + incorrect, hasBreakdown: true };
    }
    const responded = Object.keys(selected).filter(k => selected[Number(k)]).length;
    return { correct: 0, incorrect: 0, notDone: total - responded, responded, hasBreakdown: false };
  };

  const handleDelete = (resultId: number) => {
    if (!confirm('Excluir este simulado?')) return;
    try {
      const raw = localStorage.getItem('simulateResults');
      if (raw) {
        const filtered = (JSON.parse(raw) as SimulateResult[]).filter(r => r.id !== resultId);
        localStorage.setItem('simulateResults', JSON.stringify(filtered));
        setResults(filtered);
        setTutorialCompleted(filtered.some(r => r.is_tutorial && r.status === 'completed'));
        setTutorialInProgress(filtered.some(r => r.is_tutorial && r.status === 'in_progress'));
      }
    } catch { alert('Erro ao excluir o simulado'); }
  };

  const handleContinuar = (result: SimulateResult) =>
    router.push(`/dashboard/simulados/novo?resume=${result.id}`);

  const handleRefazer = () => router.push('/dashboard/simulados/novo');

  const handleIniciarTutorial = async () => {
    setTutorialLoading(true);
    try {
      const token = getToken();
      if (!token) { router.push('/login'); return; }
      const res = await fetch('/api/questions?page=1&limit=5', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const questions = Array.isArray(data) ? data : (data.questions ?? []);
      if (!questions.length) { alert('Nenhuma questão disponível para o tutorial.'); return; }
      localStorage.setItem('pendingSimulateQuestions', JSON.stringify({
        questions, name: 'Simulado Tutorial', tags: ['Tutorial'], is_tutorial: true,
      }));
      router.push('/dashboard/simulados/novo');
    } catch { alert('Erro ao iniciar o tutorial. Tente novamente.'); }
    finally { setTutorialLoading(false); }
  };

  const tutorialResultInProgress = results.find(r => r.is_tutorial && r.status === 'in_progress');
  const totalAll = results.length;

  // ── Result card (used in Resultados tab) ─────────────────────────────────
  const renderResultCard = (result: SimulateResult) => {
    const isInProgress = result.status === 'in_progress';
    return (
      <div
        key={result.id}
        className="group bg-white rounded-xl border border-gray-200 hover:border-primary-300 hover:shadow-lg hover:shadow-primary-500/5 transition-all overflow-hidden flex flex-col"
      >
        <div className={`h-1 flex-shrink-0 ${isInProgress ? 'bg-gradient-to-r from-amber-400 to-orange-400' : 'bg-gradient-to-r from-primary-400 to-primary-600'}`} />
        <div className="p-4 sm:p-5 flex flex-col flex-1 gap-3">
          {/* Title + score + delete */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="flex-1 font-semibold text-gray-900 text-base leading-snug group-hover:text-primary-700 transition-colors">
              {result.name?.trim() || 'Simulado'}
            </h3>
            <div className="flex items-start gap-2 flex-shrink-0">
              {isInProgress ? (
                <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 rounded-full whitespace-nowrap">
                  Em andamento
                </span>
              ) : (
                <div className="text-right">
                  <div className="text-xl font-bold text-primary-600 leading-none">{result.percentage}%</div>
                  <div className="text-xs text-gray-400 mt-0.5">{result.correct_answers}/{result.total_questions}</div>
                </div>
              )}
              <button onClick={() => handleDelete(result.id)}
                className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition flex-shrink-0"
                aria-label="Excluir">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {userRole === 'admin' && result.user_name && (
            <p className="text-xs text-gray-500">Por: <span className="font-medium text-gray-700">{result.user_name}{result.user_username && ` (@${result.user_username})`}</span></p>
          )}

          {result.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {result.tags.map((tag, idx) => (
                <span key={idx} className="px-2 py-0.5 text-xs font-medium bg-primary-50 text-primary-700 rounded-full border border-primary-100">{tag}</span>
              ))}
            </div>
          )}

          {isInProgress ? (
            (() => {
              const { correct, incorrect, notDone, responded, hasBreakdown } = getProgressCounts(result);
              return (
                <div className="flex flex-wrap items-center gap-4 text-sm text-gray-700 pt-2 border-t border-gray-100">
                  {hasBreakdown ? (
                    <>
                      <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-green-500" />{correct} certas</span>
                      <span className="flex items-center gap-1.5"><XCircle className="w-4 h-4 text-red-500" />{incorrect} erradas</span>
                    </>
                  ) : (
                    <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-gray-400" />{responded} respondidas</span>
                  )}
                  <span className="flex items-center gap-1.5"><Circle className="w-4 h-4 text-gray-300" />{notDone} restantes</span>
                </div>
              );
            })()
          ) : (
            <div className="flex items-center gap-4 text-sm text-gray-700 pt-2 border-t border-gray-100">
              <span className="flex items-center gap-1.5"><CheckCircle className="w-4 h-4 text-green-500" />{result.correct_answers} certas</span>
              <span className="flex items-center gap-1.5"><XCircle className="w-4 h-4 text-red-500" />{result.total_questions - result.correct_answers} erradas</span>
            </div>
          )}

          <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-auto">
            <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
            {formatDate(result.created_at)}
          </div>

          <div className="flex gap-2 pt-1">
            {isInProgress && (
              <button type="button" onClick={() => handleContinuar(result)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition font-semibold text-sm">
                <Play className="w-4 h-4" />Continuar
              </button>
            )}
            <button type="button" onClick={handleRefazer}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition ${
                isInProgress ? 'flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50' : 'w-full bg-primary-600 text-white hover:bg-primary-700'
              }`}>
              <RotateCcw className="w-4 h-4" />Refazer
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 relative pb-6">

      {/* ══ MOBILE: action row ════════════════════════════════════════════ */}
      <div className="md:hidden flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
            placeholder="Buscar simulados…"
            className="w-full pl-9 pr-8 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent shadow-sm" />
          {searchText && (
            <button type="button" onClick={() => setSearchText('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button type="button" onClick={() => router.push('/dashboard/simulados/novo')}
          className="inline-flex items-center gap-1.5 bg-primary-600 text-white px-3.5 py-2.5 rounded-xl text-sm font-semibold hover:bg-primary-700 transition shadow-sm whitespace-nowrap">
          <Plus className="w-4 h-4" />Novo
        </button>
      </div>

      {/* ══ DESKTOP: gradient header ══════════════════════════════════════ */}
      <div className="hidden md:block bg-gradient-to-br from-primary-600 to-primary-700 rounded-2xl p-6 text-white shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="bg-white/15 p-2.5 rounded-xl">
              <ClipboardList className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold leading-tight">Simulados</h1>
              <p className="text-primary-100 text-sm mt-0.5">Pratique com simulados e acompanhe seu desempenho</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!loading && totalAll > 0 && (
              <div className="bg-white/15 px-3 py-1.5 rounded-lg text-sm font-semibold">
                {totalAll} {totalAll === 1 ? 'simulado' : 'simulados'}
              </div>
            )}
            <button type="button" onClick={() => router.push('/dashboard/simulados/novo')}
              className="inline-flex items-center gap-2 bg-white text-primary-700 px-4 py-2 rounded-xl font-semibold text-sm hover:bg-primary-50 transition shadow-sm">
              <Plus className="w-4 h-4" />Novo Simulado
            </button>
          </div>
        </div>
      </div>

      {/* ══ TAB BAR ══════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
        <button
          type="button"
          onClick={() => switchTab('simulados')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-semibold transition-all ${
            activeTab === 'simulados'
              ? 'bg-white text-primary-700 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          Meus Simulados
        </button>
        <button
          type="button"
          onClick={() => switchTab('resultados')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-semibold transition-all ${
            activeTab === 'resultados'
              ? 'bg-white text-primary-700 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          Resultados
          {completed.length > 0 && (
            <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${
              activeTab === 'resultados' ? 'bg-primary-100 text-primary-700' : 'bg-gray-200 text-gray-600'
            }`}>
              {completed.length}
            </span>
          )}
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          ABA 1 — MEUS SIMULADOS
          ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'simulados' && (
        <div className="space-y-4">

          {/* Tutorial card */}
          <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl border-2 border-emerald-200 overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-emerald-400 to-teal-500" />
            <div className="p-4 sm:p-5">
              <div className="flex items-start gap-4">
                <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-2.5 rounded-xl flex-shrink-0 hidden sm:flex items-center justify-center">
                  <GraduationCap className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  {/* Linha 1: título + botão */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="font-bold text-gray-900 text-base">Simulado Tutorial</h3>
                    {tutorialInProgress && tutorialResultInProgress ? (
                      <button type="button" onClick={() => handleContinuar(tutorialResultInProgress)}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition shadow-sm whitespace-nowrap flex-shrink-0">
                        <Play className="w-3.5 h-3.5" />Continuar
                      </button>
                    ) : (
                      <button type="button" onClick={handleIniciarTutorial} disabled={tutorialLoading}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition shadow-sm whitespace-nowrap flex-shrink-0 disabled:opacity-60">
                        {tutorialLoading ? (
                          <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Carregando…</>
                        ) : tutorialCompleted ? (
                          <><RotateCcw className="w-3.5 h-3.5" />Refazer</>
                        ) : (
                          <><Play className="w-3.5 h-3.5" />Iniciar Tutorial</>
                        )}
                      </button>
                    )}
                  </div>
                  {/* Linha 2: chips */}
                  <div className="flex items-center gap-1.5 flex-wrap mb-2">
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-full border border-emerald-200">Tutorial</span>
                    <span className="px-2 py-0.5 bg-white text-gray-500 text-xs font-medium rounded-full border border-gray-200">5 questões</span>
                    {tutorialCompleted && (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full border border-green-200 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />Concluído
                      </span>
                    )}
                  </div>
                  {/* Linha 3: descrição */}
                  <p className="text-sm text-gray-600 mb-2 leading-relaxed">
                    Aprenda como funcionam os simulados do MedMind: responda questões, use o modo rascunho para taxar alternativas, veja o gabarito e o comentário da IA ao final.
                  </p>
                  {/* Linha 4: features */}
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Comentários de IA • Modo rascunho • Gabarito detalhado</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
              <p className="text-gray-500 mt-4 text-sm">Carregando…</p>
            </div>
          )}

          {/* Em andamento */}
          {!loading && inProgress.length > 0 && (
            <div className="space-y-3">
              <button type="button" onClick={() => setInProgressOpen(v => !v)}
                className="flex items-center gap-2 w-full text-left group">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Em andamento ({inProgress.length})
                </span>
                <div className="flex-1 h-px bg-gray-200" />
                {inProgressOpen
                  ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600 flex-shrink-0" />
                  : <ChevronDown className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600 flex-shrink-0" />}
              </button>
              {inProgressOpen && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {inProgress.map(renderResultCard)}
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!loading && totalAll === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <div className="w-14 h-14 bg-primary-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <ClipboardList className="w-7 h-7 text-primary-400" />
              </div>
              <p className="text-gray-700 font-semibold mb-1">Nenhum simulado ainda</p>
              <p className="text-gray-500 text-sm mb-5">Comece pelo Tutorial acima ou crie um simulado personalizado.</p>
              <button type="button" onClick={() => router.push('/dashboard/simulados/novo')}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl font-semibold text-sm hover:bg-primary-700 transition shadow-sm">
                <Plus className="w-4 h-4" />Criar primeiro simulado
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          ABA 2 — RESULTADOS
          ══════════════════════════════════════════════════════════════════ */}
      {activeTab === 'resultados' && (
        <div className="space-y-4">

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
              placeholder="Buscar resultado por nome…"
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent shadow-sm" />
            {searchText && (
              <button type="button" onClick={() => setSearchText('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Loading */}
          {loading && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
              <p className="text-gray-500 mt-4 text-sm">Carregando resultados…</p>
            </div>
          )}

          {/* Results grid */}
          {!loading && completed.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {totalCompleted} {totalCompleted === 1 ? 'resultado' : 'resultados'}
                </span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {paginatedCompleted.map(renderResultCard)}
              </div>
            </div>
          )}

          {/* Empty: sem nenhum resultado ainda */}
          {!loading && completed.length === 0 && !activeSearch && (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <BarChart3 className="w-7 h-7 text-gray-300" />
              </div>
              <p className="text-gray-700 font-semibold mb-1">Nenhum resultado ainda</p>
              <p className="text-gray-500 text-sm mb-5">
                Complete um simulado e seu resultado aparecerá aqui.
              </p>
              <button type="button" onClick={() => switchTab('simulados')}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl font-semibold text-sm hover:bg-primary-700 transition shadow-sm">
                <ClipboardList className="w-4 h-4" />Ir para Meus Simulados
              </button>
            </div>
          )}

          {/* Empty search */}
          {!loading && completed.length === 0 && activeSearch && (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-gray-500">Nenhum resultado encontrado com <strong>&quot;{activeSearch}&quot;</strong></p>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <button type="button" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition">
                Anterior
              </button>
              <span className="px-4 py-2 text-sm text-gray-500">Página {currentPage} de {totalPages}</span>
              <button type="button" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition">
                Próxima
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SimuladosPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>}>
      <SimuladosPageInner />
    </Suspense>
  );
}
