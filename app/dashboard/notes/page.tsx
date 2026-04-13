'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MoreVertical, Edit, Trash2, X, Image as ImageIcon, ChevronDown, ChevronUp, Filter } from 'lucide-react';
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
  
  // Estados para filtros (apenas para admin)
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

  /** Opções de assuntos no modal de edição, derivadas das áreas selecionadas no formulário */
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
    if (typeof window !== 'undefined') {
      return localStorage.getItem('token');
    }
    return null;
  };

  const fetchNotes = async () => {
    try {
      const token = getToken();
      if (!token) return;

      // Construir query string com filtros
      const params = new URLSearchParams();
      if (isAdmin && filterRole) {
        params.append('role', filterRole);
      }
      if (isAdmin && filterCompanyId) {
        params.append('company_id', filterCompanyId);
      }
      if (filterTags.length > 0) {
        params.append('tags', filterTags.join(','));
      }
      if (filterAreasConhecimento.length > 0) {
        params.append('areas_conhecimento', filterAreasConhecimento.join(','));
      }
      if (filterAssuntos.length > 0) {
        params.append('assuntos', filterAssuntos.join(','));
      }
      params.append('page', String(currentPage));
      params.append('limit', String(PAGE_SIZE));

      const url = `/api/notes?${params.toString()}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
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

      const response = await fetch('/api/companies', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setCompanies(data);
      }
    } catch (error) {
      console.error('Erro ao buscar empresas:', error);
    }
  };

  // Verificar se é admin na montagem do componente
  useEffect(() => {
    const token = getToken();
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const role = payload.role || 'regular';
        setUserRole(role);
        const admin = role === 'admin';
        setIsAdmin(admin);
        
        // Buscar empresas se for admin
        if (admin) {
          fetchCompanies();
        }
        
        // Buscar notas após verificar role
        fetchNotes();
      } catch (error) {
        console.error('Erro ao decodificar token:', error);
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, []);

  // Quando a área do conhecimento mudar, manter apenas assuntos que ainda estão nas opções
  useEffect(() => {
    if (filterAreasConhecimento.length === 0) {
      setFilterAssuntos([]);
      return;
    }
    const opcoes = new Set<string>();
    filterAreasConhecimento.forEach((area) => {
      const assuntos = ASSUNTOS_BY_AREA[area];
      if (assuntos) assuntos.forEach((a) => opcoes.add(a));
    });
    setFilterAssuntos((prev) => prev.filter((a) => opcoes.has(a)));
  }, [filterAreasConhecimento]);

  // No modal de edição: quando áreas do conhecimento mudarem, manter apenas assuntos válidos
  useEffect(() => {
    const areas = formData.areasConhecimento ?? [];
    if (areas.length === 0) {
      setFormData((prev) => ({ ...prev, assuntos: [] }));
      return;
    }
    const opcoes = new Set<string>();
    areas.forEach((area) => {
      const assuntos = ASSUNTOS_BY_AREA[area];
      if (assuntos) assuntos.forEach((a) => opcoes.add(a));
    });
    setFormData((prev) => ({
      ...prev,
      assuntos: (prev.assuntos ?? []).filter((a) => opcoes.has(a)),
    }));
  }, [formData.areasConhecimento]);

  // Ao mudar filtros, voltar para a página 1
  useEffect(() => {
    setCurrentPage(1);
  }, [filterRole, filterCompanyId, filterTags, filterAreasConhecimento, filterAssuntos]);
  // Buscar notas quando página ou filtros mudarem
  useEffect(() => {
    fetchNotes();
  }, [filterRole, filterCompanyId, filterTags, filterAreasConhecimento, filterAssuntos, isAdmin, currentPage]);

  // Ouvir evento de atualização de notas
  useEffect(() => {
    const handleNotesUpdated = () => {
      fetchNotes();
    };

    window.addEventListener('notesUpdated', handleNotesUpdated);
    return () => window.removeEventListener('notesUpdated', handleNotesUpdated);
  }, [isAdmin]);

  // Detectar parâmetro edit na URL e abrir modal automaticamente
  useEffect(() => {
    if (!searchParams) return;
    const editId = searchParams.get('edit');
    if (editId && notes.length > 0 && !editingNote) {
      const noteToEdit = notes.find(n => n.id === parseInt(editId));
      if (noteToEdit) {
        handleEdit(noteToEdit);
        // Limpar parâmetro da URL sem recarregar a página
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
      if (!token) {
        setMessage({ type: 'error', text: 'Não autorizado' });
        return;
      }

      if (!editingNote) {
        setMessage({ type: 'error', text: 'Nota não encontrada' });
        setFormLoading(false);
        return;
      }

      const url = `/api/notes/${editingNote.id}`;
      const method = 'PUT';

      const payload = {
        title: formData.title,
        description: formData.description,
        tags: formData.tags,
        areas_conhecimento: formData.areasConhecimento,
        assuntos: formData.assuntos,
        images: formData.images,
      };
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const updatedNote = await response.json();
        setNotes((prev) =>
          prev.map((n) =>
            n.id === updatedNote.id
              ? {
                  ...n,
                  ...updatedNote,
                  tags: updatedNote.tags ?? n.tags ?? [],
                  areas_conhecimento: updatedNote.areas_conhecimento ?? n.areas_conhecimento ?? [],
                  assuntos: updatedNote.assuntos ?? n.assuntos ?? [],
                }
              : n
          )
        );
        setMessage({ type: 'success', text: 'Nota atualizada com sucesso!' });
        setFormData({ title: '', description: '', tags: [], areasConhecimento: [], assuntos: [], images: [] });
        setEditingNote(null);
        setShowModal(false);
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || 'Erro ao salvar a nota' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Erro ao salvar a nota. Tente novamente.' });
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
    if (!confirm('Tem certeza que deseja excluir esta nota?')) {
      return;
    }

    try {
      const token = getToken();
      if (!token) {
        setMessage({ type: 'error', text: 'Não autorizado' });
        return;
      }

      const response = await fetch(`/api/notes/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        setMessage({ type: 'success', text: 'Nota excluída com sucesso!' });
        await fetchNotes();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || 'Erro ao excluir a nota' });
      }
    } catch (error) {
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
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Fechar menu ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openMenuId !== null) {
        const target = event.target as HTMLElement;
        if (!target.closest('.note-menu-container')) {
          setOpenMenuId(null);
        }
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [openMenuId]);

  return (
    <div className="space-y-6 relative pb-24">
      <header>
        <h1 className="text-3xl font-bold text-gray-800">
          {isAdmin ? 'Todas as Notas' : 'Minhas Notas'} ({totalNotes})
        </h1>
        <p className="text-gray-600 mt-1">
          {isAdmin ? 'Visualize e gerencie notas de todos os usuários' : 'Crie e gerencie suas notas de estudo'}
        </p>
      </header>

      {/* Filtros em acordeão */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setFiltersAccordionOpen((prev) => !prev)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition"
          aria-expanded={filtersAccordionOpen}
        >
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Filter className="w-5 h-5 text-gray-600" />
            Filtrar
            {(() => {
              const activeCount = filterTags.length + filterAreasConhecimento.length + filterAssuntos.length + (isAdmin ? (filterRole ? 1 : 0) + (filterCompanyId ? 1 : 0) : 0);
              return activeCount > 0 ? (
                <span className="ml-2 text-sm font-normal text-primary-600">
                  ({activeCount} ativo{activeCount !== 1 ? 's' : ''})
                </span>
              ) : null;
            })()}
          </h2>
          {filtersAccordionOpen ? (
            <ChevronUp className="w-5 h-5 text-gray-500 flex-shrink-0" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-500 flex-shrink-0" />
          )}
        </button>
        {filtersAccordionOpen && (
          <div className="border-t border-gray-200 p-4">
            <div className={isAdmin ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" : "space-y-4"}>
              {/* Área do Conhecimento e Assunto lado a lado */}
              <div className={`flex flex-wrap gap-4 ${isAdmin ? "md:col-span-2 lg:col-span-2" : ""}`}>
                {/* Filtro Área do Conhecimento */}
                <div className={`flex-1 min-w-0 ${isAdmin ? "min-w-[200px]" : "w-full"}`}>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Área do Conhecimento
                  </label>
                  <TagAutocomplete
                    options={areasConhecimentoOptions}
                    selectedTags={filterAreasConhecimento}
                    onChange={(tags) => setFilterAreasConhecimento(tags)}
                    onSaveNewTag={(newTag) => {
                      if (!areasConhecimentoOptions.includes(newTag)) {
                        setAreasConhecimentoOptions([...areasConhecimentoOptions, newTag]);
                      }
                    }}
                    placeholder="Filtrar por áreas do conhecimento..."
                    maxTags={10}
                  />
                </div>

                {/* Filtro Assunto */}
                <div className={`flex-1 min-w-0 ${isAdmin ? "min-w-[200px]" : "w-full"}`}>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Assunto
                </label>
                <TagAutocomplete
                  options={assuntosOptions.map(toDisplayAssunto)}
                  selectedTags={filterAssuntos.map(toDisplayAssunto)}
                  onChange={(tags) => setFilterAssuntos(tags.map(fromDisplay))}
                  onSaveNewTag={() => {}}
                  placeholder={filterAreasConhecimento.length === 0 ? 'Selecione uma área do conhecimento primeiro' : 'Filtrar por assuntos...'}
                  maxTags={10}
                />
                </div>
              </div>

              {/* Filtro Especialidade */}
              <div className={`max-w-sm ${isAdmin ? "md:col-span-2 lg:col-span-1" : "w-full"}`}>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Especialidade
                </label>
                <TagAutocomplete
                  options={availableTags}
                  selectedTags={filterTags}
                  onChange={(tags) => setFilterTags(tags)}
                  onSaveNewTag={(newTag) => {
                    if (!availableTags.includes(newTag)) {
                      setAvailableTags([...availableTags, newTag]);
                    }
                  }}
                  placeholder="Filtrar por especialidade..."
                  maxTags={10}
                />
              </div>

              {/* Filtros de Admin */}
              {isAdmin && (
                <>
                  <div>
                    <label htmlFor="filter-role" className="block text-sm font-medium text-gray-700 mb-2">
                      Tipo de Usuário
                    </label>
                    <select
                      id="filter-role"
                      value={filterRole}
                      onChange={(e) => setFilterRole(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                      <option value="">Todos os tipos</option>
                      <option value="admin">Administrador</option>
                      <option value="manager">Gerente</option>
                      <option value="regular">Regular</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="filter-company" className="block text-sm font-medium text-gray-700 mb-2">
                      Empresa
                    </label>
                    <select
                      id="filter-company"
                      value={filterCompanyId}
                      onChange={(e) => setFilterCompanyId(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                      <option value="">Todas as empresas</option>
                      {companies.map((company) => (
                        <option key={company.id} value={company.id.toString()}>
                          {company.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
            {(filterTags.length > 0 || filterAreasConhecimento.length > 0 || filterAssuntos.length > 0 || (isAdmin && (filterRole || filterCompanyId))) && (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setFilterTags([]);
                    setFilterAreasConhecimento([]);
                    setFilterAssuntos([]);
                    if (isAdmin) {
                      setFilterRole('');
                      setFilterCompanyId('');
                    }
                  }}
                  className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition"
                >
                  Limpar Filtros
                </button>
              </div>
            )}
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
          <p className="text-gray-600 mt-2">Carregando notas...</p>
        </div>
      ) : notes.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-lg">Você ainda não possui notas.</p>
          <p className="text-gray-400 text-sm mt-2">Clique no botão + para criar sua primeira nota.</p>
        </div>
      ) : filteredNotes.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-lg">Nenhuma nota encontrada com &quot;{searchQuery}&quot;</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredNotes.map((note) => (
            <div
              key={note.id}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('.note-menu-container')) return;
                router.push(`/dashboard/notes/${note.id}`);
              }}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow relative cursor-pointer"
            >
              <div className="note-menu-container relative" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => setOpenMenuId(openMenuId === note.id ? null : note.id)}
                  className="absolute top-2 right-2 p-1 rounded-full hover:bg-gray-100 transition z-10"
                  aria-label="Menu de opções"
                >
                  <MoreVertical className="w-5 h-5 text-gray-500" />
                </button>

                {openMenuId === note.id && (
                  <div className="absolute top-10 right-2 bg-white rounded-lg shadow-lg border border-gray-200 z-20 min-w-[120px]">
                    <button
                      type="button"
                      onClick={() => handleEdit(note)}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 rounded-t-lg"
                    >
                      <Edit className="w-4 h-4" />
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(note.id)}
                      className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 rounded-b-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                      Excluir
                    </button>
                  </div>
                )}
              </div>

              <h3 className="font-semibold text-lg text-gray-800 mb-2 pr-8">
                {note.title}
              </h3>
              {isAdmin && note.user_name && (
                <div className="mb-2">
                  <p className="text-xs text-gray-500">
                    Por: <span className="font-medium">{note.user_name}</span>
                    {note.user_role && (
                      <span className="ml-2 px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">
                        {note.user_role === 'admin' ? 'Admin' : note.user_role === 'manager' ? 'Gerente' : 'Regular'}
                      </span>
                    )}
                    {note.company_name && (
                      <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
                        {note.company_name}
                      </span>
                    )}
                  </p>
                </div>
              )}
              {((note.tags ?? []).length > 0 || (note.areas_conhecimento ?? []).length > 0 || (note.assuntos ?? []).length > 0) && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {(note.tags ?? []).map((tag) => (
                    <span
                      key={`tag-${tag}`}
                      className="inline-block px-2 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                  {(note.areas_conhecimento ?? []).map((area) => (
                    <span
                      key={`area-${area}`}
                      className="inline-block px-2 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-full"
                    >
                      {toDisplayArea(area)}
                    </span>
                  ))}
                  {(note.assuntos ?? []).map((assunto) => (
                    <span
                      key={`assunto-${assunto}`}
                      className="inline-block px-2 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-full"
                    >
                      {toDisplayAssunto(assunto)}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-gray-600 text-sm line-clamp-4 mb-4">
                {note.description}
              </p>
              <p className="text-xs text-gray-400">
                Criada em {formatDate(note.created_at)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Paginação */}
      {!loading && totalNotes > PAGE_SIZE && (
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
            Página {currentPage} de {Math.ceil(totalNotes / PAGE_SIZE)}
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(Math.ceil(totalNotes / PAGE_SIZE), p + 1))}
            disabled={currentPage >= Math.ceil(totalNotes / PAGE_SIZE)}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Próxima
          </button>
        </div>
      )}

      {/* Modal de Edição */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-800">
                Editar Nota
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
              <div>
                <label htmlFor="modal-title" className="block text-sm font-medium text-gray-700 mb-2">
                  Título
                </label>
                <input
                  type="text"
                  id="modal-title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Título da sua nota"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label htmlFor="modal-description" className="block text-sm font-medium text-gray-700 mb-2">
                  Descrição
                </label>
                <textarea
                  id="modal-description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Descreva aqui seu caso de estudo"
                  rows={12}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-y"
                  required
                />
              </div>

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
                    id="modal-image-upload"
                  />
                  <label
                    htmlFor="modal-image-upload"
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

              {/* Área do Conhecimento e Assunto */}
              <div className="flex flex-wrap gap-4">
                <div className="flex-1 min-w-0" style={{ minWidth: '200px' }}>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
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
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Assunto
                  </label>
                  <TagAutocomplete
                    options={modalAssuntosOptions.map(toDisplayAssunto)}
                    selectedTags={assuntosModal.map(toDisplayAssunto)}
                    onChange={(tags) => setFormData({ ...formData, assuntos: tags.map(fromDisplay) })}
                    onSaveNewTag={() => {}}
                    placeholder={areasConhecimentoModal.length === 0 ? 'Selecione uma área do conhecimento primeiro' : 'Selecione assuntos...'}
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
                  {formLoading ? 'Atualizando...' : 'Atualizar Nota'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
