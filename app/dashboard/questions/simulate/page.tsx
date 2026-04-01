'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, X } from 'lucide-react';
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

export default function SimulatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tagsParam = searchParams.get('tags');
    const countParam = searchParams.get('count');
    
    if (!tagsParam || !countParam) {
      router.push('/dashboard/notes/new');
      return;
    }

    const count = parseInt(countParam);
    fetchQuestions(JSON.parse(tagsParam), count);
  }, [searchParams, router]);

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
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const allQuestions = await response.json();
        // Embaralhar e pegar apenas a quantidade solicitada
        const shuffled = [...allQuestions].sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, Math.min(count, shuffled.length));
        setQuestions(selected);
      }
    } catch (error) {
      console.error('Erro ao buscar questões:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerSelect = (answer: string) => {
    const currentQuestion = questions[currentQuestionIndex];
    setSelectedAnswers({
      ...selectedAnswers,
      [currentQuestion.id]: answer,
    });
  };

  const handleNext = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    } else {
      setShowResults(true);
    }
  };

  const handlePrevious = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
    }
  };

  const calculateScore = () => {
    let correct = 0;
    questions.forEach((question) => {
      if (selectedAnswers[question.id] === question.correct_answer) {
        correct++;
      }
    });
    return { correct, total: questions.length };
  };

  const getAvailableOptions = (question: Question) => {
    const options = [
      { key: 'A', value: question.option_a },
      { key: 'B', value: question.option_b },
    ];
    if (question.option_c) options.push({ key: 'C', value: question.option_c });
    if (question.option_d) options.push({ key: 'D', value: question.option_d });
    if (question.option_e) options.push({ key: 'E', value: question.option_e });
    return options;
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-12">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="text-gray-600 mt-4">Carregando questões...</p>
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="max-w-4xl mx-auto py-12">
        <div className="text-center bg-white rounded-lg border border-gray-200 p-8">
          <p className="text-gray-600">Nenhuma questão disponível para o simulado.</p>
          <button
            onClick={() => router.back()}
            className="mt-4 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  if (showResults) {
    const { correct, total } = calculateScore();
    const percentage = Math.round((correct / total) * 100);

    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <h2 className="text-3xl font-bold text-gray-800 mb-4">Resultado do Simulado</h2>
          <div className="text-6xl font-bold text-primary-600 mb-2">{percentage}%</div>
          <p className="text-xl text-gray-700 mb-6">
            Você acertou {correct} de {total} questões
          </p>
          
          <div className="space-y-4 mt-8">
            {questions.map((question, index) => {
              const userAnswer = selectedAnswers[question.id];
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

          <div className="mt-8 flex gap-3 justify-center">
            <button
              onClick={() => router.back()}
              className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
            >
              Voltar
            </button>
            <button
              onClick={() => {
                setShowResults(false);
                setCurrentQuestionIndex(0);
                setSelectedAnswers({});
              }}
              className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
            >
              Refazer Simulado
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentQuestionIndex];
  const availableOptions = getAvailableOptions(currentQuestion);
  const selectedAnswer = selectedAnswers[currentQuestion.id];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-gray-100 transition"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Simulado</h1>
          <p className="text-gray-600 mt-1">
            Questão {currentQuestionIndex + 1} de {questions.length}
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-gray-200 rounded-full h-2">
        <div
          className="bg-primary-600 h-2 rounded-full transition-all duration-300"
          style={{ width: `${((currentQuestionIndex + 1) / questions.length) * 100}%` }}
        />
      </div>

      {/* Questão */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
        {/* Enunciado */}
        <div>
          <p className="text-lg font-medium text-gray-800">{currentQuestion.statement}</p>
        </div>

        {/* Imagens */}
        {currentQuestion.images && currentQuestion.images.length > 0 && (
          <div className="flex flex-wrap justify-center gap-4">
            {currentQuestion.images.map((image, idx) => (
              <ImageLightbox
                key={idx}
                src={image}
                alt={`Imagem ${idx + 1}`}
                className="h-48 w-auto max-w-xs"
              />
            ))}
          </div>
        )}

        {/* Alternativas */}
        <div className="space-y-3">
          {availableOptions.map((option) => {
            const isSelected = selectedAnswer === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => handleAnswerSelect(option.key)}
                className={`w-full p-4 rounded-lg border-2 text-left transition ${
                  isSelected
                    ? 'border-primary-600 bg-primary-50'
                    : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      isSelected
                        ? 'border-primary-600 bg-primary-600'
                        : 'border-gray-400'
                    }`}
                  >
                    {isSelected && <Check className="w-4 h-4 text-white" />}
                  </div>
                  <div>
                    <span className="font-semibold text-gray-700 text-sm">{option.key})</span>{' '}
                    <span className="text-gray-700 text-sm">{option.value}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Navegação */}
      <div className="flex justify-between items-center">
        <button
          type="button"
          onClick={handlePrevious}
          disabled={currentQuestionIndex === 0}
          className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={handleNext}
          className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
        >
          {currentQuestionIndex === questions.length - 1 ? 'Finalizar' : 'Próxima'}
        </button>
      </div>
    </div>
  );
}
