'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, X, Check, Filter, Eye } from 'lucide-react';
import ImageLightbox from '@/components/Common/ImageLightbox';

/** Limite máximo de questões no modal que precede a etapa de simulados */
const MAX_SIMULATE_QUESTIONS = 120;

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
  exam_year?: number | null;
  exam_board?: string | null;
  exam_institution?: string | null;
  exam_region?: string | null;
}

export default function SelectQuestionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<number[]>([]);
  const [expandedQuestionId, setExpandedQuestionId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<string[]>([]);
  const [showSimulateModal, setShowSimulateModal] = useState(false);
  const [showSimulateCountModal, setShowSimulateCountModal] = useState(false);
  const [simulateQuestionCount, setSimulateQuestionCount] = useState<number>(10);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [simulateQuestions, setSimulateQuestions] = useState<Question[]>([]);
  const [currentSimulateIndex, setCurrentSimulateIndex] = useState(0);
  const [selectedSimulateAnswers, setSelectedSimulateAnswers] = useState<Record<number, string>>({});
  const [showSimulateResults, setShowSimulateResults] = useState(false);
  const [loadingSimulate, setLoadingSimulate] = useState(false);
  const [confirmedTaxed, setConfirmedTaxed] = useState<Map<number, Set<string>>>(new Map());
  const [simulateRevealedAnswers, setSimulateRevealedAnswers] = useState<Set<number>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    exam_year: '',
    exam_board: '',
    exam_institution: '',
    exam_region: '',
  });

  useEffect(() => {
    const tagsParam = searchParams.get('tags');
    const noteIdParam = searchParams.get('noteId');
    
    if (!tagsParam) {
      router.push('/dashboard/notes/new');
      return;
    }

    if (noteIdParam) {
      setNoteId(noteIdParam);
    }

    try {
      const parsedTags = JSON.parse(tagsParam);
      setTags(parsedTags);
      fetchQuestions(parsedTags);
    } catch (error) {
      console.error('Erro ao parsear tags:', error);
      router.push('/dashboard/notes/new');
    }
  }, [searchParams, router]);

  // Rebuscar questões quando os filtros mudarem
  useEffect(() => {
    if (tags.length > 0) {
      fetchQuestions(tags);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const fetchQuestions = async (tagsArray: string[]) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login');
        return;
      }

      const tagsParam = JSON.stringify(tagsArray);
      const params = new URLSearchParams();
      params.append('tags', tagsParam);
      
      // Adicionar filtros se preenchidos
      if (filters.exam_year) params.append('exam_year', filters.exam_year);
      if (filters.exam_board) params.append('exam_board', filters.exam_board);
      if (filters.exam_institution) params.append('exam_institution', filters.exam_institution);
      if (filters.exam_region) params.append('exam_region', filters.exam_region);

      const response = await fetch(`/api/questions/by-tags?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setQuestions(data);
      }
    } catch (error) {
      console.error('Erro ao buscar questões:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleQuestionSelection = (questionId: number) => {
    setSelectedQuestionIds((prev) =>
      prev.includes(questionId)
        ? prev.filter((id) => id !== questionId)
        : [...prev, questionId]
    );
  };

  const toggleExpand = (questionId: number) => {
    setExpandedQuestionId(expandedQuestionId === questionId ? null : questionId);
  };

  const getHeaderText = () => {
    if (tags.length === 0) return 'Questões';
    if (tags.length === 1) return `Questões com o tema ${tags[0]}`;
    return `Questões com os temas ${tags.join(', ')}`;
  };

  const handleSave = async () => {
    if (noteId && selectedQuestionIds.length > 0) {
      // Se houver noteId, associar questões diretamente à nota
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          router.push('/login');
          return;
        }

        const response = await fetch(`/api/notes/${noteId}/questions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            question_ids: selectedQuestionIds,
          }),
        });

        if (response.ok) {
          alert('Questões associadas com sucesso!');
          router.back();
        } else {
          alert('Erro ao associar questões');
        }
      } catch (error) {
        console.error('Erro ao associar questões:', error);
        alert('Erro ao associar questões');
      }
    } else {
      // Se não houver noteId, salvar no localStorage para usar na página de criação de nota
      localStorage.setItem('selectedQuestionIds', JSON.stringify(selectedQuestionIds));
      router.back();
    }
  };

  const handleSimulate = async () => {
    setShowSimulateCountModal(false);
    setLoadingSimulate(true);
    setShowSimulateModal(true);
    setCurrentSimulateIndex(0);
    setSelectedSimulateAnswers({});
    setShowSimulateResults(false);
    setConfirmedTaxed(new Map());
    setSimulateRevealedAnswers(new Set());

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login');
        return;
      }

      const tagsParam = JSON.stringify(tags);
      const params = new URLSearchParams();
      params.append('tags', tagsParam);
      
      // Adicionar filtros se preenchidos
      if (filters.exam_year) params.append('exam_year', filters.exam_year);
      if (filters.exam_board) params.append('exam_board', filters.exam_board);
      if (filters.exam_institution) params.append('exam_institution', filters.exam_institution);
      if (filters.exam_region) params.append('exam_region', filters.exam_region);

      const response = await fetch(`/api/questions/by-tags?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const allQuestions = await response.json();
        // Embaralhar e pegar apenas a quantidade solicitada
        const shuffled = [...allQuestions].sort(() => Math.random() - 0.5);
        const count = Math.min(simulateQuestionCount, MAX_SIMULATE_QUESTIONS, shuffled.length);
        const selected = shuffled.slice(0, count);
        setSimulateQuestions(selected);
      }
    } catch (error) {
      console.error('Erro ao buscar questões:', error);
    } finally {
      setLoadingSimulate(false);
    }
  };

  const calculateSimulateScore = () => {
    let correct = 0;
    simulateQuestions.forEach((question) => {
      if (selectedSimulateAnswers[question.id] === question.correct_answer) {
        correct++;
      }
    });
    return { correct, total: simulateQuestions.length };
  };

  const handleSimulateAnswerSelect = (answer: string) => {
    const currentQuestion = simulateQuestions[currentSimulateIndex];
    setSelectedSimulateAnswers({
      ...selectedSimulateAnswers,
      [currentQuestion.id]: answer,
    });
  };

  const handleSimulateNext = () => {
    if (currentSimulateIndex < simulateQuestions.length - 1) {
      setCurrentSimulateIndex(currentSimulateIndex + 1);
    } else {
      // Apenas mostrar resultados, sem salvar automaticamente
      setShowSimulateResults(true);
    }
  };

  const handleSaveSimulate = () => {
    const { correct, total } = calculateSimulateScore();
    const percentage = Math.round((correct / total) * 100);
    
    // Obter informações do usuário do token
    let userInfo = {};
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
      } catch (error) {
        console.error('Erro ao decodificar token:', error);
      }
    }
    
    const result = {
      id: Date.now(),
      total_questions: total,
      correct_answers: correct,
      percentage: percentage,
      tags: tags,
      created_at: new Date().toISOString(),
      ...userInfo,
    };
    
    const savedResults = localStorage.getItem('simulateResults');
    const results = savedResults ? JSON.parse(savedResults) : [];
    results.unshift(result); // Adicionar no início
    localStorage.setItem('simulateResults', JSON.stringify(results));
    
    // Fechar modal e redirecionar para a página de simulados
    setShowSimulateModal(false);
    router.push('/dashboard/simulados');
  };

  const handleSimulatePrevious = () => {
    if (currentSimulateIndex > 0) {
      setCurrentSimulateIndex(currentSimulateIndex - 1);
    }
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

  const taxAlternative = (questionId: number, optionKey: string) => {
    setConfirmedTaxed(prev => {
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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-lg hover:bg-gray-100 transition"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-800">{getHeaderText()}</h1>
            {selectedQuestionIds.length > 0 && (
              <p className="text-gray-600 mt-1">
                {selectedQuestionIds.length === 1 
                  ? '1 questão selecionada'
                  : `${selectedQuestionIds.length} questões selecionadas`
                }
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setShowSimulateCountModal(true)}
            className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition font-medium"
          >
            Simulado
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition font-medium"
          >
            Salvar
          </button>
        </div>
      </div>

      {/* Área de Filtros */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center justify-between w-full text-left"
        >
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-gray-600" />
            <span className="font-medium text-gray-800">Filtrar</span>
          </div>
          {showFilters ? (
            <ChevronUp className="w-5 h-5 text-gray-600" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-600" />
          )}
        </button>

        {showFilters && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <div>
                <label htmlFor="filter_exam_year" className="block text-sm font-medium text-gray-700 mb-2">
                  Ano da Prova
                </label>
                <input
                  type="number"
                  id="filter_exam_year"
                  value={filters.exam_year}
                  onChange={(e) => setFilters({ ...filters, exam_year: e.target.value })}
                  placeholder="Ex: 2024"
                  min="1900"
                  max="2100"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div>
                <label htmlFor="filter_exam_board" className="block text-sm font-medium text-gray-700 mb-2">
                  Banca da Prova
                </label>
                <input
                  type="text"
                  id="filter_exam_board"
                  value={filters.exam_board}
                  onChange={(e) => setFilters({ ...filters, exam_board: e.target.value })}
                  placeholder="Ex: FGV, VUNESP"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div>
                <label htmlFor="filter_exam_institution" className="block text-sm font-medium text-gray-700 mb-2">
                  Instituição
                </label>
                <input
                  type="text"
                  id="filter_exam_institution"
                  value={filters.exam_institution}
                  onChange={(e) => setFilters({ ...filters, exam_institution: e.target.value })}
                  placeholder="Ex: USP, UNIFESP"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div>
                <label htmlFor="filter_exam_region" className="block text-sm font-medium text-gray-700 mb-2">
                  Região
                </label>
                <input
                  type="text"
                  id="filter_exam_region"
                  value={filters.exam_region}
                  onChange={(e) => setFilters({ ...filters, exam_region: e.target.value })}
                  placeholder="Ex: Sudeste, Nordeste"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setFilters({
                    exam_year: '',
                    exam_board: '',
                    exam_institution: '',
                    exam_region: '',
                  });
                }}
                className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition"
              >
                Limpar Filtros
              </button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="text-gray-600 mt-4">Carregando questões...</p>
        </div>
      ) : questions.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <p className="text-gray-600">Nenhuma questão encontrada com as tags selecionadas.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {questions.map((question) => (
            <div
              key={question.id}
              className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition"
            >
              <div className="flex items-start gap-4">
                {/* Checkbox */}
                <div className="flex-shrink-0 pt-1">
                  <button
                    type="button"
                    onClick={() => toggleQuestionSelection(question.id)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition ${
                      selectedQuestionIds.includes(question.id)
                        ? 'bg-primary-600 border-primary-600'
                        : 'border-gray-300 hover:border-primary-400'
                    }`}
                  >
                    {selectedQuestionIds.includes(question.id) && (
                      <Check className="w-3 h-3 text-white" />
                    )}
                  </button>
                </div>

                {/* Conteúdo da questão */}
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-gray-800 font-medium flex-1 line-clamp-2">{question.statement}</p>
                    <button
                      type="button"
                      onClick={() => toggleExpand(question.id)}
                      className="flex-shrink-0 text-primary-600 hover:text-primary-700 text-sm font-medium"
                    >
                      {expandedQuestionId === question.id ? (
                        <ChevronUp className="w-5 h-5" />
                      ) : (
                        <ChevronDown className="w-5 h-5" />
                      )}
                    </button>
                  </div>

                  {/* Conteúdo expandido */}
                  {expandedQuestionId === question.id && (
                    <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
                      {/* 1. Enunciado */}
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-gray-700">Enunciado:</p>
                        <p className="text-gray-800 text-base leading-relaxed">{question.statement}</p>
                      </div>

                      {/* 2. Imagens */}
                      {question.images && question.images.length > 0 && (
                        <div className="flex flex-wrap justify-center gap-4">
                          {question.images.map((image, idx) => (
                            <ImageLightbox
                              key={idx}
                              src={image}
                              alt={`Imagem ${idx + 1}`}
                              className="h-32 w-auto max-w-xs"
                            />
                          ))}
                        </div>
                      )}

                      {/* 3. Alternativas */}
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-gray-700">Alternativas:</p>
                        <div className="space-y-1 text-xs">
                          <div className="flex items-start gap-2">
                            <span className="font-medium text-gray-600">A)</span>
                            <span className="text-gray-700">{question.option_a}</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="font-medium text-gray-600">B)</span>
                            <span className="text-gray-700">{question.option_b}</span>
                          </div>
                          {question.option_c && (
                            <div className="flex items-start gap-2">
                              <span className="font-medium text-gray-600">C)</span>
                              <span className="text-gray-700">{question.option_c}</span>
                            </div>
                          )}
                          {question.option_d && (
                            <div className="flex items-start gap-2">
                              <span className="font-medium text-gray-600">D)</span>
                              <span className="text-gray-700">{question.option_d}</span>
                            </div>
                          )}
                          {question.option_e && (
                            <div className="flex items-start gap-2">
                              <span className="font-medium text-gray-600">E)</span>
                              <span className="text-gray-700">{question.option_e}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Explicação */}
                      {question.explanation && (
                        <div className="pt-2">
                          <p className="text-sm font-semibold text-gray-700 mb-1">Explicação:</p>
                          <p className="text-sm text-gray-600">{question.explanation}</p>
                        </div>
                      )}

                      {/* 4. Tags - Aparecem por último, no final da página */}
                      {question.tags && question.tags.length > 0 && (
                        <div className="space-y-2 pt-2 border-t border-gray-200">
                          <p className="text-sm font-semibold text-gray-700">Tags:</p>
                          <div className="flex flex-wrap gap-2">
                            {question.tags.map((tag, idx) => (
                              <span
                                key={idx}
                                className="px-2 py-0.5 text-xs bg-primary-100 text-primary-700 rounded-full"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Seleção de Quantidade */}
      {showSimulateCountModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Fazer Simulado</h2>
            <p className="text-sm text-gray-600 mb-4">
              Selecione a quantidade de questões que deseja responder:
            </p>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Quantidade de questões (máximo: {Math.min(questions.length, MAX_SIMULATE_QUESTIONS)})
              </label>
              <input
                type="number"
                min="1"
                max={Math.min(questions.length, MAX_SIMULATE_QUESTIONS)}
                value={simulateQuestionCount}
                onChange={(e) => setSimulateQuestionCount(Math.min(Math.max(1, parseInt(e.target.value) || 1), Math.min(questions.length, MAX_SIMULATE_QUESTIONS)))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowSimulateCountModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSimulate}
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
              >
                Iniciar Simulado
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Simulado */}
      {showSimulateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            {loadingSimulate ? (
              <div className="p-12 text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                <p className="text-gray-600 mt-4">Carregando questões...</p>
              </div>
            ) : simulateQuestions.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-gray-600 mb-4">Nenhuma questão disponível para o simulado.</p>
                <button
                  onClick={() => setShowSimulateModal(false)}
                  className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
                >
                  Fechar
                </button>
              </div>
            ) : showSimulateResults ? (
              <>
                {/* Header Fixo */}
                <div className="sticky top-0 bg-white border-b border-gray-200 p-6 z-10 rounded-t-lg">
                  <div className="flex items-center justify-between">
                    <h2 className="text-3xl font-bold text-gray-800">Resultado do Simulado</h2>
                    <button
                      onClick={() => setShowSimulateModal(false)}
                      className="p-2 rounded-lg hover:bg-gray-100 transition"
                      aria-label="Fechar"
                    >
                      <X className="w-5 h-5 text-gray-600" />
                    </button>
                  </div>
                </div>

                {/* Conteúdo com Scroll */}
                <div className="flex-1 overflow-y-auto p-6">
                  {(() => {
                    const { correct, total } = calculateSimulateScore();
                    const percentage = Math.round((correct / total) * 100);
                    return (
                      <div className="space-y-6">
                        <div className="text-center bg-white rounded-lg border border-gray-200 p-8">
                          <div className="text-6xl font-bold text-primary-600 mb-2">{percentage}%</div>
                          <p className="text-xl text-gray-700 mb-6">
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
                    );
                  })()}
                </div>

                {/* Rodapé Fixo */}
                <div className="sticky bottom-0 bg-white border-t border-gray-200 p-6 flex gap-3 justify-center rounded-b-lg">
                  <button
                    onClick={() => setShowSimulateModal(false)}
                    className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                  >
                    Fechar
                  </button>
                  <button
                    onClick={() => {
                      setShowSimulateResults(false);
                      setCurrentSimulateIndex(0);
                      setSelectedSimulateAnswers({});
                      handleSimulate();
                    }}
                    className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                  >
                    Refazer Simulado
                  </button>
                  <button
                    onClick={handleSaveSimulate}
                    className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
                  >
                    Salvar
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Header Fixo: Simulado + subheader na linha; bolinhas de progressão embaixo */}
                <div className="sticky top-0 bg-white border-b border-gray-200 p-6 z-10 rounded-t-lg">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <h2 className="text-3xl font-bold text-gray-800 flex-shrink-0">Simulado</h2>
                      <p className="text-gray-600 text-sm flex-shrink-0">
                        Questão {currentSimulateIndex + 1} de {simulateQuestions.length}
                      </p>
                    </div>
                    <button
                      onClick={() => setShowSimulateModal(false)}
                      className="p-2 rounded-lg hover:bg-gray-100 transition flex-shrink-0"
                      aria-label="Fechar"
                    >
                      <X className="w-5 h-5 text-gray-600" />
                    </button>
                  </div>
                  {/* Indicadores de progresso: cinza=respondida; verde=acertou (após Ver Resposta); vermelha=errou/não respondeu (após Ver Resposta) */}
                  <div className="flex items-center w-full mt-4">
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
                          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition text-sm font-medium cursor-pointer hover:opacity-90 hover:ring-2 hover:ring-primary-500 hover:ring-offset-1 ${ballStyle} ${isCurrentQuestion ? 'ring-2 ring-primary-600 ring-offset-2' : ''}`}
                          title={`${ballTitle} — Clique para ir à questão`}
                        >
                          {revealed ? (correct ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />) : (i + 1)}
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

                {/* Conteúdo com Scroll */}
                <div className="flex-1 overflow-y-auto p-6">
                  {(() => {
                    const currentQuestion = simulateQuestions[currentSimulateIndex];
                    const availableOptions = getAvailableOptions(currentQuestion);
                    const selectedAnswer = selectedSimulateAnswers[currentQuestion.id];

                    return (
                      <div className="space-y-6">
                        {/* Enunciado */}
                        <div>
                          <p className="text-lg font-medium text-gray-800">
                            {currentQuestion.statement}
                          </p>
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
                                    <span className="font-semibold text-gray-700">{option.key})</span>{' '}
                                    <span className="text-gray-700">{option.value}</span>
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
                          const correctOption = availableOptions.find(o => o.key === currentQuestion.correct_answer);
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
                    );
                  })()}
                </div>

                {/* Rodapé Fixo */}
                <div className="sticky bottom-0 bg-white border-t border-gray-200 p-6 flex justify-between items-center rounded-b-lg">
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
                        const q = simulateQuestions[currentSimulateIndex];
                        if (!q) return;
                        setSimulateRevealedAnswers(prev => {
                          const next = new Set(prev);
                          if (next.has(q.id)) next.delete(q.id);
                          else next.add(q.id);
                          return next;
                        });
                      }}
                      className={`p-2.5 border rounded-lg transition flex items-center ${
                        simulateRevealedAnswers.has(simulateQuestions[currentSimulateIndex]?.id as number)
                          ? 'border-primary-600 bg-primary-50 text-primary-700'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                      title={simulateRevealedAnswers.has(simulateQuestions[currentSimulateIndex]?.id as number) ? 'Ocultar resposta' : 'Mostrar resposta'}
                    >
                      <Eye className="w-5 h-5 flex-shrink-0" />
                      <span className="ml-1.5 text-sm">Ver Resposta</span>
                    </button>
                    <button
                      type="button"
                      className="px-4 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium"
                    >
                      Ajuda
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
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
