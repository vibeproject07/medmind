'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Edit, HelpCircle, BookOpen, Sparkles, Image as ImageIcon, X, Check, ChevronLeft, ChevronRight, Eye, Star } from 'lucide-react';
import TagAutocomplete from '@/components/Common/TagAutocomplete';
import ImageLightbox from '@/components/Common/ImageLightbox';
import {
  ASSUNTOS_BY_AREA,
  toDisplayArea,
  toDisplayAssunto,
  fromDisplay,
  AREAS_OPTIONS_DISPLAY,
} from '@/lib/areas-assuntos';

/** Limite máximo de questões no modal que precede a etapa de simulados */
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

interface Note {
  id: number;
  title: string;
  description: string;
  tipo_conteudo?: string;
  tags?: string[];
  areas_conhecimento?: string[];
  assuntos?: string[];
  images?: string[];
  fontes_resumo_melhorado?: string | null;
  fontes_resumo_original?: string | null;
  fontes_arquivos?: string[];
  created_at: string;
  updated_at: string;
  user_id?: number;
  user_name?: string;
  user_email?: string;
  user_role?: string;
  company_id?: number | null;
  company_name?: string | null;
}

interface Question {
  id: number;
  statement: string;
  option_a: string;
  option_b: string;
  option_c?: string | null;
  option_d?: string | null;
  option_e?: string | null;
  correct_answer: 'A' | 'B' | 'C' | 'D' | 'E';
  explanation?: string | null;
  tags?: string[];
  images?: string[];
}

type TabType = 'fontes' | 'conteudo' | 'estudio';
type NotaSubTabId = 'imagens' | 'descricao' | 'classificacao';

