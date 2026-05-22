'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  MoreVertical, Edit, Trash2, X, Image as ImageIcon,
  ChevronDown, ChevronUp, Filter, Plus, FileText,
  SlidersHorizontal, Tag, BookOpen, Calendar,
} from 'lucide-react';
import TagAutocomplete from '@/components/Common/TagAutocomplete';
import ImageLightbox from '@/components/Common/ImageLightbox';
import { useDashboardSearch } from '@/contexts/DashboardSearchContext';
import {
  ASSUNTOS_BY_AREA,
  toDisplayArea,
  toDisplayAssunto,
  fromDisplay,
  AREAS_OPTIONS_DISPLAY,
} from '@/lib/areas-assuntos';

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
  tags?: string[];
  areas_conhecimento?: string[];
  assuntos?: string[];
  images?: string[];
  created_at: string;
  updated_at: string;
  user_id?: number;
  user_name?: string;
  user_email?: string;
  user_role?: string;
  company_id?: number | null;
  company_name?: string | null;
}

interface Company {
  id: number;
  name: string;
}

export default function NotesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { searchQuery } = useDashboardSearch();
  const [availableTags, setAvailableTags] = useState<string[]>(AVAILABLE_TAGS);
  const [notes, setNotes] = useState<Note[]>([]);
  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return notes;
    const q = searchQuery.trim().toLowerCase();
    return notes.filter((n) => n.title.toLowerCase().includes(q));
  }, [notes, searchQuery]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    tags: [] as string[],
    areasConhecimento: [] as string[],
    assuntos: [] as string[],
    images: [] as string[],
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  const [userRole, setUserRole] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [filterRole, setFilterRole] = useState<string>('');
  const [filterCompanyId, setFilterCompanyId] = useState<string>('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterAreasConhecimento, setFilterAreasConhecimento] = useState<string[]>([]);
  const [areasConhecimentoOptions, setAreasConhecimentoOptions] = useState<string[]>(AREAS_OPTIONS_DISPLAY || []);
  const [filterAssuntos, setFilterAssuntos] = useState<string[]>([]);
  const [filtersAccordionOpen, setFiltersAccordionOpen] = useState(false);
  const PAGE_SIZE = 20;
  const [currentPage, setCurrentPage] = useState(1);
  const [totalNotes, setTotalNotes] = useState(0);

  const assuntosOptions = useMemo(() => {
    if (filterAreasConhecimento.length === 0) return [];
    const set = new Set<string>();
    filterAreasConhecimento.forEach((area) => {
      const assuntos = ASSUNTOS_BY_AREA[area];
      if (assuntos) assuntos.forEach((a) => set.add(a));
    });
    return Array.from(set);
  }, [filterAreasConhecimento]);

  const areasConhecimentoModal = formData.areasConhecimento ?? [];
  const assuntosModal = formData.assuntos ?? [];
  const modalAssuntosOptions = useMemo(() => {
    if (areasConhecimentoModal.length === 0) return [];
    const set = new Set<string>();
    areasConhecimentoModal.forEach((area) => {
      const assuntos = ASSUNTOS_BY_AREA[area];
      if (assuntos) assuntos.forEach((a) => set.add(a));
    });
    return Array.from(set);
  }, [areasConhecimentoModal]);

  const getToken = () => {
    if (typeof window !== 'undefined') return localStorage.getItem('token');
    return null;
  };

  const fetchNotes = async () => {
    try {
      const token = getToken();
      if (!token) return;
      const params = new URLSearchParams();
      if (isAdmin && filterRole) params.append('role', filterRole);
      if (isAdmin && filterCompanyId) params.append('company_id', filterCompanyId);
      if (filterTags.length > 0) params.append('tags', filterTags.join(','));
      if (filterAreasConhecimento.length > 0) params.append('areas_conhecimento', filterAreasConhecimento.join(','));
      if (filterAssuntos.length > 0) params.append('assuntos', filterAssuntos.join(','));
      params.append('page', String(currentPage));
      params.append('limit', String(PAGE_SIZE));
      const response = await fetch(`/api/notes?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-store',
      });
      if (response.ok) {
        const data = await response.json();
        if (data && typeof data === 'object' && Array.isArray(data.notes) && typeof data.total === 'number') {
          setNotes(data.notes);
          setTotalNotes(data.total);
        } else {
          setNotes(Array.isArray(data) ? data : []);
          setTotalNotes(Array.isArray(data) ? data.length : 0);
        }
      }
    } catch (error) {
      console.error('Erro ao buscar notas:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCompanies = async () => {
    try {
      const token = getToken();
      if (!token) return;
      const response = await fetch('/api/companies', { headers: { 'Authorization': `Bearer ${token}` } });
      if (response.ok) setCompanies(await response.json());
    } catch (error) {
      console.error('Erro ao buscar empresas:', error);
    }
  };

  useEffect(() => {
    const token = getToken();
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const role = payload.role || 'regular';
        setUserRole(role);
        const admin = role === 'admin';
        setIsAdmin(admin);
        if (admin) fetchCompanies();
        fetchNotes();
      } catch (error) {
        console.error('Erro ao decodificar token:', error);
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (filterAreasConhecimento.length === 0) { setFilterAssuntos([]); return; }
    const opcoes = new Set<string>();
    filterAreasConhecimento.forEach((area) => {
      const assuntos = ASSUNTOS_BY_AREA[area];
      if (assuntos) assuntos.forEach((a) => opcoes.add(a));
    });
    setFilterAssuntos((prev) => prev.filter((a) => opcoes.has(a)));
  }, [filterAreasConhecimento]);

  useEffect(() => {
    const areas = formData.areasConhecimento ?? [];
    if (areas.length === 0) { setFormData((prev) => ({ ...prev, assuntos: [] })); return; }
    const opcoes = new Set<string>();
    areas.forEach((area) => {
      const assuntos = ASSUNTOS_BY_AREA[area];
      if (assuntos) assuntos.forEach((a) => opcoes.add(a));
    });
    setFormData((prev) => ({ ...prev, assuntos: (prev.assuntos ?? []).filter((a) => opcoes.has(a)) }));
  }, [formData.areasConhecimento]);

  useEffect(() => { setCurrentPage(1); }, [filterRole, filterCompanyId, filterTags, filterAreasConhecimento, filterAssuntos]);
  useEffect(() => { fetchNotes(); }, [filterRole, filterCompanyId, filterTags, filterAreasConhecimento, filterAssuntos, isAdmin, currentPage]);

  useEffect(() => {
    const handleNotesUpdated = () => fetchNotes();
    window.addEventListener('notesUpdated', handleNotesUpdated);
    return () => window.removeEventListener('notesUpdated', handleNotesUpdated);
  }, [isAdmin]);

  useEffect(() => {
    if (!searchParams) return;
    const editId = searchParams.get('edit');
    if (editId && notes.length > 0 && !editingNote) {
      const noteToEdit = notes.find(n => n.id === parseInt(editId));
      if (noteToEdit) {
        handleEdit(noteToEdit);
        router.replace('/dashboard/notes', { scroll: false });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, notes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setMessage(null);
    try {
      const token = getToken();
      if (!token) { setMessage({ type: 'error', text: 'Não autorizado' }); return; }
      if (!editingNote) { setMessage({ type: 'error', text: 'Nota não encontrada' }); setFormLoading(false); return; }
      const payload = {
        title: formData.title,
        description: formData.description,
        tags: formData.tags,
        areas_conhecimento: formData.areasConhecimento,
        assuntos: formData.assuntos,
        images: formData.images,
      };
      const response = await fetch(`/api/notes/${editingNote.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        const updatedNote = await response.json();
        setNotes((prev) => prev.map((n) => n.id === updatedNote.id ? {
          ...n, ...updatedNote,
          tags: updatedNote.tags ?? n.tags ?? [],
          areas_conhecimento: updatedNote.areas_conhecimento ?? n.areas_conhecimento ?? [],
          assuntos: updatedNote.assuntos ?? n.assuntos ?? [],
        } : n));
        setMessage({ type: 'success', text: 'Nota atualizada com sucesso!' });
        setFormData({ title: '', description: '', tags: [], areasConhecimento: [], assuntos: [], images: [] });
        setEditingNote(null);
        setShowModal(false);
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || 'Erro ao salvar a nota' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Erro ao salvar a nota. Tente novamente.' });
    } finally {
      setFormLoading(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) { setMessage({ type: 'error', text: 'Apenas arquivos de imagem são permitidos' }); return; }
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setFormData((prev) => ({ ...prev, images: [...prev.images, base64] }));
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (index: number) => {
    setFormData((prev) => ({ ...prev, images: prev.images.filter((_, i) => i !== index) }));
  };

  const handleEdit = (note: Note) => {
    setEditingNote(note);
    setFormData({
      title: note.title,
      description: note.description,
      tags: note.tags || [],
      areasConhecimento: note.areas_conhecimento ?? [],
      assuntos: note.assuntos ?? [],
      images: note.images || [],
    });
    setShowModal(true);
    setOpenMenuId(null);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Tem certeza que deseja excluir esta nota?')) return;
    try {
      const token = getToken();
      if (!token) { setMessage({ type: 'error', text: 'Não autorizado' }); return; }
      const response = await fetch(`/api/notes/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        setMessage({ type: 'success', text: 'Nota excluída com sucesso!' });
        await fetchNotes();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || 'Erro ao excluir a nota' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Erro ao excluir a nota. Tente novamente.' });
    } finally {
      setOpenMenuId(null);
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingNote(null);
    setFormData({ title: '', description: '', tags: [], areasConhecimento: [], assuntos: [], images: [] });
    setMessage(null);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openMenuId !== null) {
        const target = event.target as HTMLElement;
        if (!target.closest('.note-menu-container')) setOpenMenuId(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [openMenuId]);

  const activeFilterCount =
    filterTags.length + filterAreasConhecimento.length + filterAssuntos.length +
    (isAdmin ? (filterRole ? 1 : 0) + (filterCompanyId ? 1 : 0) : 0);

  const clearAllFilters = () => {
    setFilterTags([]);
    setFilterAreasConhecimento([]);
    setFilterAssuntos([]);
    if (isAdmin) { setFilterRole(''); setFilterCompanyId(''); }
  };

  const totalPages = Math.ceil(totalNotes / PAGE_SIZE);

  return (
    <div className="space-y-5 relative pb-24">

      {/* ══════════════════════════════════════════
          PAGE HEADER
          ══════════════════════════════════════════ */}
      <div className="bg-gradient-to-br from-primary-600 to-primary-700 rounded-2xl p-5 sm:p-6 text-white shadow-sm">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3.5">
            <div className="bg-white/15 p-2.5 rounded-xl">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold leading-tight">
                {isAdmin ? 'Todas as Notas' : 'Minhas Notas'}
              </h1>
              <p className="text-primary-100 text-sm mt-0.5">
                {isAdmin
                  ? 'Visualize e gerencie notas de todos os usuários'
                  : 'Crie e gerencie suas notas de estudo'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {!loading && (
              <div className="bg-white/15 px-3 py-1.5 rounded-lg text-sm font-semibold">
                {totalNotes} {totalNotes === 1 ? 'nota' : 'notas'}
              </div>
            )}
            <Link href="/dashboard/notes/new">
              <span className="inline-flex items-center gap-2 bg-white text-primary-700 px-4 py-2 rounded-xl font-semibold text-sm hover:bg-primary-50 transition shadow-sm cursor-pointer">
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Nova Nota</span>
              </span>
            </Link>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          FILTER PANEL
          ══════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setFiltersAccordionOpen((prev) => !prev)}
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition"
          aria-expanded={filtersAccordionOpen}
        >
          <div className="flex items-center gap-2.5">
            <SlidersHorizontal className="w-4 h-4 text-primary-500" />
            <span className="font-medium text-gray-700 text-sm">Filtrar notas</span>
            {activeFilterCount > 0 && (
              <span className="bg-primary-100 text-primary-700 text-xs font-bold px-2 py-0.5 rounded-full">
                {activeFilterCount}
              </span>
            )}
          </div>
          {filtersAccordionOpen
            ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
            : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
        </button>

        {/* Active filter chips (shown when accordion is closed) */}
        {!filtersAccordionOpen && activeFilterCount > 0 && (
          <div className="px-5 pb-3.5 pt-1 flex flex-wrap gap-1.5 border-t border-gray-100">
            {filterTags.map(tag => (
              <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary-50 text-primary-700 rounded-full text-xs font-medium border border-primary-200">
                <Tag className="w-3 h-3" />{tag}
                <button type="button" onClick={() => setFilterTags(p => p.filter(t => t !== tag))} className="hover:text-primary-900 ml-0.5"><X className="w-3 h-3" /></button>
              </span>
            ))}
            {filterAreasConhecimento.map(area => (
              <span key={area} className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium border border-emerald-200">
                <BookOpen className="w-3 h-3" />{toDisplayArea(area)}
                <button type="button" onClick={() => setFilterAreasConhecimento(p => p.filter(a => a !== area))} className="hover:text-emerald-900 ml-0.5"><X className="w-3 h-3" /></button>
              </span>
            ))}
            {filterAssuntos.map(assunto => (
              <span key={assunto} className="inline-flex items-center gap-1 px-2.5 py-1 bg-teal-50 text-teal-700 rounded-full text-xs font-medium border border-teal-200">
                {toDisplayAssunto(assunto)}
                <button type="button" onClick={() => setFilterAssuntos(p => p.filter(a => a !== assunto))} className="hover:text-teal-900 ml-0.5"><X className="w-3 h-3" /></button>
              </span>
            ))}
            <button type="button" onClick={clearAllFilters} className="inline-flex items-center gap-1 px-2.5 py-1 text-gray-500 hover:text-gray-700 text-xs font-medium rounded-full hover:bg-gray-100 transition">
              <X className="w-3 h-3" />Limpar
            </button>
          </div>
        )}

        {filtersAccordionOpen && (
          <div className="border-t border-gray-100 p-5">
            <div className={isAdmin ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' : 'space-y-4'}>
              <div className={`flex flex-wrap gap-4 ${isAdmin ? 'md:col-span-2 lg:col-span-2' : ''}`}>
                <div className={`flex-1 min-w-0 ${isAdmin ? 'min-w-[200px]' : 'w-full'}`}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Área do Conhecimento
                  </label>
                  <TagAutocomplete
                    options={areasConhecimentoOptions}
                    selectedTags={filterAreasConhecimento}
                    onChange={(tags) => setFilterAreasConhecimento(tags)}
                    onSaveNewTag={(newTag) => {
                      if (!areasConhecimentoOptions.includes(newTag)) setAreasConhecimentoOptions([...areasConhecimentoOptions, newTag]);
                    }}
                    placeholder="Filtrar por áreas do conhecimento..."
                    maxTags={10}
                  />
                </div>
                <div className={`flex-1 min-w-0 ${isAdmin ? 'min-w-[200px]' : 'w-full'}`}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Assunto
                  </label>
                  <TagAutocomplete
                    options={assuntosOptions.map(toDisplayAssunto)}
                    selectedTags={filterAssuntos.map(toDisplayAssunto)}
                    onChange={(tags) => setFilterAssuntos(tags.map(fromDisplay))}
                    onSaveNewTag={() => {}}
                    placeholder={filterAreasConhecimento.length === 0 ? 'Selecione uma área primeiro' : 'Filtrar por assuntos...'}
                    maxTags={10}
                  />
                </div>
              </div>

              <div className={`max-w-sm ${isAdmin ? 'md:col-span-2 lg:col-span-1' : 'w-full'}`}>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Especialidade
                </label>
                <TagAutocomplete
                  options={availableTags}
                  selectedTags={filterTags}
                  onChange={(tags) => setFilterTags(tags)}
                  onSaveNewTag={(newTag) => {
                    if (!availableTags.includes(newTag)) setAvailableTags([...availableTags, newTag]);
                  }}
                  placeholder="Filtrar por especialidade..."
                  maxTags={10}
                />
              </div>

              {isAdmin && (
                <>
                  <div>
                    <label htmlFor="filter-role" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      Tipo de Usuário
                    </label>
                    <select
                      id="filter-role"
                      value={filterRole}
                      onChange={(e) => setFilterRole(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-gray-50"
                    >
                      <option value="">Todos os tipos</option>
                      <option value="admin">Administrador</option>
                      <option value="manager">Gerente</option>
                      <option value="regular">Regular</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="filter-company" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      Empresa
                    </label>
                    <select
                      id="filter-company"
                      value={filterCompanyId}
                      onChange={(e) => setFilterCompanyId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-gray-50"
                    >
                      <option value="">Todas as empresas</option>
                      {companies.map((company) => (
                        <option key={company.id} value={company.id.toString()}>{company.name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>

            {activeFilterCount > 0 && (
              <div className="mt-4 flex justify-end border-t border-gray-100 pt-4">
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
                >
                  <X className="w-3.5 h-3.5" />
                  Limpar filtros
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════
          FLASH MESSAGE
          ══════════════════════════════════════════ */}
      {message && (
        <div className={`flex items-center gap-3 p-4 rounded-xl border text-sm font-medium ${
          message.type === 'success'
            ? 'bg-primary-50 border-primary-200 text-primary-800'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          <span className="flex-1">{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} className="opacity-60 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════
          NOTES GRID
          ══════════════════════════════════════════ */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-8 h-8 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin" style={{ borderWidth: '3px' }} />
          <p className="text-sm text-gray-400">Carregando notas…</p>
        </div>
      ) : notes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-16 text-center">
          <div className="w-14 h-14 bg-primary-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FileText className="w-7 h-7 text-primary-400" />
          </div>
          <h3 className="text-gray-700 font-semibold text-lg mb-1">Nenhuma nota ainda</h3>
          <p className="text-gray-400 text-sm mb-6">Crie sua primeira nota para começar.</p>
          <Link href="/dashboard/notes/new">
            <span className="inline-flex items-center gap-2 bg-primary-600 text-white px-5 py-2.5 rounded-xl font-semibold text-sm hover:bg-primary-700 transition cursor-pointer">
              <Plus className="w-4 h-4" />Nova Nota
            </span>
          </Link>
        </div>
      ) : filteredNotes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <p className="text-gray-500">Nenhuma nota encontrada com &quot;{searchQuery}&quot;</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredNotes.map((note) => (
            <div
              key={note.id}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('.note-menu-container')) return;
                router.push(`/dashboard/notes/${note.id}`);
              }}
              className="group bg-white rounded-xl border border-gray-200 hover:border-primary-300 hover:shadow-lg hover:shadow-primary-500/5 transition-all cursor-pointer overflow-hidden flex flex-col"
            >
              {/* Top accent bar */}
              <div className="h-1 bg-gradient-to-r from-primary-400 to-primary-600 flex-shrink-0" />

              <div className="p-5 flex flex-col flex-1">
                {/* Title row + menu */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold text-gray-900 text-base leading-snug group-hover:text-primary-700 transition-colors">
                    {note.title}
                  </h3>
                  <div className="note-menu-container flex-shrink-0 relative" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setOpenMenuId(openMenuId === note.id ? null : note.id)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 transition text-gray-400 hover:text-gray-600"
                      aria-label="Menu de opções"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    {openMenuId === note.id && (
                      <div className="absolute top-8 right-0 bg-white rounded-xl shadow-xl border border-gray-100 z-20 min-w-[130px] overflow-hidden">
                        <button
                          type="button"
                          onClick={() => handleEdit(note)}
                          className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                        >
                          <Edit className="w-4 h-4 text-gray-400" />Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(note.id)}
                          className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                        >
                          <Trash2 className="w-4 h-4" />Excluir
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Admin author info */}
                {isAdmin && note.user_name && (
                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    <span className="text-xs text-gray-400">Por:</span>
                    <span className="text-xs font-medium text-gray-600">{note.user_name}</span>
                    {note.user_role && (
                      <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">{note.user_role === 'admin' ? 'Admin' : note.user_role === 'manager' ? 'Gerente' : 'Regular'}</span>
                    )}
                    {note.company_name && (
                      <span className="px-1.5 py-0.5 bg-primary-50 text-primary-600 rounded text-xs">{note.company_name}</span>
                    )}
                  </div>
                )}

                {/* Content preview */}
                <p className="text-gray-500 text-sm line-clamp-3 mb-4 flex-1 leading-relaxed">
                  {note.description}
                </p>

                {/* Tags */}
                {((note.tags ?? []).length > 0 || (note.areas_conhecimento ?? []).length > 0 || (note.assuntos ?? []).length > 0) && (
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {(note.tags ?? []).map((tag) => (
                      <span key={`tag-${tag}`} className="inline-block px-2 py-0.5 text-xs font-medium bg-primary-50 text-primary-700 rounded-full border border-primary-100">
                        {tag}
                      </span>
                    ))}
                    {(note.areas_conhecimento ?? []).map((area) => (
                      <span key={`area-${area}`} className="inline-block px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700 rounded-full border border-emerald-100">
                        {toDisplayArea(area)}
                      </span>
                    ))}
                    {(note.assuntos ?? []).map((assunto) => (
                      <span key={`assunto-${assunto}`} className="inline-block px-2 py-0.5 text-xs font-medium bg-teal-50 text-teal-700 rounded-full border border-teal-100">
                        {toDisplayAssunto(assunto)}
                      </span>
                    ))}
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center gap-1.5 text-xs text-gray-400 pt-3 border-t border-gray-100 mt-auto">
                  <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                  {formatDate(note.created_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════
          PAGINATION
          ══════════════════════════════════════════ */}
      {!loading && totalNotes > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-2 flex-wrap pt-2">
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            ← Anterior
          </button>
          <span className="px-4 py-2 text-sm text-gray-500 bg-white border border-gray-200 rounded-lg">
            {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Próxima →
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════
          EDIT MODAL
          ══════════════════════════════════════════ */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex justify-between items-center rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="bg-primary-100 p-2 rounded-lg">
                  <Edit className="w-4 h-4 text-primary-600" />
                </div>
                <h2 className="text-lg font-bold text-gray-900">Editar Nota</h2>
              </div>
              <button
                onClick={closeModal}
                className="p-2 rounded-lg hover:bg-gray-100 transition text-gray-400 hover:text-gray-600"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div>
                <label htmlFor="modal-title" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Título
                </label>
                <input
                  type="text"
                  id="modal-title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Título da sua nota"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-gray-50 focus:bg-white transition"
                  required
                />
              </div>

              <div>
                <label htmlFor="modal-description" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Conteúdo
                </label>
                <textarea
                  id="modal-description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Descreva aqui seu caso de estudo"
                  rows={10}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-y bg-gray-50 focus:bg-white transition"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Imagens
                </label>
                <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 hover:border-primary-300 transition-colors bg-gray-50">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageUpload}
                    className="hidden"
                    id="modal-image-upload"
                  />
                  <label htmlFor="modal-image-upload" className="flex flex-col items-center justify-center cursor-pointer py-3">
                    <ImageIcon className="w-8 h-8 text-gray-300 mb-2" />
                    <span className="text-sm text-gray-500 font-medium">Clique para adicionar imagens</span>
                    <span className="text-xs text-gray-400 mt-1">PNG, JPG, GIF até 10MB</span>
                  </label>
                </div>
                {formData.images.length > 0 && (
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {formData.images.map((image, index) => (
                      <div key={index} className="relative group">
                        <ImageLightbox src={image} alt={`Preview ${index + 1}`} className="w-full h-28 rounded-lg" />
                        <button
                          type="button"
                          onClick={() => removeImage(index)}
                          className="absolute top-1.5 right-1.5 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Remover imagem"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-4">
                <div className="flex-1 min-w-0" style={{ minWidth: '200px' }}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Área do Conhecimento
                  </label>
                  <TagAutocomplete
                    options={AREAS_OPTIONS_DISPLAY}
                    selectedTags={areasConhecimentoModal.map(toDisplayArea)}
                    onChange={(tags) => setFormData({ ...formData, areasConhecimento: tags.map(fromDisplay) })}
                    onSaveNewTag={() => {}}
                    placeholder="Selecione áreas do conhecimento..."
                  />
                </div>
                <div className="flex-1 min-w-0" style={{ minWidth: '200px' }}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Assunto
                  </label>
                  <TagAutocomplete
                    options={modalAssuntosOptions.map(toDisplayAssunto)}
                    selectedTags={assuntosModal.map(toDisplayAssunto)}
                    onChange={(tags) => setFormData({ ...formData, assuntos: tags.map(fromDisplay) })}
                    onSaveNewTag={() => {}}
                    placeholder={areasConhecimentoModal.length === 0 ? 'Selecione uma área primeiro' : 'Selecione assuntos...'}
                  />
                </div>
              </div>

              <div>
                <TagAutocomplete
                  options={availableTags}
                  selectedTags={formData.tags}
                  onChange={(tags) => setFormData({ ...formData, tags })}
                  onSaveNewTag={(newTag) => {
                    if (!availableTags.includes(newTag)) setAvailableTags([...availableTags, newTag]);
                  }}
                  label="Especialidade / Tags"
                  placeholder="Digite para buscar tags..."
                />
              </div>

              {message && (
                <div className={`flex items-center gap-3 p-3.5 rounded-xl border text-sm ${
                  message.type === 'success'
                    ? 'bg-primary-50 border-primary-200 text-primary-800'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}>
                  {message.text}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-5 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="px-5 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {formLoading ? 'Salvando…' : 'Salvar Nota'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
