'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Eye,
  MessageSquare,
  Loader2,
  Ban,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ThumbsUp,
  ThumbsDown,
  XOctagon,
  SplitSquareHorizontal,
  History,
  Edit,
  Save,
  RotateCcw,
} from 'lucide-react';
import ImageLightbox from '@/components/Common/ImageLightbox';

interface ProvaQuestion {
  id: number;
  numero_na_prova: number | null;
  statement: string;
  option_a: string;
  option_b: string;
  option_c?: string | null;
  option_d?: string | null;
  option_e?: string | null;
  correct_answer: string;
  explanation?: string | null;
  images?: string[];
  exam_board?: string | null;
  exam_region?: string | null;
  exam_year?: number | null;
  exam_type?: string | null;
  anulada?: boolean;
}

interface Prova {
  id: number;
  nome: string;
  banca: string | null;
  regiao: string | null;
  ano: string | null;
  tipo: string | null;
  created_at: string;
  questions: ProvaQuestion[];
}

type FeedbackState =
  | { status: 'idle' }
  | { status: 'voted_positive' }
  | { status: 'selecting_motivo' }
  | { status: 'voted_negative'; motivo: string };

const DESKTOP_GROUP = 10;
const MOBILE_GROUP = 5;

const MOTIVOS = [
  {
    value: 'incorreto',
    label: 'Incorreto',
    desc: 'O comentário não explica corretamente a resolução da questão',
    icon: XOctagon,
    color: 'text-red-500',
    bg: 'bg-red-50',
    border: 'border-red-200',
    hoverBg: 'hover:bg-red-50',
    hoverBorder: 'hover:border-red-400',
    hoverText: 'group-hover:text-red-700',
    hoverDesc: 'group-hover:text-red-500',
  },
  {
    value: 'incompleto',
    label: 'Incompleto',
    desc: 'O comentário explica apenas parcialmente a resolução da questão',
    icon: SplitSquareHorizontal,
    color: 'text-amber-500',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    hoverBg: 'hover:bg-amber-50',
    hoverBorder: 'hover:border-amber-400',
    hoverText: 'group-hover:text-amber-700',
    hoverDesc: 'group-hover:text-amber-600',
  },
  {
    value: 'desatualizado',
    label: 'Desatualizado',
    desc: 'O comentário apresenta uma explicação defasada para a resolução da questão',
    icon: History,
    color: 'text-blue-500',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    hoverBg: 'hover:bg-blue-50',
    hoverBorder: 'hover:border-blue-400',
    hoverText: 'group-hover:text-blue-700',
    hoverDesc: 'group-hover:text-blue-600',
  },
] as const;

type Motivo = typeof MOTIVOS[number]['value'];