export default function NoteDetailPage() {
  const router = useRouter();
  const params = useParams();
  const noteId = params?.id as string | undefined;
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('conteudo');
  const [fontesResumoSubTab, setFontesResumoSubTab] = useState<'melhorado' | 'original'>('melhorado');
  const [fontesSelectedForNote, setFontesSelectedForNote] = useState<'melhorado' | 'original' | null>(null);
  const [activeNotaSubTab, setActiveNotaSubTab] = useState<NotaSubTabId | null>('descricao');
  const [relatedQuestions, setRelatedQuestions] = useState<Question[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTipoConteudo, setEditTipoConteudo] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editAreasConhecimento, setEditAreasConhecimento] = useState<string[]>([]);
  const [editAssuntos, setEditAssuntos] = useState<string[]>([]);
  const [editImages, setEditImages] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>(AVAILABLE_TAGS);
  const editAssuntosOptions = useMemo(() => {
    if (editAreasConhecimento.length === 0) return [];
    const set = new Set<string>();
    editAreasConhecimento.forEach((area) => {
      const assuntos = ASSUNTOS_BY_AREA[area];
      if (assuntos) assuntos.forEach((a) => set.add(a));
    });
    return Array.from(set);
  }, [editAreasConhecimento]);
  /** Opções de assuntos na visualização (quando não está editando), derivadas das áreas da nota */
  const viewAssuntosOptions = useMemo(() => {
    if (!note?.areas_conhecimento?.length) return [];
    const set = new Set<string>();
    note.areas_conhecimento.forEach((area: string) => {
      const assuntos = ASSUNTOS_BY_AREA[area];
      if (assuntos) assuntos.forEach((a) => set.add(a));
    });
    return Array.from(set);
  }, [note?.areas_conhecimento]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [questionsCount, setQuestionsCount] = useState<number>(0);
  const [showSimulateModal, setShowSimulateModal] = useState(false);
  const [showSimulateCountModal, setShowSimulateCountModal] = useState(false);
  const [simulateQuestionCount, setSimulateQuestionCount] = useState<number>(10);
  const [simulateQuestions, setSimulateQuestions] = useState<Question[]>([]);
  const [currentSimulateIndex, setCurrentSimulateIndex] = useState(0);
  const [selectedSimulateAnswers, setSelectedSimulateAnswers] = useState<Record<number, string>>({});
  const [showSimulateResults, setShowSimulateResults] = useState(false);
  const [loadingSimulate, setLoadingSimulate] = useState(false);
  const [confirmedTaxed, setConfirmedTaxed] = useState<Map<number, Set<string>>>(new Map());
  const [simulateRevealedAnswers, setSimulateRevealedAnswers] = useState<Set<number>>(new Set());

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const role = payload.role || 'regular';
        const userId = payload.id;
        setIsAdmin(role === 'admin');
      } catch (error) {
        console.error('Erro ao decodificar token:', error);
      }
    }
  }, []);

  useEffect(() => {
    if (noteId) {
      fetchNote();
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  useEffect(() => {
    // Buscar questões associadas assim que a nota for carregada para mostrar o contador
    if (noteId && note) {
      fetchRelatedQuestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, note]);

  useEffect(() => {
    // Buscar quantidade de questões disponíveis baseado nas tags da nota
    if (note?.tags && note.tags.length > 0) {
      fetchQuestionsCount(note.tags);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.tags]);

  useEffect(() => {
    // Buscar quantidade de questões quando as tags da nota mudarem
    if (note?.tags && note.tags.length > 0) {
      fetchQuestionsCount(note.tags);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.tags]);

  useEffect(() => {
    // Verificar se é o dono da nota após carregar
    if (note) {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          const userId = payload.id;
          if (note.user_id === userId) {
            setIsOwner(true);
          }
        } catch (error) {
          console.error('Erro ao decodificar token:', error);
        }
      }
      // Inicializar campos de edição
      setEditTitle(note.title);
      setEditDescription(note.description);
      setEditTipoConteudo((note as Note).tipo_conteudo || '');
      setEditTags(note.tags || []);
      setEditAreasConhecimento(note.areas_conhecimento || []);
      setEditAssuntos(note.assuntos || []);
      setEditImages(note.images || []);
    }
  }, [note]);

  // Quando a área do conhecimento mudar na edição, manter apenas assuntos que ainda estão nas opções
  useEffect(() => {
    if (editAreasConhecimento.length === 0) {
      setEditAssuntos([]);
      return;
    }
    const opcoes = new Set<string>();
    editAreasConhecimento.forEach((area) => {
      const assuntos = ASSUNTOS_BY_AREA[area];
      if (assuntos) assuntos.forEach((a) => opcoes.add(a));
    });
    setEditAssuntos((prev) => prev.filter((a) => opcoes.has(a)));
  }, [editAreasConhecimento]);

  const fetchNote = async () => {
    if (!noteId) {
      setError('ID da nota não fornecido');
      setLoading(false);
      return;
    }

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login');
        return;
      }

      // Limpar token
      const cleanToken = token.trim().replace(/^["']|["']$/g, '');

      const response = await fetch(`/api/notes/${noteId}`, {
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
        },
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setNote(data);
        setError(null);
      } else if (response.status === 404) {
        setError('Nota não encontrada');
        setNote(null);
      } else if (response.status === 401 || response.status === 403) {
        setError('Não autorizado');
        router.push('/login');
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        setError(errorData.error || 'Erro ao carregar nota');
        setNote(null);
      }
    } catch (error) {
      console.error('Erro ao buscar nota:', error);
      setError('Erro ao carregar nota. Tente novamente.');
      setNote(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchRelatedQuestions = async () => {
    if (!noteId) return;

    setLoadingQuestions(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      // Buscar questões associadas à nota
      const response = await fetch(`/api/notes/${noteId}/questions`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const questions: Question[] = await response.json();
        setRelatedQuestions(questions);
      }
    } catch (error) {
      console.error('Erro ao buscar questões relacionadas:', error);
    } finally {
      setLoadingQuestions(false);
    }
  };

  const fetchQuestionsCount = async (tags: string[]) => {
    if (!tags || tags.length === 0) {
      setQuestionsCount(0);
      return;
    }

    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const tagsParam = JSON.stringify(tags);
      const response = await fetch(`/api/questions/by-tags?tags=${encodeURIComponent(tagsParam)}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const questions = await response.json();
        setQuestionsCount(questions.length);
      }
    } catch (error) {
      console.error('Erro ao buscar quantidade de questões:', error);
    }
  };

  const handleAssociateQuestions = async (selectedQuestionIds: number[]) => {
    if (!noteId || selectedQuestionIds.length === 0) return;

    try {
      const token = localStorage.getItem('token');
      if (!token) return;

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
        // Recarregar questões associadas
        fetchRelatedQuestions();
        alert('Questões associadas com sucesso!');
      } else {
        alert('Erro ao associar questões');
      }
    } catch (error) {
      console.error('Erro ao associar questões:', error);
      alert('Erro ao associar questões');
    }
  };

  const handleSimulate = async () => {
    if (relatedQuestions.length === 0) return;
    
    setShowSimulateCountModal(false);
    setLoadingSimulate(true);
    setShowSimulateModal(true);
    setCurrentSimulateIndex(0);
    setSelectedSimulateAnswers({});
    setShowSimulateResults(false);
    setConfirmedTaxed(new Map());
    setSimulateRevealedAnswers(new Set());

    try {
      // Usar apenas as questões associadas à nota
      // Embaralhar e pegar apenas a quantidade solicitada
      const shuffled = [...relatedQuestions].sort(() => Math.random() - 0.5);
      const count = Math.min(simulateQuestionCount, MAX_SIMULATE_QUESTIONS, shuffled.length);
      const selected = shuffled.slice(0, count);
      setSimulateQuestions(selected);
    } catch (error) {
      console.error('Erro ao preparar questões:', error);
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
      tags: note?.tags || [],
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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) {
        alert('Apenas arquivos de imagem são permitidos');
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setEditImages((prev) => [...prev, base64]);
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeImage = (index: number) => {
    setEditImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleEdit = () => {
    setIsEditing(true);
    setEditTitle(note?.title || '');
    setEditDescription(note?.description || '');
    setEditTipoConteudo((note as Note)?.tipo_conteudo || '');
    setEditTags(note?.tags || []);
    setEditAreasConhecimento(note?.areas_conhecimento || []);
    setEditAssuntos(note?.assuntos || []);
    setEditImages(note?.images || []);
    const n = note as Note;
    if (n?.fontes_resumo_melhorado != null || n?.fontes_resumo_original != null) {
      const desc = (n?.description ?? '').trim();
      if (desc === (n?.fontes_resumo_melhorado ?? '').trim()) setFontesSelectedForNote('melhorado');
      else if (desc === (n?.fontes_resumo_original ?? '').trim()) setFontesSelectedForNote('original');
      else setFontesSelectedForNote(null);
    } else {
      setFontesSelectedForNote(null);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setFontesSelectedForNote(null);
    setEditTitle(note?.title || '');
    setEditDescription(note?.description || '');
    setEditTipoConteudo((note as Note)?.tipo_conteudo || '');
    setEditTags(note?.tags || []);
    setEditAreasConhecimento(note?.areas_conhecimento || []);
    setEditAssuntos(note?.assuntos || []);
    setEditImages(note?.images || []);
  };

  const handleSaveEdit = async () => {
    if (!editTitle.trim()) {
      alert('O título não pode estar vazio.');
      return;
    }
    if (!note) return;

    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const response = await fetch(`/api/notes/${noteId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDescription.trim(),
          tipo_conteudo: editTipoConteudo.trim() || undefined,
          tags: editTags,
          areas_conhecimento: editAreasConhecimento,
          assuntos: editAssuntos,
          images: editImages,
          fontes_resumo_melhorado: note?.fontes_resumo_melhorado ?? undefined,
          fontes_resumo_original: note?.fontes_resumo_original ?? undefined,
          fontes_arquivos: note?.fontes_arquivos ?? [],
        }),
      });

      if (response.ok) {
        const updatedNote = await response.json();
        setNote(updatedNote);
        setIsEditing(false);
      } else {
        alert('Erro ao salvar as alterações');
      }
    } catch (error) {
      console.error('Erro ao salvar nota:', error);
      alert('Erro ao salvar as alterações');
    }
  };

  /** Salva apenas áreas do conhecimento e assuntos (quando editados na visualização, sem modo Editar) */
  const saveNoteAreasAssuntos = async (newAreas: string[], newAssuntos: string[]) => {
    if (!noteId || !note) return;
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const response = await fetch(`/api/notes/${noteId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: note.title,
          description: note.description,
          tags: note.tags ?? [],
          areas_conhecimento: newAreas,
          assuntos: newAssuntos,
          images: note.images ?? [],
          fontes_resumo_melhorado: note.fontes_resumo_melhorado ?? undefined,
          fontes_resumo_original: note.fontes_resumo_original ?? undefined,
          fontes_arquivos: note.fontes_arquivos ?? [],
        }),
      });
      if (response.ok) {
        const updatedNote = await response.json();
        setNote(updatedNote);
      }
    } catch (err) {
      console.error('Erro ao salvar áreas/assuntos:', err);
    }
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

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="text-gray-600 mt-2">Carregando nota...</p>
        </div>
      </div>
    );
  }

  if (error || !note) {
    return (
      <div className="space-y-6 p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-lg mb-2">
            {error || 'Nota não encontrada.'}
          </p>
          {noteId && (
            <p className="text-gray-400 text-sm mb-4">ID: {noteId}</p>
          )}
          <button
            onClick={() => router.push('/dashboard/notes')}
            className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          >
            Voltar para Notas
          </button>
        </div>
      </div>
    );
  }

  const canEdit = isAdmin || isOwner;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-lg hover:bg-gray-100 transition"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-3xl font-bold text-gray-800">Detalhes da Nota</h1>
        </div>
        {canEdit && !isEditing && (
          <button
            onClick={handleEdit}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
          >
            <Edit className="w-4 h-4" />
            Editar
          </button>
        )}
      </div>

      {/* Abas principais: Fontes | Nota | Estúdio (igual à página de criação) */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="border-b border-gray-200 bg-gray-100">
          <nav className="flex gap-1" aria-label="Abas">
            <button
              type="button"
              onClick={() => setActiveTab('fontes')}
              className={`px-4 py-3 text-sm font-medium rounded-t-lg transition ${
                activeTab === 'fontes'
                  ? 'bg-white border border-gray-200 border-b-0 -mb-px text-primary-600'
                  : 'bg-gray-100 text-gray-600 hover:text-gray-800 hover:bg-gray-200'
              }`}
            >
              <BookOpen className="w-4 h-4 inline-block mr-2 align-middle" />
              Fontes
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('conteudo')}
              className={`px-4 py-3 text-sm font-medium rounded-t-lg transition ${
                activeTab === 'conteudo'
                  ? 'bg-white border border-gray-200 border-b-0 -mb-px text-primary-600'
                  : 'bg-gray-100 text-gray-600 hover:text-gray-800 hover:bg-gray-200'
              }`}
            >
              Nota
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('estudio')}
              className={`px-4 py-3 text-sm font-medium rounded-t-lg transition ${
                activeTab === 'estudio'
                  ? 'bg-white border border-gray-200 border-b-0 -mb-px text-primary-600'
                  : 'bg-gray-100 text-gray-600 hover:text-gray-800 hover:bg-gray-200'
              }`}
            >
              <Sparkles className="w-4 h-4 inline-block mr-2 align-middle" />
              Estúdio
            </button>
          </nav>
        </div>

        {/* Aba Fontes */}
        {activeTab === 'fontes' && (
          <div className="p-6 bg-white space-y-6">
            {(note.fontes_arquivos?.length ?? 0) > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Arquivos carregados</h3>
                <ul className="list-disc list-inside text-sm text-gray-800 space-y-1 bg-gray-50 rounded-lg p-4 border border-gray-200">
                  {(note.fontes_arquivos ?? []).map((name, idx) => (
                    <li key={idx} className="truncate" title={name}>
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(note.fontes_resumo_melhorado || note.fontes_resumo_original) ? (
              <div className="rounded-lg border-2 border-gray-200 overflow-hidden bg-white">
                {isEditing && (
                  <p className="text-xs text-gray-500 px-4 pt-3 pb-1">
                    Selecione a estrela para definir qual conteúdo será usado no conteúdo da nota (aba Nota).
                  </p>
                )}
                <h3 className="text-sm font-semibold text-gray-700 px-4 pt-1 pb-2">Transformação por IA</h3>
                <div className="flex gap-1 p-1.5 bg-gray-100 border-b border-gray-200">
                  <button
                    type="button"
                    onClick={() => setFontesResumoSubTab('melhorado')}
                    className={`flex-1 px-4 py-3 text-sm font-semibold rounded-md transition flex items-center justify-between gap-2 ${
                      fontesResumoSubTab === 'melhorado'
                        ? 'bg-white text-primary-600 shadow-sm ring-2 ring-primary-500/30'
                        : 'text-gray-500 bg-transparent hover:bg-gray-200 hover:text-gray-700'
                    }`}
                  >
                    <span>
                      <span className="block">Arquivo transformado pela IA</span>
                      <span className="block text-xs font-normal opacity-90 mt-0.5">Melhorado</span>
                    </span>
                    {isEditing && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFontesSelectedForNote('melhorado');
                          setEditDescription(note.fontes_resumo_melhorado || '');
                        }}
                        className="p-1.5 rounded hover:bg-primary-50 transition shrink-0"
                        aria-label="Usar este conteúdo no conteúdo da nota"
                        title="Usar este conteúdo no conteúdo da nota"
                      >
                        <Star
                          className={`w-5 h-5 ${
                            fontesSelectedForNote === 'melhorado'
                              ? 'fill-amber-400 text-amber-500'
                              : 'text-gray-400 hover:text-amber-500/70'
                          }`}
                        />
                      </button>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFontesResumoSubTab('original')}
                    className={`flex-1 px-4 py-3 text-sm font-semibold rounded-md transition flex items-center justify-between gap-2 ${
                      fontesResumoSubTab === 'original'
                        ? 'bg-white text-primary-600 shadow-sm ring-2 ring-primary-500/30'
                        : 'text-gray-500 bg-transparent hover:bg-gray-200 hover:text-gray-700'
                    }`}
                  >
                    <span>
                      <span className="block">Arquivo original</span>
                      <span className="block text-xs font-normal opacity-90 mt-0.5">Original</span>
                    </span>
                    {isEditing && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFontesSelectedForNote('original');
                          setEditDescription(note.fontes_resumo_original || '');
                        }}
                        className="p-1.5 rounded hover:bg-primary-50 transition shrink-0"
                        aria-label="Usar este conteúdo no conteúdo da nota"
                        title="Usar este conteúdo no conteúdo da nota"
                      >
                        <Star
                          className={`w-5 h-5 ${
                            fontesSelectedForNote === 'original'
                              ? 'fill-amber-400 text-amber-500'
                              : 'text-gray-400 hover:text-amber-500/70'
                          }`}
                        />
                      </button>
                    )}
                  </button>
                </div>
                <div className="p-4 min-h-[120px] bg-gray-50/50 max-h-[420px] overflow-y-auto">
                  {fontesResumoSubTab === 'melhorado' && (
                    <div className="text-sm text-gray-800 whitespace-pre-wrap">
                      {note.fontes_resumo_melhorado || '—'}
                    </div>
                  )}
                  {fontesResumoSubTab === 'original' && (
                    <div className="text-sm text-gray-800 whitespace-pre-wrap">
                      {note.fontes_resumo_original || '—'}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <p className="text-base text-gray-800">
                  O conteúdo de fontes utilizado nesta nota foi incorporado ao conteúdo da aba Nota.
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  Para adicionar ou processar novas fontes com IA, crie uma nova nota a partir do botão de criar nota.
                </p>
              </>
            )}
          </div>
        )}

        {/* Aba Nota: título e conteúdo no topo, sub-abas Imagens | Descrição | Classificação */}
        {activeTab === 'conteudo' && (
          <div className="overflow-hidden">
            <div className="max-h-[480px] overflow-y-auto p-6 space-y-6 pr-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Título</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="Título da nota"
                  />
                ) : (
                  <p className="text-lg font-semibold text-gray-800">{note.title}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Conteúdo</label>
                {isEditing ? (
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={14}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-y"
                    placeholder="Conteúdo da nota"
                  />
                ) : (
                  <div className="text-gray-700 whitespace-pre-wrap leading-relaxed min-h-0">
                    {note.description || <span className="text-gray-400 italic">Sem conteúdo</span>}
                  </div>
                )}
              </div>
            </div>
            <nav className="flex gap-2 p-2 border-t border-b-2 border-gray-200 bg-gray-100 px-6 pt-4">
              <button
                type="button"
                onClick={() => setActiveNotaSubTab((prev) => (prev === 'imagens' ? null : 'imagens'))}
                className={`flex-1 px-4 py-3 text-sm font-semibold rounded-lg transition flex items-center justify-center gap-2 ${
                  activeNotaSubTab === 'imagens'
                    ? 'bg-white text-primary-600 shadow-md ring-2 ring-primary-500/40'
                    : 'bg-gray-200/80 text-gray-500 hover:bg-gray-300 hover:text-gray-700'
                }`}
              >
                <ImageIcon className="w-5 h-5 flex-shrink-0" />
                Imagens
              </button>
              <button
                type="button"
                onClick={() => setActiveNotaSubTab((prev) => (prev === 'descricao' ? null : 'descricao'))}
                className={`flex-1 px-4 py-3 text-sm font-semibold rounded-lg transition ${
                  activeNotaSubTab === 'descricao'
                    ? 'bg-white text-primary-600 shadow-md ring-2 ring-primary-500/40'
                    : 'bg-gray-200/80 text-gray-500 hover:bg-gray-300 hover:text-gray-700'
                }`}
              >
                Descrição
              </button>
              <button
                type="button"
                onClick={() => setActiveNotaSubTab((prev) => (prev === 'classificacao' ? null : 'classificacao'))}
                className={`flex-1 px-4 py-3 text-sm font-semibold rounded-lg transition ${
                  activeNotaSubTab === 'classificacao'
                    ? 'bg-white text-primary-600 shadow-md ring-2 ring-primary-500/40'
                    : 'bg-gray-200/80 text-gray-500 hover:bg-gray-300 hover:text-gray-700'
                }`}
              >
                Classificação
              </button>
            </nav>
            {activeNotaSubTab != null && (
            <div className="p-6 bg-gray-50/30">
              {activeNotaSubTab === 'imagens' && (
                <div className="space-y-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Imagens</label>
                  {isEditing ? (
                    <>
                      <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 hover:border-primary-400 transition-colors">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleImageUpload}
                          className="hidden"
                          id="detail-image-upload"
                        />
                        <label htmlFor="detail-image-upload" className="flex flex-col items-center justify-center cursor-pointer py-4">
                          <ImageIcon className="w-10 h-10 text-gray-400 mb-2" />
                          <span className="text-sm text-gray-600 font-medium">Clique para adicionar imagens</span>
                        </label>
                      </div>
                      {editImages.length > 0 && (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                          {editImages.map((image, index) => (
                            <div key={index} className="relative group">
                              <ImageLightbox src={image} alt={`Preview ${index + 1}`} className="w-full h-32" />
                              <button type="button" onClick={() => removeImage(index)} className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Remover imagem">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {note.images && note.images.length > 0 ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                          {note.images.map((image, index) => (
                            <ImageLightbox key={index} src={image} alt={`Imagem ${index + 1}`} className="w-full h-48" />
                          ))}
                        </div>
                      ) : (
                        <p className="text-gray-400 italic text-sm">Nenhuma imagem adicionada</p>
                      )}
                    </>
                  )}
                </div>
              )}
              {activeNotaSubTab === 'descricao' && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-500">O título e o conteúdo da nota estão acima.</p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de conteúdo da nota</label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editTipoConteudo}
                        onChange={(e) => setEditTipoConteudo(e.target.value)}
                        placeholder="Ex.: resumo de aula, caso clínico, anotação de artigo..."
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      />
                    ) : (
                      <p className="text-gray-700">{(note as Note).tipo_conteudo || <span className="text-gray-400 italic">Não informado</span>}</p>
                    )}
                  </div>
                </div>
              )}
              {activeNotaSubTab === 'classificacao' && (
                <div className="space-y-6">
                  <div className="space-y-4 w-full">
                    <div className="w-full">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Área do Conhecimento</label>
                      {isEditing ? (
                        <TagAutocomplete options={AREAS_OPTIONS_DISPLAY} selectedTags={editAreasConhecimento.map(toDisplayArea)} onChange={(tags) => setEditAreasConhecimento(tags.map(fromDisplay))} onSaveNewTag={() => {}} placeholder="Selecione áreas do conhecimento..." />
                      ) : (
                        note?.areas_conhecimento && note.areas_conhecimento.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {note.areas_conhecimento.map((area) => (
                              <span key={area} className="inline-block px-3 py-1 text-sm font-medium bg-gray-100 text-gray-800 rounded-full border border-gray-200">{toDisplayArea(area)}</span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-gray-400 italic text-sm">Nenhuma área selecionada</p>
                        )
                      )}
                    </div>
                    <div className="w-full">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Assunto</label>
                      {isEditing ? (
                        <TagAutocomplete options={editAssuntosOptions.map(toDisplayAssunto)} selectedTags={editAssuntos.map(toDisplayAssunto)} onChange={(tags) => setEditAssuntos(tags.map(fromDisplay))} onSaveNewTag={() => {}} placeholder={editAreasConhecimento.length === 0 ? 'Selecione uma área do conhecimento primeiro' : 'Selecione assuntos...'} />
                      ) : (
                        note?.assuntos && note.assuntos.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {note.assuntos.map((assunto) => (
                              <span key={assunto} className="inline-block px-3 py-1 text-sm font-medium bg-gray-100 text-gray-800 rounded-full border border-gray-200">{toDisplayAssunto(assunto)}</span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-gray-400 italic text-sm">Nenhum assunto selecionado</p>
                        )
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Tags ou Especialidade</label>
                    {isEditing ? (
                      <TagAutocomplete options={availableTags} selectedTags={editTags} onChange={(tags) => setEditTags(tags)} onSaveNewTag={(newTag) => { if (!availableTags.includes(newTag)) setAvailableTags([...availableTags, newTag]); }} label="Tags ou Especialidade" placeholder="Digite para buscar tags..." />
                    ) : (
                      note.tags && note.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {note.tags.map((tag) => (
                            <span key={tag} className="inline-block px-3 py-1 text-sm font-medium bg-primary-100 text-primary-700 rounded-full">{tag}</span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-gray-400 italic text-sm">Nenhuma tag adicionada</p>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
            )}
            {isEditing && (
              <div className="flex items-center gap-3 p-6 border-t border-gray-200 bg-white">
                <button type="button" onClick={handleSaveEdit} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition">Salvar alterações</button>
                <button type="button" onClick={handleCancelEdit} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition">Cancelar</button>
              </div>
            )}
          </div>
        )}

        {/* Aba Estúdio: Questões e Artigos */}
        {activeTab === 'estudio' && (
          <div className="p-6 space-y-8">
            <div className="space-y-4">
              {/* Card de Buscar Questões */}
              {note.tags && note.tags.length > 0 && (
                <div className="w-full p-4 border border-gray-300 rounded-lg bg-white">
                  <div className="font-semibold text-gray-800 mb-3">
                    Buscar Questões
                  </div>
                  <div className="flex items-center justify-center">
                    {questionsCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          const tagsParam = encodeURIComponent(JSON.stringify(note.tags));
                          router.push(`/dashboard/notes/select-questions?tags=${tagsParam}&noteId=${noteId}`);
                        }}
                        className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition text-sm font-medium"
                      >
                        Questões encontradas ({questionsCount})
                      </button>
                    ) : (
                      <p className="text-xs text-gray-500 text-center">
                        Nenhuma questão encontrada com as tags desta nota
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Lista de questões associadas */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-800">
                    Questões Associadas ({relatedQuestions.length})
                  </h3>
                  {relatedQuestions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        localStorage.setItem(
                          'pendingSimulateQuestions',
                          JSON.stringify({
                            questions: relatedQuestions,
                            tags: note?.tags ?? [],
                          })
                        );
                        router.push('/dashboard/simulados/novo');
                      }}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium"
                    >
                      Fazer Simulado
                    </button>
                  )}
                </div>
                {loadingQuestions ? (
                  <div className="text-center py-8">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                    <p className="text-gray-600 mt-2">Carregando questões...</p>
                  </div>
                ) : relatedQuestions.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <HelpCircle className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                    <p>Nenhuma questão relacionada encontrada.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {relatedQuestions.map((question) => (
                      <div
                        key={question.id}
                        onClick={() => router.push(`/dashboard/questions/${question.id}`)}
                        className="bg-gray-50 rounded-lg p-4 border border-gray-200 hover:border-primary-300 hover:shadow-md transition cursor-pointer"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <p className="text-gray-800 font-medium mb-2">{question.statement}</p>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {question.tags?.map((tag) => (
                                <span
                                  key={tag}
                                  className="px-2 py-0.5 text-xs bg-primary-100 text-primary-700 rounded-full"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                          <span className="ml-4 text-sm text-gray-500">
                            #{question.id}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Artigos científicos */}
            <div className="space-y-4 pt-4 border-t border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800">Artigos</h3>
              <div className="text-center py-8 text-gray-500">
                <BookOpen className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                <p>Funcionalidade em desenvolvimento.</p>
              </div>
            </div>
          </div>
        )}
      </div>

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
                Quantidade de questões (máximo: {Math.min(relatedQuestions.length, MAX_SIMULATE_QUESTIONS)})
              </label>
              <input
                type="number"
                min="1"
                max={Math.min(relatedQuestions.length, MAX_SIMULATE_QUESTIONS)}
                value={simulateQuestionCount}
                onChange={(e) => setSimulateQuestionCount(Math.min(Math.max(1, parseInt(e.target.value) || 1), Math.min(relatedQuestions.length, MAX_SIMULATE_QUESTIONS)))}
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
                            {currentQuestion.images.map((image: string, idx: number) => (
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
