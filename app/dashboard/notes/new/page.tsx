'use client';

import { Suspense, useState, useRef, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, X, Image as ImageIcon, ChevronDown, ChevronUp, Star,
  ChevronLeft, ChevronRight, Plus, FileText, BookOpen, Sparkles,
} from 'lucide-react';
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
  'Acupuntura', 'Anestesiologia', 'Cirurgia Cardiovascular', 'Cirurgia Geral',
  'Cirurgia Vascular', 'Clínica Médica', 'Dermatologia', 'Genética Médica',
  'Ginecologia e Obstetrícia', 'Homeopatia', 'Infectologia', 'Medicina de Emergência',
  'Medicina de Família e Comunidade', 'Medicina de Tráfego', 'Medicina do Trabalho',
  'Medicina Esportiva', 'Medicina Física e Reabilitação', 'Medicina Intensiva',
  'Medicina Legal e Perícia Médica', 'Medicina Nuclear', 'Medicina Preventiva e Social',
  'Neurocirurgia', 'Neurologia', 'Oftalmologia', 'Ortopedia e Traumatologia',
  'Otorrinolaringologia', 'Patologia', 'Patologia Clínica / Medicina Laboratorial',
  'Pediatria', 'Psiquiatria', 'Radiologia e Diagnóstico por Imagem', 'Radioterapia',
];

type NotaSubTabId = 'imagens' | 'descricao' | 'classificacao';

function NewNotePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get('tab');

  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const [availableTags, setAvailableTags] = useState<string[]>(AVAILABLE_TAGS);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    informacoes: '',
    tipoConteudo: '',
    tags: [] as string[],
    areasConhecimento: [] as string[],
    assuntos: [] as string[],
    images: [] as string[],
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
    setFormData((prev) => ({ ...prev, assuntos: prev.assuntos.filter((a) => opcoes.has(a)) }));
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
    if (typeof window !== 'undefined') return localStorage.getItem('token');
    return null;
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedDraft = localStorage.getItem('draftNote');
      if (savedDraft) {
        try {
          const d = JSON.parse(savedDraft);
          setFormData({
            title: d.title || '', description: d.description || '',
            informacoes: d.informacoes || '', tipoConteudo: d.tipoConteudo || '',
            tags: d.tags || [], areasConhecimento: d.areasConhecimento || [],
            assuntos: d.assuntos || [], images: d.images || [],
          });
          if (d.resumoAulas && (d.resumoAulas.melhorado || d.resumoAulas.original)) {
            setResumoAulas({ melhorado: d.resumoAulas.melhorado || '', original: d.resumoAulas.original || '' });
            const sel = d.resumoAulasSelectedForNote as 'melhorado' | 'original' | undefined;
            if (sel === 'melhorado' || sel === 'original') setResumoAulasSelectedForNote(sel);
            if (Array.isArray(d.fontesArquivosNames) && d.fontesArquivosNames.length > 0) {
              setFontesArquivosNames(d.fontesArquivosNames);
            }
          }
        } catch { /* ignore */ }
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || tabFromUrl !== 'fontes') return;
    const raw = sessionStorage.getItem('pendingTransformFiles');
    if (!raw) return;
    sessionStorage.removeItem('pendingTransformFiles');
    try {
      const parsed = JSON.parse(raw);
      const items: { name: string; type: string; dataUrl: string }[] = Array.isArray(parsed) ? parsed : (parsed.files ?? []);
      const link = Array.isArray(parsed) ? '' : (parsed.link ?? '');
      if (items.length === 0 && !link.trim()) return;
      if (items.length === 0) { setPendingFonteLink(link); setPendingFonteFiles([]); setShowResumoAulasModal(true); return; }
      Promise.all(items.map((item) =>
        fetch(item.dataUrl).then((r) => r.blob()).then((blob) => new File([blob], item.name, { type: item.type }))
      )).then((files) => { setPendingFonteFiles(files); setPendingFonteLink(link); setShowResumoAulasModal(true); });
    } catch { /* ignore */ }
  }, [tabFromUrl]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hasContent = formData.title || formData.description || formData.informacoes || formData.tipoConteudo ||
        formData.tags.length > 0 || formData.areasConhecimento.length > 0 || formData.assuntos.length > 0 ||
        formData.images.length > 0 || resumoAulas.melhorado || resumoAulas.original;
      if (hasContent) {
        localStorage.setItem('draftNote', JSON.stringify({ ...formData, resumoAulas, resumoAulasSelectedForNote, fontesArquivosNames }));
      } else {
        localStorage.removeItem('draftNote');
      }
    }
  }, [formData, resumoAulas, resumoAulasSelectedForNote, fontesArquivosNames]);

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

  useEffect(() => {
    const fetch_ = async () => {
      if (formData.tags.length === 0) { setQuestionsCount(0); return; }
      try {
        const token = getToken();
        if (!token) return;
        const res = await fetch(`/api/questions/by-tags?tags=${encodeURIComponent(JSON.stringify(formData.tags))}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) { const q = await res.json(); setQuestionsCount(q.length); }
      } catch { /* ignore */ }
    };
    fetch_();
  }, [formData.tags]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setMessage(null);
    try {
      const token = getToken();
      if (!token) { setMessage({ type: 'error', text: 'Não autorizado' }); return; }
      const response = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: formData.title, description: formData.informacoes || formData.description || '',
          tags: formData.tags, images: formData.images,
          areas_conhecimento: formData.areasConhecimento, assuntos: formData.assuntos,
          fontes_resumo_melhorado: resumoAulas.melhorado || undefined,
          fontes_resumo_original: resumoAulas.original || undefined,
          fontes_arquivos: fontesArquivosNames.length > 0 ? fontesArquivosNames : undefined,
        }),
      });
      if (response.ok) {
        const noteData = await response.json();
        const selectedQuestionIdsStr = localStorage.getItem('selectedQuestionIds');
        if (selectedQuestionIdsStr) {
          try {
            const ids = JSON.parse(selectedQuestionIdsStr);
            if (Array.isArray(ids) && ids.length > 0) {
              const assocRes = await fetch(`/api/notes/${noteData.id}/questions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ question_ids: ids }),
              });
              if (assocRes.ok) localStorage.removeItem('selectedQuestionIds');
            }
          } catch { /* ignore */ }
        }
        localStorage.removeItem('draftNote');
        setMessage({ type: 'success', text: 'Nota criada com sucesso!' });
        setTimeout(() => router.push('/dashboard/notes'), 1500);
      } else {
        const err = await response.json();
        setMessage({ type: 'error', text: err.error || 'Erro ao criar a nota' });
      }
    } catch { setMessage({ type: 'error', text: 'Erro ao criar a nota. Tente novamente.' }); }
    finally { setFormLoading(false); }
  };

  const openAgentUpload = (accept: string) => {
    if (fonteFileInputRef.current) {
      fonteFileInputRef.current.accept = accept;
      fonteFileInputRef.current.click();
    }
  };

  return (
    <div className="-m-3 sm:-m-4 md:-m-3 flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 52px)' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white shadow-sm gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => router.back()}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition flex-shrink-0"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-4 h-4 text-gray-600" />
          </button>
          <span className="text-base font-semibold text-gray-800 truncate">Nova Nota</span>
        </div>

        {message && (
          <div className={`text-xs px-3 py-1.5 rounded-full flex-shrink-0 ${
            message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message.text}
          </div>
        )}

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => { localStorage.removeItem('draftNote'); router.back(); }}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="nota-form"
            disabled={formLoading}
            className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
          >
            {formLoading ? 'Salvando...' : 'Salvar Nota'}
          </button>
        </div>
      </header>

      {/* ── Three-column layout ─────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ── LEFT: Fontes ─────────────────────────────────────────────── */}
        <div
          className={`flex flex-col border-r border-gray-200 bg-white flex-shrink-0 transition-all duration-200 ${
            leftCollapsed ? 'w-10' : 'w-72'
          }`}
        >
          <div className="flex items-center justify-between px-2 py-2.5 border-b border-gray-200 flex-shrink-0">
            {!leftCollapsed && (
              <div className="flex items-center gap-1.5 min-w-0">
                <BookOpen className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                <span className="text-sm font-semibold text-gray-700 truncate">Fontes</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setLeftCollapsed((v) => !v)}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition ml-auto flex-shrink-0"
              title={leftCollapsed ? 'Expandir fontes' : 'Recolher fontes'}
            >
              {leftCollapsed
                ? <ChevronRight className="w-4 h-4 text-gray-500" />
                : <ChevronLeft className="w-4 h-4 text-gray-500" />}
            </button>
          </div>

          {!leftCollapsed && (
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {/* Add source button */}
              <button
                type="button"
                onClick={() => { setPendingFonteFiles([]); setShowResumoAulasModal(true); }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border-2 border-dashed border-gray-300 rounded-lg text-xs font-medium text-gray-600 hover:border-primary-400 hover:text-primary-600 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                Adicionar fonte
              </button>

              {/* Source list */}
              {fontesArquivosNames.length > 0 ? (
                <div className="space-y-1">
                  {fontesArquivosNames.map((name, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition group cursor-default"
                    >
                      <FileText className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span className="text-xs text-gray-700 truncate">{name}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 text-center py-2">Nenhuma fonte adicionada</p>
              )}

              {/* AI summary from sources */}
              {(resumoAulas.melhorado || resumoAulas.original) && (
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <div className="text-xs text-gray-500 px-3 pt-2.5 pb-1">
                    Selecione ★ para usar no conteúdo da nota
                  </div>
                  <div className="flex gap-1 p-1 bg-gray-100 border-b border-gray-200">
                    {(['melhorado', 'original'] as const).map((st) => (
                      <div
                        key={st}
                        role="button"
                        tabIndex={0}
                        onClick={() => setResumoAulasSubTab(st)}
                        className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition flex items-center justify-between gap-1 cursor-pointer ${
                          resumoAulasSubTab === st
                            ? 'bg-white text-primary-600 shadow-sm ring-1 ring-primary-400/30'
                            : 'text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        <span>{st === 'melhorado' ? 'Melhorado' : 'Original'}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setResumoAulasSelectedForNote(st);
                            setFormData((prev) => ({
                              ...prev,
                              informacoes: st === 'melhorado' ? resumoAulas.melhorado : resumoAulas.original,
                            }));
                          }}
                          className="p-0.5 rounded hover:bg-primary-50 transition"
                          title="Usar no conteúdo da nota"
                        >
                          <Star className={`w-3.5 h-3.5 ${
                            resumoAulasSelectedForNote === st ? 'fill-amber-400 text-amber-500' : 'text-gray-400 hover:text-amber-400'
                          }`} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="p-2.5 max-h-40 overflow-y-auto">
                    <p className="text-xs text-gray-700 whitespace-pre-wrap">
                      {resumoAulasSubTab === 'melhorado' ? resumoAulas.melhorado : resumoAulas.original}
                    </p>
                  </div>
                </div>
              )}

              {/* Usar Agentes */}
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setUsarAgentesExpanded((v) => !v)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 transition text-left"
                  aria-expanded={usarAgentesExpanded}
                >
                  <span className="text-xs font-semibold text-gray-700">Usar Agentes</span>
                  {usarAgentesExpanded
                    ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                    : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                </button>

                {usarAgentesExpanded && (
                  <div className="p-2.5 space-y-1.5 bg-white">
                    <input
                      ref={fonteFileInputRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const selected = e.target.files;
                        if (selected?.length) { setPendingFonteFiles(Array.from(selected)); setShowResumoAulasModal(true); }
                        e.target.value = '';
                      }}
                    />
                    {[
                      { label: 'Vídeos', accept: 'video/*' },
                      { label: 'Áudios', accept: 'audio/*' },
                      { label: 'PDF', accept: '.pdf,application/pdf' },
                      { label: 'Word', accept: '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
                      { label: 'Slides', accept: '.ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation' },
                      { label: 'Imagens', accept: 'image/*' },
                    ].map(({ label, accept }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => openAgentUpload(accept)}
                        className="w-full px-3 py-1.5 bg-sky-50 border border-sky-200 rounded-lg text-xs text-gray-700 hover:bg-sky-100 hover:border-sky-300 transition font-medium text-left"
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => { setPendingFonteFiles([]); setShowResumoAulasModal(true); }}
                      className="w-full px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs font-medium hover:bg-primary-700 transition"
                    >
                      Transformar com IA
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── CENTER: Editor ───────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-gray-50">
          <form id="nota-form" onSubmit={handleSubmit} className="flex flex-col h-full min-h-0">
            <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4">
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Título da sua nota"
                className="w-full text-2xl font-bold bg-transparent border-0 border-b-2 border-transparent focus:border-primary-400 focus:outline-none text-gray-800 pb-2 transition placeholder:text-gray-300"
                required
              />
              <textarea
                value={formData.informacoes}
                onChange={(e) => setFormData({ ...formData, informacoes: e.target.value })}
                placeholder="Comece a escrever sua nota aqui..."
                className="w-full bg-transparent border-0 focus:outline-none text-gray-700 resize-none text-sm leading-relaxed placeholder:text-gray-300"
                style={{ minHeight: '320px' }}
              />
            </div>

            {/* Bottom sub-tabs */}
            <div className="flex-shrink-0 border-t border-gray-200 bg-white">
              <nav className="flex gap-0.5 px-4 pt-2">
                {([
                  { id: 'imagens' as NotaSubTabId, label: 'Imagens' },
                  { id: 'descricao' as NotaSubTabId, label: 'Descrição' },
                  { id: 'classificacao' as NotaSubTabId, label: 'Classificação' },
                ]).map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveNotaSubTab((prev) => (prev === id ? null : id))}
                    className={`px-4 py-2 text-xs font-medium rounded-t-lg transition border-b-2 ${
                      activeNotaSubTab === id
                        ? 'text-primary-600 border-primary-500 bg-gray-50'
                        : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {id === 'imagens' && <ImageIcon className="w-3.5 h-3.5 inline-block mr-1 align-middle" />}
                    {label}
                  </button>
                ))}
              </nav>

              {activeNotaSubTab !== null && (
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 max-h-72 overflow-y-auto">
                  {activeNotaSubTab === 'imagens' && (
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => setShowImagensModal(true)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 hover:border-primary-400 transition"
                      >
                        <ImageIcon className="w-4 h-4 text-gray-500" />
                        {formData.images.length === 0
                          ? 'Adicionar imagens'
                          : `${formData.images.length} imagem(ns)`}
                      </button>
                      {formData.images.length > 0 && (
                        <div className="grid grid-cols-4 gap-2">
                          {formData.images.map((img, i) => (
                            <ImageLightbox key={i} src={img} alt={`Preview ${i + 1}`} className="w-full h-20" />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {activeNotaSubTab === 'descricao' && (
                    <div className="space-y-3">
                      <label className="block text-xs font-medium text-gray-700">
                        Tipo de conteúdo
                        <input
                          type="text"
                          value={formData.tipoConteudo}
                          onChange={(e) => setFormData({ ...formData, tipoConteudo: e.target.value })}
                          placeholder="Ex.: resumo de aula, caso clínico, anotação de artigo..."
                          className="mt-1 w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                      </label>
                    </div>
                  )}

                  {activeNotaSubTab === 'classificacao' && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Área do Conhecimento</label>
                        <TagAutocomplete
                          options={AREAS_OPTIONS_DISPLAY}
                          selectedTags={formData.areasConhecimento.map(toDisplayArea)}
                          onChange={(tags) => setFormData({ ...formData, areasConhecimento: tags.map(fromDisplay) })}
                          onSaveNewTag={() => {}}
                          placeholder="Selecione áreas..."
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Assunto</label>
                        <TagAutocomplete
                          options={assuntosOptions.map(toDisplayAssunto)}
                          selectedTags={formData.assuntos.map(toDisplayAssunto)}
                          onChange={(tags) => setFormData({ ...formData, assuntos: tags.map(fromDisplay) })}
                          onSaveNewTag={() => {}}
                          placeholder={formData.areasConhecimento.length === 0 ? 'Selecione uma área primeiro' : 'Selecione assuntos...'}
                        />
                      </div>
                      <div>
                        <TagAutocomplete
                          options={availableTags}
                          selectedTags={formData.tags}
                          onChange={(tags) => setFormData({ ...formData, tags })}
                          onSaveNewTag={(t) => { if (!availableTags.includes(t)) setAvailableTags([...availableTags, t]); }}
                          label="Tags / Especialidade"
                          placeholder="Digite para buscar tags..."
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </form>
        </div>

        {/* ── RIGHT: Estúdio ───────────────────────────────────────────── */}
        <div
          className={`flex flex-col border-l border-gray-200 bg-white flex-shrink-0 transition-all duration-200 ${
            rightCollapsed ? 'w-10' : 'w-72'
          }`}
        >
          <div className="flex items-center justify-between px-2 py-2.5 border-b border-gray-200 flex-shrink-0">
            <button
              type="button"
              onClick={() => setRightCollapsed((v) => !v)}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition flex-shrink-0"
              title={rightCollapsed ? 'Expandir estúdio' : 'Recolher estúdio'}
            >
              {rightCollapsed
                ? <ChevronLeft className="w-4 h-4 text-gray-500" />
                : <ChevronRight className="w-4 h-4 text-gray-500" />}
            </button>
            {!rightCollapsed && (
              <div className="flex items-center gap-1.5 min-w-0 mr-auto ml-1">
                <Sparkles className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                <span className="text-sm font-semibold text-gray-700 truncate">Estúdio</span>
              </div>
            )}
          </div>

          {!rightCollapsed && (
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {/* Buscar Questões */}
              <div className="rounded-lg border border-gray-200 p-3 bg-white space-y-2">
                <p className="text-xs font-semibold text-gray-700">Buscar Questões</p>
                {formData.tags.length > 0 && questionsCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      const tagsParam = encodeURIComponent(JSON.stringify(formData.tags));
                      router.push(`/dashboard/notes/select-questions?tags=${tagsParam}`);
                    }}
                    className="w-full px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs font-medium hover:bg-primary-700 transition"
                  >
                    Ver questões ({questionsCount})
                  </button>
                ) : (
                  <p className="text-xs text-gray-400">
                    Selecione tags na aba Classificação para buscar questões
                  </p>
                )}
              </div>

              {/* AI Tools */}
              {[
                { label: 'Melhorar Texto', desc: 'Aprimora clareza e estrutura' },
                { label: 'Gerar Resumo', desc: 'Cria um resumo executivo' },
                { label: 'Sugerir Tags', desc: 'Sugere tags de organização' },
                { label: 'Expandir Conteúdo', desc: 'Adiciona mais detalhes' },
              ].map(({ label, desc }) => (
                <button
                  key={label}
                  type="button"
                  className="w-full p-3 border border-gray-200 rounded-lg hover:border-primary-400 hover:bg-primary-50 transition text-left group"
                >
                  <p className="text-xs font-semibold text-gray-800 group-hover:text-primary-700">{label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Modal: Adicionar Imagens ─────────────────────────────────────── */}
      {showImagensModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex-shrink-0 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-800">Adicionar imagens</h2>
              <button type="button" onClick={() => setShowImagensModal(false)} className="p-2 rounded-lg hover:bg-gray-100 transition" aria-label="Fechar">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-2 py-6 border-2 border-dashed border-gray-300 rounded-lg hover:border-primary-400 hover:bg-primary-50/30 transition"
              >
                <ImageIcon className="w-12 h-12 text-gray-400" />
                <span className="text-sm font-medium text-gray-600">Clique para selecionar imagens</span>
                <span className="text-xs text-gray-500">PNG, JPG, GIF até 10MB</span>
              </button>
              {formData.images.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-3">Imagens adicionadas ({formData.images.length})</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {formData.images.map((image, index) => (
                      <div key={index} className="relative group">
                        <ImageLightbox src={image} alt={`Preview ${index + 1}`} className="w-full h-28" />
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
              <button type="button" onClick={() => setShowImagensModal(false)} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition">
                Concluído
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: ResumoAulas ─────────────────────────────────────────── */}
      <ResumoAulasModal
        isOpen={showResumoAulasModal}
        onClose={() => { setShowResumoAulasModal(false); setPendingFonteFiles([]); setPendingFonteLink(''); }}
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
