'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle, XCircle, Ban, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';

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

export default function ProvaExamPage() {
  const router = useRouter();
  const params = useParams();
  const provaId = Number(params.id);

  const [prova, setProva] = useState<Prova | null>(null);
  const [examIndex, setExamIndex] = useState(0);
  const [examAnswers, setExamAnswers] = useState<Record<number, string>>({});
  const [showResults, setShowResults] = useState(false);

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

  if (!prova) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  const questions = prova.questions;
  const currentQuestion = questions[examIndex];
  const total = questions.length;

  const getOptionValue = (q: ProvaQuestion, key: string): string => {
    const map: Record<string, string> = {
      A: q.option_a,
      B: q.option_b,
      C: q.option_c || '',
      D: q.option_d || '',
      E: q.option_e || '',
    };
    return map[key] || '';
  };

  const handleAnswer = (letter: string) => {
    if (!currentQuestion) return;
    setExamAnswers((prev) => ({ ...prev, [currentQuestion.id]: letter }));
  };

  const handleNext = () => {
    if (examIndex < total - 1) setExamIndex((i) => i + 1);
    else setShowResults(true);
  };

  const handlePrev = () => {
    if (examIndex > 0) setExamIndex((i) => i - 1);
  };

  const correctCount = prova.questions.filter((q) => examAnswers[q.id] === q.correct_answer).length;
  const percent = total ? Math.round((correctCount / total) * 100) : 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => router.push('/dashboard/provas')}
          className="p-2 rounded-lg hover:bg-gray-100 transition"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{prova.nome}</h1>
          {(prova.banca || prova.regiao || prova.ano) && (
            <p className="text-sm text-gray-500">
              {[prova.banca, prova.regiao, prova.ano].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>

      {showResults ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8">
          <div className="text-center mb-8">
            <p className="text-5xl font-bold text-primary-600 mb-2">{percent}%</p>
            <p className="text-gray-600">{correctCount} de {total} questões corretas</p>
            <div className="flex justify-center gap-6 mt-4 text-sm">
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircle className="w-4 h-4" /> {correctCount} corretas
              </span>
              <span className="flex items-center gap-1 text-red-600">
                <XCircle className="w-4 h-4" /> {total - correctCount} incorretas
              </span>
            </div>
          </div>
          <div className="space-y-4">
            {prova.questions.map((q, idx) => {
              const userAnswer = examAnswers[q.id];
              const isCorrect = userAnswer === q.correct_answer;
              return (
                <div
                  key={q.id}
                  className={`p-4 rounded-lg border-2 ${isCorrect ? 'border-green-400 bg-green-50' : 'border-red-400 bg-red-50'}`}
                >
                  <div className="flex items-start justify-between mb-1">
                    <p className="font-semibold text-gray-800 text-sm">Questão {q.numero_na_prova ?? idx + 1}</p>
                    {isCorrect ? (
                      <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-gray-700 text-sm mb-2 line-clamp-2">{q.statement}</p>
                  <div className="text-xs space-y-0.5">
                    <p>
                      <span className="font-medium">Sua resposta:</span>{' '}
                      <span className={isCorrect ? 'text-green-700' : 'text-red-700'}>
                        {userAnswer || 'Não respondida'}
                      </span>
                    </p>
                    {!isCorrect && (
                      <p>
                        <span className="font-medium">Correta:</span>{' '}
                        <span className="text-green-700">{q.correct_answer}</span>
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-center mt-6">
            <button
              type="button"
              onClick={() => router.push('/dashboard/provas')}
              className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
            >
              Voltar para Provas
            </button>
          </div>
        </div>
      ) : currentQuestion ? (
        <div className="bg-white rounded-xl border border-gray-200 flex flex-col">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>
                Questão {currentQuestion.numero_na_prova ?? examIndex + 1} (ID #{currentQuestion.id})
                {currentQuestion.anulada && (
                  <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold border border-red-200">
                    <Ban className="w-3 h-3" />
                    ANULADA
                  </span>
                )}
              </span>
              <span>
                {[currentQuestion.exam_board, currentQuestion.exam_region, currentQuestion.exam_year, currentQuestion.exam_type].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>

          <div className="p-6 flex-1">
            {currentQuestion.anulada && (
              <div className="flex items-start gap-2 mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm font-semibold">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                Questão anulada — não disponível para simulados.
              </div>
            )}
            <p className="text-gray-800 mb-4 whitespace-pre-wrap">{currentQuestion.statement}</p>
            <div className="space-y-2">
              {['A', 'B', 'C', 'D', 'E'].map((key) => {
                const val = getOptionValue(currentQuestion, key);
                if (!val) return null;
                const selected = examAnswers[currentQuestion.id] === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleAnswer(key)}
                    className={`w-full text-left p-3 rounded-lg border-2 transition ${
                      selected ? 'border-primary-500 bg-primary-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                    }`}
                  >
                    <span className="font-semibold text-gray-700">{key})</span>{' '}
                    <span className="text-gray-800">{val}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
            <button
              type="button"
              onClick={handlePrev}
              disabled={examIndex === 0}
              className="flex items-center gap-1 px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" /> Anterior
            </button>
            <span className="text-sm text-gray-600">{examIndex + 1} de {total}</span>
            <button
              type="button"
              onClick={handleNext}
              className="flex items-center gap-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
            >
              {examIndex >= total - 1 ? 'Finalizar' : 'Próxima'} <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