// ── Carousel ──────────────────────────────────────────────────────────────────
function QuestionCarousel({
  questions,
  examIndex,
  setExamIndex,
  examAnswers,
  revealedAnswers,
  groupIndex,
  setGroupIndex,
  groupSize,
  disableNavigation,
}: {
  questions: ProvaQuestion[];
  examIndex: number;
  setExamIndex: (i: number) => void;
  examAnswers: Record<number, string>;
  revealedAnswers: Set<number>;
  groupIndex: number;
  setGroupIndex: (g: number | ((prev: number) => number)) => void;
  groupSize: number;
  disableNavigation: boolean;
}) {
  const total = questions.length;
  const totalGroups = Math.ceil(total / groupSize);
  const groupStart = groupIndex * groupSize;
  const groupEnd = Math.min(groupStart + groupSize, total);
  const groupQuestions = questions.slice(groupStart, groupEnd);

  const prevGroup = useCallback(() => setGroupIndex((g) => Math.max(0, g - 1)), [setGroupIndex]);
  const nextGroup = useCallback(
    () => setGroupIndex((g) => Math.min(totalGroups - 1, g + 1)),
    [setGroupIndex, totalGroups],
  );

  return (
    <div className="flex flex-col items-center gap-2 mt-3 select-none">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={prevGroup}
          disabled={groupIndex === 0 || disableNavigation}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition flex-shrink-0"
          title="Grupo anterior"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2">
          {groupQuestions.map((q, localIdx) => {
            const i = groupStart + localIdx;
            const revealed = revealedAnswers.has(q.id);
            const answered = !!examAnswers[q.id];
            const correct = examAnswers[q.id] === q.correct_answer;
            const isCurrent = i === examIndex;

            let ballClass = '';
            if (revealed) {
              ballClass = correct
                ? 'bg-emerald-500 text-white border-emerald-500'
                : 'bg-red-500 text-white border-red-500';
            } else if (answered) {
              ballClass = 'bg-blue-100 text-blue-700 border-blue-300';
            } else {
              ballClass = 'bg-white text-gray-600 border-gray-300 hover:border-primary-400';
            }

            return (
              <button
                key={q.id}
                type="button"
                onClick={() => !disableNavigation && setExamIndex(i)}
                disabled={disableNavigation}
                title={`Questão ${i + 1}${revealed ? (correct ? ' ✓' : ' ✗') : answered ? ' (respondida)' : ''}`}
                className={`relative w-9 h-9 rounded-full border-2 flex items-center justify-center text-xs font-semibold transition-all duration-150 cursor-pointer flex-shrink-0
                  ${ballClass}
                  ${isCurrent ? 'ring-2 ring-offset-2 ring-primary-500 border-primary-500 shadow-sm' : 'hover:opacity-80'}
                  ${disableNavigation ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {revealed ? (
                  correct ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />
                ) : (
                  i + 1
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={nextGroup}
          disabled={groupIndex >= totalGroups - 1 || disableNavigation}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition flex-shrink-0"
          title="Próximo grupo"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {totalGroups > 1 && (
        <div className="flex items-center gap-1.5">
          {Array.from({ length: totalGroups }).map((_, g) => (
            <button
              key={g}
              type="button"
              onClick={() => !disableNavigation && setGroupIndex(g)}
              disabled={disableNavigation}
              className={`rounded-full transition-all duration-200 ${
                g === groupIndex ? 'w-5 h-1.5 bg-primary-500' : 'w-1.5 h-1.5 bg-gray-300 hover:bg-gray-400'
              }`}
              title={`Grupo ${g + 1} (questões ${g * groupSize + 1}–${Math.min((g + 1) * groupSize, total)})`}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 font-medium">
        Questão <span className="text-gray-600 font-semibold">{examIndex + 1}</span> de {total}
        {totalGroups > 1 && (
          <> · Grupo <span className="text-gray-600 font-semibold">{groupIndex + 1}</span> de {totalGroups}</>
        )}
      </p>
    </div>
  );
}

// ── Feedback buttons (shared between desktop panel and mobile sheet) ───────────
function CommentFeedback({
  feedbackState,
  onThumbUp,
  onThumbDown,
}: {
  feedbackState: FeedbackState;
  onThumbUp: () => void;
  onThumbDown: () => void;
}) {
  const voted = feedbackState.status !== 'idle';

  return (
    <div className="flex items-center gap-1.5">
      {/* Thumb up */}
      <button
        type="button"
        onClick={onThumbUp}
        disabled={voted}
        title="Útil"
        className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-medium transition disabled:cursor-not-allowed ${
          feedbackState.status === 'voted_positive'
            ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
            : 'border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50'
        }`}
      >
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>

      {/* Thumb down */}
      <button
        type="button"
        onClick={onThumbDown}
        disabled={voted && feedbackState.status !== 'selecting_motivo'}
        title="Não útil"
        className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-medium transition disabled:cursor-not-allowed ${
          feedbackState.status === 'voted_negative'
            ? 'bg-red-50 border-red-400 text-red-700'
            : feedbackState.status === 'selecting_motivo'
            ? 'bg-orange-50 border-orange-400 text-orange-700'
            : 'border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50'
        }`}
      >
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>

    </div>
  );
}

// ── Motivo modal — rendered at page level so it can have a full backdrop ──────
function MotivoModal({
  onSelectMotivo,
  onCancel,
}: {
  onSelectMotivo: (motivo: Motivo) => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-800">Por que não gostou?</h3>
          <p className="text-xs text-gray-500 mt-0.5">Ajude-nos a melhorar os comentários da IA</p>
        </div>
        <div className="p-4 space-y-2.5">
          {MOTIVOS.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => onSelectMotivo(m.value)}
                className={`group w-full text-left flex items-start gap-3 p-4 rounded-xl border-2 border-gray-100 bg-white transition-all duration-150 ${m.hoverBg} ${m.hoverBorder} active:scale-[0.98]`}
              >
                <div className={`mt-0.5 p-2 rounded-lg ${m.bg} flex-shrink-0`}>
                  <Icon className={`w-4 h-4 ${m.color}`} />
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold text-gray-800 ${m.hoverText}`}>{m.label}</p>
                  <p className={`text-xs text-gray-500 ${m.hoverDesc} mt-0.5 leading-relaxed`}>{m.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
        <div className="px-4 pb-5">
          <button
            type="button"
            onClick={onCancel}
            className="w-full py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 transition font-medium"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProvaExamPage() {
  const router = useRouter();
  const params = useParams();
  const provaId = Number(params.id);

  const [prova, setProva] = useState<Prova | null>(null);
  const [examIndex, setExamIndex] = useState(0);
  const [examAnswers, setExamAnswers] = useState<Record<number, string>>({});
  const [showResults, setShowResults] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const [confirmedTaxed, setConfirmedTaxed] = useState<Map<number, Set<string>>>(new Map());
  const [revealedAnswers, setRevealedAnswers] = useState<Set<number>>(new Set());

  const [aiCommentOpen, setAiCommentOpen] = useState(false);
  // Cache stores { comentario, feedback_positivo }
  const [aiCommentCache, setAiCommentCache] = useState<Record<number, { comentario: string | null; feedback_positivo: number } | null>>({});
  const [aiCommentLoading, setAiCommentLoading] = useState(false);
  // Per-question feedback state
  const [feedbackStates, setFeedbackStates] = useState<Record<number, FeedbackState>>({});
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);

  const [groupSize, setGroupSize] = useState(DESKTOP_GROUP);
  const [groupIndex, setGroupIndex] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingProva, setLoadingProva] = useState(true);
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{
    statement: string;
    option_a: string;
    option_b: string;
    option_c: string;
    option_d: string;
    option_e: string;
    correct_answer: 'A' | 'B' | 'C' | 'D' | 'E';
    explanation: string;
  }>({
    statement: '',
    option_a: '',
    option_b: '',
    option_c: '',
    option_d: '',
    option_e: '',
    correct_answer: 'A',
    explanation: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [togglingAnulada, setTogglingAnulada] = useState(false);

  const cacheProvaLight = (data: Prova) => {
    try {
      const light = {
        ...data,
        questions: data.questions.map((q) => ({ ...q, images: [] as string[] })),
      };
      localStorage.setItem(`examProva_${provaId}`, JSON.stringify(light));
    } catch {
      /* QuotaExceeded — API é a fonte da verdade */
    }
  };

  useEffect(() => {
    const update = () => setGroupSize(window.innerWidth < 640 ? MOBILE_GROUP : DESKTOP_GROUP);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    setGroupIndex(Math.floor(examIndex / groupSize));
  }, [examIndex, groupSize]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoadingProva(true);
      setLoadError(null);

      // Cache opcional (sem depender dele — evita QuotaExceeded com imagens base64)
      try {
        const raw = localStorage.getItem(`examProva_${provaId}`);
        if (raw) {
          const cached = JSON.parse(raw) as Prova;
          if (!cancelled && cached?.id && Array.isArray(cached.questions)) {
            setProva(cached);
            setLoadingProva(false);
          }
        }
      } catch {
        /* ignore cache */
      }

      try {
        const token = localStorage.getItem('token');
        if (!token) {
          if (!cancelled) {
            setLoadError('Sessão expirada. Faça login novamente.');
            setLoadingProva(false);
          }
          return;
        }
        const res = await fetch(`/api/provas/${provaId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) {
          if (!cancelled) {
            setLoadError(data.error || `Erro ao carregar prova (${res.status}).`);
            setLoadingProva(false);
          }
          return;
        }
        if (cancelled) return;
        setProva(data);
        // Cache leve: sem imagens (evita estourar localStorage)
        cacheProvaLight(data);
      } catch {
        if (!cancelled) setLoadError('Erro de rede ao carregar a prova.');
      } finally {
        if (!cancelled) setLoadingProva(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [provaId]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setIsAdmin(payload.role === 'admin');
    } catch {
      setIsAdmin(false);
    }
  }, []);

  useEffect(() => {
    setAiCommentOpen(false);
  }, [examIndex]);

  const fetchAiComment = async (questionId: number) => {
    if (aiCommentCache[questionId] !== undefined) {
      setAiCommentOpen(true);
      return;
    }
    setAiCommentLoading(true);
    setAiCommentOpen(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/comentarios/${questionId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      setAiCommentCache((prev) => ({
        ...prev,
        [questionId]: {
          comentario:        data.comentario ?? null,
          feedback_positivo: data.feedback_positivo ?? 0,
        },
      }));
    } catch {
      setAiCommentCache((prev) => ({ ...prev, [questionId]: { comentario: null, feedback_positivo: 0 } }));
    } finally {
      setAiCommentLoading(false);
    }
  };

  const getFeedbackState = (questionId: number): FeedbackState =>
    feedbackStates[questionId] ?? { status: 'idle' };

  const setFeedbackState = (questionId: number, state: FeedbackState) =>
    setFeedbackStates((prev) => ({ ...prev, [questionId]: state }));

  const handleThumbUp = async (questionId: number) => {
    const current = getFeedbackState(questionId);
    if (current.status !== 'idle') return;
    setFeedbackState(questionId, { status: 'voted_positive' });
    // Optimistically update counter
    setAiCommentCache((prev) => {
      const entry = prev[questionId];
      if (!entry) return prev;
      return { ...prev, [questionId]: { ...entry, feedback_positivo: entry.feedback_positivo + 1 } };
    });
    try {
      const token = localStorage.getItem('token');
      await fetch(`/api/comentarios/${questionId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ tipo: 'positivo' }),
      });
    } catch {
      // silent — optimistic update already shown
    }
  };

  const handleThumbDown = (questionId: number) => {
    const current = getFeedbackState(questionId);
    if (current.status === 'selecting_motivo') {
      // cancel
      setFeedbackState(questionId, { status: 'idle' });
    } else if (current.status === 'idle') {
      setFeedbackState(questionId, { status: 'selecting_motivo' });
    }
  };

  const handleSelectMotivo = async (questionId: number, motivo: Motivo) => {
    if (feedbackSubmitting) return;
    setFeedbackState(questionId, { status: 'voted_negative', motivo });
    setFeedbackSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      await fetch(`/api/comentarios/${questionId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ tipo: 'negativo', motivo }),
      });
    } catch {
      // silent
    } finally {
      setFeedbackSubmitting(false);
    }
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

  const getAvailableOptions = (q: ProvaQuestion) => {
    const options: { key: string; value: string }[] = [
      { key: 'A', value: q.option_a },
      { key: 'B', value: q.option_b },
    ];
    if (q.option_c) options.push({ key: 'C', value: q.option_c });
    if (q.option_d) options.push({ key: 'D', value: q.option_d });
    if (q.option_e) options.push({ key: 'E', value: q.option_e });
    return options;
  };

  const answerQuestion = useCallback(
    (questionId: number, optionKey: string, currentIdx: number, total: number) => {
      setExamAnswers((prev) => ({ ...prev, [questionId]: optionKey }));
      const groupEnd = (groupIndex + 1) * groupSize;
      const isLastInGroup = currentIdx === groupEnd - 1;
      const hasNextGroup = groupEnd < total;
      if (isLastInGroup && hasNextGroup) setGroupIndex((g) => g + 1);
    },
    [groupIndex, groupSize],
  );

  if (loadingProva && !prova) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (loadError && !prova) {
    return (
      <div className="max-w-lg mx-auto mt-12 p-6 bg-white border border-red-200 rounded-xl space-y-4">
        <p className="text-red-700 font-semibold">Não foi possível abrir a prova</p>
        <p className="text-sm text-gray-600">{loadError}</p>
        <button
          type="button"
          onClick={() => router.push('/dashboard/provas')}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700"
        >
          Voltar às provas
        </button>
      </div>
    );
  }

  if (!prova) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  const questions = prova.questions;
  const total = questions.length;
  const currentQuestion = questions[examIndex];
  const correctCount = questions.filter((q) => examAnswers[q.id] === q.correct_answer).length;
  const percent = total ? Math.round((correctCount / total) * 100) : 0;
  const answeredCount = Object.keys(examAnswers).length;

  // ── Results screen ────────────────────────────────────────────────────────
  if (showResults) {
    return (
      <div className="-m-3 sm:-m-4 md:-m-3 h-full flex flex-col overflow-hidden">
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <h2 className="text-2xl font-bold text-gray-800">Resultado — {prova.nome}</h2>
          <button
            type="button"
            onClick={() => router.push('/dashboard/provas')}
            className="p-2 rounded-lg hover:bg-gray-100 transition"
            aria-label="Fechar"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="text-center bg-white rounded-xl border border-gray-200 p-8 shadow-sm">
              <div className="text-6xl font-bold text-primary-600 mb-2">{percent}%</div>
              <p className="text-xl text-gray-700">{correctCount} de {total} questões corretas</p>
              <div className="flex justify-center gap-6 mt-4 text-sm">
                <span className="flex items-center gap-1 text-emerald-600">
                  <CheckCircle className="w-4 h-4" /> {correctCount} corretas
                </span>
                <span className="flex items-center gap-1 text-red-600">
                  <XCircle className="w-4 h-4" /> {total - correctCount} incorretas
                </span>
              </div>
              <div className="mt-6 w-full bg-gray-100 rounded-full h-2">
                <div className="bg-emerald-500 h-2 rounded-full transition-all" style={{ width: `${percent}%` }} />
              </div>
            </div>
            <div className="space-y-3">
              {questions.map((q, idx) => {
                const userAnswer = examAnswers[q.id];
                const isCorrect = userAnswer === q.correct_answer;
                return (
                  <div
                    key={q.id}
                    className={`p-4 rounded-xl border-2 ${isCorrect ? 'border-emerald-400 bg-emerald-50' : 'border-red-400 bg-red-50'}`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <p className="font-semibold text-gray-800">
                        Questão {idx + 1}
                        {q.anulada && (
                          <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold border border-red-200">
                            <Ban className="w-3 h-3" /> ANULADA
                          </span>
                        )}
                      </p>
                      {isCorrect ? <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" /> : <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />}
                    </div>
                    <p className="text-gray-700 mb-2 text-sm line-clamp-2">{q.statement}</p>
                    <div className="text-sm space-y-1">
                      <p>
                        <span className="font-medium">Sua resposta:</span>{' '}
                        <span className={isCorrect ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                          {userAnswer || 'Não respondida'}
                        </span>
                      </p>
                      {!isCorrect && (
                        <p>
                          <span className="font-medium">Resposta correta:</span>{' '}
                          <span className="text-emerald-700 font-semibold">{q.correct_answer}</span>
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
            onClick={() => router.push('/dashboard/provas')}
            className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
          >
            Voltar para Provas
          </button>
        </div>
      </div>
    );
  }

  const availableOptions = currentQuestion ? getAvailableOptions(currentQuestion) : [];
  const selectedAnswer = currentQuestion ? examAnswers[currentQuestion.id] : undefined;
  const currentFeedbackState = currentQuestion ? getFeedbackState(currentQuestion.id) : { status: 'idle' as const };
  const currentCommentData = currentQuestion ? aiCommentCache[currentQuestion.id] : null;
  const hasComment = !aiCommentLoading && currentCommentData?.comentario != null;

  const isEditingCurrent = !!currentQuestion && editingQuestionId === currentQuestion.id;
  const editAvailableOptions: Array<'A' | 'B' | 'C' | 'D' | 'E'> = [
    'A',
    'B',
    ...(editForm.option_c.trim() ? (['C'] as const) : []),
    ...(editForm.option_d.trim() ? (['D'] as const) : []),
    ...(editForm.option_e.trim() ? (['E'] as const) : []),
  ];

  const startEditCurrentQuestion = () => {
    if (!currentQuestion) return;
    setEditingQuestionId(currentQuestion.id);
    setEditForm({
      statement: currentQuestion.statement ?? '',
      option_a: currentQuestion.option_a ?? '',
      option_b: currentQuestion.option_b ?? '',
      option_c: currentQuestion.option_c ?? '',
      option_d: currentQuestion.option_d ?? '',
      option_e: currentQuestion.option_e ?? '',
      correct_answer: (currentQuestion.correct_answer as 'A' | 'B' | 'C' | 'D' | 'E') ?? 'A',
      explanation: currentQuestion.explanation ?? '',
    });
  };

  const cancelEditCurrentQuestion = () => {
    setEditingQuestionId(null);
  };

  const saveEditCurrentQuestion = async () => {
    if (!currentQuestion) return;
    if (!editForm.statement.trim() || !editForm.option_a.trim() || !editForm.option_b.trim()) {
      alert('Enunciado e alternativas A/B são obrigatórios.');
      return;
    }
    if (!editAvailableOptions.includes(editForm.correct_answer)) {
      alert('Resposta correta deve corresponder a uma alternativa preenchida.');
      return;
    }

    setSavingEdit(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const payload: Record<string, unknown> = {
        statement: editForm.statement.trim(),
        option_a: editForm.option_a.trim(),
        option_b: editForm.option_b.trim(),
        correct_answer: editForm.correct_answer,
        option_c: editForm.option_c.trim() || null,
        option_d: editForm.option_d.trim() || null,
        option_e: editForm.option_e.trim() || null,
        explanation: editForm.explanation.trim() || null,
      };

      const res = await fetch(`/api/questions/${currentQuestion.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const updated = await res.json();
      if (!res.ok) {
        alert(updated.error || 'Erro ao salvar questão.');
        return;
      }

      setProva((prev) => {
        if (!prev) return prev;
        const nextQuestions = prev.questions.map((q) =>
          q.id === currentQuestion.id
            ? {
                ...q,
                statement: updated.statement ?? q.statement,
                option_a: updated.option_a ?? q.option_a,
                option_b: updated.option_b ?? q.option_b,
                option_c: updated.option_c ?? null,
                option_d: updated.option_d ?? null,
                option_e: updated.option_e ?? null,
                correct_answer: updated.correct_answer ?? q.correct_answer,
                explanation: updated.explanation ?? null,
              }
            : q,
        );
        const next = { ...prev, questions: nextQuestions };
        cacheProvaLight(next);
        return next;
      });

      setEditingQuestionId(null);
    } catch {
      alert('Erro ao salvar questão.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggleAnulada = async () => {
    if (!currentQuestion) return;
    const novaAnulada = !currentQuestion.anulada;
    const confirmMsg = novaAnulada
      ? 'Anular esta questão? Ela ficará inacessível para simulados, mas continuará visível nas provas.'
      : 'Reativar esta questão? Ela voltará a estar disponível para simulados.';
    if (!confirm(confirmMsg)) return;

    setTogglingAnulada(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const res = await fetch(`/api/questions/${currentQuestion.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ anulada: novaAnulada }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Erro ao atualizar questão.');
        return;
      }
      const raw = await res.json();

      setProva((prev) => {
        if (!prev) return prev;
        const nextQuestions = prev.questions.map((q) =>
          q.id === currentQuestion.id ? { ...q, anulada: raw.anulada } : q,
        );
        const next = { ...prev, questions: nextQuestions };
        cacheProvaLight(next);
        return next;
      });
      setEditingQuestionId(null);
    } catch {
      alert('Erro ao atualizar questão.');
    } finally {
      setTogglingAnulada(false);
    }
  };

  // ── Exit confirmation modal ───────────────────────────────────────────────
  const ExitConfirmModal = showExitConfirm ? (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
        <h3 className="text-lg font-bold text-gray-800">Sair da prova?</h3>
        <p className="text-sm text-gray-600">
          Seu progresso nesta prova não será salvo. Tem certeza que deseja sair?
        </p>
        <div className="flex gap-3 mt-2">
          <button
            type="button"
            onClick={() => setShowExitConfirm(false)}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50 transition text-sm"
          >
            Continuar prova
          </button>
          <button
            type="button"
            onClick={() => router.push('/dashboard/provas')}
            className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition text-sm"
          >
            Sair mesmo assim
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // ── Shared comment panel header actions ──────────────────────────────────
  const CommentPanelHeader = ({ onClose }: { onClose: () => void }) => (
    <div className="relative flex items-center justify-between w-full">
      <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-purple-600" />
        Comentário da IA
      </h3>
      <div className="flex items-center gap-1.5 relative">
        {hasComment && currentQuestion && (
          <CommentFeedback
            feedbackState={currentFeedbackState}
            onThumbUp={() => handleThumbUp(currentQuestion.id)}
            onThumbDown={() => handleThumbDown(currentQuestion.id)}
          />
        )}
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition text-gray-500"
          aria-label="Fechar comentário"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  // ── Comment content ────────────────────────────────────────────────────────
  const CommentContent = () => (
    <>
      {aiCommentLoading ? (
        <div className="flex items-center justify-center h-32 gap-3 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
          <span className="text-sm">Carregando comentário...</span>
        </div>
      ) : currentCommentData?.comentario != null ? (
        <div className="space-y-3">
          <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
            {currentCommentData.comentario}
          </div>
          {/* Voted negative — show confirmation */}
          {currentFeedbackState.status === 'voted_negative' && (
            <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg text-xs text-orange-700">
              Obrigado pelo feedback! Vamos usar isso para melhorar nossos comentários.
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-32 gap-2 text-center">
          <MessageSquare className="w-8 h-8 text-gray-300" />
          <p className="text-sm text-gray-500">Comentário não disponível para esta questão.</p>
        </div>
      )}
    </>
  );

  // ── Exam screen ───────────────────────────────────────────────────────────
  return (
    <div className="-m-3 sm:-m-4 md:-m-3 h-full flex flex-col overflow-hidden">
      {ExitConfirmModal}
      {currentFeedbackState.status === 'selecting_motivo' && currentQuestion && (
        <MotivoModal
          onSelectMotivo={(m) => handleSelectMotivo(currentQuestion.id, m)}
          onCancel={() => handleThumbDown(currentQuestion.id)}
        />
      )}

      {/* ── Fixed topbar ─────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 pt-3 pb-2 flex-shrink-0 z-10">
        <div className="flex items-center gap-3">
          <h2 className="text-lg sm:text-xl font-bold text-gray-800 truncate flex-1 min-w-0">
            {prova.nome}
          </h2>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="hidden sm:flex items-center gap-1 px-2.5 py-1 bg-gray-50 rounded-lg border border-gray-200 text-xs text-gray-500">
              <span className="font-semibold text-gray-700">{answeredCount}</span>
              <span>/ {total}</span>
            </div>
            <button
              type="button"
              onClick={() => setShowExitConfirm(true)}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition text-gray-500"
              aria-label="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <QuestionCarousel
          questions={questions}
          examIndex={examIndex}
          setExamIndex={setExamIndex}
          examAnswers={examAnswers}
          revealedAnswers={revealedAnswers}
          groupIndex={groupIndex}
          setGroupIndex={setGroupIndex}
          groupSize={groupSize}
          disableNavigation={editingQuestionId !== null}
        />
      </div>

      {/* ── Scrollable body ───────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        <div className={`flex-1 overflow-y-auto p-4 sm:p-6 transition-all duration-300 ease-out ${aiCommentOpen ? 'sm:border-r sm:border-gray-200' : ''}`}>
          {currentQuestion && (
            <div className="max-w-3xl mx-auto space-y-5">
              {currentQuestion.anulada && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm font-semibold">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  Questão anulada — não disponível para simulados.
                </div>
              )}

              <div>
                {currentQuestion.anulada && (
                  <span className="inline-flex items-center gap-1 mb-3 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold border border-red-200">
                    <Ban className="w-3 h-3" /> ANULADA
                  </span>
                )}
                {isEditingCurrent ? (
                  <textarea
                    value={editForm.statement}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, statement: e.target.value }))}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                ) : (
                  <p className="text-base font-medium text-gray-800 whitespace-pre-wrap leading-relaxed">
                    {currentQuestion.statement}
                  </p>
                )}
              </div>

              {currentQuestion.images && currentQuestion.images.length > 0 && (
                <div className="flex flex-wrap justify-center gap-4">
                  {currentQuestion.images.map((image: string, idx: number) => (
                    <ImageLightbox key={idx} src={image} alt={`Imagem ${idx + 1}`} className="h-48 w-auto max-w-xs" />
                  ))}
                </div>
              )}

              <div className="space-y-2.5">
                {(isEditingCurrent
                  ? ([
                      { key: 'A', value: editForm.option_a },
                      { key: 'B', value: editForm.option_b },
                      { key: 'C', value: editForm.option_c },
                      { key: 'D', value: editForm.option_d },
                      { key: 'E', value: editForm.option_e },
                    ] as const)
                  : availableOptions
                ).map((option) => {
                  if (isEditingCurrent) {
                    return (
                      <div key={option.key} className="rounded-xl border border-gray-200 bg-white p-3">
                        <label className="block text-xs font-semibold text-gray-500 mb-1">
                          Alternativa {option.key}
                          {(option.key === 'A' || option.key === 'B') ? ' *' : ' (opcional)'}
                        </label>
                        <input
                          type="text"
                          value={option.value}
                          onChange={(e) =>
                            setEditForm((prev) => ({
                              ...prev,
                              ...(option.key === 'A' ? { option_a: e.target.value } : {}),
                              ...(option.key === 'B' ? { option_b: e.target.value } : {}),
                              ...(option.key === 'C' ? { option_c: e.target.value } : {}),
                              ...(option.key === 'D' ? { option_d: e.target.value } : {}),
                              ...(option.key === 'E' ? { option_e: e.target.value } : {}),
                            }))
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                      </div>
                    );
                  }

                  const isSelected = selectedAnswer === option.key;
                  const isConfirmedTaxed = confirmedTaxed.get(currentQuestion.id)?.has(option.key) || false;
                  const isRevealed = revealedAnswers.has(currentQuestion.id);
                  const isCorrectOption = option.key === currentQuestion.correct_answer;

                  let rowClass = '';
                  if (isConfirmedTaxed) rowClass = 'border-gray-200 bg-gray-50 opacity-50 line-through';
                  else if (isRevealed && isCorrectOption) rowClass = 'border-emerald-400 bg-emerald-50';
                  else if (isRevealed && isSelected && !isCorrectOption) rowClass = 'border-red-400 bg-red-50';
                  else if (isSelected) rowClass = 'border-primary-500 bg-primary-50';
                  else rowClass = 'border-gray-200 bg-white hover:border-primary-300 hover:bg-gray-50';

                  return (
                    <div key={option.key} className={`rounded-xl border-2 flex items-center gap-3 transition-all duration-150 ${rowClass}`}>
                      <button
                        type="button"
                        onClick={() =>
                          !isConfirmedTaxed &&
                          !currentQuestion.anulada &&
                          answerQuestion(currentQuestion.id, option.key, examIndex, total)
                        }
                        disabled={isConfirmedTaxed || !!currentQuestion.anulada}
                        className={`flex flex-1 items-center gap-3 text-left p-4 min-w-0 ${
                          isConfirmedTaxed || currentQuestion.anulada ? 'cursor-not-allowed' : 'cursor-pointer'
                        }`}
                      >
                        <div
                          className={`w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 text-xs font-bold transition-all ${
                            isConfirmedTaxed
                              ? 'border-gray-300 bg-gray-100 text-gray-400'
                              : isRevealed && isCorrectOption
                              ? 'border-emerald-500 bg-emerald-500 text-white'
                              : isRevealed && isSelected && !isCorrectOption
                              ? 'border-red-500 bg-red-500 text-white'
                              : isSelected
                              ? 'border-primary-600 bg-primary-600 text-white'
                              : 'border-gray-300 text-gray-500'
                          }`}
                        >
                          {isRevealed && isCorrectOption ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : isRevealed && isSelected && !isCorrectOption ? (
                            <X className="w-3.5 h-3.5" />
                          ) : (
                            option.key
                          )}
                        </div>
                        <span className="text-gray-700 text-sm leading-relaxed">{option.value}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); taxAlternative(currentQuestion.id, option.key); }}
                        disabled={!!currentQuestion.anulada}
                        className={`mr-3 p-2 rounded-lg transition flex-shrink-0 flex items-center justify-center ${
                          isConfirmedTaxed
                            ? 'bg-orange-500 text-white hover:bg-orange-600'
                            : 'border border-orange-300 text-orange-500 hover:bg-orange-50'
                        } disabled:opacity-30 disabled:cursor-not-allowed`}
                        title={isConfirmedTaxed ? 'Desfazer taxar' : 'Taxar alternativa'}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {isEditingCurrent && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Resposta correta *</label>
                    <select
                      value={editForm.correct_answer}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          correct_answer: e.target.value as 'A' | 'B' | 'C' | 'D' | 'E',
                        }))
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                      {editAvailableOptions.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Explicação (opcional)</label>
                    <textarea
                      value={editForm.explanation}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, explanation: e.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                </div>
              )}

              {revealedAnswers.has(currentQuestion.id) && (() => {
                const correctOption = availableOptions.find((o) => o.key === currentQuestion.correct_answer);
                return correctOption ? (
                  <div className="mt-2 p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-emerald-800 mb-0.5">Resposta correta</p>
                      <p className="text-gray-700 text-sm">
                        <span className="font-semibold">{correctOption.key})</span> {correctOption.value}
                      </p>
                    </div>
                  </div>
                ) : null;
              })()}
            </div>
          )}
        </div>

        {/* AI comment panel — desktop (sm+), slides in from the right */}
        <div
          className={`hidden sm:flex flex-col overflow-hidden bg-gray-50 flex-shrink-0
            transition-[width] duration-300 ease-out
            ${aiCommentOpen ? 'w-1/2 border-l border-gray-200' : 'w-0 border-l-0'}`}
        >
          {/* Inner wrapper keeps the content at full panel width during animation */}
          <div className="flex flex-col h-full w-[50vw]">
            <div className="flex items-center px-6 py-4 border-b border-gray-200 bg-white flex-shrink-0">
              <CommentPanelHeader onClose={() => setAiCommentOpen(false)} />
            </div>
            <div className="flex-1 p-6 overflow-y-auto">
              <CommentContent />
            </div>
          </div>
        </div>
      </div>

      {/* AI comment bottom sheet — mobile (< sm) */}
      <div
        className={`sm:hidden fixed inset-0 bg-black/40 z-40 transition-opacity duration-300 ${
          aiCommentOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setAiCommentOpen(false)}
      />
      <div
        className={`sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl flex flex-col
          transition-transform duration-300 ease-out
          ${aiCommentOpen ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ height: '80vh' }}
      >
        <div className="flex flex-col items-center pt-3 pb-2 border-b border-gray-100 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-300 mb-3" />
          <div className="px-5 w-full">
            <CommentPanelHeader onClose={() => setAiCommentOpen(false)} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <CommentContent />
        </div>
      </div>

      {/* ── Fixed footer ─────────────────────────────────────────────────── */}
      <div className="bg-white border-t border-gray-200 flex-shrink-0 z-10">
        <div className="px-4 sm:px-6 py-3 flex justify-between items-center gap-2">
          <button
            type="button"
            onClick={() => { if (examIndex > 0) setExamIndex((i) => i - 1); }}
            disabled={examIndex === 0 || editingQuestionId !== null}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium"
          >
            <ChevronLeft className="w-4 h-4" />
            Anterior
          </button>

          <div className="flex gap-2 items-center">
            {isAdmin && !isEditingCurrent && (
              <button
                type="button"
                onClick={startEditCurrentQuestion}
                className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition text-sm font-semibold shadow-sm"
                title="Editar esta questão da prova"
              >
                <Edit className="w-4 h-4" />
                <span className="hidden sm:inline">Editar</span>
              </button>
            )}
            {isAdmin && isEditingCurrent && (
              <>
                <button
                  type="button"
                  onClick={cancelEditCurrentQuestion}
                  disabled={savingEdit || togglingAnulada}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition text-sm font-medium disabled:opacity-50"
                  title="Cancelar edição"
                >
                  <X className="w-4 h-4" />
                  <span className="hidden sm:inline">Cancelar</span>
                </button>
                <button
                  type="button"
                  onClick={handleToggleAnulada}
                  disabled={savingEdit || togglingAnulada}
                  className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 border rounded-lg transition text-sm font-medium disabled:opacity-50 ${
                    currentQuestion?.anulada
                      ? 'border-green-300 text-green-700 hover:bg-green-50'
                      : 'border-red-300 text-red-700 hover:bg-red-50'
                  }`}
                  title={currentQuestion?.anulada ? 'Reativar questão' : 'Anular questão'}
                >
                  {togglingAnulada ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : currentQuestion?.anulada ? (
                    <RotateCcw className="w-4 h-4" />
                  ) : (
                    <Ban className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline">
                    {togglingAnulada
                      ? 'Salvando...'
                      : currentQuestion?.anulada
                      ? 'Reativar'
                      : 'Anular'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={saveEditCurrentQuestion}
                  disabled={savingEdit || togglingAnulada}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition text-sm font-semibold disabled:opacity-50"
                  title="Salvar alterações da questão"
                >
                  {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span className="hidden sm:inline">Salvar</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                if (!currentQuestion) return;
                setRevealedAnswers((prev) => {
                  const next = new Set(prev);
                  if (next.has(currentQuestion.id)) next.delete(currentQuestion.id);
                  else next.add(currentQuestion.id);
                  return next;
                });
              }}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 border rounded-lg transition text-sm font-medium ${
                currentQuestion && revealedAnswers.has(currentQuestion.id)
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Eye className="w-4 h-4" />
              <span className="hidden sm:inline">Ver Resposta</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!currentQuestion) return;
                if (aiCommentOpen) setAiCommentOpen(false);
                else fetchAiComment(currentQuestion.id);
              }}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 border rounded-lg transition text-sm font-medium ${
                aiCommentOpen
                  ? 'border-purple-500 bg-purple-50 text-purple-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span className="hidden sm:inline">Comentário IA</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              if (examIndex < total - 1) setExamIndex((i) => i + 1);
              else setShowResults(true);
            }}
            disabled={editingQuestionId !== null}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition text-sm font-semibold disabled:opacity-50"
          >
            {examIndex >= total - 1 ? (
              'Finalizar'
            ) : (
              <>Próximo <ChevronRight className="w-4 h-4" /></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
