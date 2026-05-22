'use client';

import { Suspense, useState, useRef, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, X, Image as ImageIcon,
  FileText, Film, Music,
  Link as LinkIcon, Loader2,
  AlertCircle, CheckCircle2, Save, Trash2,
} from 'lucide-react';

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
  { label: 'PDF',    accept: '.pdf,application/pdf',
    iconColor: 'text-red-500',    bgColor: 'bg-red-50    border-red-100   hover:border-red-300',   linkMode: false },
  { label: 'Word',   accept: '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    iconColor: 'text-blue-500',   bgColor: 'bg-blue-50   border-blue-100  hover:border-blue-300',  linkMode: false },
  { label: 'Slides', accept: '.ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation',
    iconColor: 'text-orange-500', bgColor: 'bg-orange-50 border-orange-100 hover:border-orange-300', linkMode: false },
  { label: 'Vídeo',  accept: 'video/*',
    iconColor: 'text-purple-500', bgColor: 'bg-purple-50 border-purple-100 hover:border-purple-300', linkMode: false },
  { label: 'Áudio',  accept: 'audio/*',
    iconColor: 'text-pink-500',   bgColor: 'bg-pink-50   border-pink-100  hover:border-pink-300',  linkMode: false },
  { label: 'Imagem', accept: 'image/*',
    iconColor: 'text-green-500',  bgColor: 'bg-green-50  border-green-100 hover:border-green-300', linkMode: false },
  { label: 'Link',   accept: '',
    iconColor: 'text-cyan-500',   bgColor: 'bg-cyan-50   border-cyan-100  hover:border-cyan-300',  linkMode: true  },
];

