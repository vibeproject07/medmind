'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Eye,
  ClipboardList,
  MessageSquare,
  Loader2,
} from 'lucide-react';
import TagAutocomplete from '@/components/Common/TagAutocomplete';
import ImageLightbox from '@/components/Common/ImageLightbox';
import {
  ASSUNTOS_BY_AREA,
  toDisplayArea,
  toDisplayAssunto,
  fromDisplay,
  AREAS_OPTIONS_DISPLAY,
} from '@/lib/areas-assuntos';

const MAX_SIMULATE_QUESTIONS = 120;

const AVAILABLE_TAGS = [
  'Acupuntura',
  'Anestesiologia',
  'Cirurgia Cardiovascular',
  'Cirurgia Geral',
  'Cirurgia Vascular',
  'Clínica Médica',
  'Dermatologia',
  'Genética Médica',
  'Ginecologia e Obstetrícia',
  'Homeopatia',
  'Infectologia',
  'Medicina de Emergência',
  'Medicina de Família e Comunidade',
  'Medicina de Tráfego',
  'Medicina do Trabalho',
  'Medicina Esportiva',
  'Medicina Física e Reabilitação',
  'Medicina Intensiva',
  'Medicina Legal e Perícia Médica',
  'Medicina Nuclear',
  'Medicina Preventiva e Social',
  'Neurocirurgia',
  'Neurologia',
  'Oftalmologia',
  'Ortopedia e Traumatologia',
  'Otorrinolaringologia',
  'Patologia',
  'Patologia Clínica / Medicina Laboratorial',
  'Pediatria',
  'Psiquiatria',
  'Radiologia e Diagnóstico por Imagem',
  'Radioterapia',
];

interface Question {
  id: number;
  statement: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e?: string | null;
  correct_answer: 'A' | 'B' | 'C' | 'D' | 'E';
  explanation?: string | null;
  tags?: string[];
  images?: string[];
  areas_conhecimento?: string[];
  assuntos?: string[];
  anulada?: boolean;
}

type Phase = 'wizard-1' | 'wizard-2' | 'loading' | 'executing' | 'results';

function SimuladoNovoInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [availableTags, setAvailableTags] = useState<string[]>(AVAILABLE_TAGS);

  const [phase, setPhase] = useState<Phase>('wizard-1');

  const [wizardFilters, setWizardFilters] = useState<{
    tags: string[];
    areas_conhecimento: string[];
    assuntos: string[];
  }>({ tags: [], areas_conhecimento: [], assuntos: [] });

  const wizardAssuntosOptions = useMemo(() => {
    if (wizardFilters.areas_conhecimento.length === 0) return [];
    const set = new Set<string>();
    wizardFilters.areas_conhecimento.forEach((area) => {
      const assuntos = ASSUNTOS_BY_AREA[area];
      if (assuntos) assuntos.forEach((a) => set.add(a));
    });
    return Array.from(set);
  }, [wizardFilters.areas_conhecimento]);

  const [simulateQuestionCount, setSimulateQuestionCount] = useState<number>(10);
  const [simulateAvailableCount, setSimulateAvailableCount] = useState<number | null>(null);
  const [simulateName, setSimulateName] = useState<string>('');
  const [wizardNomearExpanded, setWizardNomearExpanded] = useState(false);

  const [simulateQuestions, setSimulateQuestions] = useState<Question[]>([]);
  const [currentSimulateIndex, setCurrentSimulateIndex] = useState(0);
  const [selectedSimulateAnswers, setSelectedSimulateAnswers] = useState<Record<number, string>>({});
  const [confirmedTaxed, setConfirmedTaxed] = useState<Map<number, Set<string>>>(new Map());
  const [simulateRevealedAnswers, setSimulateRevealedAnswers] = useState<Set<number>>(new Set());
  const [currentSimulateResultId, setCurrentSimulateResultId] = useState<number | null>(null);
  const [resumedTags, setResumedTags] = useState<string[]>([]);
  const [presetQuestionsPool, setPresetQuestionsPool] = useState<Question[] | null>(null);

  const [aiCommentOpen, setAiCommentOpen] = useState(false);
  const [aiCommentCache, setAiCommentCache] = useState<Record<number, string | null>>({});
  const [aiCommentLoading, setAiCommentLoading] = useState(false);

  const getToken = () => (typeof window !== 'undefined' ? localStorage.getItem('token') : null);

  const fetchAiComment = async (questionId: number) => {
    if (aiCommentCache[questionId] !== undefined) {
      setAiCommentOpen(true);
      return;
    }
    setAiCommentLoading(true);
    setAiCommentOpen(true);
    try {
      const token = getToken();
      const res = await fetch(`/api/comentarios/${questionId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      setAiCommentCache((prev) => ({ ...prev, [questionId]: data.comentario ?? null }));
    } catch {
      setAiCommentCache((prev) => ({ ...prev, [questionId]: null }));
    } finally {
      setAiCommentLoading(false);
    }
  };

  const fetchQuestionsPool = async (
    filtersOverride: { tags?: string[]; areas_conhecimento?: string[]; assuntos?: string[] },
    maxLimit = 500
  ): Promise<Question[]> => {
    const token = getToken();
    if (!token) return [];
    const params = new URLSearchParams();
    params.set('page', '1');
    params.set('limit', String(maxLimit));
    const f = filtersOverride;
    if ((f.tags ?? []).length > 0) params.append('tags', (f.tags ?? []).join(','));
    if ((f.areas_conhecimento ?? []).length > 0)
      params.append('areas_conhecimento', (f.areas_conhecimento ?? []).join(','));
    if ((f.assuntos ?? []).length > 0) params.append('assuntos', (f.assuntos ?? []).join(','));
    const response = await fetch(`/api/questions?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [];
    const data = await response.json();
    if (Array.isArray(data)) return data;
    return data.questions ?? [];
  };

  const fetchQuestionsCount = async (
    filtersOverride: { tags?: string[]; areas_conhecimento?: string[]; assuntos?: string[] }
  ): Promise<number> => {
    const token = getToken();
    if (!token) return 0;
    const params = new URLSearchParams();
    params.set('page', '1');
    params.set('limit', '1');
    const f = filtersOverride;
    if ((f.tags ?? []).length > 0) params.append('tags', (f.tags ?? []).join(','));
    if ((f.areas_conhecimento ?? []).length > 0)
      params.append('areas_conhecimento', (f.areas_conhecimento ?? []).join(','));
    if ((f.assuntos ?? []).length > 0) params.append('assuntos', (f.assuntos ?? []).join(','));
    const response = await fetch(`/api/questions?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return 0;
    const data = await response.json();
    return typeof data?.total === 'number' ? data.total : 0;
  };

  useEffect(() => {
    const tagsParam = searchParams.get('tags');
    const areasParam = searchParams.get('areas');
    const assuntosParam = searchParams.get('assuntos');
    const resumeParam = searchParams.get('resume');

    if (resumeParam) {
      const id = Number(resumeParam);
      if (!Number.isNaN(id)) {
        const raw = localStorage.getItem('simulateResults');
        const list: {
          id?: number;
          status?: string;
          simulate_questions?: Question[];
          current_index?: number;
          selected_answers?: Record<number, string>;
          tags?: string[];
        }[] = raw ? JSON.parse(raw) : [];
        const result = list.find((r) => r.id === id && r.status === 'in_progress');
        if (result?.simulate_questions?.length) {
          setSimulateQuestions(result.simulate_questions);
          setCurrentSimulateIndex(result.current_index ?? 0);
          setSelectedSimulateAnswers(result.selected_answers ?? {});
          setCurrentSimulateResultId(id);
          setResumedTags(result.tags ?? []);
          setPhase('executing');
          return;
        }
      }
    }

    const pendingRaw = localStorage.getItem('pendingSimulateQuestions');
    if (pendingRaw) {
      localStorage.removeItem('pendingSimulateQuestions');
      try {
        const pending = JSON.parse(pendingRaw) as {
          questions: Question[];
          name?: string;
          tags?: string[];
        };
        if (pending.questions?.length) {
          setPresetQuestionsPool(pending.questions);
          setSimulateName(pending.name ?? '');
          setResumedTags(pending.tags ?? []);
          setSimulateAvailableCount(pending.questions.length);
          setSimulateQuestionCount(Math.min(10, pending.questions.length));
          setPhase('wizard-2');
          return;
        }
      } catch {
      }
    }

    const prefillTags = tagsParam ? JSON.parse(decodeURIComponent(tagsParam)) : [];
    const prefillAreas = areasParam ? JSON.parse(decodeURIComponent(areasParam)) : [];
    const prefillAssuntos = assuntosParam ? JSON.parse(decodeURIComponent(assuntosParam)) : [];
    setWizardFilters({
      tags: prefillTags,
      areas_conhecimento: prefillAreas,
      assuntos: prefillAssuntos,
    });
  }, [searchParams]);

  useEffect(() => {
    if (phase !== 'wizard-2') {
      if (phase !== 'wizard-2') setSimulateAvailableCount(null);
      return;
    }
    let cancelled = false;
    fetchQuestionsCount(wizardFilters).then((total) => {
      if (!cancelled) setSimulateAvailableCount(total);
    });
    return () => {
      cancelled = true;
    };
  }, [phase, wizardFilters.tags, wizardFilters.areas_conhecimento, wizardFilters.assuntos]);

  useEffect(() => {
    if (currentSimulateResultId == null || !simulateQuestions.length) return;
    const raw = localStorage.getItem('simulateResults');
    const list: { id?: number; current_index?: number; selected_answers?: Record<number, string> }[] = raw
      ? JSON.parse(raw)
      : [];
    const idx = list.findIndex((r) => r.id === currentSimulateResultId);
    if (idx < 0) return;
    list[idx] = { ...list[idx], current_index: currentSimulateIndex, selected_answers: selectedSimulateAnswers };
    localStorage.setItem('simulateResults', JSON.stringify(list));
  }, [currentSimulateResultId, currentSimulateIndex, selectedSimulateAnswers, simulateQuestions.length]);

  const handleStartSimulate = async () => {
    setPhase('loading');
    try {
      let questionsPool: Question[];
      if (presetQuestionsPool) {
        questionsPool = presetQuestionsPool;
      } else {
        questionsPool = await fetchQuestionsPool(wizardFilters, 500);
      }
      if (questionsPool.length === 0) {
        setPhase('wizard-2');
        return;
      }
      const shuffled = [...questionsPool].sort(() => Math.random() - 0.5);
      const effectiveMax = Math.min(MAX_SIMULATE_QUESTIONS, simulateAvailableCount ?? MAX_SIMULATE_QUESTIONS);
      const count = Math.min(simulateQuestionCount, effectiveMax, shuffled.length);
      const selected = shuffled.slice(0, count);

      const tagsBase = presetQuestionsPool ? resumedTags : wizardFilters.tags ?? [];
      const areasDisplay = presetQuestionsPool ? [] : (wizardFilters.areas_conhecimento ?? []).map(toDisplayArea).filter(Boolean);
      const assuntosDisplay = presetQuestionsPool ? [] : (wizardFilters.assuntos ?? []).map(toDisplayAssunto).filter(Boolean);
      const tags = [...tagsBase, ...areasDisplay, ...assuntosDisplay];

      const resultId = Date.now();
      const inProgressResult = {
        id: resultId,
        status: 'in_progress' as const,
        total_questions: selected.length,
        correct_answers: 0,
        percentage: 0,
        tags,
        created_at: new Date().toISOString(),
        name: simulateName.trim() || undefined,
        simulate_questions: selected,
        current_index: 0,
        selected_answers: {} as Record<number, string>,
      };
      const savedResults = localStorage.getItem('simulateResults');
      const results = savedResults ? JSON.parse(savedResults) : [];
      results.unshift(inProgressResult);
      localStorage.setItem('simulateResults', JSON.stringify(results));

      setSimulateQuestions(selected);
      setCurrentSimulateIndex(0);
      setSelectedSimulateAnswers({});
      setConfirmedTaxed(new Map());
      setSimulateRevealedAnswers(new Set());
      setCurrentSimulateResultId(resultId);
      setResumedTags(tags);
      setPhase('executing');
    } catch (error) {
      console.error('Erro ao preparar questões:', error);
      setPhase('wizard-2');
    }
  };

  const calculateSimulateScore = () => {
    let correct = 0;
    simulateQuestions.forEach((question) => {
      if (selectedSimulateAnswers[question.id] === question.correct_answer) correct++;
    });
    return { correct, total: simulateQuestions.length };
  };

  useEffect(() => {
    setAiCommentOpen(false);
  }, [currentSimulateIndex]);

  const handleSimulateAnswerSelect = (answer: string) => {
    const currentQuestion = simulateQuestions[currentSimulateIndex];
    setSelectedSimulateAnswers((prev) => ({ ...prev, [currentQuestion.id]: answer }));
  };

  const handleSimulateNext = () => {
    if (currentSimulateIndex < simulateQuestions.length - 1) {
      setCurrentSimulateIndex((prev) => prev + 1);
    } else {
      setPhase('results');
    }
  };

  const handleSimulatePrevious = () => {
    if (currentSimulateIndex > 0) setCurrentSimulateIndex((prev) => prev - 1);
  };

  const taxAlternative = (questionId: number, optionKey: string) => {
    setConfirmedTaxed((prev) => {
      const newMap = new Map(prev);
      const existing = newMap.get(questionId) || new Set<string>();
      const next = new Set(existing);
      if (next.has(optionKey)) next.delete(optionKey);
      else next.add(optionKey);
      if (next.size === 0) newMap.delete(questionId);
      else newMap.set(questionId, next);
      return newMap;
    });
  };

  const getAvailableOptions = (question: Question) => {
    const options: { key: string; value: string }[] = [
      { key: 'A', value: question.option_a },
      { key: 'B', value: question.option_b },
    ];
    if (question.option_c) options.push({ key: 'C', value: question.option_c });
    if (question.option_d) options.push({ key: 'D', value: question.option_d });
    if (question.option_e) options.push({ key: 'E', value: question.option_e });
    return options;
  };

  const handleSaveSimulate = () => {
    const { correct, total } = calculateSimulateScore();
    const percentage = Math.round((correct / total) * 100);

    let userInfo: Record<string, unknown> = {};
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        userInfo = {
          user_id: payload.id,
          user_name: payload.name || '',
          user_username: payload.username || null,
          user_email: payload.email || '',
        };
      } catch {
      }
    }

    const savedResults = localStorage.getItem('simulateResults');
    const results: { id: number; tags?: string[]; created_at?: string; [k: string]: unknown }[] = savedResults
      ? JSON.parse(savedResults)
      : [];

    if (currentSimulateResultId != null) {
      const idx = results.findIndex((r) => r.id === currentSimulateResultId);
      if (idx >= 0) {
        const existing = results[idx];
        results[idx] = {
          id: existing.id,
          status: 'completed',
          total_questions: total,
          correct_answers: correct,
          percentage,
          tags: existing.tags ?? resumedTags,
          created_at: existing.created_at ?? new Date().toISOString(),
          name: simulateName.trim() || (existing as { name?: string }).name,
          ...userInfo,
        };
      }
      setCurrentSimulateResultId(null);
    } else {
      results.unshift({
        id: Date.now(),
        status: 'completed',
        total_questions: total,
        correct_answers: correct,
        percentage,
        tags: resumedTags,
        created_at: new Date().toISOString(),
        name: simulateName.trim() || undefined,
        ...userInfo,
      });
    }

    localStorage.setItem('simulateResults', JSON.stringify(results));
    router.push('/dashboard/simulados');
  };

  const handleRefazerSimulate = () => {
    setCurrentSimulateIndex(0);
    setSelectedSimulateAnswers({});
    setConfirmedTaxed(new Map());
    setSimulateRevealedAnswers(new Set());
    setCurrentSimulateResultId(null);
    setWizardFilters({ tags: [], areas_conhecimento: [], assuntos: [] });
    setSimulateName('');
    setPhase('wizard-1');
  };

  if (phase === 'wizard-1') {
    const hasFilter =
      wizardFilters.tags.length > 0 ||
      wizardFilters.areas_conhecimento.length > 0 ||
      wizardFilters.assuntos.length > 0;

    return (
      <div className="max-w-2xl mx-auto space-y-6 p-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="p-2 rounded-lg hover:bg-gray-100 transition"
            aria-label="Voltar"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex items-center gap-3">
            <ClipboardList className="w-7 h-7 text-primary-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Fazer Simulado — Passo 1 de 2</h1>
              <p className="text-sm text-gray-600">
                Selecione ao menos uma opção (Área do Conhecimento, Assunto ou Especialidade) para avançar.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Área do Conhecimento</label>
            <TagAutocomplete
              options={AREAS_OPTIONS_DISPLAY}
              selectedTags={wizardFilters.areas_conhecimento.map(toDisplayArea)}
              onChange={(tags) =>
                setWizardFilters((prev) => ({ ...prev, areas_conhecimento: tags.map(fromDisplay) }))
              }
              onSaveNewTag={() => {}}
              placeholder="Filtrar por áreas do conhecimento..."
              maxTags={10}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Assunto</label>
            <TagAutocomplete
              options={wizardAssuntosOptions.map(toDisplayAssunto)}
              selectedTags={wizardFilters.assuntos.map(toDisplayAssunto)}
              onChange={(tags) => setWizardFilters((prev) => ({ ...prev, assuntos: tags.map(fromDisplay) }))}
              onSaveNewTag={() => {}}
              placeholder={
                wizardFilters.areas_conhecimento.length === 0
                  ? 'Selecione uma área do conhecimento primeiro'
                  : 'Filtrar por assuntos...'
              }
              maxTags={10}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Especialidade</label>
            <TagAutocomplete
              options={availableTags}
              selectedTags={wizardFilters.tags}
              onChange={(tags) => setWizardFilters((prev) => ({ ...prev, tags }))}
              onSaveNewTag={(newTag) => {
                if (!availableTags.includes(newTag)) setAvailableTags([...availableTags, newTag]);
              }}
              placeholder="Filtrar por especialidade..."
              maxTags={10}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!hasFilter}
            onClick={() => setPhase('wizard-2')}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Avançar
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'wizard-2') {
    const effectiveMax = Math.min(MAX_SIMULATE_QUESTIONS, simulateAvailableCount ?? MAX_SIMULATE_QUESTIONS);
    const displayMax = simulateAvailableCount != null ? effectiveMax : MAX_SIMULATE_QUESTIONS;

    return (
      <div className="max-w-2xl mx-auto space-y-6 p-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPhase('wizard-1')}
            className="p-2 rounded-lg hover:bg-gray-100 transition"
            aria-label="Voltar"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex items-center gap-3">
            <ClipboardList className="w-7 h-7 text-primary-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Fazer Simulado — Passo 2 de 2</h1>
              <p className="text-sm text-gray-600">Selecione a quantidade de questões que deseja responder.</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Quantidade de questões (máximo: {displayMax}
              {simulateAvailableCount != null && simulateAvailableCount < MAX_SIMULATE_QUESTIONS && (
                <span className="text-gray-500 font-normal">
                  {' '}— {simulateAvailableCount} disponíveis com os filtros selecionados
                </span>
              )}
              )
            </label>
            <input
              type="number"
              min="1"
              max={effectiveMax}
              value={Math.min(simulateQuestionCount, effectiveMax)}
              onChange={(e) =>
                setSimulateQuestionCount(
                  Math.min(Math.max(1, parseInt(e.target.value) || 1), effectiveMax)
                )
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nome:</label>
            <input
              type="text"
              value={simulateName}
              onChange={(e) => setSimulateName(e.target.value)}
              placeholder="Nomeie seu simulado"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setWizardNomearExpanded((prev) => !prev)}
              className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left font-medium text-gray-800 hover:bg-gray-50 transition"
              aria-expanded={wizardNomearExpanded}
            >
              <span>Sobre a nomeação:</span>
              {wizardNomearExpanded ? (
                <ChevronUp className="w-5 h-5 text-gray-500 flex-shrink-0" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-500 flex-shrink-0" />
              )}
            </button>
            {wizardNomearExpanded && (
              <div className="px-4 pb-4 pt-0">
                <p className="text-sm text-gray-600">
                  Caso o simulado não seja nomeado, por padrão ele será identificado pelo número do simulado
                  realizado por você (por exemplo: Simulado 1, Simulado 2, etc.).
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => setPhase('wizard-1')}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={handleStartSimulate}
            className="flex-1 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          >
            Iniciar Simulado
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        <p className="text-gray-600">Carregando questões...</p>
      </div>
    );
  }

  if (phase === 'results') {
    const { correct, total } = calculateSimulateScore();
    const percentage = Math.round((correct / total) * 100);

    return (
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <h2 className="text-2xl font-bold text-gray-800">Resultado do Simulado</h2>
          <button
            type="button"
            onClick={() => router.push('/dashboard/simulados')}
            className="p-2 rounded-lg hover:bg-gray-100 transition"
            aria-label="Fechar"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="text-center bg-white rounded-lg border border-gray-200 p-8">
              <div className="text-6xl font-bold text-primary-600 mb-2">{percentage}%</div>
              <p className="text-xl text-gray-700">
                Você acertou {correct} de {total} questões
              </p>
            </div>

            <div className="space-y-4">
              {simulateQuestions.map((question, index) => {
                const userAnswer = selectedSimulateAnswers[question.id];
                const isCorrect = userAnswer === question.correct_answer;
                return (
                  <div
                    key={question.id}
                    className={`p-4 rounded-lg border-2 ${
                      isCorrect ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <p className="font-semibold text-gray-800">Questão {index + 1}</p>
                      {isCorrect ? (
                        <Check className="w-5 h-5 text-green-600" />
                      ) : (
                        <X className="w-5 h-5 text-red-600" />
                      )}
                    </div>
                    <p className="text-gray-700 mb-2">{question.statement}</p>
                    <div className="text-sm space-y-1">
                      <p>
                        <span className="font-medium">Sua resposta:</span>{' '}
                        <span className={isCorrect ? 'text-green-700' : 'text-red-700'}>
                          {userAnswer || 'Não respondida'}
                        </span>
                      </p>
                      {!isCorrect && (
                        <p>
                          <span className="font-medium">Resposta correta:</span>{' '}
                          <span className="text-green-700">{question.correct_answer}</span>
                        </p>
                      )}
                      {question.explanation && (
                        <p className="mt-2 text-gray-600">
                          <span className="font-medium">Explicação:</span> {question.explanation}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bg-white border-t border-gray-200 px-6 py-4 flex gap-3 justify-center flex-shrink-0">
          <button
            type="button"
            onClick={handleRefazerSimulate}
            className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
          >
            Refazer Simulado
          </button>
          <button
            type="button"
            onClick={handleSaveSimulate}
            className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          >
            Salvar
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'executing' && simulateQuestions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-gray-600">Nenhuma questão disponível para o simulado.</p>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
        >
          Voltar
        </button>
      </div>
    );
  }

  const currentQuestion = simulateQuestions[currentSimulateIndex];
  const availableOptions = currentQuestion ? getAvailableOptions(currentQuestion) : [];
  const selectedAnswer = currentQuestion ? selectedSimulateAnswers[currentQuestion.id] : undefined;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <h2 className="text-2xl font-bold text-gray-800 flex-shrink-0">Simulado</h2>
            <p className="text-gray-600 text-sm flex-shrink-0">
              Questão {currentSimulateIndex + 1} de {simulateQuestions.length}
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push('/dashboard/simulados')}
            className="p-2 rounded-lg hover:bg-gray-100 transition flex-shrink-0"
            aria-label="Fechar"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        <div className="flex items-center w-full mt-4 overflow-x-auto">
          {simulateQuestions.map((q, i) => {
            const revealed = simulateRevealedAnswers.has(q.id);
            const answered = !!selectedSimulateAnswers[q.id];
            const correct = selectedSimulateAnswers[q.id] === q.correct_answer;
            const ballStyle = revealed
              ? correct
                ? 'bg-green-500 text-white'
                : 'bg-red-500 text-white'
              : answered
              ? 'bg-gray-300 text-gray-800'
              : 'bg-white border-2 border-black text-gray-800';
            const ballTitle = revealed
              ? correct
                ? `Questão ${i + 1} (correta)`
                : `Questão ${i + 1} (incorreta)`
              : answered
              ? `Questão ${i + 1} (respondida)`
              : `Questão ${i + 1} (não respondida)`;
            const isCurrentQuestion = i === currentSimulateIndex;
            return (
              <span key={q.id} className="contents">
                <button
                  type="button"
                  onClick={() => setCurrentSimulateIndex(i)}
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition text-sm font-medium cursor-pointer hover:opacity-90 hover:ring-2 hover:ring-primary-500 hover:ring-offset-1 ${ballStyle} ${
                    isCurrentQuestion ? 'ring-2 ring-primary-600 ring-offset-2' : ''
                  }`}
                  title={`${ballTitle} — Clique para ir à questão`}
                >
                  {revealed ? correct ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" /> : i + 1}
                </button>
                {i < simulateQuestions.length - 1 && (
                  <div className="flex-1 min-w-0 flex items-center px-0.5" aria-hidden>
                    <div className="h-px w-full bg-gray-300" />
                  </div>
                )}
              </span>
            );
          })}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className={`overflow-y-auto p-6 ${aiCommentOpen ? 'w-1/2 border-r border-gray-200' : 'w-full'}`}>
        {currentQuestion && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div>
              <p className="text-lg font-medium text-gray-800">{currentQuestion.statement}</p>
            </div>

            {currentQuestion.images && currentQuestion.images.length > 0 && (
              <div className="flex flex-wrap justify-center gap-4">
                {currentQuestion.images.map((image: string, idx: number) => (
                  <ImageLightbox key={idx} src={image} alt={`Imagem ${idx + 1}`} className="h-48 w-auto max-w-xs" />
                ))}
              </div>
            )}

            <div className="space-y-3">
              {availableOptions.map((option) => {
                const isSelected = selectedAnswer === option.key;
                const isConfirmedTaxed = confirmedTaxed.get(currentQuestion.id)?.has(option.key) || false;

                return (
                  <div
                    key={option.key}
                    className={`w-full p-4 rounded-lg border-2 flex items-center gap-3 transition ${
                      isConfirmedTaxed
                        ? 'border-gray-200 bg-gray-100 line-through opacity-60'
                        : isSelected
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => !isConfirmedTaxed && handleSimulateAnswerSelect(option.key)}
                      disabled={isConfirmedTaxed}
                      className={`flex flex-1 items-center gap-3 text-left min-w-0 ${
                        isConfirmedTaxed ? 'cursor-not-allowed' : ''
                      }`}
                    >
                      <div
                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          isConfirmedTaxed
                            ? 'border-gray-300 bg-gray-200'
                            : isSelected
                            ? 'border-primary-600 bg-primary-600'
                            : 'border-gray-400'
                        }`}
                      >
                        {isSelected && !isConfirmedTaxed && <Check className="w-4 h-4 text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-gray-700 text-sm">{option.key})</span>{' '}
                        <span className="text-gray-700 text-sm">{option.value}</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        taxAlternative(currentQuestion.id, option.key);
                      }}
                      className={`p-2 rounded-lg transition flex-shrink-0 flex items-center justify-center ${
                        isConfirmedTaxed
                          ? 'bg-orange-500 text-white hover:bg-orange-600'
                          : 'bg-white border-2 border-orange-500 text-orange-600 hover:bg-orange-50'
                      }`}
                      title={isConfirmedTaxed ? 'Desfazer taxar' : 'Taxar alternativa'}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            {simulateRevealedAnswers.has(currentQuestion.id) && (() => {
              const correctOption = availableOptions.find((o) => o.key === currentQuestion.correct_answer);
              return correctOption ? (
                <div className="mt-4 p-4 rounded-lg bg-green-50 border border-green-200">
                  <p className="text-sm font-semibold text-green-800 mb-1">Resposta correta:</p>
                  <p className="text-gray-800 text-sm">
                    <span className="font-semibold">{correctOption.key})</span> {correctOption.value}
                  </p>
                </div>
              ) : null;
            })()}
          </div>
        )}
        </div>

        {aiCommentOpen && (
          <div className="w-1/2 overflow-y-auto bg-gray-50 border-l border-gray-200 flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white flex-shrink-0">
              <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary-600" />
                Comentário da IA
              </h3>
              <button
                type="button"
                onClick={() => setAiCommentOpen(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition text-gray-500"
                aria-label="Fechar comentário"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 p-6 overflow-y-auto">
              {aiCommentLoading ? (
                <div className="flex items-center justify-center h-32 gap-3 text-gray-500">
                  <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
                  <span className="text-sm">Carregando comentário...</span>
                </div>
              ) : currentQuestion && aiCommentCache[currentQuestion.id] != null ? (
                <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {aiCommentCache[currentQuestion.id]}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-32 gap-2 text-center">
                  <MessageSquare className="w-8 h-8 text-gray-300" />
                  <p className="text-sm text-gray-500">Comentário não disponível para esta questão.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border-t border-gray-200 px-6 py-4 flex justify-between items-center flex-shrink-0">
        <button
          type="button"
          onClick={handleSimulatePrevious}
          disabled={currentSimulateIndex === 0}
          className="p-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
          title="Anterior"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="flex gap-2 items-center">
          <button
            type="button"
            onClick={() => {
              if (!currentQuestion) return;
              setSimulateRevealedAnswers((prev) => {
                const next = new Set(prev);
                if (next.has(currentQuestion.id)) next.delete(currentQuestion.id);
                else next.add(currentQuestion.id);
                return next;
              });
            }}
            className={`p-2.5 border rounded-lg transition flex items-center ${
              currentQuestion && simulateRevealedAnswers.has(currentQuestion.id)
                ? 'border-primary-600 bg-primary-50 text-primary-700'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
            title={
              currentQuestion && simulateRevealedAnswers.has(currentQuestion.id)
                ? 'Ocultar resposta'
                : 'Mostrar resposta'
            }
          >
            <Eye className="w-5 h-5 flex-shrink-0" />
            <span className="ml-1.5 text-sm">Ver Resposta</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!currentQuestion) return;
              if (aiCommentOpen) {
                setAiCommentOpen(false);
              } else {
                fetchAiComment(currentQuestion.id);
              }
            }}
            className={`p-2.5 border rounded-lg transition flex items-center ${
              aiCommentOpen
                ? 'border-purple-600 bg-purple-50 text-purple-700'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
            title={aiCommentOpen ? 'Fechar comentário' : 'Ver comentário da IA'}
          >
            <MessageSquare className="w-5 h-5 flex-shrink-0" />
            <span className="ml-1.5 text-sm">Comentário da IA</span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleSimulateNext}
          className="p-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          title={currentSimulateIndex === simulateQuestions.length - 1 ? 'Finalizar' : 'Próxima'}
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

export default function SimuladoNovoPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
          <p className="text-gray-600">Carregando...</p>
        </div>
      }
    >
      <SimuladoNovoInner />
    </Suspense>
  );
}
