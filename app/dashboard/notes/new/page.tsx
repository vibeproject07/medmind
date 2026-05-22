'use client';

import { Suspense, useState, useRef, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, X, Image as ImageIcon, Star,
  Plus, FileText, BookOpen, Sparkles, Film, Music,
  Link as LinkIcon, ChevronDown, ChevronUp,
} from 'lucide-react';
import TagAutocomplete from '@/components/Common/TagAutocomplete';
import ImageLightbox from '@/components/Common/ImageLightbox';
import ResumoAulasModal from '@/components/Dashboard/ResumoAulasModal';
import {
  ASSUNTOS_BY_AREA, toDisplayArea, toDisplayAssunto,
  fromDisplay, AREAS_OPTIONS_DISPLAY,
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

const SOURCE_TYPES = [
  { label: 'PDF',    accept: '.pdf,application/pdf',                                          iconColor: 'text-red-500',    bgColor: 'bg-red-50    border-red-100   hover:border-red-300',   linkMode: false },
  { label: 'Word',   accept: '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document', iconColor: 'text-blue-500',   bgColor: 'bg-blue-50   border-blue-100  hover:border-blue-300',  linkMode: false },
  { label: 'Slides', accept: '.ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation', iconColor: 'text-orange-500', bgColor: 'bg-orange-50 border-orange-100 hover:border-orange-300', linkMode: false },
  { label: 'Vídeo',  accept: 'video/*',                                                       iconColor: 'text-purple-500', bgColor: 'bg-purple-50 border-purple-100 hover:border-purple-300', linkMode: false },
  { label: 'Áudio',  accept: 'audio/*',                                                       iconColor: 'text-pink-500',   bgColor: 'bg-pink-50   border-pink-100  hover:border-pink-300',  linkMode: false },
  { label: 'Imagem', accept: 'image/*',                                                       iconColor: 'text-green-500',  bgColor: 'bg-green-50  border-green-100 hover:border-green-300', linkMode: false },
  { label: 'Link',   accept: '',                                                               iconColor: 'text-cyan-500',   bgColor: 'bg-cyan-50   border-cyan-100  hover:border-cyan-300',  linkMode: true  },
];

function StepIndicator({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <div className={`flex items-center gap-1.5 ${step === 1 ? 'text-primary-700' : 'text-gray-400'}`}>
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
          step === 1 ? 'bg-primary-600 text-white' : 'bg-primary-100 text-primary-600'
        }`}>1</div>
        <span className="text-xs font-semibold whitespace-nowrap">Fontes</span>
      </div>
      <div className={`w-8 h-0.5 flex-shrink-0 mx-1 rounded ${step > 1 ? 'bg-primary-400' : 'bg-gray-200'}`} />
      <div className={`flex items-center gap-1.5 ${step === 2 ? 'text-primary-700' : 'text-gray-400'}`}>
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
          step === 2 ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'
        }`}>2</div>
        <span className="text-xs font-semibold whitespace-nowrap">Nota</span>
      </div>
    </div>
  );
}

function SourceTypeIcon({ type }: { type: typeof SOURCE_TYPES[number] }) {
  if (type.label === 'Vídeo') return <Film className={`w-5 h-5 ${type.iconColor}`} />;
  if (type.label === 'Áudio') return <Music className={`w-5 h-5 ${type.iconColor}`} />;
  if (type.label === 'Link')  return <LinkIcon className={`w-5 h-5 ${type.iconColor}`} />;
  if (type.label === 'Imagem') return <ImageIcon className={`w-5 h-5 ${type.iconColor}`} />;
  return <FileText className={`w-5 h-5 ${type.iconColor}`} />;
}

