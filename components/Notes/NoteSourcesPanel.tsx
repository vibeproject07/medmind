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

function isPreviewable(source: NoteSource): boolean {
  return source.category === 'image' || source.category === 'audio' || source.category === 'video';
}

export default function NoteSourcesPanel({
  noteId,
  canEdit,
  compact = false,
}: {
  noteId: number;
  canEdit: boolean;
  compact?: boolean;
}) {
  const [sources, setSources] = useState<NoteSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [processedOutput, setProcessedOutput] = useState<{ sourceId: number; text: string } | null>(null);
  const [preview, setPreview] = useState<{ source: NoteSource; url: string } | null>(null);
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

  useEffect(() => { void loadSources(); }, [loadSources]);

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
      } catch (err) {
        setError(err instanceof Error ? `${file.name}: ${err.message}` : `Falha ao enviar ${file.name}.`);
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

  const openSource = async (source: NoteSource, download = false) => {
    setBusyId(source.id);
    try {
      const url = await requestUrl(source, download);
      if (isPreviewable(source) && !download) setPreview({ source, url });
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
      const data = await readJson<{ text?: string; originalText?: string }>(response);
      if (!response.ok || !data.text) throw new Error(data.error || 'Não foi possível processar o arquivo.');
      setProcessedOutput({ sourceId: source.id, text: data.text });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível processar o arquivo.');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <section className={compact ? '' : 'space-y-3'}>
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
              : <><Upload className="w-4 h-4" />Adicionar arquivos privados</>}
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-primary-700">
            PDF, Word, slides, texto, imagem, áudio ou vídeo — até 500 MB por arquivo.
          </p>
        </div>
      )}

      {error && (
        <div className="flex gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="mt-0.5 w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />Carregando arquivos…
        </div>
      ) : sources.length === 0 ? (
        <p className="py-2 text-sm text-gray-500">Nenhum arquivo privado anexado a esta nota.</p>
      ) : (
        <ul className="space-y-2">
          {sources.map((source) => (
            <li key={source.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-2.5 py-2">
              <span className="shrink-0 text-primary-600">{sourceIcon(source)}</span>
              <button
                type="button"
                disabled={source.status !== 'ready' || busyId === source.id}
                onClick={() => void openSource(source)}
                className="min-w-0 flex-1 text-left disabled:cursor-default"
              >
                <span className="block truncate text-sm font-medium text-gray-700 hover:text-primary-700">{source.original_name}</span>
                <span className="block text-[11px] text-gray-400">
                  {source.status === 'ready' ? formatSize(Number(source.size_bytes)) : 'Upload pendente'}
                </span>
              </button>
              {busyId === source.id ? <Loader2 className="w-4 h-4 animate-spin text-primary-500" /> : (
                <div className="flex shrink-0 items-center gap-0.5">
                  <button type="button" title="Abrir" onClick={() => void openSource(source)}
                    disabled={source.status !== 'ready'} className="rounded p-1.5 text-gray-400 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-40">
                    <ExternalLink className="w-4 h-4" />
                  </button>
                  <button type="button" title="Baixar" onClick={() => void openSource(source, true)}
                    disabled={source.status !== 'ready'} className="rounded p-1.5 text-gray-400 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-40">
                    <Download className="w-4 h-4" />
                  </button>
                  <button type="button" title="Processar com IA" onClick={() => void processSource(source)}
                    disabled={source.status !== 'ready' || processingId !== null} className="rounded p-1.5 text-gray-400 hover:bg-violet-50 hover:text-violet-600 disabled:opacity-40">
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
      )}

      {processedOutput && (
        <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-violet-800">
              <Sparkles className="w-3.5 h-3.5" />Resultado do processamento
            </p>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(processedOutput.text).catch(() => setError('Não foi possível copiar o resultado.'))}
              className="text-xs font-medium text-violet-700 hover:text-violet-900"
            >
              Copiar
            </button>
          </div>
          <p className="max-h-52 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-gray-700">
            {processedOutput.text}
          </p>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true">
          <div className="relative max-h-[90vh] w-full max-w-4xl rounded-xl bg-white p-4 shadow-2xl">
            <button type="button" onClick={() => setPreview(null)} className="absolute right-3 top-3 rounded p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Fechar prévia">
              <X className="w-5 h-5" />
            </button>
            <p className="mb-3 truncate pr-9 text-sm font-semibold text-gray-700">{preview.source.original_name}</p>
            {preview.source.category === 'image' && <img src={preview.url} alt={preview.source.original_name} className="mx-auto max-h-[76vh] max-w-full rounded object-contain" />}
            {preview.source.category === 'audio' && <audio src={preview.url} controls className="w-full" />}
            {preview.source.category === 'video' && <video src={preview.url} controls className="max-h-[76vh] w-full rounded bg-black" />}
          </div>
        </div>
      )}
    </section>
  );
}