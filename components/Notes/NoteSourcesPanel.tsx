'use client';

import { ChangeEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Download,
  ExternalLink,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Loader2,
  Music,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  getPrimaryReadySource,
  reconcileNoteSourceSelection,
  sortNoteSourcesByCreation,
} from '@/lib/note-source-selection';
import type {
  ProcessingValidationKind,
  ProcessingValidationReport,
} from '@/lib/source-processing-validation';

export const NOTE_SOURCE_ACCEPT = [
  '.pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.csv',
  'image/jpeg,image/png,image/gif,image/webp',
  'audio/mpeg,audio/mp4,audio/wav,audio/ogg',
  'video/mp4,video/webm,video/quicktime',
].join(',');

export type NoteSource = {
  id: number;
  note_id: number;
  user_id: number;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  category: 'document' | 'text' | 'image' | 'audio' | 'video';
  status: 'uploading' | 'ready';
  processing_status: 'idle' | 'queued' | 'processing' | 'completed' | 'failed';
  processing_original_text?: string | null;
  processing_result?: string | null;
  processing_error?: string | null;
  processing_attempts: number;
  processing_started_at?: string | null;
  processing_completed_at?: string | null;
  cleaned_transcription?: string | null;
  cleaned_extraction_text?: string | null;
  created_at: string;
  updated_at: string;
};

type UploadResponse = {
  source: NoteSource;
  uploadUrl: string;
  uploadFields: Record<string, string>;
};

async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  return response.json().catch(() => ({})) as Promise<T & { error?: string }>;
}

