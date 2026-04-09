'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronDown, ChevronUp, Check, Filter } from 'lucide-react';
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
  const [noteId, setNoteId] = useState<string | null>(null);
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
            onClick={() => {
              localStorage.setItem(
                'pendingSimulateQuestions',
                JSON.stringify({ questions, tags })
              );
              router.push('/dashboard/simulados/novo');
            }}
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

    </div>
  );
}
