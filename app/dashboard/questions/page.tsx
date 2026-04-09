'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Edit, Trash2, X, Image as ImageIcon, Filter, ChevronDown, ChevronUp, ClipboardList, Ban, AlertTriangle } from 'lucide-react';
import TagAutocomplete from '@/components/Common/TagAutocomplete';
import DeCSAutocomplete from '@/components/Common/DeCSAutocomplete';
import ImageLightbox from '@/components/Common/ImageLightbox';
import {
  ASSUNTOS_BY_AREA,
  toDisplayArea,
  toDisplayAssunto,
  fromDisplay,
  AREAS_OPTIONS_DISPLAY,
} from '@/lib/areas-assuntos';

const PAGE_SIZE = 15;

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
  exam_year?: number | null;
  exam_board?: string | null;
  exam_institution?: string | null;
  exam_region?: string | null;
  anulada?: boolean;
  decs_terms?: string[];
  created_at: string;
  updated_at: string;
}

export default function QuestionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [availableTags, setAvailableTags] = useState<string[]>(AVAILABLE_TAGS);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [revealedAnswers, setRevealedAnswers] = useState<Set<number>>(new Set());
  const [formData, setFormData] = useState({
    statement: '',
    option_a: '',
    option_b: '',
    option_c: '',
    option_d: '',
    option_e: '',
    correct_answer: 'A' as 'A' | 'B' | 'C' | 'D' | 'E',
    explanation: '',
    tags: [] as string[],
    images: [] as string[],
    areas_conhecimento: [] as string[],
    assuntos: [] as string[],
    decs_terms: [] as string[],
    exam_year: null as number | null,
    exam_board: '',
    exam_institution: '',
    exam_region: '',
  });
  const formAssuntosOptions = useMemo(() => {
    if (formData.areas_conhecimento.length === 0) return [];
    const set = new Set<string>();
    formData.areas_conhecimento.forEach((area) => {
      const assuntos = ASSUNTOS_BY_AREA[area];
      if (assuntos) assuntos.forEach((a) => set.add(a));
    });
    return Array.from(set);
  }, [formData.areas_conhecimento]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    exam_year: '',
    exam_board: '',
    exam_institution: '',
    tags: [] as string[],
    areas_conhecimento: [] as string[],
    assuntos: [] as string[],
  });
  const assuntosOptions = useMemo(() => {
    if (filters.areas_conhecimento.length === 0) return [];
    const set = new Set<string>();
    filters.areas_conhecimento.forEach((area) => {
      const assuntos = ASSUNTOS_BY_AREA[area];
      if (assuntos) assuntos.forEach((a) => set.add(a));
    });
    return Array.from(set);
  }, [filters.areas_conhecimento]);

  useEffect(() => {
    // Verificar role do usuário
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const role = payload.role || 'regular';
        setIsAdmin(role === 'admin');
      } catch (error) {
        console.error('Erro ao decodificar token:', error);
      }
    }
  }, []);

  // Quando a área do conhecimento mudar (filtros), manter apenas assuntos que ainda estão nas opções
  useEffect(() => {
    if (filters.areas_conhecimento.length === 0) {
      setFilters((prev) => ({ ...prev, assuntos: [] }));
      return;
    }
    const opcoes = new Set<string>();
    filters.areas_conhecimento.forEach((area) => {
      const assuntos = ASSUNTOS_BY_AREA[area];
      if (assuntos) assuntos.forEach((a) => opcoes.add(a));
    });
    setFilters((prev) => ({
      ...prev,
      assuntos: prev.assuntos.filter((a) => opcoes.has(a)),
    }));
  }, [filters.areas_conhecimento]);

  // Quando a área do conhecimento mudar (formulário do modal), manter apenas assuntos que ainda estão nas opções
  useEffect(() => {
    if (formData.areas_conhecimento.length === 0) {
      setFormData((prev) => ({ ...prev, assuntos: [] }));
      return;
    }
    const opcoes = new Set<string>();
    formData.areas_conhecimento.forEach((area) => {
      const assuntos = ASSUNTOS_BY_AREA[area];
      if (assuntos) assuntos.forEach((a) => opcoes.add(a));
    });
    setFormData((prev) => ({
      ...prev,
      assuntos: prev.assuntos.filter((a) => opcoes.has(a)),
    }));
  }, [formData.areas_conhecimento]);

  // Ao mudar filtros, voltar para a página 1
  useEffect(() => {
    setCurrentPage(1);
  }, [filters.exam_year, filters.exam_board, filters.exam_institution, filters.tags, filters.areas_conhecimento, filters.assuntos]);


  // Buscar questões quando página ou filtros mudarem
  useEffect(() => {
    fetchQuestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, currentPage]);

  // Ajustar resposta correta quando alternativas opcionais são removidas
  useEffect(() => {
    const availableOptions = ['A', 'B'];
    if (formData.option_c) availableOptions.push('C');
    if (formData.option_d) availableOptions.push('D');
    if (formData.option_e) availableOptions.push('E');

    // Se a resposta correta atual não está nas opções disponíveis, ajustar para A
    if (!availableOptions.includes(formData.correct_answer)) {
      setFormData(prev => ({ ...prev, correct_answer: 'A' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.option_c, formData.option_d, formData.option_e]);

  const getToken = () => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('token');
    }
    return null;
  };

  const fetchQuestions = async () => {
    try {
      setLoading(true);
      const token = getToken();
      if (!token) return;

      const params = new URLSearchParams();
      params.set('page', String(currentPage));
      params.set('limit', String(PAGE_SIZE));
      if (filters.exam_year) params.append('exam_year', filters.exam_year);
      if (filters.exam_board) params.append('exam_board', filters.exam_board);
      if (filters.exam_institution) params.append('exam_institution', filters.exam_institution);
      if (filters.tags.length > 0) params.append('tags', filters.tags.join(','));
      if (filters.areas_conhecimento.length > 0) params.append('areas_conhecimento', filters.areas_conhecimento.join(','));
      if (filters.assuntos.length > 0) params.append('assuntos', filters.assuntos.join(','));

      const url = `/api/questions?${params.toString()}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          setQuestions(data);
          setTotalQuestions(data.length);
        } else {
          setQuestions(data.questions ?? []);
          setTotalQuestions(data.total ?? 0);
        }
      }
    } catch (error) {
      console.error('Erro ao buscar questões:', error);
    } finally {
      setLoading(false);
    }
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setMessage(null);

    try {
      const token = getToken();
      if (!token) {
        setMessage({ type: 'error', text: 'Não autorizado' });
        return;
      }

      // Validar resposta correta antes de enviar
      const availableOptions = ['A', 'B'];
      if (formData.option_c) availableOptions.push('C');
      if (formData.option_d) availableOptions.push('D');
      if (formData.option_e) availableOptions.push('E');

      if (!availableOptions.includes(formData.correct_answer)) {
        setMessage({ 
          type: 'error', 
          text: `A resposta correta deve ser uma das alternativas preenchidas: ${availableOptions.join(', ')}` 
        });
        setFormLoading(false);
        return;
      }

      const url = editingQuestion 
        ? `/api/questions/${editingQuestion.id}`
        : '/api/questions';
      const method = editingQuestion ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...formData,
          option_c: formData.option_c || null,
          option_d: formData.option_d || null,
          option_e: formData.option_e || null,
          explanation: formData.explanation || null,
          exam_year: formData.exam_year || null,
          exam_board: formData.exam_board || null,
          exam_institution: formData.exam_institution || null,
          exam_region: formData.exam_region || null,
          areas_conhecimento: formData.areas_conhecimento,
          assuntos: formData.assuntos,
        }),
      });

      if (response.ok) {
        setMessage({ 
          type: 'success', 
          text: editingQuestion ? 'Questão atualizada com sucesso!' : 'Questão criada com sucesso!' 
        });
        setFormData({
          statement: '',
          option_a: '',
          option_b: '',
          option_c: '',
          option_d: '',
          option_e: '',
          correct_answer: 'A',
          explanation: '',
          tags: [],
          images: [],
          areas_conhecimento: [],
          assuntos: [],
          decs_terms: [],
          exam_year: null,
          exam_board: '',
          exam_institution: '',
          exam_region: '',
        });
        setEditingQuestion(null);
        setShowModal(false);
        await fetchQuestions();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || 'Erro ao salvar a questão' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Erro ao salvar a questão. Tente novamente.' });
    } finally {
      setFormLoading(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) {
        setMessage({ type: 'error', text: 'Apenas arquivos de imagem são permitidos' });
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setFormData((prev) => ({
          ...prev,
          images: [...prev.images, base64],
        }));
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeImage = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index),
    }));
  };

  const handleEdit = (question: Question) => {
    setEditingQuestion(question);
    setFormData({
      statement: question.statement,
      option_a: question.option_a,
      option_b: question.option_b,
      option_c: question.option_c,
      option_d: question.option_d,
      option_e: question.option_e || '',
      correct_answer: question.correct_answer,
      explanation: question.explanation || '',
      tags: question.tags || [],
      images: question.images || [],
      areas_conhecimento: question.areas_conhecimento || [],
      assuntos: question.assuntos || [],
      decs_terms: question.decs_terms || [],
      exam_year: question.exam_year || null,
      exam_board: question.exam_board || '',
      exam_institution: question.exam_institution || '',
      exam_region: question.exam_region || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Tem certeza que deseja excluir esta questão?')) {
      return;
    }

    try {
      const token = getToken();
      if (!token) {
        setMessage({ type: 'error', text: 'Não autorizado' });
        return;
      }

      const response = await fetch(`/api/questions/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        setMessage({ type: 'success', text: 'Questão excluída com sucesso!' });
        await fetchQuestions();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || 'Erro ao excluir a questão' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Erro ao excluir a questão. Tente novamente.' });
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingQuestion(null);
    setFormData({
      statement: '',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      option_e: '',
      correct_answer: 'A',
      explanation: '',
      tags: [],
      images: [],
      areas_conhecimento: [],
      assuntos: [],
      decs_terms: [],
      exam_year: null,
      exam_board: '',
      exam_institution: '',
      exam_region: '',
    });
    setMessage(null);
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

  const toggleRevealAnswer = (questionId: number) => {
    setRevealedAnswers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(questionId)) {
        newSet.delete(questionId);
      } else {
        newSet.add(questionId);
      }
      return newSet;
    });
  };


  // Detectar parâmetro edit na URL e abrir modal automaticamente
  useEffect(() => {
    if (!searchParams) return;
    const editId = searchParams.get('edit');
    if (editId && questions.length > 0 && !editingQuestion) {
      const questionToEdit = questions.find(q => q.id === parseInt(editId));
      if (questionToEdit) {
        handleEdit(questionToEdit);
        // Limpar parâmetro da URL sem recarregar a página
        router.replace('/dashboard/questions', { scroll: false });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, questions]);

  return (
    <div className="space-y-6 relative pb-24">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">
            Questões ({totalQuestions})
          </h1>
          <p className="text-gray-600 mt-1">
            {isAdmin ? 'Gerencie o banco de questões' : 'Pratique com questões de estudo'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {totalQuestions > 0 && (
            <button
              onClick={() => router.push('/dashboard/simulados/novo')}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
            >
              <ClipboardList className="w-5 h-5" />
              Fazer Simulado
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
            >
              <Plus className="w-5 h-5" />
              Nova Questão
            </button>
          )}
        </div>
      </header>

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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
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
            </div>
            
            {/* Filtro Área do Conhecimento e Assuntos lado a lado */}
            <div className="flex flex-wrap gap-4 mb-4">
              <div className="flex-1 min-w-0">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Área do Conhecimento
                </label>
                <TagAutocomplete
                  options={AREAS_OPTIONS_DISPLAY}
                  selectedTags={filters.areas_conhecimento.map(toDisplayArea)}
                  onChange={(tags) => setFilters({ ...filters, areas_conhecimento: tags.map(fromDisplay) })}
                  onSaveNewTag={() => {}}
                  placeholder="Filtrar por áreas do conhecimento..."
                  maxTags={10}
                />
              </div>
              <div className="flex-1 min-w-0">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Assunto
                </label>
                <TagAutocomplete
                  options={assuntosOptions.map(toDisplayAssunto)}
                  selectedTags={filters.assuntos.map(toDisplayAssunto)}
                  onChange={(tags) => setFilters({ ...filters, assuntos: tags.map(fromDisplay) })}
                  onSaveNewTag={() => {}}
                  placeholder={filters.areas_conhecimento.length === 0 ? 'Selecione uma área do conhecimento primeiro' : 'Filtrar por assuntos...'}
                  maxTags={10}
                />
              </div>
            </div>

            {/* Filtro Especialidade */}
            <div className="mb-4 max-w-sm">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Especialidade
              </label>
              <TagAutocomplete
                options={availableTags}
                selectedTags={filters.tags}
                onChange={(tags) => setFilters({ ...filters, tags })}
                onSaveNewTag={(newTag) => {
                  if (!availableTags.includes(newTag)) {
                    setAvailableTags([...availableTags, newTag]);
                  }
                }}
                placeholder="Filtrar por especialidade..."
                maxTags={10}
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setFilters({
                    exam_year: '',
                    exam_board: '',
                    exam_institution: '',
                    tags: [],
                    areas_conhecimento: [],
                    assuntos: [],
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

      {message && (
        <div
          className={`p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="text-gray-600 mt-2">Carregando questões...</p>
        </div>
      ) : totalQuestions === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-lg">Nenhuma questão cadastrada.</p>
          <p className="text-gray-400 text-sm mt-2">
            {isAdmin 
              ? 'Clique em "Nova Questão" para criar a primeira.' 
              : 'Aguarde enquanto questões são adicionadas ao banco.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {questions.map((question) => (
            <div
              key={question.id}
              onClick={() => router.push(`/dashboard/questions/${question.id}`)}
              className={`bg-white rounded-lg shadow-sm border p-6 hover:shadow-md transition-shadow cursor-pointer ${
                question.anulada ? 'border-red-200 bg-red-50/30' : 'border-gray-200'
              }`}
            >
              {question.anulada && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  QUESTÃO ANULADA — Indisponível para simulados
                </div>
              )}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-lg text-gray-800">
                      Questão #{question.id}
                    </h3>
                    {question.anulada && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold border border-red-200">
                        <Ban className="w-3 h-3" />
                        ANULADA
                      </span>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(question);
                        }}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                        aria-label="Editar"
                      >
                        <Edit className="w-5 h-5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(question.id);
                        }}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                        aria-label="Excluir"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                </div>
                {/* Tags: Área do Conhecimento, Assunto e Especialidade - visíveis no topo do card */}
                {((question.tags ?? []).length > 0 || (question.areas_conhecimento ?? []).length > 0 || (question.assuntos ?? []).length > 0) && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {(question.areas_conhecimento ?? []).map((area) => (
                      <span
                        key={`area-${area}`}
                        className="inline-block px-2 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-[15px]"
                      >
                        {toDisplayArea(area)}
                      </span>
                    ))}
                    {(question.assuntos ?? []).map((assunto) => (
                      <span
                        key={`assunto-${assunto}`}
                        className="inline-block px-2 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-[15px]"
                      >
                        {toDisplayAssunto(assunto)}
                      </span>
                    ))}
                    {(question.tags ?? []).map((tag) => (
                      <span
                        key={`tag-${tag}`}
                        className="inline-block px-2 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-[15px]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              
              <p className="text-gray-700 mb-4">{question.statement}</p>
              
              <div className="space-y-2 mb-4">
                <div className={`p-3 rounded-lg ${
                  (isAdmin || revealedAnswers.has(question.id)) && question.correct_answer === 'A' 
                    ? 'bg-green-50 border-2 border-green-500' 
                    : 'bg-gray-50 border border-gray-200'
                }`}>
                  <span className="font-semibold text-gray-700 text-sm">A)</span> <span className="text-sm">{question.option_a}</span>
                </div>
                <div className={`p-3 rounded-lg ${
                  (isAdmin || revealedAnswers.has(question.id)) && question.correct_answer === 'B' 
                    ? 'bg-green-50 border-2 border-green-500' 
                    : 'bg-gray-50 border border-gray-200'
                }`}>
                  <span className="font-semibold text-gray-700 text-sm">B)</span> <span className="text-sm">{question.option_b}</span>
                </div>
                <div className={`p-3 rounded-lg ${
                  (isAdmin || revealedAnswers.has(question.id)) && question.correct_answer === 'C' 
                    ? 'bg-green-50 border-2 border-green-500' 
                    : 'bg-gray-50 border border-gray-200'
                }`}>
                  <span className="font-semibold text-gray-700 text-sm">C)</span> <span className="text-sm">{question.option_c}</span>
                </div>
                <div className={`p-3 rounded-lg ${
                  (isAdmin || revealedAnswers.has(question.id)) && question.correct_answer === 'D' 
                    ? 'bg-green-50 border-2 border-green-500' 
                    : 'bg-gray-50 border border-gray-200'
                }`}>
                  <span className="font-semibold text-gray-700 text-sm">D)</span> <span className="text-sm">{question.option_d}</span>
                </div>
                {question.option_e && (
                  <div className={`p-3 rounded-lg ${
                    (isAdmin || revealedAnswers.has(question.id)) && question.correct_answer === 'E' 
                      ? 'bg-green-50 border-2 border-green-500' 
                      : 'bg-gray-50 border border-gray-200'
                  }`}>
                    <span className="font-semibold text-gray-700 text-sm">E)</span> <span className="text-sm">{question.option_e}</span>
                  </div>
                )}
              </div>

              {!isAdmin && (
                <div className="mb-4">
                  <button
                    onClick={() => toggleRevealAnswer(question.id)}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
                  >
                    {revealedAnswers.has(question.id) ? 'Ocultar Resposta' : 'Revelar Resposta Correta'}
                  </button>
                </div>
              )}

              {(isAdmin || revealedAnswers.has(question.id)) && question.explanation && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm font-semibold text-blue-800 mb-1">Explicação:</p>
                  <p className="text-sm text-blue-700">{question.explanation}</p>
                </div>
              )}

              <p className="text-xs text-gray-400 mt-4">
                Criada em {formatDate(question.created_at)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Paginação */}
      {!loading && totalQuestions > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-2 flex-wrap mt-6">
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Anterior
          </button>
          <span className="px-4 py-2 text-sm text-gray-600">
            Página {currentPage} de {Math.ceil(totalQuestions / PAGE_SIZE)}
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(Math.ceil(totalQuestions / PAGE_SIZE), p + 1))}
            disabled={currentPage >= Math.ceil(totalQuestions / PAGE_SIZE)}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Próxima
          </button>
        </div>
      )}

      {/* Modal de Criação/Edição */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-800">
                {editingQuestion ? 'Editar Questão' : 'Nova Questão'}
              </h2>
              <button
                onClick={closeModal}
                className="p-2 rounded-full hover:bg-gray-100 transition"
                aria-label="Fechar"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {/* Campo de Imagens */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Imagens
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-primary-400 transition-colors">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageUpload}
                    className="hidden"
                    id="question-image-upload"
                  />
                  <label
                    htmlFor="question-image-upload"
                    className="flex flex-col items-center justify-center cursor-pointer py-4"
                  >
                    <ImageIcon className="w-10 h-10 text-gray-400 mb-2" />
                    <span className="text-sm text-gray-600 font-medium">
                      Clique para adicionar imagens
                    </span>
                    <span className="text-xs text-gray-500 mt-1">
                      PNG, JPG, GIF até 10MB
                    </span>
                  </label>
                </div>
                
                {/* Preview das imagens */}
                {formData.images.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {formData.images.map((image, index) => (
                      <div key={index} className="relative group">
                        <ImageLightbox
                          src={image}
                          alt={`Preview ${index + 1}`}
                          className="w-full h-32"
                        />
                        <button
                          type="button"
                          onClick={() => removeImage(index)}
                          className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Remover imagem"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="statement" className="block text-sm font-medium text-gray-700 mb-2">
                  Enunciado *
                </label>
                <textarea
                  id="statement"
                  value={formData.statement}
                  onChange={(e) => setFormData({ ...formData, statement: e.target.value })}
                  placeholder="Digite o enunciado da questão"
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-y"
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="option_a" className="block text-sm font-medium text-gray-700 mb-2">
                    Alternativa A *
                  </label>
                  <input
                    type="text"
                    id="option_a"
                    value={formData.option_a}
                    onChange={(e) => setFormData({ ...formData, option_a: e.target.value })}
                    placeholder="Alternativa A"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="option_b" className="block text-sm font-medium text-gray-700 mb-2">
                    Alternativa B *
                  </label>
                  <input
                    type="text"
                    id="option_b"
                    value={formData.option_b}
                    onChange={(e) => setFormData({ ...formData, option_b: e.target.value })}
                    placeholder="Alternativa B"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="option_c" className="block text-sm font-medium text-gray-700 mb-2">
                    Alternativa C (opcional)
                  </label>
                  <input
                    type="text"
                    id="option_c"
                    value={formData.option_c}
                    onChange={(e) => setFormData({ ...formData, option_c: e.target.value })}
                    placeholder="Alternativa C"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label htmlFor="option_d" className="block text-sm font-medium text-gray-700 mb-2">
                    Alternativa D (opcional)
                  </label>
                  <input
                    type="text"
                    id="option_d"
                    value={formData.option_d}
                    onChange={(e) => setFormData({ ...formData, option_d: e.target.value })}
                    placeholder="Alternativa D"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label htmlFor="option_e" className="block text-sm font-medium text-gray-700 mb-2">
                    Alternativa E (opcional)
                  </label>
                  <input
                    type="text"
                    id="option_e"
                    value={formData.option_e}
                    onChange={(e) => setFormData({ ...formData, option_e: e.target.value })}
                    placeholder="Alternativa E"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label htmlFor="correct_answer" className="block text-sm font-medium text-gray-700 mb-2">
                    Resposta Correta *
                  </label>
                  <select
                    id="correct_answer"
                    value={formData.correct_answer}
                    onChange={(e) => {
                      const value = e.target.value as 'A' | 'B' | 'C' | 'D' | 'E';
                      setFormData({ ...formData, correct_answer: value });
                    }}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    required
                  >
                    <option value="A">A</option>
                    <option value="B">B</option>
                    {formData.option_c && <option value="C">C</option>}
                    {formData.option_d && <option value="D">D</option>}
                    {formData.option_e && <option value="E">E</option>}
                  </select>
                  {formData.correct_answer && (() => {
                    const availableOptions = ['A', 'B'];
                    if (formData.option_c) availableOptions.push('C');
                    if (formData.option_d) availableOptions.push('D');
                    if (formData.option_e) availableOptions.push('E');
                    if (!availableOptions.includes(formData.correct_answer)) {
                      return (
                        <p className="mt-1 text-sm text-red-600">
                          A resposta selecionada não corresponde a uma alternativa preenchida. Selecione A ou B.
                        </p>
                      );
                    }
                    return null;
                  })()}
                </div>
              </div>

              <div>
                <label htmlFor="explanation" className="block text-sm font-medium text-gray-700 mb-2">
                  Explicação (opcional)
                </label>
                <textarea
                  id="explanation"
                  value={formData.explanation}
                  onChange={(e) => setFormData({ ...formData, explanation: e.target.value })}
                  placeholder="Explique por que esta é a resposta correta"
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-y"
                />
              </div>

              {/* Área do Conhecimento e Assunto */}
              <div className="flex flex-wrap gap-4">
                <div className="flex-1 min-w-0">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Área do Conhecimento
                  </label>
                  <TagAutocomplete
                    options={AREAS_OPTIONS_DISPLAY}
                    selectedTags={formData.areas_conhecimento.map(toDisplayArea)}
                    onChange={(tags) => setFormData({ ...formData, areas_conhecimento: tags.map(fromDisplay) })}
                    onSaveNewTag={() => {}}
                    placeholder="Selecione áreas do conhecimento..."
                    maxTags={10}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Assunto
                  </label>
                  <TagAutocomplete
                    options={formAssuntosOptions.map(toDisplayAssunto)}
                    selectedTags={formData.assuntos.map(toDisplayAssunto)}
                    onChange={(tags) => setFormData({ ...formData, assuntos: tags.map(fromDisplay) })}
                    onSaveNewTag={() => {}}
                    placeholder={formData.areas_conhecimento.length === 0 ? 'Selecione uma área do conhecimento primeiro' : 'Selecione assuntos...'}
                    maxTags={10}
                  />
                </div>
              </div>

              <div>
                <TagAutocomplete
                  options={availableTags}
                  selectedTags={formData.tags}
                  onChange={(tags) => setFormData({ ...formData, tags })}
                  onSaveNewTag={(newTag) => {
                    // Adicionar nova tag às opções disponíveis
                    if (!availableTags.includes(newTag)) {
                      setAvailableTags([...availableTags, newTag]);
                    }
                  }}
                  label="Tags ou Especialidade"
                  placeholder="Digite para buscar tags..."
                />
              </div>

              <div>
                <DeCSAutocomplete
                  selectedTerms={formData.decs_terms}
                  onChange={(terms) => setFormData({ ...formData, decs_terms: terms })}
                  onTagAdd={(term) => {
                    if (!formData.tags.includes(term)) {
                      setFormData((prev) => ({ ...prev, tags: [...prev.tags, term] }));
                    }
                  }}
                  label="Termos DeCS/MeSH (vocabulário controlado BVS)"
                  placeholder="Ex: Hipertensão, Diabetes Mellitus..."
                />
              </div>

              {/* Informações da Prova */}
              <div className="border-t border-gray-200 pt-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Informações da Prova</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="exam_year" className="block text-sm font-medium text-gray-700 mb-2">
                      Ano da Prova
                    </label>
                    <input
                      type="number"
                      id="exam_year"
                      value={formData.exam_year || ''}
                      onChange={(e) => {
                        const value = e.target.value ? parseInt(e.target.value) : null;
                        setFormData({ ...formData, exam_year: value });
                      }}
                      placeholder="Ex: 2024"
                      min="1900"
                      max="2100"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label htmlFor="exam_board" className="block text-sm font-medium text-gray-700 mb-2">
                      Banca da Prova
                    </label>
                    <input
                      type="text"
                      id="exam_board"
                      value={formData.exam_board}
                      onChange={(e) => setFormData({ ...formData, exam_board: e.target.value })}
                      placeholder="Ex: FGV, VUNESP, CESPE"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label htmlFor="exam_institution" className="block text-sm font-medium text-gray-700 mb-2">
                      Instituição associada à Prova
                    </label>
                    <input
                      type="text"
                      id="exam_institution"
                      value={formData.exam_institution}
                      onChange={(e) => setFormData({ ...formData, exam_institution: e.target.value })}
                      placeholder="Ex: USP, UNIFESP"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label htmlFor="exam_region" className="block text-sm font-medium text-gray-700 mb-2">
                      Região
                    </label>
                    <input
                      type="text"
                      id="exam_region"
                      value={formData.exam_region}
                      onChange={(e) => setFormData({ ...formData, exam_region: e.target.value })}
                      placeholder="Ex: Sudeste, Nordeste, Sul"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>

              {message && (
                <div
                  className={`p-4 rounded-lg ${
                    message.type === 'success'
                      ? 'bg-green-50 border border-green-200 text-green-700'
                      : 'bg-red-50 border border-red-200 text-red-700'
                  }`}
                >
                  {message.text}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {formLoading ? 'Salvando...' : editingQuestion ? 'Atualizar Questão' : 'Criar Questão'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
