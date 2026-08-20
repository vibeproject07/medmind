'use client';

import { Suspense, useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, X, Image as ImageIcon,
  FileText, Film, Music,
  Link as LinkIcon, Loader2,
  AlertCircle, CheckCircle2, Save, Trash2, Sparkles, BookOpen,
} from 'lucide-react';
import { uploadNoteSourceFile } from '@/components/Notes/NoteSourcesPanel';
import PendingNoteSourcesPreview from '@/components/Notes/PendingNoteSourcesPreview';
import TagAutocomplete from '@/components/Common/TagAutocomplete';
import {
  ASSUNTOS_BY_AREA,
  AREAS_OPTIONS_DISPLAY,
  fromDisplay,
  toDisplayArea,
  toDisplayAssunto,
} from '@/lib/areas-assuntos';
import { consumePendingNoteSources } from '@/lib/pending-note-sources';

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

function StepIndicator({ step, onBack }: { step: 1 | 2; onBack?: () => void }) {
  return (
    <div className="flex items-center gap-1 min-w-0">
      {/* Step 1 — clickable when on step 2 to go back */}
      <button
        type="button"
        onClick={step === 2 && onBack ? onBack : undefined}
        className={`flex items-center gap-1.5 ${step === 2 ? 'cursor-pointer hover:opacity-80 transition' : 'cursor-default'} ${step === 1 ? 'text-primary-700' : 'text-gray-400'}`}
      >
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
          step === 1 ? 'bg-primary-600 text-white' : 'bg-primary-100 text-primary-600'
        }`}>
          {step > 1 ? <CheckCircle2 className="w-4 h-4" /> : '1'}
        </div>
        <span className="text-xs font-semibold whitespace-nowrap">Fontes</span>
      </button>
      <div className={`w-8 h-0.5 flex-shrink-0 mx-1 rounded ${step > 1 ? 'bg-primary-400' : 'bg-gray-200'}`} />
      <div className={`flex items-center gap-1.5 cursor-default ${step === 2 ? 'text-primary-700' : 'text-gray-400'}`}>
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
type SaveReminderAction = { type: 'leave' } | { type: 'step1' } | { type: 'openEstudio' };

function SaveReminderModal({
  open,
  onClose,
  onSave,
  onLeaveWithoutSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  onLeaveWithoutSave: () => void;
  saving: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
          aria-label="Fechar"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="px-6 pt-6 pb-5">
          <p className="text-base font-semibold text-gray-800 pr-8">Lembre-se de salvar a nota criada</p>
        </div>
        <div className="flex flex-col-reverse sm:flex-row gap-2 px-6 pb-6">
          <button
            type="button"
            onClick={onLeaveWithoutSave}
            disabled={saving}
            className="flex-1 px-4 py-2.5 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition font-medium disabled:opacity-50"
          >
            Sair sem salvar
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 transition disabled:opacity-50"
          >
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Salvando…</> : <><Save className="w-4 h-4" />Salvar</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function NewNotePageContent() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const tabFromUrl   = searchParams.get('tab');

  const [step, setStep] = useState<1 | 2>(1);
  const [activePanel, setActivePanel] = useState<'estudio' | null>(null);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkInput, setLinkInput]         = useState('');

  // Processing state
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [showSaveReminderModal, setShowSaveReminderModal] = useState(false);
  const pendingSaveActionRef = useRef<SaveReminderAction | null>(null);
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
  const [pendingSourceFiles, setPendingSourceFiles] = useState<File[]>([]);
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

  const hasUnsavedContent = useMemo(() => {
    return !!(
      formData.title.trim() ||
      formData.informacoes.trim() ||
      formData.tags.length > 0 ||
      formData.areasConhecimento.length > 0 ||
      formData.assuntos.length > 0 ||
      formData.images.length > 0 ||
      resumoAulas.melhorado.trim() ||
      resumoAulas.original.trim() ||
      fontesArquivosNames.length > 0
    );
  }, [formData, resumoAulas, fontesArquivosNames]);

  const guardUnsaved = useCallback(
    (action: SaveReminderAction, run: () => void) => {
      if (!hasUnsavedContent) {
        run();
        return;
      }
      pendingSaveActionRef.current = action;
      setShowSaveReminderModal(true);
    },
    [hasUnsavedContent],
  );

  const executePendingWithoutSave = useCallback(() => {
    const action = pendingSaveActionRef.current;
    pendingSaveActionRef.current = null;
    setShowSaveReminderModal(false);
    if (!action) return;
    if (action.type === 'leave') {
      localStorage.removeItem('draftNote');
      router.push('/dashboard/notes');
    } else if (action.type === 'step1') {
      setActivePanel(null);
      setStep(1);
    } else if (action.type === 'openEstudio') {
      setActivePanel('estudio');
    }
  }, [router]);

  const requestOpenEstudio = useCallback(() => {
    guardUnsaved({ type: 'openEstudio' }, () => setActivePanel('estudio'));
  }, [guardUnsaved]);

  useEffect(() => {
    if (formData.areasConhecimento.length === 0) { setFormData((p) => ({ ...p, assuntos: [] })); return; }
    const valid = new Set<string>();
    formData.areasConhecimento.forEach((area) => { ASSUNTOS_BY_AREA[area]?.forEach((a) => valid.add(a)); });
    setFormData((p) => ({ ...p, assuntos: p.assuntos.filter((a) => valid.has(a)) }));
  }, [formData.areasConhecimento]);

  // Always open clean — discard any leftover draft from previous session
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('draftNote');
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

  // ?tab=conteudo → abrir passo da nota; ?tab=estudio → passo 2 + painel estúdio (com aviso se não salvo)
  useEffect(() => {
    if (tabFromUrl === 'conteudo') setStep(2);
    if (tabFromUrl === 'estudio') {
      setStep(2);
      requestOpenEstudio();
    }
  }, [tabFromUrl, requestOpenEstudio]);

  useEffect(() => {
    if (!hasUnsavedContent) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedContent]);

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
    // Arquivos não passam mais por IA antes de a nota existir. Eles são enviados
    // diretamente ao S3 após o salvamento e podem ser processados depois, por fonte.
    if (files.length > 0) {
      const names = files.map((file) => file.name);
      setProcessingError(null);
      setPendingSourceFiles(files);
      setFontesArquivosNames(names);
      setSourceName(names.join(', '));
      setFormData((current) => {
        if (current.title.trim()) return current;
        const baseName = files[0].name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
        return { ...current, title: baseName || 'Nova nota' };
      });
      setStep(2);
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) { setMessage({ type: 'error', text: 'Faça login para continuar.' }); return; }
    const name = files.length > 0 ? files.map((f) => f.name).join(', ') : link.trim();
    setSourceName(name);
    setProcessing(true);
    setProcessingError(null);
    setProcessingStatus('Iniciando processamento…');
    let succeeded = false;
    let suggestedTitle = '';
    try {
      const result = await runSourceTransformation(files, link, token, setProcessingStatus);
      setResumoAulas({ melhorado: result.melhorado, original: result.original });
      setFontesArquivosNames(result.fileNames);
      setPendingSourceFiles(files);

      // ── Generate AI title from processed content ─────────────────────
      if (result.melhorado.trim() || result.original.trim()) {
        setProcessingStatus('Sugerindo título…');
        try {
          const snippet = (result.melhorado || result.original).slice(0, 1500);
          const gr = await fetch('/api/gemini/transform', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              transcription: snippet,
              instruction:
                'Com base no conteúdo acima, gere APENAS um título curto e descritivo para uma nota de estudo médica. ' +
                'O título deve ter no máximo 8 palavras, sem pontuação no final, sem aspas, apenas o título.',
              agentKey: 'ajuste_transcricao',
            }),
          });
          const gd: { text?: string } = await gr.json().catch(() => ({}));
          suggestedTitle = (gd.text || '').trim().replace(/^["']|["']$/g, '');
        } catch { /* ignore — user can type the title manually */ }
      }

      setFormData((p) => ({ ...p, informacoes: result.melhorado, title: suggestedTitle }));
      succeeded = true;
    } catch (err) {
      setProcessingError(err instanceof Error ? err.message : 'Erro ao processar fonte.');
    } finally {
      setProcessing(false);
      setProcessingStatus('');
    }
    // advance AFTER state updates settle (outside try/catch/finally to avoid React batching edge cases)
    if (succeeded) setStep(2);
  };

  // Files selected from the global quick-create modal remain only in client
  // memory until the user saves the note. This avoids encoding media in web
  // storage while keeping the original file available for its local preview.
  useEffect(() => {
    const stagedFiles = consumePendingNoteSources();
    if (stagedFiles.length > 0) void processSource(stagedFiles, '');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openFilePickerFor = (accept: string) => {
    if (fonteFileInputRef.current) {
      fonteFileInputRef.current.accept = accept;
      fonteFileInputRef.current.click();
    }
  };

  const handleDiscard = () => {
    localStorage.removeItem('draftNote');
    router.push('/dashboard/notes');
  };

  const requestLeave = () => guardUnsaved({ type: 'leave' }, handleDiscard);

  const requestStep1 = () => guardUnsaved({ type: 'step1' }, () => {
    setActivePanel(null);
    setStep(1);
  });

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
  const removePendingSourceFile = (index: number) => {
    setPendingSourceFiles((files) => files.filter((_, currentIndex) => currentIndex !== index));
    setFontesArquivosNames((names) => names.filter((_, currentIndex) => currentIndex !== index));
  };

  const handleSubmit = async (
    afterSave?: 'note' | 'list' | 'estudio',
  ): Promise<number | null> => {
    if (!formData.title.trim()) {
      setMessage({ type: 'error', text: 'O título é obrigatório' });
      return null;
    }
    setFormLoading(true);
    setMessage(null);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setMessage({ type: 'error', text: 'Não autorizado' });
        return null;
      }
      const response = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: formData.title,
          description: formData.informacoes,
          tipo_conteudo: formData.tipoConteudo || undefined,
          tags: formData.tags,
          images: formData.images,
          areas_conhecimento: formData.areasConhecimento,
          assuntos: formData.assuntos,
          fontes_resumo_melhorado: resumoAulas.melhorado || undefined,
          fontes_resumo_original: resumoAulas.original || undefined,
          // New files are persisted in note_sources after the note exists. Keep this
          // legacy field only for a non-file source such as an external link.
          fontes_arquivos: pendingSourceFiles.length === 0 && fontesArquivosNames.length > 0
            ? fontesArquivosNames
            : undefined,
        }),
      });
      if (response.ok) {
        const noteData = await response.json();
        // The note must exist before private source objects can be safely linked to it.
        // A source failure never rolls back the saved note; the detail screen lets users retry.
        const sourceUploadFailures: string[] = [];
        for (const file of pendingSourceFiles) {
          try {
            await uploadNoteSourceFile(noteData.id, file, token);
          } catch (sourceError) {
            console.error('[notes] Falha ao salvar fonte no S3:', sourceError);
            sourceUploadFailures.push(file.name);
          }
        }
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
        if (sourceUploadFailures.length > 0) {
          sessionStorage.setItem(
            'noteSourceUploadWarning',
            `A nota foi salva, mas ${sourceUploadFailures.join(', ')} não pôde ser enviado ao armazenamento privado.`,
          );
          sessionStorage.setItem(
            'noteSourceRetryNames',
            JSON.stringify({ noteId: noteData.id, fileNames: sourceUploadFailures }),
          );
        }
        if (afterSave === 'list') {
          router.push('/dashboard/notes');
        } else {
          if (afterSave === 'estudio' && typeof window !== 'undefined') {
            sessionStorage.setItem('openNotePanel', 'estudio');
          }
          router.push(`/dashboard/notes/${noteData.id}`);
        }
        return noteData.id as number;
      }
      const err = await response.json().catch(() => ({}));
      setMessage({ type: 'error', text: err.error || 'Erro ao criar a nota' });
      return null;
    } catch {
      setMessage({ type: 'error', text: 'Erro ao criar a nota. Tente novamente.' });
      return null;
    } finally {
      setFormLoading(false);
    }
  };

  const handleSaveReminderSalvar = async () => {
    const action = pendingSaveActionRef.current;
    const redirect =
      action?.type === 'leave' ? 'list' : action?.type === 'openEstudio' ? 'estudio' : 'note';
    const noteId = await handleSubmit(redirect);
    if (noteId == null) {
      pendingSaveActionRef.current = action;
      setShowSaveReminderModal(true);
      return;
    }
    pendingSaveActionRef.current = null;
    setShowSaveReminderModal(false);
  };

  // ── STEP 1: Sources ───────────────────────────────────────────────────
  const renderStep1 = () => (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
      <div className="max-w-xl mx-auto space-y-6">

        {/* ── Processing state (links legados) ─────────────────────── */}
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
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Adicionar fonte
            </p>

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

        {/* Arquivos pendentes para envio após a criação da nota */}
        {!processing && fontesArquivosNames.length > 0 && (
          <div className="rounded-xl border border-primary-100 bg-primary-50/40 p-4 flex items-center gap-3">
            <CheckCircle2 className="w-4 h-4 text-primary-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-primary-700">Arquivos prontos para enviar</p>
              <p className="text-xs text-primary-500 truncate">
                {fontesArquivosNames.join(', ')} — serão enviados ao armazenamento privado ao salvar a nota.
              </p>
            </div>
            <button type="button" onClick={() => { setFontesArquivosNames([]); setPendingSourceFiles([]); }}
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
  const renderEstudioPanel = () => (
    <div className="space-y-4 p-4">
      <p className="text-xs text-gray-500">
        Salve a nota para persistir associações. Você ainda pode buscar questões por tags antes de salvar.
      </p>
      {formData.tags.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            const tagsParam = encodeURIComponent(JSON.stringify(formData.tags));
            router.push(`/dashboard/notes/select-questions?tags=${tagsParam}`);
          }}
          className="w-full px-3 py-2 bg-primary-600 text-white rounded-lg text-xs font-semibold hover:bg-primary-700 transition"
        >
          Buscar questões por tags
        </button>
      ) : (
        <p className="text-xs text-gray-400">Adicione tags à nota para buscar questões relacionadas.</p>
      )}
      <div className="pt-3 border-t border-gray-100">
        <p className="text-xs font-semibold text-gray-700 mb-2">Artigos</p>
        <div className="text-center py-4 text-gray-400">
          <BookOpen className="w-6 h-6 mx-auto mb-1.5 opacity-40" />
          <p className="text-xs">Em desenvolvimento</p>
        </div>
      </div>
    </div>
  );

  const renderNoteMetadata = () => (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-800">Informações da nota</h2>
        <p className="mt-0.5 text-xs text-gray-500">Organize a nota para encontrá-la e relacioná-la a questões depois.</p>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Tipo de conteúdo</label>
        <input
          type="text"
          value={formData.tipoConteudo}
          onChange={(event) => setFormData({ ...formData, tipoConteudo: event.target.value })}
          placeholder="Ex.: resumo de aula, caso clínico, artigo"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-transparent focus:ring-2 focus:ring-primary-500"
        />
      </div>

      <TagAutocomplete
        label="Especialidade / tags"
        options={availableTags}
        selectedTags={formData.tags}
        onChange={(tags) => setFormData({ ...formData, tags })}
        onSaveNewTag={(tag) => {
          if (!availableTags.includes(tag)) setAvailableTags((current) => [...current, tag]);
        }}
        placeholder="Digite para buscar tags…"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Área do conhecimento</label>
          <TagAutocomplete
            options={AREAS_OPTIONS_DISPLAY}
            selectedTags={formData.areasConhecimento.map(toDisplayArea)}
            onChange={(tags) => setFormData({ ...formData, areasConhecimento: tags.map(fromDisplay) })}
            onSaveNewTag={() => undefined}
            placeholder="Selecione as áreas…"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Assuntos</label>
          <TagAutocomplete
            options={assuntosOptions.map(toDisplayAssunto)}
            selectedTags={formData.assuntos.map(toDisplayAssunto)}
            onChange={(tags) => setFormData({ ...formData, assuntos: tags.map(fromDisplay) })}
            onSaveNewTag={() => undefined}
            placeholder={formData.areasConhecimento.length ? 'Selecione os assuntos…' : 'Selecione uma área primeiro'}
          />
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setImagesExpanded((expanded) => !expanded)}
          className="flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
          aria-expanded={imagesExpanded}
        >
          Imagens complementares
          <span className="text-primary-600">{imagesExpanded ? 'Ocultar' : 'Adicionar'}</span>
        </button>
        {imagesExpanded && (
          <div className="mt-2">
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-3 text-sm font-medium text-gray-600 hover:border-primary-300 hover:bg-primary-50/30"
            >
              <ImageIcon className="h-4 w-4" />Adicionar imagens à nota
            </button>
            {formData.images.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {formData.images.map((image, index) => (
                  <div key={`${image.slice(0, 24)}-${index}`} className="group relative overflow-hidden rounded-lg border border-gray-200">
                    <img src={image} alt={`Imagem complementar ${index + 1}`} className="h-24 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="absolute right-1.5 top-1.5 rounded-full bg-white/90 p-1 text-red-500 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                      aria-label={`Remover imagem complementar ${index + 1}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );

  const renderStep2 = () => (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row">
      <div className="flex-1 min-h-0 flex flex-col min-w-0">
        {/* Fixed sub-header: title + action buttons */}
        <div className="flex-shrink-0 flex flex-col gap-2 px-4 py-2.5 border-b border-gray-200 bg-white sm:flex-row sm:items-center">
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="Título da nota"
            required
            className="w-full min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-base font-semibold text-gray-800 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0"
            style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}
          />
          <div className="flex w-full items-center justify-end gap-1.5 sm:w-auto sm:flex-shrink-0">
            <button
              type="button"
              onClick={requestOpenEstudio}
              className={`hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition ${
                activePanel === 'estudio'
                  ? 'bg-primary-50 text-primary-700 border-primary-200'
                  : 'text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Estúdio
            </button>
            {message && (
              <span className={`text-xs px-2 py-1 rounded-full hidden sm:inline ${
                message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}>
                {message.text}
              </span>
            )}
            <button
              type="button"
              onClick={() => handleSubmit()}
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

        {/* Mobile: Estúdio tab */}
        <div className="flex-shrink-0 sm:hidden flex border-b border-gray-200 bg-white">
          <button
            type="button"
            onClick={() => setActivePanel(null)}
            className={`flex-1 py-2.5 text-xs font-semibold transition ${
              activePanel !== 'estudio' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'
            }`}
          >
            Nota
          </button>
          <button
            type="button"
            onClick={requestOpenEstudio}
            className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1 transition ${
              activePanel === 'estudio' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Estúdio
          </button>
        </div>

        {fontesArquivosNames.length > 0 && activePanel !== 'estudio' && (
          <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-primary-50/70">
            <CheckCircle2 className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" />
            <span className="text-xs text-primary-600 truncate">
              Gerado a partir de: {fontesArquivosNames.join(', ')}
            </span>
          </div>
        )}

        {activePanel === 'estudio' ? (
          <div className="flex-1 min-h-0 overflow-y-auto md:hidden bg-white">{renderEstudioPanel()}</div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 sm:px-6">
            <div className="mx-auto max-w-4xl space-y-4">
              {pendingSourceFiles.length > 0 && (
                <PendingNoteSourcesPreview files={pendingSourceFiles} onRemove={removePendingSourceFile} />
              )}

              <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <label className="mb-2 block text-sm font-semibold text-gray-800">Conteúdo da nota</label>
                <textarea
                  value={formData.informacoes}
                  onChange={(e) => setFormData({ ...formData, informacoes: e.target.value })}
                  placeholder="Escreva observações, contexto, conclusões e o que desejar registrar sobre este material…"
                  rows={12}
                  className="min-h-64 w-full resize-y rounded-lg border border-gray-200 px-4 py-3 text-sm leading-relaxed text-gray-700 focus:border-transparent focus:ring-2 focus:ring-primary-500"
                />
              </section>

              {renderNoteMetadata()}
            </div>
          </div>
        )}
      </div>

      {activePanel === 'estudio' && (
        <div className="hidden md:flex w-72 xl:w-80 flex-shrink-0 border-l border-gray-200 bg-white flex-col min-h-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary-600" />
              <span className="text-sm font-semibold text-gray-700">Estúdio</span>
            </div>
            <button
              type="button"
              onClick={() => setActivePanel(null)}
              className="p-1 rounded-lg hover:bg-gray-100 transition text-gray-400"
              aria-label="Fechar estúdio"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">{renderEstudioPanel()}</div>
        </div>
      )}
    </div>
  );

  return (
    <div className="-m-3 sm:-m-4 md:-m-3 flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 52px)' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white shadow-sm gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => (step === 1 ? requestLeave() : requestStep1())}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition flex-shrink-0"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-4 h-4 text-gray-600" />
          </button>
          <span className="text-sm font-semibold text-gray-700 hidden sm:inline">Nova Nota</span>
        </div>

        <StepIndicator step={step} onBack={requestStep1} />

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

      {/* ── AI subtitle — step 1 only ───────────────────────────────────── */}
      {step === 1 && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50/80">
          <Sparkles className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" />
          <span className="text-xs text-gray-500">Salve a nota primeiro; depois você poderá processar cada arquivo com IA, se quiser.</span>
        </div>
      )}

      {/* ── Step content ────────────────────────────────────────────────── */}
      {step === 1 ? renderStep1() : renderStep2()}

      {/* ── Footer — step 1 only ────────────────────────────────────────── */}
      {step === 1 && (
        <footer className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 py-3 border-t border-gray-200 bg-white shadow-[0_-1px_6px_rgba(0,0,0,0.04)]">
          <button
            type="button"
            onClick={requestLeave}
            className="px-4 py-2 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition"
          >
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

      <SaveReminderModal
        open={showSaveReminderModal}
        onClose={() => {
          pendingSaveActionRef.current = null;
          setShowSaveReminderModal(false);
        }}
        onSave={handleSaveReminderSalvar}
        onLeaveWithoutSave={executePendingWithoutSave}
        saving={formLoading}
      />

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
