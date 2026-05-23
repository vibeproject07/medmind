'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, AlertCircle, Clock, X, Sparkles } from 'lucide-react';

export interface NoteDecsBatchJobView {
  id: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  items: {
    noteId: number;
    title: string;
    status: 'pending' | 'processing' | 'done' | 'error';
    error?: string;
    descriptorCount?: number;
  }[];
}

const STORAGE_KEY = 'notesDecsBatchJobId';

export function getStoredNotesDecsJobId(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(STORAGE_KEY);
}

export function storeNotesDecsJobId(jobId: string) {
  sessionStorage.setItem(STORAGE_KEY, jobId);
}

export function clearStoredNotesDecsJobId() {
  sessionStorage.removeItem(STORAGE_KEY);
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'processing') return <Loader2 className="w-4 h-4 text-violet-600 animate-spin flex-shrink-0" />;
  if (status === 'done') return <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />;
  if (status === 'error') return <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />;
  return <Clock className="w-4 h-4 text-gray-400 flex-shrink-0" />;
}

export default function NotesDecsBatchTracker({
  jobId,
  onDismiss,
  onComplete,
}: {
  jobId: string | null;
  onDismiss?: () => void;
  onComplete?: () => void;
}) {
  const [job, setJob] = useState<NoteDecsBatchJobView | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const completedNotified = useRef(false);

  useEffect(() => {
    completedNotified.current = false;
  }, [jobId]);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }

    let cancelled = false;
    const token = localStorage.getItem('token');
    if (!token) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/admin/notes-decs-classify-batch?jobId=${encodeURIComponent(jobId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.job) {
          setJob(data.job);
          if (data.job.status !== 'running' && !completedNotified.current) {
            completedNotified.current = true;
            onComplete?.();
          }
        }
      } catch { /* ignore */ }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId, onComplete]);

  if (!jobId || !job) return null;

  const done = job.items.filter((i) => i.status === 'done').length;
  const total = job.items.length;
  const processing = job.items.find((i) => i.status === 'processing');
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isRunning = job.status === 'running';

  const handleDismiss = () => {
    if (isRunning) return;
    clearStoredNotesDecsJobId();
    onDismiss?.();
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-full max-w-sm shadow-xl rounded-2xl border border-violet-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-violet-600 text-white">
        <div className="flex items-center gap-2 min-w-0">
          {isRunning ? (
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
          ) : (
            <Sparkles className="w-4 h-4 flex-shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">Classificação DeCS — notas</p>
            <p className="text-xs text-violet-100">
              {isRunning
                ? processing
                  ? `Processando: ${processing.title.slice(0, 40)}…`
                  : `${done}/${total} concluídas`
                : `Finalizado · ${done}/${total} com sucesso`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="p-1 rounded hover:bg-violet-500 text-xs"
          >
            {collapsed ? '▼' : '▲'}
          </button>
          {!isRunning && (
            <button type="button" onClick={handleDismiss} className="p-1 rounded hover:bg-violet-500" aria-label="Fechar">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="px-4 pt-3">
            <div className="h-2 bg-violet-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-violet-600 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1 text-right">{pct}%</p>
          </div>
          <ul className="max-h-52 overflow-y-auto px-2 py-2 space-y-1">
            {job.items.map((item) => (
              <li
                key={item.noteId}
                className={`flex items-start gap-2 px-2 py-1.5 rounded-lg text-xs ${
                  item.status === 'processing' ? 'bg-violet-50' : 'bg-gray-50/80'
                }`}
              >
                <StatusIcon status={item.status} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-800 truncate" title={item.title}>
                    {item.title}
                  </p>
                  {item.status === 'done' && item.descriptorCount != null && (
                    <p className="text-gray-500">{item.descriptorCount} descritor(es)</p>
                  )}
                  {item.status === 'error' && item.error && (
                    <p className="text-red-500 line-clamp-2">{item.error}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