function NewNotePageContent() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const tabFromUrl   = searchParams.get('tab');

  const [step, setStep] = useState<1 | 2>(1);
  const [showLinkInput, setShowLinkInput] = useState(false);

  const [availableTags, setAvailableTags] = useState<string[]>(AVAILABLE_TAGS);
  const [formData, setFormData] = useState({
    title: '', description: '', informacoes: '', tipoConteudo: '',
    tags: [] as string[], areasConhecimento: [] as string[],
    assuntos: [] as string[], images: [] as string[],
  });
  const [resumoAulas, setResumoAulas]                             = useState({ melhorado: '', original: '' });
  const [resumoAulasSubTab, setResumoAulasSubTab]                 = useState<'melhorado' | 'original'>('melhorado');
  const [resumoAulasSelectedForNote, setResumoAulasSelectedForNote] = useState<'melhorado' | 'original' | null>(null);
  const [fontesArquivosNames, setFontesArquivosNames]             = useState<string[]>([]);
  const [linkInput, setLinkInput]                                 = useState('');
  const [classifExpanded, setClassifExpanded]                     = useState(true);
  const [imagesExpanded, setImagesExpanded]                       = useState(false);

  const assuntosOptions = useMemo(() => {
    if (formData.areasConhecimento.length === 0) return [];
    const set = new Set<string>();
    formData.areasConhecimento.forEach((area) => { ASSUNTOS_BY_AREA[area]?.forEach((a) => set.add(a)); });
    return Array.from(set);
  }, [formData.areasConhecimento]);

  useEffect(() => {
    if (formData.areasConhecimento.length === 0) { setFormData((p) => ({ ...p, assuntos: [] })); return; }
    const valid = new Set<string>();
    formData.areasConhecimento.forEach((area) => { ASSUNTOS_BY_AREA[area]?.forEach((a) => valid.add(a)); });
    setFormData((p) => ({ ...p, assuntos: p.assuntos.filter((a) => valid.has(a)) }));
  }, [formData.areasConhecimento]);

  const fileInputRef     = useRef<HTMLInputElement>(null);
  const fonteFileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFonteFiles, setPendingFonteFiles] = useState<File[]>([]);
  const [pendingFonteLink, setPendingFonteLink]   = useState('');
  const [formLoading, setFormLoading]             = useState(false);
  const [message, setMessage]                     = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showResumoAulasModal, setShowResumoAulasModal] = useState(false);

  const getToken = () => typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  // Restore draft
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('draftNote');
    if (!saved) return;
    try {
      const d = JSON.parse(saved);
      setFormData({ title: d.title||'', description: d.description||'', informacoes: d.informacoes||'',
        tipoConteudo: d.tipoConteudo||'', tags: d.tags||[], areasConhecimento: d.areasConhecimento||[],
        assuntos: d.assuntos||[], images: d.images||[] });
      if (d.resumoAulas?.melhorado || d.resumoAulas?.original) {
        setResumoAulas({ melhorado: d.resumoAulas.melhorado||'', original: d.resumoAulas.original||'' });
        if (d.resumoAulasSelectedForNote === 'melhorado' || d.resumoAulasSelectedForNote === 'original')
          setResumoAulasSelectedForNote(d.resumoAulasSelectedForNote);
        if (Array.isArray(d.fontesArquivosNames) && d.fontesArquivosNames.length > 0)
          setFontesArquivosNames(d.fontesArquivosNames);
      }
    } catch { /* ignore */ }
  }, []);

  // Session storage for pending files
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

  // Save draft
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasContent = formData.title || formData.informacoes || formData.description || formData.tags.length > 0 ||
      formData.areasConhecimento.length > 0 || formData.images.length > 0 || resumoAulas.melhorado || resumoAulas.original;
    if (hasContent) localStorage.setItem('draftNote', JSON.stringify({ ...formData, resumoAulas, resumoAulasSelectedForNote, fontesArquivosNames }));
    else localStorage.removeItem('draftNote');
  }, [formData, resumoAulas, resumoAulasSelectedForNote, fontesArquivosNames]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files ?? []).forEach((file) => {
      if (!file.type.startsWith('image/')) { setMessage({ type: 'error', text: 'Apenas arquivos de imagem são permitidos' }); return; }
      const reader = new FileReader();
      reader.onload = (ev) => setFormData((p) => ({ ...p, images: [...p.images, ev.target?.result as string] }));
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (i: number) => setFormData((p) => ({ ...p, images: p.images.filter((_, j) => j !== i) }));

  const openAgentUpload = (accept: string) => {
    if (fonteFileInputRef.current) { fonteFileInputRef.current.accept = accept; fonteFileInputRef.current.click(); }
  };

  const handleDiscard = () => { localStorage.removeItem('draftNote'); router.push('/dashboard/notes'); };

  const handleSubmit = async () => {
    if (!formData.title.trim()) { setMessage({ type: 'error', text: 'O título é obrigatório' }); return; }
    setFormLoading(true); setMessage(null);
    try {
      const token = getToken();
      if (!token) { setMessage({ type: 'error', text: 'Não autorizado' }); return; }
      const response = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: formData.title,
          description: formData.informacoes || formData.description || '',
          tags: formData.tags, images: formData.images,
          areas_conhecimento: formData.areasConhecimento, assuntos: formData.assuntos,
          fontes_resumo_melhorado: resumoAulas.melhorado || undefined,
          fontes_resumo_original: resumoAulas.original || undefined,
          fontes_arquivos: fontesArquivosNames.length > 0 ? fontesArquivosNames : undefined,
        }),
      });
      if (response.ok) {
        const noteData = await response.json();
        const selIds = localStorage.getItem('selectedQuestionIds');
        if (selIds) {
          try {
            const ids = JSON.parse(selIds);
            if (Array.isArray(ids) && ids.length > 0) {
              const r = await fetch(`/api/notes/${noteData.id}/questions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ question_ids: ids }),
              });
              if (r.ok) localStorage.removeItem('selectedQuestionIds');
            }
          } catch { /* ignore */ }
        }
        localStorage.removeItem('draftNote');
        router.push(`/dashboard/notes/${noteData.id}`);
      } else {
        const err = await response.json();
        setMessage({ type: 'error', text: err.error || 'Erro ao criar a nota' });
      }
    } catch { setMessage({ type: 'error', text: 'Erro ao criar a nota. Tente novamente.' }); }
    finally   { setFormLoading(false); }
  };

  const addLinkAsSource = () => {
    if (!linkInput.trim()) return;
    setPendingFonteLink(linkInput.trim());
    setPendingFonteFiles([]);
    setShowResumoAulasModal(true);
    setLinkInput('');
    setShowLinkInput(false);
  };

  // ── STEP 1: Sources ──────────────────────────────────────────────────
  const renderStep1 = () => (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-xl mx-auto space-y-6">

        {/* Title */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Título da nota <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="Ex.: Farmacologia — β-bloqueadores"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base font-medium focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white shadow-sm"
          />
        </div>

        {/* Source type picker */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Fontes (opcional)</p>
            <span className="text-xs text-gray-400">Arquivos para transformar com IA</span>
          </div>

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

          <div className="grid grid-cols-4 gap-2.5">
            {SOURCE_TYPES.map((src) => (
              <button
                key={src.label}
                type="button"
                onClick={() => {
                  if (src.linkMode) { setShowLinkInput((v) => !v); return; }
                  openAgentUpload(src.accept);
                }}
                className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border-2 transition-all ${src.bgColor} cursor-pointer`}
              >
                <SourceTypeIcon type={src} />
                <span className="text-xs font-medium text-gray-600">{src.label}</span>
              </button>
            ))}
          </div>

          {/* Link input */}
          {showLinkInput && (
            <div className="flex gap-2">
              <input
                type="url"
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addLinkAsSource()}
                placeholder="https://..."
                className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                autoFocus
              />
              <button type="button" onClick={addLinkAsSource}
                className="px-3 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition">
                Adicionar
              </button>
              <button type="button" onClick={() => setShowLinkInput(false)}
                className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50 transition text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Added files list */}
        {fontesArquivosNames.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Fontes adicionadas ({fontesArquivosNames.length})
            </p>
            <div className="space-y-1">
              {fontesArquivosNames.map((name, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                  <FileText className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  <span className="text-xs text-gray-700 truncate flex-1">{name}</span>
                  <button type="button" onClick={() => setFontesArquivosNames((p) => p.filter((_, j) => j !== i))}
                    className="text-gray-400 hover:text-red-500 transition flex-shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            {!resumoAulas.melhorado && !resumoAulas.original && (
              <button
                type="button"
                onClick={() => { setPendingFonteFiles([]); setPendingFonteLink(''); setShowResumoAulasModal(true); }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition"
              >
                <Sparkles className="w-4 h-4" />
                Transformar com IA
              </button>
            )}
          </div>
        )}

        {/* AI summary preview */}
        {(resumoAulas.melhorado || resumoAulas.original) && (
          <div className="rounded-xl border-2 border-primary-100 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-primary-50 border-b border-primary-100">
              <Sparkles className="w-3.5 h-3.5 text-primary-600" />
              <span className="text-xs font-semibold text-primary-700">Transformação por IA</span>
              <span className="ml-auto text-xs text-primary-500">Selecione ★ para usar no conteúdo</span>
            </div>
            <div className="flex bg-white border-b border-gray-200">
              {(['melhorado', 'original'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setResumoAulasSubTab(st)}
                  className={`flex-1 flex items-center justify-between gap-1 px-4 py-2.5 text-xs font-medium transition border-b-2 ${
                    resumoAulasSubTab === st ? 'text-primary-600 border-primary-500 bg-primary-50/50' : 'text-gray-500 border-transparent hover:text-gray-700'
                  }`}
                >
                  <span>{st === 'melhorado' ? 'Melhorado' : 'Original'}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setResumoAulasSelectedForNote(st);
                      setFormData((p) => ({ ...p, informacoes: st === 'melhorado' ? resumoAulas.melhorado : resumoAulas.original }));
                    }}
                    className="p-0.5 rounded hover:bg-primary-100 transition"
                    title="Usar no conteúdo da nota"
                  >
                    <Star className={`w-3.5 h-3.5 ${resumoAulasSelectedForNote === st ? 'fill-amber-400 text-amber-500' : 'text-gray-300 hover:text-amber-400'}`} />
                  </button>
                </button>
              ))}
            </div>
            <div className="p-4 max-h-48 overflow-y-auto">
              <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">
                {resumoAulasSubTab === 'melhorado' ? resumoAulas.melhorado : resumoAulas.original}
              </p>
            </div>
          </div>
        )}

        {/* Add more sources button (if no files added yet) */}
        {fontesArquivosNames.length === 0 && (
          <button
            type="button"
            onClick={() => { setPendingFonteFiles([]); setPendingFonteLink(''); setShowResumoAulasModal(true); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 hover:border-primary-300 hover:text-primary-600 hover:bg-primary-50/30 transition"
          >
            <Plus className="w-4 h-4" />
            Adicionar e transformar com IA
          </button>
        )}

      </div>
    </div>
  );

  // ── STEP 2: Note editor / preview ────────────────────────────────────
  const renderStep2 = () => (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Title */}
        <input
          type="text"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          placeholder="Título da nota"
          required
          className="w-full text-2xl font-bold bg-transparent border-0 border-b-2 border-transparent focus:border-primary-400 focus:outline-none text-gray-800 pb-2 transition placeholder:text-gray-300"
        />

        {/* Content */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide">Conteúdo</label>
          <textarea
            value={formData.informacoes}
            onChange={(e) => setFormData({ ...formData, informacoes: e.target.value })}
            placeholder="Comece a escrever sua nota aqui..."
            className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm text-gray-700 resize-none leading-relaxed shadow-sm"
            style={{ minHeight: 240 }}
          />
        </div>

        {/* Classificação accordion */}
        <div className="rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setClassifExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition"
          >
            <span className="text-sm font-semibold text-gray-700">Classificação</span>
            {classifExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          {classifExpanded && (
            <div className="px-4 pb-4 space-y-4 border-t border-gray-100">
              <div className="pt-3">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Área do Conhecimento</label>
                <TagAutocomplete
                  options={AREAS_OPTIONS_DISPLAY}
                  selectedTags={formData.areasConhecimento.map(toDisplayArea)}
                  onChange={(tags) => setFormData({ ...formData, areasConhecimento: tags.map(fromDisplay) })}
                  onSaveNewTag={() => {}} placeholder="Selecione áreas..." />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Assunto</label>
                <TagAutocomplete
                  options={assuntosOptions.map(toDisplayAssunto)}
                  selectedTags={formData.assuntos.map(toDisplayAssunto)}
                  onChange={(tags) => setFormData({ ...formData, assuntos: tags.map(fromDisplay) })}
                  onSaveNewTag={() => {}}
                  placeholder={formData.areasConhecimento.length === 0 ? 'Selecione uma área primeiro' : 'Selecione assuntos...'} />
              </div>
              <div>
                <TagAutocomplete
                  options={availableTags}
                  selectedTags={formData.tags}
                  onChange={(tags) => setFormData({ ...formData, tags })}
                  onSaveNewTag={(t) => { if (!availableTags.includes(t)) setAvailableTags([...availableTags, t]); }}
                  label="Tags / Especialidade"
                  placeholder="Digite para buscar tags..." />
              </div>
            </div>
          )}
        </div>

        {/* Imagens accordion */}
        <div className="rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setImagesExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-700">Imagens</span>
              {formData.images.length > 0 && (
                <span className="px-1.5 py-0.5 text-xs bg-primary-100 text-primary-700 rounded-full">{formData.images.length}</span>
              )}
            </div>
            {imagesExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          {imagesExpanded && (
            <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-primary-400 hover:text-primary-600 transition"
              >
                <ImageIcon className="w-4 h-4" />
                {formData.images.length === 0 ? 'Adicionar imagens' : `${formData.images.length} imagem(ns)`}
              </button>
              {formData.images.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {formData.images.map((img, i) => (
                    <div key={i} className="relative group">
                      <ImageLightbox src={img} alt={`Preview ${i + 1}`} className="w-full h-24" />
                      <button type="button" onClick={() => removeImage(i)}
                        className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );

  return (
    <div className="-m-3 sm:-m-4 md:-m-3 flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 52px)' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white shadow-sm gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => step === 1 ? router.back() : setStep(1)}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition flex-shrink-0"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-4 h-4 text-gray-600" />
          </button>
          <span className="text-sm font-semibold text-gray-700 hidden sm:inline">Nova Nota</span>
        </div>

        <StepIndicator step={step} />

        <div className="flex items-center gap-2 flex-1 justify-end">
          {message && (
            <span className={`text-xs px-2 py-1 rounded-full flex-shrink-0 hidden sm:inline ${
              message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {message.text}
            </span>
          )}
        </div>
      </header>

      {/* ── Step content ────────────────────────────────────────────────── */}
      {step === 1 ? renderStep1() : renderStep2()}

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 border-t border-gray-200 bg-white shadow-[0_-1px_6px_rgba(0,0,0,0.04)]">
        {step === 1 ? (
          <>
            <button type="button" onClick={handleDiscard}
              className="px-4 py-2 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                if (!formData.title.trim()) { setMessage({ type: 'error', text: 'Informe o título antes de continuar' }); return; }
                setMessage(null); setStep(2);
              }}
              className="flex items-center gap-2 px-5 py-2 text-sm bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 transition"
            >
              Próximo
              <span className="text-xs opacity-80">2/2</span>
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setStep(1)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition">
                <ArrowLeft className="w-3.5 h-3.5" />Voltar
              </button>
              <button type="button" onClick={handleDiscard}
                className="px-3 py-2 text-sm border border-red-200 rounded-xl text-red-600 hover:bg-red-50 transition">
                Descartar
              </button>
            </div>
            {message && (
              <span className={`text-xs px-2 py-1 rounded-full ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {message.text}
              </span>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={formLoading}
              className="px-5 py-2 text-sm bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 transition disabled:opacity-50"
            >
              {formLoading ? 'Salvando…' : 'Salvar Nota'}
            </button>
          </>
        )}
      </footer>

      {/* ── ResumoAulas modal ───────────────────────────────────────────── */}
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
          setFormData((p) => ({ ...p, informacoes: melhorado }));
          setShowResumoAulasModal(false);
          setPendingFonteFiles([]); setPendingFonteLink('');
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
