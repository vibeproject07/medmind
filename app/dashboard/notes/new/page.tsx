'use client';

import { Suspense, useState, useRef, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, BookOpen, Sparkles, X, Image as ImageIcon, ChevronDown, ChevronUp, Star } from 'lucide-react';
import TagAutocomplete from '@/components/Common/TagAutocomplete';
import ImageLightbox from '@/components/Common/ImageLightbox';
import ResumoAulasModal from '@/components/Dashboard/ResumoAulasModal';
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

type TabId = 'fontes' | 'conteudo' | 'estudio';
type NotaSubTabId = 'imagens' | 'descricao' | 'classificacao';

function NewNotePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabFromUrl = (searchParams.get('tab') as TabId) || 'conteudo';
  const activeTab: TabId = tabFromUrl === 'fontes' || tabFromUrl === 'estudio' ? tabFromUrl : 'conteudo';

  const setTab = (tab: TabId) => {
    router.replace(`/dashboard/notes/new?tab=${tab}`);
  };

  const [availableTags, setAvailableTags] = useState<string[]>(AVAILABLE_TAGS);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    informacoes: '',
    tipoConteudo: '', // Tipo de conteúdo da nota (aba Descrição)
    tags: [] as string[],
    areasConhecimento: [] as string[],
    assuntos: [] as string[],
    images: [] as string[], // Array de URLs base64 das imagens
  });
  const [resumoAulas, setResumoAulas] = useState<{ melhorado: string; original: string }>({ melhorado: '', original: '' });
  const [resumoAulasSubTab, setResumoAulasSubTab] = useState<'melhorado' | 'original'>('melhorado');
  const [resumoAulasSelectedForNote, setResumoAulasSelectedForNote] = useState<'melhorado' | 'original' | null>(null);
  const [fontesArquivosNames, setFontesArquivosNames] = useState<string[]>([]);
  const assuntosOptions = useMemo(() => {
    if (formData.areasConhecimento.length === 0) return [];
    const set = new Set<string>();
    formData.areasConhecimento.forEach((area) => {
      const assuntos = ASSUNTOS_BY_AREA[area];
      if (assuntos) assuntos.forEach((a) => set.add(a));
    });
    return Array.from(set);
  }, [formData.areasConhecimento]);

  // Quando a área do conhecimento mudar, manter apenas assuntos que ainda estão nas opções
  useEffect(() => {
    if (formData.areasConhecimento.length === 0) {
      setFormData((prev) => ({ ...prev, assuntos: [] }));
      return;
    }
    const opcoes = new Set<string>();
    formData.areasConhecimento.forEach((area) => {
      const assuntos = ASSUNTOS_BY_AREA[area];
      if (assuntos) assuntos.forEach((a) => opcoes.add(a));
    });
    setFormData((prev) => ({
      ...prev,
      assuntos: prev.assuntos.filter((a) => opcoes.has(a)),
    }));
  }, [formData.areasConhecimento]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fonteFileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFonteFiles, setPendingFonteFiles] = useState<File[]>([]);
  const [pendingFonteLink, setPendingFonteLink] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showResumoAulasModal, setShowResumoAulasModal] = useState(false);
  const [showImagensModal, setShowImagensModal] = useState(false);
  const [questionsCount, setQuestionsCount] = useState<number>(0);
  const [activeNotaSubTab, setActiveNotaSubTab] = useState<NotaSubTabId | null>(null);
  const [usarAgentesExpanded, setUsarAgentesExpanded] = useState(false);

  const getToken = () => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('token');
    }
    return null;
  };

  // Carregar dados salvos do localStorage ao montar o componente
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedDraft = localStorage.getItem('draftNote');
      if (savedDraft) {
        try {
          const draftData = JSON.parse(savedDraft);
          setFormData({
            title: draftData.title || '',
            description: draftData.description || '',
            informacoes: draftData.informacoes || '',
            tipoConteudo: draftData.tipoConteudo || '',
            tags: draftData.tags || [],
            areasConhecimento: draftData.areasConhecimento || [],
            assuntos: draftData.assuntos || [],
            images: draftData.images || [],
          });
          if (draftData.resumoAulas && (draftData.resumoAulas.melhorado || draftData.resumoAulas.original)) {
            setResumoAulas({
              melhorado: draftData.resumoAulas.melhorado || '',
              original: draftData.resumoAulas.original || '',
            });
            const selected = draftData.resumoAulasSelectedForNote as 'melhorado' | 'original' | undefined;
            if (selected === 'melhorado' || selected === 'original') {
              setResumoAulasSelectedForNote(selected);
            }
            if (Array.isArray(draftData.fontesArquivosNames) && draftData.fontesArquivosNames.length > 0) {
              setFontesArquivosNames(draftData.fontesArquivosNames);
            }
          }
        } catch (error) {
          console.error('Erro ao carregar rascunho:', error);
        }
      }
    }
  }, []);

  // Se veio do modal Criar Nota com arquivo(s) e/ou link, abrir o modal Transformando Arquivos na aba Fontes
  useEffect(() => {
    if (typeof window === 'undefined' || activeTab !== 'fontes') return;
    const raw = sessionStorage.getItem('pendingTransformFiles');
    if (!raw) return;
    sessionStorage.removeItem('pendingTransformFiles');
    try {
      const parsed = JSON.parse(raw);
      const items: { name: string; type: string; dataUrl: string }[] = Array.isArray(parsed) ? parsed : (parsed.files ?? []);
      const link = Array.isArray(parsed) ? '' : (parsed.link ?? '');
      if (items.length === 0 && !link.trim()) return;
      if (items.length === 0) {
        setPendingFonteLink(link);
        setPendingFonteFiles([]);
        setShowResumoAulasModal(true);
        return;
      }
      Promise.all(
        items.map((item) =>
          fetch(item.dataUrl)
            .then((r) => r.blob())
            .then((blob) => new File([blob], item.name, { type: item.type }))
        )
      ).then((files) => {
        setPendingFonteFiles(files);
        setPendingFonteLink(link);
        setShowResumoAulasModal(true);
      });
    } catch (e) {
      console.error('Erro ao restaurar arquivo(s)/link para o modal:', e);
    }
  }, [activeTab]);

  // Salvar dados no localStorage sempre que formData mudar
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Só salvar se houver algum conteúdo
      const hasContent = formData.title || formData.description || formData.informacoes || formData.tipoConteudo || formData.tags.length > 0 || formData.areasConhecimento.length > 0 || formData.assuntos.length > 0 || formData.images.length > 0 || resumoAulas.melhorado || resumoAulas.original;
      if (hasContent) {
        localStorage.setItem('draftNote', JSON.stringify({ ...formData, resumoAulas, resumoAulasSelectedForNote, fontesArquivosNames }));
      } else {
        // Se estiver vazio, remover do localStorage
        localStorage.removeItem('draftNote');
      }
    }
  }, [formData, resumoAulas, resumoAulasSelectedForNote, fontesArquivosNames]);

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

    // Limpar o input para permitir selecionar o mesmo arquivo novamente
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

  // Buscar quantidade de questões quando as tags mudarem
  useEffect(() => {
    const fetchQuestionsCount = async () => {
      if (formData.tags.length === 0) {
        setQuestionsCount(0);
        return;
      }

      try {
        const token = getToken();
        if (!token) return;

        const tagsParam = JSON.stringify(formData.tags);
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

    fetchQuestionsCount();
  }, [formData.tags]);

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

      const response = await fetch('/api/notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: formData.title,
          description: formData.informacoes || formData.description || '',
          tags: formData.tags,
          images: formData.images,
          areas_conhecimento: formData.areasConhecimento,
          assuntos: formData.assuntos,
          fontes_resumo_melhorado: resumoAulas.melhorado || undefined,
          fontes_resumo_original: resumoAulas.original || undefined,
          fontes_arquivos: fontesArquivosNames.length > 0 ? fontesArquivosNames : undefined,
        }),
      });

      if (response.ok) {
        const noteData = await response.json();
        
        // Associar questões selecionadas à nota, se houver
        const selectedQuestionIdsStr = localStorage.getItem('selectedQuestionIds');
        if (selectedQuestionIdsStr) {
          try {
            const selectedQuestionIds = JSON.parse(selectedQuestionIdsStr);
            if (Array.isArray(selectedQuestionIds) && selectedQuestionIds.length > 0) {
              const associateResponse = await fetch(`/api/notes/${noteData.id}/questions`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                  question_ids: selectedQuestionIds,
                }),
              });

              if (associateResponse.ok) {
                // Limpar o localStorage após associar com sucesso
                localStorage.removeItem('selectedQuestionIds');
              }
            }
          } catch (error) {
            console.error('Erro ao associar questões:', error);
            // Não falhar a criação da nota se houver erro ao associar questões
          }
        }

        // Limpar o rascunho do localStorage após salvar com sucesso
        localStorage.removeItem('draftNote');

        setMessage({ type: 'success', text: 'Nota criada com sucesso!' });
        setTimeout(() => {
          router.push('/dashboard/notes');
        }, 1500);
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || 'Erro ao criar a nota' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Erro ao criar a nota. Tente novamente.' });
    } finally {
      setFormLoading(false);
    }
  };

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
          <h1 className="text-3xl font-bold text-gray-800">Nova Nota</h1>
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

      <form onSubmit={handleSubmit}>
        {/* Abas */}
        <div className="border-b border-gray-200 bg-gray-100 mb-6">
          <nav className="flex gap-1" aria-label="Abas">
            <button
              type="button"
              onClick={() => setTab('fontes')}
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
              onClick={() => setTab('conteudo')}
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
              onClick={() => setTab('estudio')}
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

        {/* Conteúdo da aba Fontes */}
        {activeTab === 'fontes' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-6">
            {/* Seção expansível Usar Agentes */}
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setUsarAgentesExpanded((v) => !v)}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 border-b border-gray-200 transition text-left"
                aria-expanded={usarAgentesExpanded}
              >
                <span className="font-medium text-gray-800">Usar Agentes</span>
                {usarAgentesExpanded ? (
                  <ChevronUp className="w-5 h-5 text-gray-500 shrink-0" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-500 shrink-0" />
                )}
              </button>
              {usarAgentesExpanded && (
                <div className="p-4 space-y-4 bg-white">
                  <p className="text-base text-gray-800">
                    Faça upload de um arquivo para que nossos agentes possam criar uma nota para você.
                  </p>

                  <input
                    ref={fonteFileInputRef}
                    type="file"
                    className="hidden"
                    accept=""
                    onChange={(e) => {
                      const selected = e.target.files;
                      if (selected?.length) {
                        setPendingFonteFiles(Array.from(selected));
                        setShowResumoAulasModal(true);
                      }
                      e.target.value = '';
                    }}
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (fonteFileInputRef.current) {
                          fonteFileInputRef.current.accept = 'video/*';
                          fonteFileInputRef.current.click();
                        }
                      }}
                      className="px-4 py-3 bg-sky-50 border border-sky-200 rounded-lg text-gray-700 hover:bg-sky-100 hover:border-sky-300 transition font-medium text-center"
                    >
                      Vídeos
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (fonteFileInputRef.current) {
                          fonteFileInputRef.current.accept = 'audio/*';
                          fonteFileInputRef.current.click();
                        }
                      }}
                      className="px-4 py-3 bg-sky-50 border border-sky-200 rounded-lg text-gray-700 hover:bg-sky-100 hover:border-sky-300 transition font-medium text-center"
                    >
                      Áudios
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (fonteFileInputRef.current) {
                          fonteFileInputRef.current.accept = '.pdf,application/pdf';
                          fonteFileInputRef.current.click();
                        }
                      }}
                      className="px-4 py-3 bg-sky-50 border border-sky-200 rounded-lg text-gray-700 hover:bg-sky-100 hover:border-sky-300 transition font-medium text-center"
                    >
                      Documento PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (fonteFileInputRef.current) {
                          fonteFileInputRef.current.accept = '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
                          fonteFileInputRef.current.click();
                        }
                      }}
                      className="px-4 py-3 bg-sky-50 border border-sky-200 rounded-lg text-gray-700 hover:bg-sky-100 hover:border-sky-300 transition font-medium text-center"
                    >
                      Documento Word
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (fonteFileInputRef.current) {
                          fonteFileInputRef.current.accept = '.ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation';
                          fonteFileInputRef.current.click();
                        }
                      }}
                      className="px-4 py-3 bg-sky-50 border border-sky-200 rounded-lg text-gray-700 hover:bg-sky-100 hover:border-sky-300 transition font-medium text-center"
                    >
                      Apresentação de Slides
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (fonteFileInputRef.current) {
                          fonteFileInputRef.current.accept = 'image/*';
                          fonteFileInputRef.current.click();
                        }
                      }}
                      className="px-4 py-3 bg-sky-50 border border-sky-200 rounded-lg text-gray-700 hover:bg-sky-100 hover:border-sky-300 transition font-medium text-center"
                    >
                      Imagens
                    </button>
                  </div>

                  <div className="pt-2 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={() => {
                        setPendingFonteFiles([]);
                        setShowResumoAulasModal(true);
                      }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition font-medium"
                    >
                      Transformando Arquivos com IA
                    </button>
                  </div>
                </div>
              )}
            </div>

            {(resumoAulas.melhorado || resumoAulas.original) && (
              <div className="rounded-lg border-2 border-gray-200 overflow-hidden bg-white">
                <p className="text-xs text-gray-500 px-4 pt-3 pb-1">
                  Selecione a estrela para definir qual conteúdo será usado no conteúdo da nota.
                </p>
                <div className="flex gap-1 p-1.5 bg-gray-100 border-b border-gray-200">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setResumoAulasSubTab('melhorado')}
                    className={`flex-1 px-4 py-3 text-sm font-semibold rounded-md transition flex items-center justify-between gap-2 cursor-pointer ${
                      resumoAulasSubTab === 'melhorado'
                        ? 'bg-white text-primary-600 shadow-sm ring-2 ring-primary-500/30'
                        : 'text-gray-500 bg-transparent hover:bg-gray-200 hover:text-gray-700'
                    }`}
                  >
                    <span>
                      <span className="block">Arquivo transformado pela IA</span>
                      <span className="block text-xs font-normal opacity-90 mt-0.5">Melhorado</span>
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setResumoAulasSelectedForNote('melhorado');
                        setFormData((prev) => ({ ...prev, informacoes: resumoAulas.melhorado || prev.informacoes }));
                      }}
                      className="p-1.5 rounded hover:bg-primary-50 transition shrink-0"
                      aria-label="Usar este conteúdo no conteúdo da nota"
                      title="Usar este conteúdo no conteúdo da nota"
                    >
                      <Star
                        className={`w-5 h-5 ${
                          resumoAulasSelectedForNote === 'melhorado'
                            ? 'fill-amber-400 text-amber-500'
                            : 'text-gray-400 hover:text-amber-500/70'
                        }`}
                      />
                    </button>
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setResumoAulasSubTab('original')}
                    className={`flex-1 px-4 py-3 text-sm font-semibold rounded-md transition flex items-center justify-between gap-2 cursor-pointer ${
                      resumoAulasSubTab === 'original'
                        ? 'bg-white text-primary-600 shadow-sm ring-2 ring-primary-500/30'
                        : 'text-gray-500 bg-transparent hover:bg-gray-200 hover:text-gray-700'
                    }`}
                  >
                    <span>
                      <span className="block">Arquivo original</span>
                      <span className="block text-xs font-normal opacity-90 mt-0.5">Original</span>
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setResumoAulasSelectedForNote('original');
                        setFormData((prev) => ({ ...prev, informacoes: resumoAulas.original || prev.informacoes }));
                      }}
                      className="p-1.5 rounded hover:bg-primary-50 transition shrink-0"
                      aria-label="Usar este conteúdo no conteúdo da nota"
                      title="Usar este conteúdo no conteúdo da nota"
                    >
                      <Star
                        className={`w-5 h-5 ${
                          resumoAulasSelectedForNote === 'original'
                            ? 'fill-amber-400 text-amber-500'
                            : 'text-gray-400 hover:text-amber-500/70'
                        }`}
                      />
                    </button>
                  </div>
                </div>
                <div className="p-4 min-h-[120px] bg-gray-50/50">
                  {resumoAulasSubTab === 'melhorado' && (
                    <div className="text-sm text-gray-800 whitespace-pre-wrap max-h-80 overflow-y-auto">
                      {resumoAulas.melhorado || '—'}
                    </div>
                  )}
                  {resumoAulasSubTab === 'original' && (
                    <div className="text-sm text-gray-800 whitespace-pre-wrap max-h-80 overflow-y-auto">
                      {resumoAulas.original || '—'}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label htmlFor="source-title" className="block text-sm font-medium text-gray-700 mb-2">
                  Título da Fonte
                </label>
                <input
                  type="text"
                  id="source-title"
                  placeholder="Ex: Artigo científico, livro, site..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div>
                <label htmlFor="source-url" className="block text-sm font-medium text-gray-700 mb-2">
                  URL (opcional)
                </label>
                <input
                  type="url"
                  id="source-url"
                  placeholder="https://..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div>
                <label htmlFor="source-notes" className="block text-sm font-medium text-gray-700 mb-2">
                  Notas sobre a fonte
                </label>
                <textarea
                  id="source-notes"
                  placeholder="Adicione observações ou citações relevantes desta fonte..."
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-y"
                />
              </div>

              <button
                type="button"
                className="w-full px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-primary-500 hover:text-primary-600 transition"
              >
                + Adicionar outra fonte
              </button>
            </div>
          </div>
        )}

        {/* Conteúdo da aba Nota: input de conteúdo no topo, sub-abas abaixo */}
        {activeTab === 'conteudo' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6 space-y-6">
              <div>
                <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                  Título
                </label>
                <input
                  type="text"
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Título da sua nota"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label htmlFor="informacoes" className="block text-sm font-medium text-gray-700 mb-2">
                  Conteúdo
                </label>
                <textarea
                  id="informacoes"
                  value={formData.informacoes}
                  onChange={(e) => setFormData({ ...formData, informacoes: e.target.value })}
                  placeholder="Conteúdo da nota. O texto do Transformando Arquivos com IA (melhorado) pode ser adicionado aqui a partir da aba Fontes."
                  rows={14}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-y"
                />
              </div>
            </div>
            <nav className="flex gap-2 p-2 border-t border-b-2 border-gray-200 bg-gray-100 px-6 pt-4">
              <button
                type="button"
                onClick={() => setActiveNotaSubTab((prev) => (prev === 'imagens' ? null : 'imagens'))}
                className={`flex-1 px-4 py-3 text-base font-semibold rounded-lg transition flex items-center justify-center gap-2 ${
                  activeNotaSubTab === 'imagens'
                    ? 'bg-white text-primary-700 shadow-md border-4 border-primary-600/75'
                    : 'bg-gray-200/80 text-gray-500 hover:bg-gray-300 hover:text-gray-700 border-2 border-transparent'
                }`}
              >
                <ImageIcon className="w-5 h-5 flex-shrink-0" />
                Imagens
              </button>
              <button
                type="button"
                onClick={() => setActiveNotaSubTab((prev) => (prev === 'descricao' ? null : 'descricao'))}
                className={`flex-1 px-4 py-3 text-base font-semibold rounded-lg transition ${
                  activeNotaSubTab === 'descricao'
                    ? 'bg-white text-primary-700 shadow-md border-4 border-primary-600/75'
                    : 'bg-gray-200/80 text-gray-500 hover:bg-gray-300 hover:text-gray-700 border-2 border-transparent'
                }`}
              >
                Descrição
              </button>
              <button
                type="button"
                onClick={() => setActiveNotaSubTab((prev) => (prev === 'classificacao' ? null : 'classificacao'))}
                className={`flex-1 px-4 py-3 text-base font-semibold rounded-lg transition ${
                  activeNotaSubTab === 'classificacao'
                    ? 'bg-white text-primary-700 shadow-md border-4 border-primary-600/75'
                    : 'bg-gray-200/80 text-gray-500 hover:bg-gray-300 hover:text-gray-700 border-2 border-transparent'
                }`}
              >
                Classificação
              </button>
            </nav>
            {activeNotaSubTab != null && (
            <div className="p-6 bg-gray-50/30">
              {activeNotaSubTab === 'imagens' && (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => setShowImagensModal(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 hover:border-primary-400 transition"
                  >
                    <ImageIcon className="w-5 h-5 text-gray-500" />
                    {formData.images.length === 0
                      ? 'Adicionar imagens'
                      : `${formData.images.length} imagem(ns) adicionada(s)`}
                  </button>
                  {formData.images.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-3">Clique em uma imagem para ampliar</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                        {formData.images.map((image, index) => (
                          <ImageLightbox
                            key={index}
                            src={image}
                            alt={`Preview ${index + 1}`}
                            className="w-full h-28"
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {activeNotaSubTab === 'descricao' && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-500">
                    O título e o conteúdo da nota estão acima.
                  </p>
                  <div>
                    <label htmlFor="tipo-conteudo" className="block text-sm font-medium text-gray-700 mb-2">
                      Tipo de conteúdo da nota
                    </label>
                    <input
                      type="text"
                      id="tipo-conteudo"
                      value={formData.tipoConteudo}
                      onChange={(e) => setFormData({ ...formData, tipoConteudo: e.target.value })}
                      placeholder="Ex.: resumo de aula, caso clínico, anotação de artigo..."
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                </div>
              )}
              {activeNotaSubTab === 'classificacao' && (
                <div className="space-y-6">
                  <div className="space-y-4 w-full">
                    <div className="w-full">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Área do Conhecimento
                      </label>
                      <TagAutocomplete
                        options={AREAS_OPTIONS_DISPLAY}
                        selectedTags={formData.areasConhecimento.map(toDisplayArea)}
                        onChange={(tags) => setFormData({ ...formData, areasConhecimento: tags.map(fromDisplay) })}
                        onSaveNewTag={() => {}}
                        placeholder="Selecione áreas do conhecimento..."
                      />
                    </div>
                    <div className="w-full">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Assunto
                      </label>
                      <TagAutocomplete
                        options={assuntosOptions.map(toDisplayAssunto)}
                        selectedTags={formData.assuntos.map(toDisplayAssunto)}
                        onChange={(tags) => setFormData({ ...formData, assuntos: tags.map(fromDisplay) })}
                        onSaveNewTag={() => {}}
                        placeholder={formData.areasConhecimento.length === 0 ? 'Selecione uma área do conhecimento primeiro' : 'Selecione assuntos...'}
                      />
                    </div>
                  </div>
                  <div>
                    <TagAutocomplete
                      options={availableTags}
                      selectedTags={formData.tags}
                      onChange={(tags) => setFormData({ ...formData, tags })}
                      onSaveNewTag={(newTag) => {
                        if (!availableTags.includes(newTag)) {
                          setAvailableTags([...availableTags, newTag]);
                        }
                      }}
                      label="Tags ou Especialidade"
                      placeholder="Digite para buscar tags..."
                    />
                  </div>
                </div>
              )}
            </div>
            )}
          </div>
        )}

        {/* Conteúdo da aba Estúdio */}
        {activeTab === 'estudio' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
            <p className="text-sm text-gray-600 mb-4">
              Utilize ferramentas de IA e recursos avançados para aprimorar e enriquecer sua nota.
            </p>

            <div className="space-y-3">
              <div className="w-full p-4 border border-gray-300 rounded-lg bg-white">
                <div className="font-semibold text-gray-800 mb-3">
                  Buscar Questões
                </div>
                <div className="flex items-center justify-center">
                  {formData.tags.length > 0 && questionsCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        const tagsParam = encodeURIComponent(JSON.stringify(formData.tags));
                        router.push(`/dashboard/notes/select-questions?tags=${tagsParam}`);
                      }}
                      className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition text-sm font-medium"
                    >
                      Questões encontradas ({questionsCount})
                    </button>
                  ) : (
                    <p className="text-xs text-gray-500 text-center">
                      Selecione tags na nota para buscar questões
                    </p>
                  )}
                </div>
              </div>

              <button
                type="button"
                className="w-full p-4 border border-gray-300 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition text-left"
              >
                <div className="font-semibold text-gray-800 mb-1">Melhorar Texto</div>
                <div className="text-sm text-gray-600">
                  Use IA para aprimorar a clareza e estrutura do texto
                </div>
              </button>

              <button
                type="button"
                className="w-full p-4 border border-gray-300 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition text-left"
              >
                <div className="font-semibold text-gray-800 mb-1">Gerar Resumo</div>
                <div className="text-sm text-gray-600">
                  Crie um resumo executivo da sua nota automaticamente
                </div>
              </button>

              <button
                type="button"
                className="w-full p-4 border border-gray-300 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition text-left"
              >
                <div className="font-semibold text-gray-800 mb-1">Sugerir Tags</div>
                <div className="text-sm text-gray-600">
                  Obtenha sugestões de tags relevantes para organização
                </div>
              </button>

              <button
                type="button"
                className="w-full p-4 border border-gray-300 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition text-left"
              >
                <div className="font-semibold text-gray-800 mb-1">Expandir Conteúdo</div>
                <div className="text-sm text-gray-600">
                  Adicione mais detalhes e contexto ao seu texto
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Botões de Ação - visíveis em todas as abas */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem('draftNote');
              router.back();
            }}
            className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={formLoading}
            className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {formLoading ? 'Salvando...' : 'Salvar Nota'}
          </button>
        </div>
      </form>

      {/* Modal de Adicionar Imagens */}
      {showImagensModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex-shrink-0 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-800">Adicionar imagens</h2>
              <button
                type="button"
                onClick={() => setShowImagensModal(false)}
                className="p-2 rounded-lg hover:bg-gray-100 transition"
                aria-label="Fechar"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                className="hidden"
                id="modal-image-upload"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-2 py-6 border-2 border-dashed border-gray-300 rounded-lg hover:border-primary-400 hover:bg-primary-50/30 transition"
              >
                <ImageIcon className="w-12 h-12 text-gray-400" />
                <span className="text-sm font-medium text-gray-600">
                  Clique para selecionar imagens
                </span>
                <span className="text-xs text-gray-500">
                  PNG, JPG, GIF até 10MB
                </span>
              </button>

              {formData.images.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-3">
                    Imagens adicionadas ({formData.images.length})
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {formData.images.map((image, index) => (
                      <div key={index} className="relative group">
                        <ImageLightbox
                          src={image}
                          alt={`Preview ${index + 1}`}
                          className="w-full h-28"
                        />
                        <button
                          type="button"
                          onClick={() => removeImage(index)}
                          className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Remover imagem"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex-shrink-0 border-t border-gray-200 px-6 py-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShowImagensModal(false)}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
              >
                Concluído
              </button>
            </div>
          </div>
        </div>
      )}

      <ResumoAulasModal
        isOpen={showResumoAulasModal}
        onClose={() => {
          setShowResumoAulasModal(false);
          setPendingFonteFiles([]);
          setPendingFonteLink('');
        }}
        title="Transformando Arquivos com IA"
        initialFiles={pendingFonteFiles.length > 0 ? pendingFonteFiles : undefined}
        initialLink={pendingFonteLink || undefined}
        onSaveResumo={(melhorado, original, fileNames) => {
          setResumoAulas({ melhorado, original });
          setFontesArquivosNames(fileNames ?? []);
          setResumoAulasSelectedForNote('melhorado');
          setFormData((prev) => ({ ...prev, informacoes: melhorado }));
          setShowResumoAulasModal(false);
          setPendingFonteFiles([]);
          setPendingFonteLink('');
        }}
      />
    </div>
  );
}

export default function NewNotePage() {
  return (
    <Suspense fallback={null}>
      <NewNotePageContent />
    </Suspense>
  );
}
