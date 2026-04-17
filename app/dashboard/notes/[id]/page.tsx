'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Edit, HelpCircle, BookOpen, Sparkles, Image as ImageIcon, X, Star, Brain, ExternalLink, Loader2 } from 'lucide-react';
import TagAutocomplete from '@/components/Common/TagAutocomplete';
import ImageLightbox from '@/components/Common/ImageLightbox';
import {
  ASSUNTOS_BY_AREA,
  toDisplayArea,
  toDisplayAssunto,
  fromDisplay,
  AREAS_OPTIONS_DISPLAY,
} from '@/lib/areas-assuntos';

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

  type SimilarNote = { id: number; title: string; description: string; tags: string[]; areas_conhecimento: string[]; similarity: number };
  type SimilarQuestion = { id: number; statement: string; tags: string[]; areas_conhecimento: string[]; exam_year: number | null; exam_board: string | null; exam_institution: string | null; similarity: number };
  const [similarNotes, setSimilarNotes] = useState<SimilarNote[]>([]);
  const [similarQuestions2, setSimilarQuestions2] = useState<SimilarQuestion[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarTab, setSimilarTab] = useState<'notes' | 'questions'>('notes');

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
    if (!noteId || !note) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    setSimilarLoading(true);
    fetch(`/api/notes/${noteId}/similar?limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.ok ? r.json() : { notes: [], questions: [] })
      .then((data) => {
        setSimilarNotes(data.notes ?? []);
        setSimilarQuestions2(data.questions ?? []);
      })
      .catch(() => {})
      .finally(() => setSimilarLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, note?.id]);

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
                              <span key={area} className="inline-block px-3 py-1 text-sm font-medium bg-primary-100 text-primary-700 rounded-full">{toDisplayArea(area)}</span>
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
                              <span key={assunto} className="inline-block px-3 py-1 text-sm font-medium bg-primary-100 text-primary-700 rounded-full">{toDisplayAssunto(assunto)}</span>
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

      {/* Conteúdo Relacionado (similaridade semântica) */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-gray-200">
          <Brain className="h-4 w-4 text-violet-500" />
          <h3 className="text-lg font-semibold text-gray-800">Conteúdo relacionado</h3>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">busca semântica</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-3 border-b border-gray-100 bg-gray-50">
          <button
            onClick={() => setSimilarTab('notes')}
            className={`px-4 py-2 text-sm font-medium rounded-t-md transition ${
              similarTab === 'notes'
                ? 'bg-white text-violet-600 border border-b-white border-gray-200 -mb-px'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Notas parecidas
            {similarNotes.length > 0 && (
              <span className="ml-1.5 text-xs bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full">{similarNotes.length}</span>
            )}
          </button>
          <button
            onClick={() => setSimilarTab('questions')}
            className={`px-4 py-2 text-sm font-medium rounded-t-md transition ${
              similarTab === 'questions'
                ? 'bg-white text-violet-600 border border-b-white border-gray-200 -mb-px'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Questões do mesmo tema
            {similarQuestions2.length > 0 && (
              <span className="ml-1.5 text-xs bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full">{similarQuestions2.length}</span>
            )}
          </button>
        </div>

        <div className="p-6">
          {similarLoading ? (
            <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Buscando conteúdo similar…</span>
            </div>
          ) : similarTab === 'notes' ? (
            similarNotes.length === 0 ? (
              <div className="text-center py-6">
                <Brain className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-400 text-sm">Nenhuma nota similar encontrada. O embedding desta nota precisa ser gerado primeiro.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {similarNotes.map((sn) => (
                  <div
                    key={sn.id}
                    className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:border-violet-200 hover:bg-violet-50/30 transition group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{sn.title}</p>
                      <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{sn.description}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {sn.areas_conhecimento?.slice(0, 2).map((a) => (
                          <span key={a} className="text-xs px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded-full">{a}</span>
                        ))}
                        <span className="ml-auto text-xs font-medium text-violet-600">{Math.round(sn.similarity * 100)}% similar</span>
                      </div>
                    </div>
                    <button
                      onClick={() => router.push(`/dashboard/notes/${sn.id}`)}
                      className="flex-shrink-0 p-1.5 text-gray-400 hover:text-violet-600 transition opacity-0 group-hover:opacity-100"
                      title="Ver nota"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )
          ) : (
            similarQuestions2.length === 0 ? (
              <div className="text-center py-6">
                <Brain className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-400 text-sm">Nenhuma questão similar encontrada. O embedding desta nota precisa ser gerado primeiro.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {similarQuestions2.map((sq) => (
                  <div
                    key={sq.id}
                    className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:border-violet-200 hover:bg-violet-50/30 transition group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 line-clamp-2">{sq.statement}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-1.5">
                        {sq.exam_year && <span className="text-xs text-gray-500">{sq.exam_year}</span>}
                        {sq.exam_board && <span className="text-xs text-gray-500">· {sq.exam_board}</span>}
                        {sq.exam_institution && <span className="text-xs text-gray-500">· {sq.exam_institution}</span>}
                        {sq.areas_conhecimento?.slice(0, 2).map((a) => (
                          <span key={a} className="text-xs px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded-full">{a}</span>
                        ))}
                        <span className="ml-auto text-xs font-medium text-violet-600">{Math.round(sq.similarity * 100)}% similar</span>
                      </div>
                    </div>
                    <button
                      onClick={() => router.push(`/dashboard/questions/${sq.id}`)}
                      className="flex-shrink-0 p-1.5 text-gray-400 hover:text-violet-600 transition opacity-0 group-hover:opacity-100"
                      title="Ver questão"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

    </div>
  );
}
