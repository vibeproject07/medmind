'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft, Edit, HelpCircle, BookOpen, Sparkles,
  Image as ImageIcon, X, Star, Brain, ExternalLink, Loader2,
  FileText, CheckSquare, Save,
} from 'lucide-react';
import TagAutocomplete from '@/components/Common/TagAutocomplete';
import ImageLightbox from '@/components/Common/ImageLightbox';
import {
  ASSUNTOS_BY_AREA, toDisplayArea, toDisplayAssunto,
  fromDisplay, AREAS_OPTIONS_DISPLAY,
} from '@/lib/areas-assuntos';
import { useNote } from '@/contexts/NoteContext';

const AVAILABLE_TAGS = [
  'Acupuntura','Anestesiologia','Cirurgia Cardiovascular','Cirurgia Geral',
  'Cirurgia Vascular','Clínica Médica','Dermatologia','Genética Médica',
  'Ginecologia e Obstetrícia','Homeopatia','Infectologia','Medicina de Emergência',
  'Medicina de Família e Comunidade','Medicina de Tráfego','Medicina do Trabalho',
  'Medicina Esportiva','Medicina Física e Reabilitação','Medicina Intensiva',
  'Medicina Legal e Perícia Médica','Medicina Nuclear','Medicina Preventiva e Social',
  'Neurocirurgia','Neurologia','Oftalmologia','Ortopedia e Traumatologia',
  'Otorrinolaringologia','Patologia','Patologia Clínica / Medicina Laboratorial',
  'Pediatria','Psiquiatria','Radiologia e Diagnóstico por Imagem','Radioterapia',
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
  exam_year?: number | null;
  exam_board?: string | null;
  exam_institution?: string | null;
  areas_conhecimento?: string[];
}

type ActivePanel = 'fontes' | 'estudio' | null;

