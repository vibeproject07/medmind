'use client';

import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
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
): Promise<NoteSource> {
  const auth = { Authorization: `Bearer ${token.trim().replace(/^["']|["']$/g, '')}` };
  const checksumSha256 = await sha256(file);
  const prepare = await fetch(`/api/notes/${noteId}/sources`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      checksumSha256,
    }),
  });
  const prepared = await readJson<UploadResponse>(prepare);
  if (!prepare.ok || !prepared.uploadUrl || !prepared.source) {
    throw new Error(prepared.error || 'Não foi possível preparar o envio deste arquivo.');
  }

  try {
    const formData = new FormData();
    Object.entries(prepared.uploadFields).forEach(([name, value]) => formData.append(name, value));
    formData.append('file', file);
    const put = await fetch(prepared.uploadUrl, {
      method: 'POST',
      body: formData,
    });
    if (!put.ok) throw new Error('O S3 recusou o envio do arquivo.');

    const complete = await fetch(`/api/notes/${noteId}/sources/${prepared.source.id}/complete`, {
      method: 'POST',
      headers: auth,
    });
    const completed = await readJson<{ source: NoteSource }>(complete);
    if (!complete.ok || !completed.source) {
      throw new Error(completed.error || 'O arquivo foi enviado, mas não pôde ser confirmado.');
    }
    return completed.source;
  } catch (error) {
    await fetch(`/api/notes/${noteId}/sources/${prepared.source.id}`, {
      method: 'DELETE',
      headers: auth,
    }).catch(() => undefined);
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
}: {
  noteId: number;
  canEdit: boolean;
  compact?: boolean;
  fallbackContent?: string;
  onPrimaryAvailabilityChange?: (available: boolean) => void;
}) {
  const [sources, setSources] = useState<NoteSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [selected, setSelected] = useState<{ source: NoteSource; url: string } | null>(null);
  const [selectedByUser, setSelectedByUser] = useState(false);
  const [failedUploads, setFailedUploads] = useState<{ file: File; error: string }[]>([]);
  const [retryFileNames, setRetryFileNames] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const token = () => localStorage.getItem('token')?.trim().replace(/^["']|["']$/g, '') || '';

  const loadSources = useCallback(async () => {
    const accessToken = token();
    if (!accessToken) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/notes/${noteId}/sources`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await readJson<{ sources: NoteSource[] }>(response);
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar as fontes.');
      setSources(data.sources || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as fontes.');
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    setSelected(null);
    setSelectedByUser(false);
    setSources([]);
    onPrimaryAvailabilityChange?.(false);
    void loadSources();
  }, [loadSources, onPrimaryAvailabilityChange]);

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

  const selectSource = async (source: NoteSource) => {
    setBusyId(source.id);
    try {
      const url = await requestUrl(source);
      setSelected({ source, url });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível abrir o arquivo.');
    } finally {
      setBusyId(null);
    }
  };

  const openSource = async (source: NoteSource, download = false) => {
    setBusyId(source.id);
    try {
      const url = await requestUrl(source, download);
      if (!download) {
        setSelectedByUser(true);
        setSelected({ source, url });
      }
      else window.open(url, '_blank', 'noopener,noreferrer');
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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível excluir o arquivo.');
    } finally {
      setBusyId(null);
    }
  };

  const processSource = async (source: NoteSource) => {
    const accessToken = token();
    if (!accessToken) return;
    setError(null);
    setProcessingId(source.id);
    try {
      const response = await fetch(`/api/notes/${noteId}/sources/${source.id}/process`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await readJson<{ source?: NoteSource }>(response);
      if (!response.ok || !data.source) throw new Error(data.error || 'Não foi possível colocar o arquivo na fila.');
      setSources((current) => current.map((item) => item.id === source.id ? data.source! : item));
      setSelected((current) => current?.source.id === source.id ? { ...current, source: data.source! } : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível processar o arquivo.');
    } finally {
      setProcessingId(null);
    }
  };

  useEffect(() => {
    const current = selected?.source;
    if (!current) return;
    const replacement = sources.find((source) => source.id === current.id);
    if (replacement) setSelected((value) => value ? { ...value, source: replacement } : value);
  }, [sources]); // Keep the selected viewer in sync with poll results.

  useEffect(() => {
    if (selectedByUser || busyId !== null) return;
    const firstReadySource = sources.find((source) => source.status === 'ready');
    if (firstReadySource && selected?.source.id !== firstReadySource.id) {
      void selectSource(firstReadySource);
    }
  }, [sources, selected?.source.id, selectedByUser, busyId]); // Keep the first completed upload as primary.

  useEffect(() => {
    if (!loading) onPrimaryAvailabilityChange?.(sources.some((source) => source.status === 'ready'));
  }, [loading, onPrimaryAvailabilityChange, sources]);

  useEffect(() => {
    if (!sources.some((source) => source.processing_status === 'queued' || source.processing_status === 'processing')) return;
    const interval = window.setInterval(() => { void loadSources(); }, 3000);
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
                {selected.source.category === 'video' && <video src={selected.url} controls className="max-h-[28rem] w-full rounded bg-black" />}
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
                  {selected.source.processing_error && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{selected.source.processing_error}</p>}
                  {selected.source.processing_result && (
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-violet-700">Material de estudo</p>
                      <p className="max-h-52 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-gray-700">{selected.source.processing_result}</p>
                    </div>
                  )}
                  {selected.source.processing_original_text && (
                    <details>
                      <summary className="cursor-pointer text-xs font-medium text-violet-700">Ver texto extraído ou transcrição</summary>
                      <p className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-gray-700">{selected.source.processing_original_text}</p>
                    </details>
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
                    <button type="button" title="Processar com IA" onClick={() => void processSource(source)}
                      disabled={
                        source.status !== 'ready' ||
                        processingId !== null ||
                        source.processing_status === 'queued' ||
                        source.processing_status === 'processing'
                      } className="rounded p-1.5 text-gray-400 hover:bg-violet-50 hover:text-violet-600 disabled:opacity-40">
                      {processingId === source.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
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