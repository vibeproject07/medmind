'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Eye,
  MessageSquare,
  Loader2,
} from 'lucide-react';
import ImageLightbox from '@/components/Common/ImageLightbox';

interface Question {
  id: number;
  statement: string;
  option_a: string;
  option_b: string;
  option_c?: string;
  option_d?: string;
  option_e?: string;
  correct_answer: string;
  explanation?: string;
  tags?: string[];
  images?: string[];
}

function SimulatePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(true);

  const [confirmedTaxed, setConfirmedTaxed] = useState<Map<number, Set<string>>>(new Map());
  const [revealedAnswers, setRevealedAnswers] = useState<Set<number>>(new Set());

  const [aiCommentOpen, setAiCommentOpen] = useState(false);
  const [aiCommentCache, setAiCommentCache] = useState<Record<number, string | null>>({});
  const [aiCommentLoading, setAiCommentLoading] = useState(false);

  useEffect(() => {
    const tagsParam = searchParams.get('tags');
    const countParam = searchParams.get('count');

    if (!tagsParam || !countParam) {
      router.push('/dashboard/notes/new');
      return;
    }

    fetchQuestions(JSON.parse(tagsParam), parseInt(countParam));
  }, [searchParams, router]);

  useEffect(() => {
    setAiCommentOpen(false);
  }, [currentQuestionIndex]);

  const fetchQuestions = async (tagsArray: string[], count: number) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login');
        return;
      }
      const tagsParam = JSON.stringify(tagsArray);
      const response = await fetch(`/api/questions/by-tags?tags=${encodeURIComponent(tagsParam)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const allQuestions = await response.json();
        const shuffled = [...allQuestions].sort(() => Math.random() - 0.5);
        setQuestions(shuffled.slice(0, Math.min(count, shuffled.length)));
      }
    } catch (error) {
      console.error('Erro ao buscar questões:', error);
    } finally {
      setLoading(false);
    }
  };

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

  const handleAnswerSelect = (answer: string) => {
    const q = questions[currentQuestionIndex];
    setSelectedAnswers((prev) => ({ ...prev, [q.id]: answer }));
  };

  const handleNext = () => {
    if (currentQuestionIndex < questions.length - 1) setCurrentQuestionIndex((i) => i + 1);
    else setShowResults(true);
  };

  const handlePrevious = () => {
    if (currentQuestionIndex > 0) setCurrentQuestionIndex((i) => i - 1);
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

  const calculateScore = () => {
    let correct = 0;
    questions.forEach((q) => {
      if (selectedAnswers[q.id] === q.correct_answer) correct++;
    });
    return { correct, total: questions.length };
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        <p className="text-gray-600">Carregando questões...</p>
      </div>
    );
  }

  if (questions.length === 0) {
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

  if (showResults) {
    const { correct, total } = calculateScore();
    const percentage = Math.round((correct / total) * 100);
    return (
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <h2 className="text-2xl font-bold text-gray-800">Resultado do Simulado</h2>
          <button
            type="button"
            onClick={() => router.back()}
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
              <p className="text-xl text-gray-700">Você acertou {correct} de {total} questões</p>
            </div>
            <div className="space-y-4">
              {questions.map((question, index) => {
                const userAnswer = selectedAnswers[question.id];
                const isCorrect = userAnswer === question.correct_answer;
                return (
                  <div
                    key={question.id}
                    className={`p-4 rounded-lg border-2 ${isCorrect ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}`}
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
            onClick={() => {
              setShowResults(false);
              setCurrentQuestionIndex(0);
              setSelectedAnswers({});
              setConfirmedTaxed(new Map());
              setRevealedAnswers(new Set());
            }}
            className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
          >
            Refazer Simulado
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          >
            Concluir
          </button>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentQuestionIndex];
  const availableOptions = getAvailableOptions(currentQuestion);
  const selectedAnswer = selectedAnswers[currentQuestion.id];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <h2 className="text-2xl font-bold text-gray-800 flex-shrink-0">Simulado</h2>
            <p className="text-gray-600 text-sm flex-shrink-0">
              Questão {currentQuestionIndex + 1} de {questions.length}
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.back()}
            className="p-2 rounded-lg hover:bg-gray-100 transition flex-shrink-0"
            aria-label="Fechar"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        <div className="flex justify-center w-full mt-5 overflow-x-auto">
          <div className="inline-flex items-center gap-0 py-1">
            {questions.map((q, i) => {
              const revealed = revealedAnswers.has(q.id);
              const answered = !!selectedAnswers[q.id];
              const correct = selectedAnswers[q.id] === q.correct_answer;
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
              const isCurrentQuestion = i === currentQuestionIndex;
              return (
                <span key={q.id} className="contents">
                  <button
                    type="button"
                    onClick={() => setCurrentQuestionIndex(i)}
                    className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition text-sm font-medium cursor-pointer hover:opacity-90 hover:ring-2 hover:ring-primary-500 hover:ring-offset-1 ${ballStyle} ${
                      isCurrentQuestion ? 'ring-2 ring-primary-600 ring-offset-2' : ''
                    }`}
                    title={`${ballTitle} — Clique para ir à questão`}
                  >
                    {revealed ? correct ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" /> : i + 1}
                  </button>
                  {i < questions.length - 1 && (
                    <div className="w-4 flex-shrink-0 flex items-center px-0.5" aria-hidden>
                      <div className="h-px w-full bg-gray-300" />
                    </div>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className={`overflow-y-auto p-6 ${aiCommentOpen ? 'w-1/2 border-r border-gray-200' : 'w-full'}`}>
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
                      onClick={() => !isConfirmedTaxed && handleAnswerSelect(option.key)}
                      disabled={isConfirmedTaxed}
                      className={`flex flex-1 items-center gap-3 text-left min-w-0 ${isConfirmedTaxed ? 'cursor-not-allowed' : ''}`}
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

            {revealedAnswers.has(currentQuestion.id) && (() => {
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
          onClick={handlePrevious}
          disabled={currentQuestionIndex === 0}
          className="p-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
          title="Anterior"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="flex gap-2 items-center">
          <button
            type="button"
            onClick={() => {
              setRevealedAnswers((prev) => {
                const next = new Set(prev);
                if (next.has(currentQuestion.id)) next.delete(currentQuestion.id);
                else next.add(currentQuestion.id);
                return next;
              });
            }}
            className={`p-2.5 border rounded-lg transition flex items-center ${
              revealedAnswers.has(currentQuestion.id)
                ? 'border-primary-600 bg-primary-50 text-primary-700'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
            title={revealedAnswers.has(currentQuestion.id) ? 'Ocultar resposta' : 'Mostrar resposta'}
          >
            <Eye className="w-5 h-5 flex-shrink-0" />
            <span className="ml-1.5 text-sm">Ver Resposta</span>
          </button>

          <button
            type="button"
            onClick={() => {
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
          onClick={handleNext}
          className="p-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          title={currentQuestionIndex === questions.length - 1 ? 'Finalizar' : 'Próxima'}
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

export default function SimulatePage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
          <p className="text-gray-600">Carregando...</p>
        </div>
      }
    >
      <SimulatePageInner />
    </Suspense>
  );
}
