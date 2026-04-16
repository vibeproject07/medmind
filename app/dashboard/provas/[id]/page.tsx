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

const DESKTOP_GROUP = 10;
const MOBILE_GROUP = 5;

function QuestionCarousel({
  questions,
  examIndex,
  setExamIndex,
  examAnswers,
  revealedAnswers,
  groupIndex,
  setGroupIndex,
  groupSize,
}: {
  questions: ProvaQuestion[];
  examIndex: number;
  setExamIndex: (i: number) => void;
  examAnswers: Record<number, string>;
  revealedAnswers: Set<number>;
  groupIndex: number;
  setGroupIndex: (g: number | ((prev: number) => number)) => void;
  groupSize: number;
}) {
  const total = questions.length;
  const totalGroups = Math.ceil(total / groupSize);

  const groupStart = groupIndex * groupSize;
  const groupEnd = Math.min(groupStart + groupSize, total);
  const groupQuestions = questions.slice(groupStart, groupEnd);

  const prevGroup = useCallback(
    () => setGroupIndex((g) => Math.max(0, g - 1)),
    [setGroupIndex],
  );
  const nextGroup = useCallback(
    () => setGroupIndex((g) => Math.min(totalGroups - 1, g + 1)),
    [setGroupIndex, totalGroups],
  );

  return (
    <div className="flex flex-col items-center gap-2 mt-3 select-none">
      <div className="flex items-center gap-3">
        {/* ← Prev group */}
        <button
          type="button"
          onClick={prevGroup}
          disabled={groupIndex === 0}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition flex-shrink-0"
          title="Grupo anterior"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Balls */}
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
                onClick={() => setExamIndex(i)}
                title={`Questão ${i + 1}${revealed ? (correct ? ' ✓' : ' ✗') : answered ? ' (respondida)' : ''}`}
                className={`relative w-9 h-9 rounded-full border-2 flex items-center justify-center text-xs font-semibold transition-all duration-150 cursor-pointer flex-shrink-0
                  ${ballClass}
                  ${isCurrent
                    ? 'ring-2 ring-offset-2 ring-primary-500 border-primary-500 shadow-sm'
                    : 'hover:opacity-80'}
                `}
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

        {/* → Next group */}
        <button
          type="button"
          onClick={nextGroup}
          disabled={groupIndex >= totalGroups - 1}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition flex-shrink-0"
          title="Próximo grupo"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Group dots */}
      {totalGroups > 1 && (
        <div className="flex items-center gap-1.5">
          {Array.from({ length: totalGroups }).map((_, g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGroupIndex(g)}
              className={`rounded-full transition-all duration-200 ${
                g === groupIndex
                  ? 'w-5 h-1.5 bg-primary-500'
                  : 'w-1.5 h-1.5 bg-gray-300 hover:bg-gray-400'
              }`}
              title={`Grupo ${g + 1} (questões ${g * groupSize + 1}–${Math.min((g + 1) * groupSize, total)})`}
            />
          ))}
        </div>
      )}

      {/* Counter */}
      <p className="text-xs text-gray-400 font-medium">
        Questão <span className="text-gray-600 font-semibold">{examIndex + 1}</span> de {total}
        {totalGroups > 1 && (
          <>
            {' '}· Grupo{' '}
            <span className="text-gray-600 font-semibold">{groupIndex + 1}</span> de {totalGroups}
          </>
        )}
      </p>
    </div>
  );
}