function reportUploadFailure(
  token: string,
  message: string,
  context: Record<string, unknown>,
  error?: unknown,
): void {
  const normalizedError =
    error instanceof Error ? error : new Error(error == null ? message : String(error));
  const diagnostic = {
    message,
    context,
    errorName: normalizedError.name,
    errorMessage: normalizedError.message,
    stack: normalizedError.stack ?? new Error(message).stack,
  };
  console.log(`[source-upload] ${message}`, diagnostic);
  void fetch('/api/source-upload-diagnostics', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.trim().replace(/^["']|["']$/g, '')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(diagnostic),
  }).catch((reportError) => {
    const reportStack =
      reportError instanceof Error ? reportError.stack : new Error(String(reportError)).stack;
    console.log('[source-upload] Falha ao enviar diagnóstico ao console do Replit.', {
      error: reportError instanceof Error ? reportError.message : String(reportError),
      stack: reportStack,
    });
  });
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const bytes = new Uint8Array(digest);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

export async function uploadNoteSourceFile(
  noteId: number,
  file: File,
  token: string,
  onProgress?: (progress: number, stage: string) => void,
): Promise<NoteSource> {
  const auth = { Authorization: `Bearer ${token.trim().replace(/^["']|["']$/g, '')}` };
  onProgress?.(0, 'Preparando o arquivo…');
  let checksumSha256: string;
  try {
    checksumSha256 = await sha256(file);
  } catch (error) {
    reportUploadFailure(token, 'Falha ao calcular checksum do arquivo.', {
      noteId,
      fileType: file.type,
      fileSize: file.size,
    }, error);
    throw error;
  }
  let prepare: Response;
  try {
    prepare = await fetch(`/api/notes/${noteId}/sources`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        checksumSha256,
      }),
    });
  } catch (error) {
    reportUploadFailure(token, 'Falha de rede ao preparar upload.', {
      noteId,
      fileType: file.type,
    }, error);
    throw error;
  }
  const prepared = await readJson<UploadResponse>(prepare);
  if (!prepare.ok || !prepared.uploadUrl || !prepared.source) {
    reportUploadFailure(token, 'API não preparou o upload.', {
      noteId,
      fileType: file.type,
      status: prepare.status,
      apiError: prepared.error,
      hasUploadUrl: Boolean(prepared.uploadUrl),
      hasSource: Boolean(prepared.source),
    });
    throw new Error(prepared.error || 'Não foi possível preparar o envio deste arquivo.');
  }

  try {
    const formData = new FormData();
    Object.entries(prepared.uploadFields).forEach(([name, value]) => formData.append(name, value));
    formData.append('file', file);
    const put = await new Promise<Response>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', prepared.uploadUrl);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress?.(event.loaded / event.total, 'Enviando o arquivo…');
        }
      };
      xhr.onload = () => {
        try {
          if (xhr.status < 200 || xhr.status >= 300) {
            reportUploadFailure(token, 'Armazenamento recusou o arquivo.', {
              noteId,
              sourceId: prepared.source.id,
              fileType: file.type,
              status: xhr.status,
              statusText: xhr.statusText,
            });
          }
          const responseMustNotHaveBody =
            xhr.status === 204 || xhr.status === 205 || xhr.status === 304;
          resolve(new Response(responseMustNotHaveBody ? null : xhr.responseText, {
            status: xhr.status,
            statusText: xhr.statusText,
          }));
        } catch (error) {
          reportUploadFailure(token, 'Falha ao interpretar resposta do armazenamento.', {
            noteId,
            sourceId: prepared.source.id,
            fileType: file.type,
            status: xhr.status,
            statusText: xhr.statusText,
          }, error);
          reject(error);
        }
      };
      xhr.onerror = () => {
        const uploadError = new Error('Erro de rede/CORS durante envio ao armazenamento.');
        reportUploadFailure(token, uploadError.message, {
          noteId,
          sourceId: prepared.source.id,
          fileType: file.type,
          readyState: xhr.readyState,
          status: xhr.status,
        }, uploadError);
        reject(uploadError);
      };
      xhr.onabort = () => {
        const abortError = new Error('Envio ao armazenamento cancelado.');
        reportUploadFailure(token, abortError.message, {
          noteId,
          sourceId: prepared.source.id,
          fileType: file.type,
        }, abortError);
        reject(abortError);
      };
      xhr.send(formData);
    });
    if (!put.ok) throw new Error('O S3 recusou o envio do arquivo.');

    onProgress?.(1, 'Confirmando o arquivo…');
    let complete: Response;
    try {
      complete = await fetch(`/api/notes/${noteId}/sources/${prepared.source.id}/complete`, {
        method: 'POST',
        headers: auth,
      });
    } catch (error) {
      reportUploadFailure(token, 'Falha de rede ao confirmar upload.', {
        noteId,
        sourceId: prepared.source.id,
        fileType: file.type,
      }, error);
      throw error;
    }
    const completed = await readJson<{ source: NoteSource }>(complete);
    if (!complete.ok || !completed.source) {
      reportUploadFailure(token, 'API não confirmou o arquivo enviado.', {
        noteId,
        sourceId: prepared.source.id,
        fileType: file.type,
        status: complete.status,
        apiError: completed.error,
        hasSource: Boolean(completed.source),
      });
      throw new Error(completed.error || 'O arquivo foi enviado, mas não pôde ser confirmado.');
    }
    return completed.source;
  } catch (error) {
    reportUploadFailure(token, 'Upload da fonte falhou; iniciando limpeza.', {
      noteId,
      sourceId: prepared.source.id,
      fileType: file.type,
      fileSize: file.size,
    }, error);
    await fetch(`/api/notes/${noteId}/sources/${prepared.source.id}`, {
      method: 'DELETE',
      headers: auth,
    }).then(async (cleanupResponse) => {
      if (!cleanupResponse.ok) {
        const cleanupBody = await readJson<Record<string, never>>(cleanupResponse);
        reportUploadFailure(token, 'API recusou limpeza após erro de upload.', {
          noteId,
          sourceId: prepared.source.id,
          fileType: file.type,
          status: cleanupResponse.status,
          apiError: cleanupBody.error,
        });
      }
    }).catch((cleanupError) => {
      reportUploadFailure(token, 'Falha ao limpar registro após erro de upload.', {
        noteId,
        sourceId: prepared.source.id,
        fileType: file.type,
      }, cleanupError);
    });
    throw error;
  }
}

function sourceIcon(source: NoteSource, className = 'w-4 h-4') {
  if (source.category === 'image') return <ImageIcon className={className} />;
  if (source.category === 'audio') return <Music className={className} />;
  if (source.category === 'video') return <FileVideo className={className} />;
  return <FileText className={className} />;
}

function formatSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(size >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function supportsInlineViewer(source: NoteSource): boolean {
  return source.category === 'image' ||
    source.category === 'audio' ||
    source.category === 'video' ||
    source.category === 'text' ||
    source.mime_type === 'application/pdf';
}

const StaticVideoPlayer = memo(function StaticVideoPlayer({
  src,
}: {
  src: string;
}) {
  return <video src={src} controls preload="metadata" className="max-h-[28rem] w-full rounded bg-black" />;
});

function processingLabel(source: NoteSource): string {
  switch (source.processing_status) {
    case 'queued': return 'Na fila';
    case 'processing': return 'Processando';
    case 'completed': return 'IA concluída';
    case 'failed': return 'Falhou — tente novamente';
    default: return 'Sem processamento';
  }
}

export default function NoteSourcesPanel({
  noteId,
  canEdit,
  compact = false,
  fallbackContent = '',
  onPrimaryAvailabilityChange,
  onTokenizationContentChange,
}: {
  noteId: number;
  canEdit: boolean;
  compact?: boolean;
  fallbackContent?: string;
  onPrimaryAvailabilityChange?: (available: boolean) => void;
  onTokenizationContentChange?: (
    input: { content: string; sourceType: NoteSource['category'] } | null,
  ) => void;
}) {
  const [sources, setSources] = useState<NoteSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [selected, setSelected] = useState<{ source: NoteSource; url: string } | null>(null);
  const [selectedByUser, setSelectedByUser] = useState(false);
  const [visibleProcessedText, setVisibleProcessedText] = useState<'transcription' | 'extraction' | null>(null);
  const [validationKind, setValidationKind] = useState<ProcessingValidationKind | null>(null);
  const [validationReport, setValidationReport] = useState<ProcessingValidationReport | null>(null);
  const [failedUploads, setFailedUploads] = useState<{ file: File; error: string }[]>([]);
  const [retryFileNames, setRetryFileNames] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedByUserRef = useRef(false);
  const selectionRequestRef = useRef(0);

  const token = () => localStorage.getItem('token')?.trim().replace(/^["']|["']$/g, '') || '';

  const loadSources = useCallback(async (showLoading = true) => {
    const accessToken = token();
    if (!accessToken) return;
    if (showLoading) setLoading(true);
    try {
      const response = await fetch(`/api/notes/${noteId}/sources`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await readJson<{ sources: NoteSource[] }>(response);
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar as fontes.');
      setSources(sortNoteSourcesByCreation(data.sources || []));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as fontes.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    setSelected(null);
    setSelectedByUser(false);
    selectedByUserRef.current = false;
    selectionRequestRef.current += 1;
    setSources([]);
    onPrimaryAvailabilityChange?.(false);
    onTokenizationContentChange?.(null);
    void loadSources();
  }, [loadSources, onPrimaryAvailabilityChange, onTokenizationContentChange]);

  useEffect(() => {
    const raw = sessionStorage.getItem('noteSourceRetryNames');
    if (!raw) return;
    try {
      const pending = JSON.parse(raw) as { noteId?: number; fileNames?: string[] };
      if (Number(pending.noteId) === noteId && Array.isArray(pending.fileNames)) {
        setRetryFileNames(pending.fileNames.filter((name) => typeof name === 'string' && name.trim()));
        sessionStorage.removeItem('noteSourceRetryNames');
      }
    } catch {
      sessionStorage.removeItem('noteSourceRetryNames');
    }
  }, [noteId]);

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (inputRef.current) inputRef.current.value = '';
    if (!files.length) return;
    const accessToken = token();
    if (!accessToken) { setError('Faça login novamente para enviar fontes.'); return; }

    setError(null);
    setUploading(files.map((file) => file.name));
    for (const file of files) {
      try {
        await uploadNoteSourceFile(noteId, file, accessToken);
        setFailedUploads((current) => current.filter((item) => item.file !== file));
        setRetryFileNames((current) => current.filter((name) => name !== file.name));
      } catch (err) {
        const message = err instanceof Error ? err.message : `Falha ao enviar ${file.name}.`;
        setError(`${file.name}: ${message}`);
        setFailedUploads((current) => [...current.filter((item) => item.file !== file), { file, error: message }]);
      } finally {
        setUploading((current) => current.filter((name) => name !== file.name));
      }
    }
    await loadSources();
  };

  const requestUrl = async (source: NoteSource, download = false) => {
    const accessToken = token();
    if (!accessToken) throw new Error('Faça login novamente.');
    const response = await fetch(
      `/api/notes/${noteId}/sources/${source.id}${download ? '?download=1' : ''}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const data = await readJson<{ url: string }>(response);
    if (!response.ok || !data.url) throw new Error(data.error || 'Não foi possível abrir o arquivo.');
    return data.url;
  };

  const selectSource = async (source: NoteSource, byUser = false) => {
    const requestId = selectionRequestRef.current + 1;
    selectionRequestRef.current = requestId;
    if (byUser) {
      selectedByUserRef.current = true;
      setSelectedByUser(true);
    }
    setBusyId(source.id);
    try {
      const url = await requestUrl(source);
      if (
        selectionRequestRef.current !== requestId ||
        (!byUser && selectedByUserRef.current)
      ) return;
      setSelected({ source, url });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível abrir o arquivo.');
    } finally {
      setBusyId(null);
    }
  };

  const openSource = async (source: NoteSource, download = false) => {
    if (!download) {
      await selectSource(source, true);
      return;
    }
    setBusyId(source.id);
    try {
      const url = await requestUrl(source, download);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível abrir o arquivo.');
    } finally {
      setBusyId(null);
    }
  };

  const deleteSource = async (source: NoteSource) => {
    if (!window.confirm(`Excluir "${source.original_name}" permanentemente?`)) return;
    const accessToken = token();
    if (!accessToken) return;
    setBusyId(source.id);
    try {
      const response = await fetch(`/api/notes/${noteId}/sources/${source.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await readJson<Record<string, never>>(response);
      if (!response.ok) throw new Error(data.error || 'Não foi possível excluir o arquivo.');
      setSources((current) => current.filter((item) => item.id !== source.id));
      if (selected?.source.id === source.id) {
        setSelected(null);
        setSelectedByUser(false);
        selectedByUserRef.current = false;
        selectionRequestRef.current += 1;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível excluir o arquivo.');
    } finally {
      setBusyId(null);
    }
  };

  const validateProcessingInput = async (
    source: NoteSource,
    kind: ProcessingValidationKind,
  ) => {
    const accessToken = token();
    if (!accessToken) return;
    setError(null);
    setValidationKind(kind);
    setValidationReport(null);
    try {
      const response = await fetch(
        `/api/notes/${noteId}/sources/${source.id}/validate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ kind }),
        },
      );
      const data = await readJson<{ report?: ProcessingValidationReport }>(response);
      if (!response.ok || !data.report) {
        throw new Error(data.error || 'Não foi possível validar os pré-requisitos.');
      }
      setValidationReport(data.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível validar os pré-requisitos.');
    } finally {
      setValidationKind(null);
    }
  };

  useEffect(() => {
    const current = selected?.source;
    if (!current) return;
    const replacement = sources.find((source) => source.id === current.id);
    if (replacement) setSelected((value) => value ? { ...value, source: replacement } : value);
  }, [sources]); // Keep the selected viewer in sync with poll results.

  useEffect(() => {
    setVisibleProcessedText(null);
    setValidationReport(null);
  }, [selected?.source.id]);

  useEffect(() => {
    if (busyId !== null) return;
    const nextSelection = reconcileNoteSourceSelection(sources, {
      sourceId: selected?.source.id ?? null,
      selectedByUser,
    });
    if (nextSelection.sourceId !== selected?.source.id) {
      const nextSource = sources.find((source) => source.id === nextSelection.sourceId);
      if (nextSource) {
        void selectSource(nextSource);
      } else {
        setSelected(null);
        setSelectedByUser(false);
        selectedByUserRef.current = false;
        selectionRequestRef.current += 1;
      }
    }
  }, [sources, selected?.source.id, selectedByUser, busyId]);

  useEffect(() => {
    if (!loading) onPrimaryAvailabilityChange?.(sources.some((source) => source.status === 'ready'));
  }, [loading, onPrimaryAvailabilityChange, sources]);

  useEffect(() => {
    if (loading) return;
    const processedSources = sources.filter(
      (source) =>
        source.status === 'ready' &&
        source.processing_status === 'completed' &&
        Boolean((source.cleaned_transcription || source.cleaned_extraction_text || '').trim()),
    );
    const primary = getPrimaryReadySource(processedSources);
    const content = primary
      ? (primary.cleaned_transcription || primary.cleaned_extraction_text || '').trim()
      : '';
    onTokenizationContentChange?.(
      primary && content
        ? { content, sourceType: primary.category }
        : null,
    );
  }, [loading, onTokenizationContentChange, sources]);

  useEffect(() => {
    if (!sources.some((source) => source.processing_status === 'queued' || source.processing_status === 'processing')) return;
    const interval = window.setInterval(() => { void loadSources(false); }, 3000);
    return () => window.clearInterval(interval);
  }, [sources, loadSources]);

  return (
    <section className={compact ? '' : 'space-y-3'}>
      {error && (
        <div className="flex gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="mt-0.5 w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {failedUploads.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-900">Alguns arquivos não foram enviados</p>
          {failedUploads.map(({ file, error: uploadError }) => (
            <div key={`${file.name}-${file.lastModified}`} className="flex items-center gap-2 text-xs text-amber-800">
              <span className="min-w-0 flex-1 truncate" title={uploadError}>{file.name}</span>
              <button
                type="button"
                onClick={() => {
                  const dataTransfer = new DataTransfer();
                  dataTransfer.items.add(file);
                  void handleFiles({ target: { files: dataTransfer.files } } as ChangeEvent<HTMLInputElement>);
                }}
                className="shrink-0 rounded-md bg-white px-2 py-1 font-semibold text-amber-800 ring-1 ring-amber-300 hover:bg-amber-100"
              >
                Tentar novamente
              </button>
            </div>
          ))}
        </div>
      )}

      {retryFileNames.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-900">Reenvie os arquivos que falharam</p>
          {retryFileNames.map((fileName) => (
            <div key={fileName} className="flex items-center gap-2 text-xs text-amber-800">
              <span className="min-w-0 flex-1 truncate">{fileName}</span>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="shrink-0 rounded-md bg-white px-2 py-1 font-semibold text-amber-800 ring-1 ring-amber-300 hover:bg-amber-100"
              >
                Selecionar e reenviar
              </button>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-4 py-5 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />Carregando arquivos…
        </div>
      ) : (
        <div className="space-y-3">
          {selected && (
            <div className="overflow-hidden rounded-xl border border-primary-100 bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-primary-50/40 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-700">Conteúdo principal</p>
                  <p className="truncate text-sm font-medium text-gray-700">{selected.source.original_name}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" title="Abrir em outra guia" onClick={() => window.open(selected.url, '_blank', 'noopener,noreferrer')}
                    className="rounded p-1.5 text-gray-500 hover:bg-white hover:text-primary-700"><ExternalLink className="w-4 h-4" /></button>
                  <button type="button" title="Baixar" onClick={() => void openSource(selected.source, true)}
                    className="rounded p-1.5 text-gray-500 hover:bg-white hover:text-primary-700"><Download className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="bg-gray-50 p-3">
                {selected.source.category === 'image' && <img src={selected.url} alt={selected.source.original_name} className="mx-auto max-h-[28rem] max-w-full rounded object-contain" />}
                {selected.source.category === 'audio' && <audio src={selected.url} controls className="w-full" />}
                {selected.source.category === 'video' && <StaticVideoPlayer src={selected.url} />}
                {(selected.source.category === 'text' || selected.source.mime_type === 'application/pdf') && (
                  <iframe src={selected.url} title={selected.source.original_name} className="h-[28rem] w-full rounded border border-gray-200 bg-white" />
                )}
                {!supportsInlineViewer(selected.source) && (
                  <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center text-sm text-gray-500">
                    <FileText className="h-8 w-8 text-gray-400" />
                    <p>Este formato não pode ser exibido aqui, mas continua disponível para abrir ou baixar.</p>
                  </div>
                )}
              </div>
              {(selected.source.processing_original_text || selected.source.processing_result || selected.source.processing_error || selected.source.processing_status !== 'idle') && (
                <div className="space-y-3 border-t border-violet-100 bg-violet-50/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-800"><Sparkles className="h-3.5 w-3.5" />Processamento por IA</p>
                    <span className="text-[11px] font-medium text-violet-700">{processingLabel(selected.source)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void validateProcessingInput(selected.source, 'tokenizer')}
                      disabled={validationKind !== null}
                      className="rounded-md border border-violet-200 bg-white px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                    >
                      {validationKind === 'tokenizer' ? 'Validando…' : 'Validar tokenizador'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void validateProcessingInput(selected.source, 'chunking')}
                      disabled={validationKind !== null}
                      className="rounded-md border border-violet-200 bg-white px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                    >
                      {validationKind === 'chunking' ? 'Validando…' : 'Validar chunking'}
                    </button>
                  </div>
                  {validationReport && (
                    <div className={`rounded-md border p-2.5 ${
                      validationReport.valid
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-red-200 bg-red-50'
                    }`}>
                      <p className={`text-xs font-semibold ${
                        validationReport.valid ? 'text-emerald-800' : 'text-red-800'
                      }`}>
                        {validationReport.valid
                          ? 'Todos os pré-requisitos estão dentro dos padrões.'
                          : 'O fluxo não pode continuar: há pré-requisitos fora dos padrões.'}
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {validationReport.checks.map((check) => (
                          <li key={check.key} className={`text-[11px] ${
                            check.ok ? 'text-emerald-800' : 'text-red-800'
                          }`}>
                            <span className="font-semibold">{check.ok ? 'OK' : 'Alerta'} — {check.label}:</span>{' '}
                            {check.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {selected.source.processing_error && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{selected.source.processing_error}</p>}
                  {selected.source.processing_result && (
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-violet-700">Material de estudo</p>
                      <p className="max-h-52 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-gray-700">{selected.source.processing_result}</p>
                    </div>
                  )}
                  {(selected.source.cleaned_transcription || selected.source.cleaned_extraction_text) && (
                    <div>
                      <div className="flex flex-wrap gap-2">
                        {selected.source.cleaned_transcription && (
                          <button type="button" onClick={() => setVisibleProcessedText((current) => current === 'transcription' ? null : 'transcription')}
                            className="rounded-md border border-violet-200 bg-white px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50">
                            Transcrição
                          </button>
                        )}
                        {selected.source.cleaned_extraction_text && (
                          <button type="button" onClick={() => setVisibleProcessedText((current) => current === 'extraction' ? null : 'extraction')}
                            className="rounded-md border border-violet-200 bg-white px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50">
                            Extração
                          </button>
                        )}
                      </div>
                      {visibleProcessedText && (
                        <p className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-md bg-white p-2 text-xs leading-relaxed text-gray-700">
                          {visibleProcessedText === 'transcription'
                            ? selected.source.cleaned_transcription
                            : selected.source.cleaned_extraction_text}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {!selected && (
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Conteúdo principal</p>
              {fallbackContent.trim() ? (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{fallbackContent}</p>
              ) : sources.length > 0 ? (
                <p className="mt-2 text-sm text-gray-500">A mídia será exibida aqui quando o envio for concluído.</p>
              ) : (
                <p className="mt-2 text-sm italic text-gray-400">Adicione uma mídia ou escreva anotações para começar esta nota.</p>
              )}
            </div>
          )}
        </div>
      )}

      {canEdit && (
        <div className="rounded-xl border border-dashed border-primary-200 bg-primary-50/50 p-3">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={NOTE_SOURCE_ACCEPT}
            onChange={handleFiles}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading.length > 0}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-white border border-primary-200 px-3 py-2.5 text-sm font-semibold text-primary-700 hover:bg-primary-50 disabled:opacity-60 transition"
          >
            {uploading.length > 0
              ? <><Loader2 className="w-4 h-4 animate-spin" />Enviando {uploading.length} arquivo(s)…</>
              : <><Upload className="w-4 h-4" />Adicionar mídias à nota</>}
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-primary-700">
            A primeira mídia é exibida como conteúdo principal. Adicione imagens, vídeos, áudios, textos ou documentos extras — até 500 MB por arquivo.
          </p>
        </div>
      )}

      {!loading && sources.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Mídias e arquivos da nota</p>
          <ul className="space-y-2">
            {sources.map((source) => (
              <li key={source.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${selected?.source.id === source.id ? 'border-primary-300 bg-primary-50/40' : 'border-gray-100 bg-white'}`}>
                <span className="shrink-0 text-primary-600">{sourceIcon(source)}</span>
                <button
                  type="button"
                  disabled={source.status !== 'ready' || busyId === source.id}
                  onClick={() => void openSource(source)}
                  className="min-w-0 flex-1 text-left disabled:cursor-default"
                >
                  <span className="block truncate text-sm font-medium text-gray-700 hover:text-primary-700">{source.original_name}</span>
                    <span className="block text-[11px] text-gray-400">
                     {source.status === 'ready' ? `${formatSize(Number(source.size_bytes))} · ${processingLabel(source)}` : 'Upload pendente'}
                  </span>
                </button>
                {busyId === source.id ? <Loader2 className="w-4 h-4 animate-spin text-primary-500" /> : (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button type="button" title="Visualizar" onClick={() => void openSource(source)}
                      disabled={source.status !== 'ready'} className="rounded p-1.5 text-gray-400 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-40">
                      <ExternalLink className="w-4 h-4" />
                    </button>
                    <button type="button" title="Baixar" onClick={() => void openSource(source, true)}
                      disabled={source.status !== 'ready'} className="rounded p-1.5 text-gray-400 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-40">
                      <Download className="w-4 h-4" />
                    </button>
                    {canEdit && <button type="button" title="Excluir" onClick={() => void deleteSource(source)}
                      className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600">
                      <Trash2 className="w-4 h-4" />
                    </button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}