function StepIndicator({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      <div className={`flex items-center gap-1.5 ${step === 1 ? 'text-primary-700' : 'text-gray-400'}`}>
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
          step === 1 ? 'bg-primary-600 text-white' : 'bg-primary-100 text-primary-600'
        }`}>
          {step > 1 ? <CheckCircle2 className="w-4 h-4" /> : '1'}
        </div>
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
  if (type.label === 'Vídeo')  return <Film      className={`w-5 h-5 ${type.iconColor}`} />;
  if (type.label === 'Áudio')  return <Music     className={`w-5 h-5 ${type.iconColor}`} />;
  if (type.label === 'Link')   return <LinkIcon  className={`w-5 h-5 ${type.iconColor}`} />;
  if (type.label === 'Imagem') return <ImageIcon className={`w-5 h-5 ${type.iconColor}`} />;
  return <FileText className={`w-5 h-5 ${type.iconColor}`} />;
}

// ── inline AI processing (replaces ResumoAulasModal logic) ────────────────
async function runSourceTransformation(
  files: File[],
  link: string,
  token: string,
  onStatus: (msg: string) => void,
): Promise<{ melhorado: string; original: string; fileNames: string[] }> {
  const isAudioVideo = files.some((f) => f.type.startsWith('audio/') || f.type.startsWith('video/'));
  const hasLink      = link.trim().length > 0;
  const isYouTube    = hasLink && (link.includes('youtube.com/watch') || link.includes('youtu.be/'));
  let original  = '';
  let melhorado = '';

  if (isAudioVideo) {
    // ── Transcribe audio/video ──────────────────────────────────────────
    onStatus('Transcrevendo áudio/vídeo…');
    const av = files.find((f) => f.type.startsWith('audio/') || f.type.startsWith('video/'))!;
    const fd = new FormData();
    fd.append('file', av);
    const res = await fetch('/api/groq/transcribe-with-extract', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const data: { text?: string; error?: string } = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro ao transcrever arquivo de áudio/vídeo.');
    original = data.text || '';

    if (original.trim()) {
      onStatus('Melhorando com IA…');
      const gr = await fetch('/api/gemini/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          transcription: original,
          instruction: 'Resuma a transcrição em material de estudo claro, organizado e em português do Brasil.',
          agentKey: 'ajuste_transcricao',
        }),
      });
      const gd: { text?: string; error?: string } = await gr.json().catch(() => ({}));
      melhorado = gd.text || original;
    } else {
      melhorado = original;
    }

  } else if (isYouTube) {
    // ── YouTube link ────────────────────────────────────────────────────
    onStatus('Processando vídeo do YouTube…');
    const res = await fetch('/api/gemini/process-youtube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url: link.trim() }),
    });
    const data: { text?: string; error?: string } = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro ao processar vídeo do YouTube.');
    original = data.text || '';

    if (original.trim()) {
      onStatus('Melhorando com IA…');
      const gr = await fetch('/api/gemini/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          transcription: original,
          instruction: 'Analise e organize a transcrição acima em material de estudo.',
          agentKey: 'ajuste_transcricao',
        }),
      });
      const gd: { text?: string; error?: string } = await gr.json().catch(() => ({}));
      melhorado = gd.text || original;
    } else {
      melhorado = original;
    }

  } else if (hasLink) {
    // ── Generic link ────────────────────────────────────────────────────
    onStatus('Baixando e extraindo conteúdo do link…');
    const res = await fetch('/api/groq/transcribe-with-extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url: link.trim() }),
    });
    const data: { text?: string; error?: string } = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro ao processar link.');
    original = data.text || '';

    if (original.trim()) {
      onStatus('Melhorando com IA…');
      const gr = await fetch('/api/gemini/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          transcription: original,
          instruction: 'Analise e organize o conteúdo acima em material de estudo.',
          agentKey: 'ajuste_transcricao',
        }),
      });
      const gd: { text?: string; error?: string } = await gr.json().catch(() => ({}));
      melhorado = gd.text || original;
    } else {
      melhorado = original;
    }

  } else {
    // ── Document / Image ────────────────────────────────────────────────
    const docOrImage = files.find(
      (f) =>
        f.type.startsWith('image/') ||
        f.type === 'application/pdf' ||
        f.type === 'application/msword' ||
        f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        f.type === 'application/vnd.ms-powerpoint' ||
        f.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    if (!docOrImage) throw new Error('Nenhum arquivo ou link reconhecido para processar.');

    onStatus('Extraindo conteúdo do documento…');
    const fd = new FormData();
    fd.append('file', docOrImage);
    const res = await fetch('/api/gemini/process-document', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const data: { originalText?: string; text?: string; error?: string | { message?: string } } =
      await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        typeof data.error === 'string'
          ? data.error
          : (data.error as { message?: string })?.message ?? 'Erro ao processar documento.';
      throw new Error(msg);
    }
    original  = data.originalText || data.text || '';
    melhorado = original; // documents aren't AI-improved in the original modal either
  }

  const fileNames =
    files.length > 0 ? files.map((f) => f.name) : link.trim() ? [link.trim()] : [];
  return { melhorado, original, fileNames };
}
// ─────────────────────────────────────────────────────────────────────────────

function NewNotePageContent() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const tabFromUrl   = searchParams.get('tab');

  const [step, setStep] = useState<1 | 2>(1);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkInput, setLinkInput]         = useState('');

  // Processing state
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [processing, setProcessing]       = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [processingError, setProcessingError]   = useState<string | null>(null);
  const [sourceName, setSourceName]             = useState('');

  const [availableTags, setAvailableTags] = useState<string[]>(AVAILABLE_TAGS);
  const [formData, setFormData] = useState({
    title: '', informacoes: '', tipoConteudo: '',
    tags: [] as string[], areasConhecimento: [] as string[],
    assuntos: [] as string[], images: [] as string[],
  });
  const [resumoAulas, setResumoAulas] = useState({ melhorado: '', original: '' });
  const [fontesArquivosNames, setFontesArquivosNames] = useState<string[]>([]);
  const [classifExpanded, setClassifExpanded] = useState(true);
  const [imagesExpanded, setImagesExpanded]   = useState(false);
  const [formLoading, setFormLoading]         = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fileInputRef      = useRef<HTMLInputElement>(null);
  const fonteFileInputRef = useRef<HTMLInputElement>(null);

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

  // Restore draft
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('draftNote');
    if (!saved) return;
    try {
      const d = JSON.parse(saved);
      setFormData({
        title: d.title || '', informacoes: d.informacoes || '', tipoConteudo: d.tipoConteudo || '',
        tags: d.tags || [], areasConhecimento: d.areasConhecimento || [],
        assuntos: d.assuntos || [], images: d.images || [],
      });
      if (d.resumoAulas?.melhorado || d.resumoAulas?.original) {
        setResumoAulas({ melhorado: d.resumoAulas.melhorado || '', original: d.resumoAulas.original || '' });
        if (Array.isArray(d.fontesArquivosNames) && d.fontesArquivosNames.length > 0)
          setFontesArquivosNames(d.fontesArquivosNames);
      }
    } catch { /* ignore */ }
  }, []);

  // Session storage for pending files (from other parts of the app)
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
      if (items.length === 0) {
        processSource([], link.trim());
        return;
      }
      Promise.all(
        items.map((item) =>
          fetch(item.dataUrl).then((r) => r.blob()).then((blob) => new File([blob], item.name, { type: item.type }))
        )
      ).then((files) => processSource(files, link.trim()));
    } catch { /* ignore */ }
  }, [tabFromUrl]); // eslint-disable-line

  // Save draft
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasContent =
      formData.title || formData.informacoes || formData.tags.length > 0 ||
      formData.areasConhecimento.length > 0 || formData.images.length > 0 ||
      resumoAulas.melhorado || resumoAulas.original;
    if (hasContent) localStorage.setItem('draftNote', JSON.stringify({ ...formData, resumoAulas, fontesArquivosNames }));
    else localStorage.removeItem('draftNote');
  }, [formData, resumoAulas, fontesArquivosNames]);

  // ── Inline source processing ─────────────────────────────────────────
  const processSource = async (files: File[], link: string) => {
    const token = localStorage.getItem('token');
    if (!token) { setMessage({ type: 'error', text: 'Faça login para continuar.' }); return; }
    const name = files.length > 0 ? files.map((f) => f.name).join(', ') : link.trim();
    setSourceName(name);
    setProcessing(true);
    setProcessingError(null);
    setProcessingStatus('Iniciando processamento…');
    try {
      const result = await runSourceTransformation(files, link, token, setProcessingStatus);
      setResumoAulas({ melhorado: result.melhorado, original: result.original });
      setFontesArquivosNames(result.fileNames);
      setFormData((p) => ({ ...p, informacoes: result.melhorado }));
      setStep(2); // auto-advance
    } catch (err) {
      setProcessingError(err instanceof Error ? err.message : 'Erro ao processar fonte.');
    } finally {
      setProcessing(false);
      setProcessingStatus('');
    }
  };

  const openFilePickerFor = (accept: string) => {
    if (fonteFileInputRef.current) {
      fonteFileInputRef.current.accept = accept;
      fonteFileInputRef.current.click();
    }
  };

  const handleDiscard = () => { localStorage.removeItem('draftNote'); router.push('/dashboard/notes'); };

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

  const handleSubmit = async () => {
    if (!formData.title.trim()) { setMessage({ type: 'error', text: 'O título é obrigatório' }); return; }
    setFormLoading(true); setMessage(null);
    try {
      const token = localStorage.getItem('token');
      if (!token) { setMessage({ type: 'error', text: 'Não autorizado' }); return; }
      const response = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: formData.title,
          description: formData.informacoes,
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
              await fetch(`/api/notes/${noteData.id}/questions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ question_ids: ids }),
              });
              localStorage.removeItem('selectedQuestionIds');
            }
          } catch { /* ignore */ }
        }
        localStorage.removeItem('draftNote');
        router.push(`/dashboard/notes/${noteData.id}`);
      } else {
        const err = await response.json().catch(() => ({}));
        setMessage({ type: 'error', text: err.error || 'Erro ao criar a nota' });
      }
    } catch { setMessage({ type: 'error', text: 'Erro ao criar a nota. Tente novamente.' }); }
    finally   { setFormLoading(false); }
  };

  // ── STEP 1: Sources ───────────────────────────────────────────────────
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

        {/* ── Processing state ─────────────────────────────────────── */}
        {processing && (
          <div className="rounded-xl border-2 border-primary-100 bg-primary-50/60 p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-primary-600 animate-spin" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-primary-700">Processando com IA</p>
                <p className="text-xs text-primary-500 truncate" title={sourceName}>{sourceName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 pl-1">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary-400 animate-pulse" />
              <p className="text-xs text-primary-600">{processingStatus}</p>
            </div>
            <div className="h-1.5 rounded-full bg-primary-100 overflow-hidden">
              <div className="h-full bg-primary-400 rounded-full animate-pulse w-2/3" />
            </div>
          </div>
        )}

        {/* ── Error state ──────────────────────────────────────────── */}
        {processingError && !processing && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-700">Erro no processamento</p>
              <p className="text-xs text-red-600 mt-0.5">{processingError}</p>
            </div>
            <button type="button" onClick={() => setProcessingError(null)}
              className="flex-shrink-0 text-red-400 hover:text-red-600 transition">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Source type picker (hidden while processing) ─────────── */}
        {!processing && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Adicionar fonte (opcional)
              </p>
              <span className="text-xs text-gray-400">O arquivo será transformado com IA</span>
            </div>

            {/* Hidden file input */}
            <input
              ref={fonteFileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const selected = e.target.files;
                if (selected?.length) processSource(Array.from(selected), '');
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
                    openFilePickerFor(src.accept);
                  }}
                  className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border-2 transition-all cursor-pointer ${src.bgColor}`}
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
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && linkInput.trim()) {
                      setShowLinkInput(false);
                      processSource([], linkInput.trim());
                      setLinkInput('');
                    }
                  }}
                  placeholder="https://drive.google.com/… ou YouTube…"
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  autoFocus
                />
                <button
                  type="button"
                  disabled={!linkInput.trim()}
                  onClick={() => {
                    if (!linkInput.trim()) return;
                    setShowLinkInput(false);
                    processSource([], linkInput.trim());
                    setLinkInput('');
                  }}
                  className="px-3 py-2 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition disabled:opacity-40"
                >
                  Processar
                </button>
                <button type="button" onClick={() => setShowLinkInput(false)}
                  className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50 transition text-gray-400">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Previous processed source info (if draft restored) */}
        {!processing && fontesArquivosNames.length > 0 && (
          <div className="rounded-xl border border-primary-100 bg-primary-50/40 p-4 flex items-center gap-3">
            <CheckCircle2 className="w-4 h-4 text-primary-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-primary-700">Fonte já processada</p>
              <p className="text-xs text-primary-500 truncate">{fontesArquivosNames.join(', ')}</p>
            </div>
            <button type="button" onClick={() => { setFontesArquivosNames([]); setResumoAulas({ melhorado: '', original: '' }); setFormData((p) => ({ ...p, informacoes: '' })); }}
              className="text-primary-400 hover:text-primary-600 transition flex-shrink-0" title="Remover fonte">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

      </div>
    </div>
  );

  // ── STEP 2: Note editor / preview ─────────────────────────────────────
  // Returns a fragment — siblings live at the same flex level as the main header
  const renderStep2 = () => (
    <>
      {/* Fixed sub-header: title + action buttons */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 bg-white">
        <input
          type="text"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          placeholder="Título da nota"
          required
          className="flex-1 min-w-0 text-base font-semibold bg-transparent border-0 focus:outline-none text-gray-800 placeholder:text-gray-300"
          style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}
        />
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {message && (
            <span className={`text-xs px-2 py-1 rounded-full hidden sm:inline ${
              message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {message.text}
            </span>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={formLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 transition disabled:opacity-50"
          >
            {formLoading
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Salvando…</>
              : <><Save className="w-3.5 h-3.5" />Salvar</>}
          </button>
          <button
            type="button"
            onClick={() => setShowDiscardModal(true)}
            className="p-1.5 rounded-lg border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition"
            title="Descartar nota"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Fixed source badge */}
      {fontesArquivosNames.length > 0 && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-primary-50/70">
          <CheckCircle2 className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" />
          <span className="text-xs text-primary-600 truncate">
            Gerado a partir de: {fontesArquivosNames.join(', ')}
          </span>
        </div>
      )}

      {/* Scrollable content — only this area scrolls */}
      <div className="flex-1 min-h-0 flex flex-col px-4 sm:px-6 py-3">
        <textarea
          value={formData.informacoes}
          onChange={(e) => setFormData({ ...formData, informacoes: e.target.value })}
          placeholder="Conteúdo da nota…"
          className="flex-1 min-h-0 w-full bg-white border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm text-gray-700 resize-none leading-relaxed shadow-sm"
        />
      </div>
    </>
  );

  return (
    <>
    <div className="-m-3 sm:-m-4 md:-m-3 flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 52px)' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white shadow-sm gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button type="button"
            onClick={() => step === 1 ? router.back() : setStep(1)}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition flex-shrink-0"
            aria-label="Voltar">
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

      {/* ── Footer — step 1 only ────────────────────────────────────────── */}
      {step === 1 && (
        <footer className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 border-t border-gray-200 bg-white shadow-[0_-1px_6px_rgba(0,0,0,0.04)]">
          <button type="button" onClick={handleDiscard}
            className="px-4 py-2 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition">
            Cancelar
          </button>
          {message && (
            <span className={`text-xs px-2 py-1 rounded-full ${
              message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {message.text}
            </span>
          )}
          <button
            type="button"
            disabled={processing}
            onClick={() => {
              if (!formData.title.trim()) { setMessage({ type: 'error', text: 'Informe o título antes de continuar' }); return; }
              setMessage(null); setStep(2);
            }}
            className="flex items-center gap-2 px-5 py-2 text-sm bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 transition disabled:opacity-40"
          >
            {processing
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Processando…</>
              : <>Escrever nota <span className="text-xs opacity-70">→</span></>}
          </button>
        </footer>
      )}

    </div>

    {/* ── Discard confirmation modal ───────────────────────────────────── */}
    {showDiscardModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
          <div className="flex items-start gap-3 mb-4">
            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-red-100 flex items-center justify-center">
              <Trash2 className="w-4 h-4 text-red-500" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-800">Descartar nota?</h3>
              <p className="text-sm text-gray-500 mt-0.5">Todas as alterações serão perdidas permanentemente.</p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowDiscardModal(false)}
              className="px-4 py-2 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition font-medium">
              Cancelar
            </button>
            <button type="button" onClick={handleDiscard}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-red-500 text-white rounded-xl font-semibold hover:bg-red-600 transition">
              <Trash2 className="w-3.5 h-3.5" />Descartar
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

export default function NewNotePage() {
  return (
    <Suspense fallback={null}>
      <NewNotePageContent />
    </Suspense>
  );
}