export default function ProvaExamPage() {
  const router = useRouter();
  const params = useParams();
  const provaId = Number(params.id);

  const [prova, setProva] = useState<Prova | null>(null);
  const [examIndex, setExamIndex] = useState(0);
  const [examAnswers, setExamAnswers] = useState<Record<number, string>>({});
  const [showResults, setShowResults] = useState(false);

  const [confirmedTaxed, setConfirmedTaxed] = useState<Map<number, Set<string>>>(new Map());
  const [revealedAnswers, setRevealedAnswers] = useState<Set<number>>(new Set());

  const [aiCommentOpen, setAiCommentOpen] = useState(false);
  const [aiCommentCache, setAiCommentCache] = useState<Record<number, string | null>>({});
  const [aiCommentLoading, setAiCommentLoading] = useState(false);

  // Carousel group state lifted here so the parent can advance on answer
  const [groupSize, setGroupSize] = useState(DESKTOP_GROUP);
  const [groupIndex, setGroupIndex] = useState(0);

  // Responsive group size
  useEffect(() => {
    const update = () => setGroupSize(window.innerWidth < 640 ? MOBILE_GROUP : DESKTOP_GROUP);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Sync group to follow examIndex (only when examIndex changes)
  useEffect(() => {
    setGroupIndex(Math.floor(examIndex / groupSize));
  }, [examIndex, groupSize]);

  useEffect(() => {
    const raw = localStorage.getItem(`examProva_${provaId}`);
    if (!raw) {
      router.replace('/dashboard/provas');
      return;
    }
    try {
      setProva(JSON.parse(raw));
    } catch {
      router.replace('/dashboard/provas');
    }
  }, [provaId, router]);

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
      setAiCommentCache((prev) => ({ ...prev, [questionId]: data.comentario ?? null }));
    } catch {
      setAiCommentCache((prev) => ({ ...prev, [questionId]: null }));
    } finally {
      setAiCommentLoading(false);
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

  // Answer a question and auto-advance the carousel group if this was the last
  // question of the current visible group (but not the last question overall).
  const answerQuestion = useCallback(
    (questionId: number, optionKey: string, currentIdx: number, total: number) => {
      setExamAnswers((prev) => ({ ...prev, [questionId]: optionKey }));
      const groupEnd = (groupIndex + 1) * groupSize; // exclusive
      const isLastInGroup = currentIdx === groupEnd - 1;
      const hasNextGroup = groupEnd < total;
      if (isLastInGroup && hasNextGroup) {
        setGroupIndex((g) => g + 1);
      }
    },
    [groupIndex, groupSize],
  );

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
      <div className="flex flex-col h-[calc(100vh-4rem)]">
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
                <div
                  className="bg-emerald-500 h-2 rounded-full transition-all"
                  style={{ width: `${percent}%` }}
                />
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
                      {isCorrect ? (
                        <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                      )}
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

  // ── Exam screen ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">

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
              onClick={() => router.push('/dashboard/provas')}
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
        />
      </div>

      {/* ── Scrollable body ───────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        <div className={`overflow-y-auto p-4 sm:p-6 ${aiCommentOpen ? 'w-1/2 border-r border-gray-200' : 'w-full'}`}>
          {currentQuestion && (
            <div className="max-w-3xl mx-auto space-y-5">
              {/* Anulada banner */}
              {currentQuestion.anulada && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm font-semibold">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  Questão anulada — não disponível para simulados.
                </div>
              )}

              {/* Statement — without number badge or prova name */}
              <div>
                {currentQuestion.anulada && (
                  <span className="inline-flex items-center gap-1 mb-3 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold border border-red-200">
                    <Ban className="w-3 h-3" /> ANULADA
                  </span>
                )}
                <p className="text-base font-medium text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {currentQuestion.statement}
                </p>
              </div>

              {/* Images */}
              {currentQuestion.images && currentQuestion.images.length > 0 && (
                <div className="flex flex-wrap justify-center gap-4">
                  {currentQuestion.images.map((image: string, idx: number) => (
                    <ImageLightbox key={idx} src={image} alt={`Imagem ${idx + 1}`} className="h-48 w-auto max-w-xs" />
                  ))}
                </div>
              )}

              {/* Options */}
              <div className="space-y-2.5">
                {availableOptions.map((option) => {
                  const isSelected = selectedAnswer === option.key;
                  const isConfirmedTaxed = confirmedTaxed.get(currentQuestion.id)?.has(option.key) || false;
                  const isRevealed = revealedAnswers.has(currentQuestion.id);
                  const isCorrectOption = option.key === currentQuestion.correct_answer;

                  let rowClass = '';
                  if (isConfirmedTaxed) {
                    rowClass = 'border-gray-200 bg-gray-50 opacity-50 line-through';
                  } else if (isRevealed && isCorrectOption) {
                    rowClass = 'border-emerald-400 bg-emerald-50';
                  } else if (isRevealed && isSelected && !isCorrectOption) {
                    rowClass = 'border-red-400 bg-red-50';
                  } else if (isSelected) {
                    rowClass = 'border-primary-500 bg-primary-50';
                  } else {
                    rowClass = 'border-gray-200 bg-white hover:border-primary-300 hover:bg-gray-50';
                  }

                  return (
                    <div
                      key={option.key}
                      className={`rounded-xl border-2 flex items-center gap-3 transition-all duration-150 ${rowClass}`}
                    >
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
                        onClick={(e) => {
                          e.stopPropagation();
                          taxAlternative(currentQuestion.id, option.key);
                        }}
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

              {/* Revealed answer */}
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

        {/* AI comment panel — desktop only (sm+) */}
        {aiCommentOpen && (
          <div className="hidden sm:flex w-1/2 overflow-y-auto bg-gray-50 border-l border-gray-200 flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white flex-shrink-0">
              <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-purple-600" />
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
                  <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
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

      {/* ── AI comment bottom sheet — mobile only (< sm) ─────────────────── */}
      {/* Backdrop */}
      <div
        className={`sm:hidden fixed inset-0 bg-black/40 z-40 transition-opacity duration-300 ${
          aiCommentOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setAiCommentOpen(false)}
      />
      {/* Sheet */}
      <div
        className={`sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl flex flex-col
          transition-transform duration-300 ease-out
          ${aiCommentOpen ? 'translate-y-0' : 'translate-y-full'}
        `}
        style={{ height: '80vh' }}
      >
        {/* Handle + header */}
        <div className="flex flex-col items-center pt-3 pb-2 border-b border-gray-100 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-300 mb-3" />
          <div className="flex items-center justify-between w-full px-5">
            <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-purple-600" />
              Comentário da IA
            </h3>
            <button
              type="button"
              onClick={() => setAiCommentOpen(false)}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition text-gray-500"
              aria-label="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {aiCommentLoading ? (
            <div className="flex items-center justify-center h-32 gap-3 text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
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

      {/* ── Fixed footer ─────────────────────────────────────────────────── */}
      <div className="bg-white border-t border-gray-200 flex-shrink-0 z-10">
        <div className="px-4 sm:px-6 py-3 flex justify-between items-center gap-2">
          {/* ← Anterior */}
          <button
            type="button"
            onClick={() => { if (examIndex > 0) setExamIndex((i) => i - 1); }}
            disabled={examIndex === 0}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium"
          >
            <ChevronLeft className="w-4 h-4" />
            Anterior
          </button>

          {/* Mid actions */}
          <div className="flex gap-2 items-center">
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
                if (aiCommentOpen) {
                  setAiCommentOpen(false);
                } else {
                  fetchAiComment(currentQuestion.id);
                }
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

          {/* Próximo → */}
          <button
            type="button"
            onClick={() => {
              if (examIndex < total - 1) setExamIndex((i) => i + 1);
              else setShowResults(true);
            }}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition text-sm font-semibold"
          >
            {examIndex >= total - 1 ? (
              'Finalizar'
            ) : (
              <>
                Próximo
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