export default function NoteDetailPage() {
  const router  = useRouter();
  const params  = useParams();
  const noteId  = params?.id as string | undefined;

  const [note, setNote]                   = useState<Note | null>(null);
  const [loading, setLoading]             = useState(true);
  const [isAdmin, setIsAdmin]             = useState(false);
  const [isOwner, setIsOwner]             = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const { setNoteTitle, notePanel: activePanel, setNotePanel: setActivePanel } = useNote();
  const [fontesResumoSubTab, setFontesResumoSubTab] = useState<'melhorado' | 'original'>('melhorado');
  const [fontesSelectedForNote, setFontesSelectedForNote] = useState<'melhorado' | 'original' | null>(null);
  const [relatedQuestions, setRelatedQuestions] = useState<Question[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [isEditing, setIsEditing]         = useState(false);
  const [editTitle, setEditTitle]         = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTipoConteudo, setEditTipoConteudo] = useState('');
  const [editTags, setEditTags]           = useState<string[]>([]);
  const [editAreasConhecimento, setEditAreasConhecimento] = useState<string[]>([]);
  const [editAssuntos, setEditAssuntos]   = useState<string[]>([]);
  const [editImages, setEditImages]       = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>(AVAILABLE_TAGS);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [questionsCount, setQuestionsCount] = useState<number>(0);

  type SimilarNote     = { id: number; title: string; description: string; tags: string[]; areas_conhecimento: string[]; similarity: number };
  type SimilarQuestion = { id: number; statement: string; tags: string[]; areas_conhecimento: string[]; exam_year: number | null; exam_board: string | null; exam_institution: string | null; similarity: number };
  const [similarNotes,     setSimilarNotes]     = useState<SimilarNote[]>([]);
  const [similarQuestions, setSimilarQuestions] = useState<SimilarQuestion[]>([]);
  const [similarLoading,   setSimilarLoading]   = useState(false);
  const [similarTab,       setSimilarTab]       = useState<'notes' | 'questions'>('notes');

  const editAssuntosOptions = useMemo(() => {
    if (editAreasConhecimento.length === 0) return [];
    const set = new Set<string>();
    editAreasConhecimento.forEach((area) => { ASSUNTOS_BY_AREA[area]?.forEach((a) => set.add(a)); });
    return Array.from(set);
  }, [editAreasConhecimento]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setIsAdmin(payload.role === 'admin');
      } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    if (noteId) fetchNote();
    else setLoading(false);
  }, [noteId]); // eslint-disable-line

  useEffect(() => {
    if (noteId && note) fetchRelatedQuestions();
  }, [noteId, note]); // eslint-disable-line

  useEffect(() => {
    if (!noteId || !note) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    setSimilarLoading(true);
    fetch(`/api/notes/${noteId}/similar?limit=5`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : { notes: [], questions: [] })
      .then((data) => { setSimilarNotes(data.notes ?? []); setSimilarQuestions(data.questions ?? []); })
      .catch(() => {})
      .finally(() => setSimilarLoading(false));
  }, [noteId, note?.id]); // eslint-disable-line

  useEffect(() => {
    if (note?.tags && note.tags.length > 0) fetchQuestionsCount(note.tags);
  }, [note?.tags]); // eslint-disable-line

  useEffect(() => {
    if (note) {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          if (note.user_id === payload.id) setIsOwner(true);
        } catch { /* ignore */ }
      }
      setNoteTitle(note.title);
      setEditTitle(note.title);
      setEditDescription(note.description);
      setEditTipoConteudo((note as Note).tipo_conteudo || '');
      setEditTags(note.tags || []);
      setEditAreasConhecimento(note.areas_conhecimento || []);
      setEditAssuntos(note.assuntos || []);
      setEditImages(note.images || []);
    }
  }, [note]); // eslint-disable-line

  // Clear topbar title + panel when leaving the note page
  useEffect(() => {
    return () => {
      setNoteTitle('');
      setActivePanel(null);
    };
  }, []); // eslint-disable-line

  useEffect(() => {
    if (editAreasConhecimento.length === 0) { setEditAssuntos([]); return; }
    const valid = new Set<string>();
    editAreasConhecimento.forEach((area) => { ASSUNTOS_BY_AREA[area]?.forEach((a) => valid.add(a)); });
    setEditAssuntos((prev) => prev.filter((a) => valid.has(a)));
  }, [editAreasConhecimento]);

  const fetchNote = async () => {
    if (!noteId) { setError('ID da nota não fornecido'); setLoading(false); return; }
    try {
      const token = localStorage.getItem('token');
      if (!token) { router.push('/login'); return; }
      const cleanToken = token.trim().replace(/^["']|["']$/g, '');
      const response = await fetch(`/api/notes/${noteId}`, {
        headers: { Authorization: `Bearer ${cleanToken}` },
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setNote(data); setError(null);
      } else if (response.status === 404) {
        setError('Nota não encontrada'); setNote(null);
      } else if (response.status === 401 || response.status === 403) {
        setError('Não autorizado'); router.push('/login');
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        setError(errorData.error || 'Erro ao carregar nota'); setNote(null);
      }
    } catch {
      setError('Erro ao carregar nota. Tente novamente.'); setNote(null);
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
      const response = await fetch(`/api/notes/${noteId}/questions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) setRelatedQuestions(await response.json());
    } catch { /* ignore */ }
    finally { setLoadingQuestions(false); }
  };

  const fetchQuestionsCount = async (tags: string[]) => {
    if (!tags?.length) { setQuestionsCount(0); return; }
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const response = await fetch(`/api/questions/by-tags?tags=${encodeURIComponent(JSON.stringify(tags))}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) setQuestionsCount((await response.json()).length);
    } catch { /* ignore */ }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files ?? []).forEach((file) => {
      if (!file.type.startsWith('image/')) { alert('Apenas arquivos de imagem são permitidos'); return; }
      const reader = new FileReader();
      reader.onload = (event) => setEditImages((prev) => [...prev, event.target?.result as string]);
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (index: number) => setEditImages((prev) => prev.filter((_, i) => i !== index));

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
    } else { setFontesSelectedForNote(null); }
  };

  const handleCancelEdit = () => {
    setIsEditing(false); setFontesSelectedForNote(null);
    setEditTitle(note?.title || ''); setEditDescription(note?.description || '');
    setEditTipoConteudo((note as Note)?.tipo_conteudo || '');
    setEditTags(note?.tags || []); setEditAreasConhecimento(note?.areas_conhecimento || []);
    setEditAssuntos(note?.assuntos || []); setEditImages(note?.images || []);
  };

  const handleSaveEdit = async () => {
    if (!editTitle.trim()) { alert('O título não pode estar vazio.'); return; }
    if (!note) return;
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const response = await fetch(`/api/notes/${noteId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(), description: editDescription.trim(),
          tipo_conteudo: editTipoConteudo.trim() || undefined,
          tags: editTags, areas_conhecimento: editAreasConhecimento, assuntos: editAssuntos,
          images: editImages,
          fontes_resumo_melhorado: note?.fontes_resumo_melhorado ?? undefined,
          fontes_resumo_original: note?.fontes_resumo_original ?? undefined,
          fontes_arquivos: note?.fontes_arquivos ?? [],
        }),
      });
      if (response.ok) { setNote(await response.json()); setIsEditing(false); }
      else alert('Erro ao salvar as alterações');
    } catch { alert('Erro ao salvar as alterações'); }
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          <p className="text-gray-500 mt-3 text-sm">Carregando nota…</p>
        </div>
      </div>
    );
  }

  if (error || !note) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-lg mb-2">{error || 'Nota não encontrada.'}</p>
          {noteId && <p className="text-gray-400 text-sm mb-4">ID: {noteId}</p>}
          <button onClick={() => router.push('/dashboard/notes')}
            className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition">
            Voltar para Notas
          </button>
        </div>
      </div>
    );
  }

  const canEdit = isAdmin || isOwner;

  // ── Panel toggle helper ──────────────────────────────────────────────
  const togglePanel = (panel: 'fontes' | 'estudio') =>
    setActivePanel(activePanel === panel ? null : panel);

  // ── Fontes panel ─────────────────────────────────────────────────────
  const FontesPanel = () => (
    <div className="space-y-4">
      {(note.fontes_arquivos?.length ?? 0) > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Arquivos carregados</p>
          <ul className="space-y-1">
            {(note.fontes_arquivos ?? []).map((name, idx) => (
              <li key={idx} className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                <FileText className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <span className="text-xs text-gray-700 truncate" title={name}>{name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(note.fontes_resumo_melhorado || note.fontes_resumo_original) ? (
        <div className="rounded-xl border-2 border-gray-200 overflow-hidden">
          {isEditing && (
            <p className="text-xs text-gray-500 px-3 pt-2 pb-1">
              Selecione ★ para usar como conteúdo da nota.
            </p>
          )}
          <p className="text-xs font-semibold text-gray-600 px-3 pt-2 pb-1">Transformação por IA</p>
          <div className="flex">
            {(['melhorado', 'original'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setFontesResumoSubTab(st)}
                className={`flex-1 flex items-center justify-between gap-1 px-3 py-2.5 text-xs font-semibold border-b-2 transition ${
                  fontesResumoSubTab === st
                    ? 'text-primary-600 border-primary-500 bg-primary-50/50'
                    : 'text-gray-500 border-gray-200 hover:text-gray-700 bg-gray-50'
                }`}
              >
                <span>{st === 'melhorado' ? 'Melhorado' : 'Original'}</span>
                {isEditing && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFontesSelectedForNote(st);
                      setEditDescription(st === 'melhorado' ? note.fontes_resumo_melhorado || '' : note.fontes_resumo_original || '');
                    }}
                    className="p-0.5 rounded hover:bg-primary-100 transition"
                    title="Usar no conteúdo"
                  >
                    <Star className={`w-3.5 h-3.5 ${fontesSelectedForNote === st ? 'fill-amber-400 text-amber-500' : 'text-gray-300 hover:text-amber-400'}`} />
                  </button>
                )}
              </button>
            ))}
          </div>
          <div className="p-3 max-h-64 overflow-y-auto bg-white">
            <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">
              {fontesResumoSubTab === 'melhorado' ? note.fontes_resumo_melhorado || '—' : note.fontes_resumo_original || '—'}
            </p>
          </div>
        </div>
      ) : (
        <div className="text-center py-6 text-gray-400">
          <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-xs">O conteúdo das fontes foi incorporado à nota.</p>
        </div>
      )}
    </div>
  );

  // ── Estúdio panel ────────────────────────────────────────────────────
  const EstudioPanel = () => (
    <div className="space-y-5">
      {note.tags && note.tags.length > 0 && (
        <div className="rounded-xl border border-gray-200 p-4 space-y-2">
          <p className="text-xs font-semibold text-gray-700">Buscar Questões</p>
          {questionsCount > 0 ? (
            <button
              type="button"
              onClick={() => {
                const tagsParam = encodeURIComponent(JSON.stringify(note.tags));
                router.push(`/dashboard/notes/select-questions?tags=${tagsParam}&noteId=${noteId}`);
              }}
              className="w-full px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs font-semibold hover:bg-primary-700 transition"
            >
              Ver questões ({questionsCount})
            </button>
          ) : (
            <p className="text-xs text-gray-400">Nenhuma questão encontrada com as tags desta nota</p>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-700">
            Questões Associadas ({relatedQuestions.length})
          </p>
          {relatedQuestions.length > 0 && (
            <button
              type="button"
              onClick={() => {
                localStorage.setItem('pendingSimulateQuestions', JSON.stringify({ questions: relatedQuestions, tags: note?.tags ?? [] }));
                router.push('/dashboard/simulados/novo');
              }}
              className="px-2 py-1 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition text-xs"
            >
              Fazer Simulado
            </button>
          )}
        </div>
        {loadingQuestions ? (
          <div className="flex items-center gap-2 text-gray-400 py-4 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs">Carregando…</span>
          </div>
        ) : relatedQuestions.length === 0 ? (
          <div className="text-center py-6 text-gray-400">
            <HelpCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-xs">Nenhuma questão associada</p>
          </div>
        ) : (
          <div className="space-y-2">
            {relatedQuestions.map((q) => (
              <div
                key={q.id}
                onClick={() => router.push(`/dashboard/questions/${q.id}`)}
                className="p-3 rounded-xl border border-gray-200 hover:border-primary-300 hover:shadow-sm transition cursor-pointer"
              >
                <p className="text-xs text-gray-700 line-clamp-2">{q.statement}</p>
                {q.tags && q.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {q.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 text-xs bg-primary-50 text-primary-600 rounded-full">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pt-3 border-t border-gray-100">
        <p className="text-xs font-semibold text-gray-700 mb-3">Artigos</p>
        <div className="text-center py-4 text-gray-400">
          <BookOpen className="w-6 h-6 mx-auto mb-1.5 opacity-40" />
          <p className="text-xs">Em desenvolvimento</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 p-4 sm:p-6">

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-gray-100 transition flex-shrink-0"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Always-visible Fontes icon button */}
          <button
            type="button"
            onClick={() => togglePanel('fontes')}
            title="Fontes"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              activePanel === 'fontes'
                ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span className="hidden sm:inline">Fontes</span>
            {(note.fontes_arquivos?.length ?? 0) > 0 && (
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${activePanel === 'fontes' ? 'bg-primary-500' : 'bg-gray-300'}`} />
            )}
          </button>

          {/* Always-visible Estúdio icon button */}
          <button
            type="button"
            onClick={() => togglePanel('estudio')}
            title="Estúdio"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              activePanel === 'estudio'
                ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">Estúdio</span>
            {relatedQuestions.length > 0 && (
              <span className={`min-w-[18px] h-[18px] rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${
                activePanel === 'estudio' ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-600'
              }`}>{relatedQuestions.length}</span>
            )}
          </button>

          {canEdit && !isEditing && (
            <button
              onClick={handleEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition text-sm font-medium"
            >
              <Edit className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Editar</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Main layout: content + side panel ───────────────────────── */}
      <div className="flex gap-6 items-start">

        {/* ── Main content ──────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Note body card */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-6 space-y-5">
              {/* Title — only shown in edit mode (view mode: topbar) */}
              {isEditing && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Título</label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => { setEditTitle(e.target.value); setNoteTitle(e.target.value); }}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent text-base font-semibold"
                    placeholder="Título da nota"
                  />
                </div>
              )}

              {/* Content */}
              {isEditing ? (
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Conteúdo</label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={14}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-y text-sm leading-relaxed"
                    placeholder="Conteúdo da nota"
                  />
                </div>
              ) : (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Conteúdo</p>
                  <div className="text-gray-700 whitespace-pre-wrap leading-relaxed text-sm">
                    {note.description || <span className="text-gray-400 italic">Sem conteúdo</span>}
                  </div>
                </div>
              )}

              {/* Tipo conteúdo (editing only) */}
              {isEditing && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Tipo de conteúdo</label>
                  <input
                    type="text"
                    value={editTipoConteudo}
                    onChange={(e) => setEditTipoConteudo(e.target.value)}
                    placeholder="Ex.: resumo de aula, caso clínico, anotação de artigo…"
                    className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                  />
                </div>
              )}
              {!isEditing && (note as Note).tipo_conteudo && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Tipo</p>
                  <p className="text-sm text-gray-600">{(note as Note).tipo_conteudo}</p>
                </div>
              )}
            </div>

            {/* Metadata bar */}
            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/50 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
              {note.user_name && <span>Por {note.user_name}</span>}
              <span>Criado em {formatDate(note.created_at)}</span>
              {note.updated_at !== note.created_at && <span>Atualizado em {formatDate(note.updated_at)}</span>}
            </div>
          </div>

          {/* Classification card */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-6 py-4 space-y-4">
              {/* Areas */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Área do Conhecimento</p>
                {isEditing ? (
                  <TagAutocomplete
                    options={AREAS_OPTIONS_DISPLAY}
                    selectedTags={editAreasConhecimento.map(toDisplayArea)}
                    onChange={(tags) => setEditAreasConhecimento(tags.map(fromDisplay))}
                    onSaveNewTag={() => {}} placeholder="Selecione áreas…" />
                ) : (
                  note.areas_conhecimento && note.areas_conhecimento.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {note.areas_conhecimento.map((area) => (
                        <span key={area} className="px-2.5 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-full">{toDisplayArea(area)}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 italic">Nenhuma área selecionada</p>
                  )
                )}
              </div>

              {/* Assuntos */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Assunto</p>
                {isEditing ? (
                  <TagAutocomplete
                    options={editAssuntosOptions.map(toDisplayAssunto)}
                    selectedTags={editAssuntos.map(toDisplayAssunto)}
                    onChange={(tags) => setEditAssuntos(tags.map(fromDisplay))}
                    onSaveNewTag={() => {}}
                    placeholder={editAreasConhecimento.length === 0 ? 'Selecione uma área primeiro' : 'Selecione assuntos…'} />
                ) : (
                  note.assuntos && note.assuntos.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {note.assuntos.map((assunto) => (
                        <span key={assunto} className="px-2.5 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-full">{toDisplayAssunto(assunto)}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 italic">Nenhum assunto selecionado</p>
                  )
                )}
              </div>

              {/* Tags */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Tags / Especialidade</p>
                {isEditing ? (
                  <TagAutocomplete
                    options={availableTags}
                    selectedTags={editTags}
                    onChange={(tags) => setEditTags(tags)}
                    onSaveNewTag={(newTag) => { if (!availableTags.includes(newTag)) setAvailableTags([...availableTags, newTag]); }}
                    label="Tags ou Especialidade"
                    placeholder="Digite para buscar tags…" />
                ) : (
                  note.tags && note.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {note.tags.map((tag) => (
                        <span key={tag} className="px-2.5 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-full">{tag}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 italic">Nenhuma tag adicionada</p>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Images card */}
          {(isEditing || (note.images && note.images.length > 0)) && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
              <div className="px-6 py-4 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Imagens</p>
                {isEditing ? (
                  <>
                    <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" id="detail-image-upload" />
                    <label
                      htmlFor="detail-image-upload"
                      className="flex items-center justify-center gap-2 py-5 border-2 border-dashed border-gray-200 rounded-xl hover:border-primary-400 hover:bg-primary-50/30 transition cursor-pointer"
                    >
                      <ImageIcon className="w-5 h-5 text-gray-400" />
                      <span className="text-sm text-gray-500">Clique para adicionar imagens</span>
                    </label>
                    {editImages.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {editImages.map((image, index) => (
                          <div key={index} className="relative group">
                            <ImageLightbox src={image} alt={`Preview ${index + 1}`} className="w-full h-32" />
                            <button type="button" onClick={() => removeImage(index)}
                              className="absolute top-1.5 right-1.5 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                              aria-label="Remover imagem">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  note.images && note.images.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {note.images.map((image, index) => (
                        <ImageLightbox key={index} src={image} alt={`Imagem ${index + 1}`} className="w-full h-40" />
                      ))}
                    </div>
                  ) : null
                )}
              </div>
            </div>
          )}

          {/* Edit action buttons */}
          {isEditing && (
            <div className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-4">
              <button type="button" onClick={handleSaveEdit}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition text-sm font-semibold">
                <Save className="w-4 h-4" />
                Salvar alterações
              </button>
              <button type="button" onClick={handleCancelEdit}
                className="px-4 py-2 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition text-sm">
                Cancelar
              </button>
            </div>
          )}

        </div>

        {/* ── Side panel ────────────────────────────────────────────── */}
        {activePanel !== null && (
          <div className="w-72 xl:w-80 flex-shrink-0 hidden md:block">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm sticky top-4">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  {activePanel === 'fontes'
                    ? <><BookOpen className="w-4 h-4 text-primary-600" /><span className="text-sm font-semibold text-gray-700">Fontes</span></>
                    : <><Sparkles className="w-4 h-4 text-primary-600" /><span className="text-sm font-semibold text-gray-700">Estúdio</span></>
                  }
                </div>
                <button type="button" onClick={() => setActivePanel(null)}
                  className="p-1 rounded-lg hover:bg-gray-100 transition text-gray-400">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 max-h-[70vh] overflow-y-auto">
                {activePanel === 'fontes' ? <FontesPanel /> : <EstudioPanel />}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── Mobile panels (below main content on small screens) ─────── */}
      {activePanel !== null && (
        <div className="md:hidden bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              {activePanel === 'fontes'
                ? <><BookOpen className="w-4 h-4 text-primary-600" /><span className="text-sm font-semibold text-gray-700">Fontes</span></>
                : <><Sparkles className="w-4 h-4 text-primary-600" /><span className="text-sm font-semibold text-gray-700">Estúdio</span></>
              }
            </div>
            <button type="button" onClick={() => setActivePanel(null)}
              className="p-1 rounded-lg hover:bg-gray-100 transition text-gray-400">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4">
            {activePanel === 'fontes' ? <FontesPanel /> : <EstudioPanel />}
          </div>
        </div>
      )}

      {/* ── Related content (semantic search) ───────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-gray-100">
          <Brain className="h-4 w-4 text-violet-500" />
          <h3 className="text-sm font-semibold text-gray-800">Conteúdo relacionado</h3>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">busca semântica</span>
        </div>

        <div className="flex gap-1 px-4 pt-3 border-b border-gray-100 bg-gray-50/50">
          {(['notes', 'questions'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSimilarTab(tab)}
              className={`px-4 py-2 text-sm font-medium rounded-t-md transition ${
                similarTab === tab
                  ? 'bg-white text-violet-600 border border-b-white border-gray-200 -mb-px'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'notes' ? 'Notas parecidas' : 'Questões do mesmo tema'}
              {tab === 'notes' && similarNotes.length > 0 && (
                <span className="ml-1.5 text-xs bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full">{similarNotes.length}</span>
              )}
              {tab === 'questions' && similarQuestions.length > 0 && (
                <span className="ml-1.5 text-xs bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full">{similarQuestions.length}</span>
              )}
            </button>
          ))}
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
                <Brain className="h-8 w-8 text-gray-200 mx-auto mb-2" />
                <p className="text-gray-400 text-sm">Nenhuma nota similar. O embedding desta nota precisa ser gerado primeiro.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {similarNotes.map((sn) => (
                  <div key={sn.id} className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 hover:border-violet-200 hover:bg-violet-50/30 transition group">
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
                    <button onClick={() => router.push(`/dashboard/notes/${sn.id}`)}
                      className="flex-shrink-0 p-1.5 text-gray-400 hover:text-violet-600 transition opacity-0 group-hover:opacity-100" title="Ver nota">
                      <ExternalLink className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )
          ) : (
            similarQuestions.length === 0 ? (
              <div className="text-center py-6">
                <Brain className="h-8 w-8 text-gray-200 mx-auto mb-2" />
                <p className="text-gray-400 text-sm">Nenhuma questão similar. O embedding desta nota precisa ser gerado primeiro.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {similarQuestions.map((sq) => (
                  <div key={sq.id} className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 hover:border-violet-200 hover:bg-violet-50/30 transition group">
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
                    <button onClick={() => router.push(`/dashboard/questions/${sq.id}`)}
                      className="flex-shrink-0 p-1.5 text-gray-400 hover:text-violet-600 transition opacity-0 group-hover:opacity-100" title="Ver questão">
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
