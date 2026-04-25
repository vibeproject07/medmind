'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  FlaskConical, Play, StopCircle, RefreshCw, Trash2,
  CheckCircle2, AlertCircle, Clock, ChevronLeft,
  TrendingUp, Layers, Zap,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RunRecord {
  question_id: number;
  v1_status: string;
  v1_primary: number;
  v1_secondary: number;
  v1_time_ms: number | null;
  v1_error?: string;
  v2_status: string;
  v2_primary: number;
  v2_secondary: number;
  v2_time_ms: number | null;
  v2_error?: string;
  overlap_count: number;
  tested_at: string;
}

interface TestStats {
  avgV1: string;
  avgV2: string;
  avgOverlap: string;
  avgV1ms: number | null;
  avgV2ms: number | null;
}

interface TestStatus {
  total: number;
  done: number;
  pending: number;
  v1: { ok: number; error: number };
  v2: { ok: number; error: number };
  stats: TestStats;
  runs: RunRecord[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getToken() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('token') ?? '';
}

function pct(a: number, b: number) {
  if (b === 0) return 0;
  return Math.round((a / b) * 100);
}

function statusBadge(status: string, error?: string) {
  if (status === 'ok') return (
    <span className="inline-flex items-center gap-1 text-emerald-600 text-xs">
      <CheckCircle2 className="h-3 w-3" /> ok
    </span>
  );
  if (status === 'error') return (
    <span className="inline-flex items-center gap-1 text-red-500 text-xs" title={error}>
      <AlertCircle className="h-3 w-3" /> erro
    </span>
  );
  return <span className="text-gray-400 text-xs">—</span>;
}

function ProgressBar({ value, total, color }: { value: number; total: number; color: string }) {
  const pctVal = pct(value, total);
  return (
    <div className="w-full bg-gray-100 rounded-full h-2">
      <div
        className={`h-2 rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${pctVal}%` }}
      />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DecsTestPage() {
  const router = useRouter();
  const [status, setStatus] = useState<TestStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [batchSize, setBatchSize] = useState(3);
  const autoRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString('pt-BR');
    setLog((prev) => [...prev.slice(-199), `[${ts}] ${msg}`]);
  };

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/decs-batch-test', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) { addLog(`Erro ao buscar status: ${res.status}`); return; }
      const data = await res.json() as TestStatus;
      setStatus(data);
    } catch (e) {
      addLog(`Erro de rede: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Scroll log to bottom
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const runBatch = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/admin/decs-batch-test', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ batch_size: batchSize }),
      });
      if (!res.ok) {
        addLog(`Erro HTTP ${res.status}`);
        return false;
      }
      const data = await res.json() as {
        processed: Array<{
          question_id: number;
          v1_status: string; v1_primary: number; v1_secondary: number; v1_time_ms: number | null;
          v2_status: string; v2_primary: number; v2_secondary: number; v2_time_ms: number | null;
          overlap_count: number;
        }>;
        remaining: number;
        message?: string;
      };
      if (data.message) {
        addLog(data.message);
        return false;
      }
      for (const r of data.processed) {
        const v1 = r.v1_status === 'ok'
          ? `V1: ${r.v1_primary}p+${r.v1_secondary}s (${r.v1_time_ms ?? '?'}ms)`
          : `V1: ERRO`;
        const v2 = r.v2_status === 'ok'
          ? `V2: ${r.v2_primary}p+${r.v2_secondary}s (${r.v2_time_ms ?? '?'}ms) overlap=${r.overlap_count}`
          : `V2: ERRO`;
        addLog(`Q#${r.question_id} — ${v1} | ${v2}`);
      }
      addLog(`Restantes: ${data.remaining}`);
      await fetchStatus();
      return data.remaining > 0;
    } catch (e) {
      addLog(`Erro: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }, [batchSize, fetchStatus]);

  const startAuto = useCallback(async () => {
    autoRef.current = true;
    setRunning(true);
    addLog('Iniciando execução automática…');
    while (autoRef.current) {
      const more = await runBatch();
      if (!more) break;
    }
    setRunning(false);
    addLog('Execução concluída.');
  }, [runBatch]);

  const stopAuto = () => {
    autoRef.current = false;
    setRunning(false);
    addLog('Parado pelo usuário.');
  };

  const handleReset = async () => {
    if (!confirm('Apagar todos os resultados de teste? Essa ação não pode ser desfeita.')) return;
    await fetch('/api/admin/decs-batch-test', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    setLog([]);
    addLog('Resultados resetados.');
    await fetchStatus();
  };

  const progressPct = status ? pct(status.done, status.total) : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <FlaskConical className="h-6 w-6 text-violet-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Teste A/B — Pipeline DeCS</h1>
            <p className="text-sm text-gray-500">Compara V1 (keyword search) e V2 (RAG + hierarquia) nas 100 questões mais recentes</p>
          </div>
        </div>

        {/* Controls */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Questões por lote:</label>
              <select
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                disabled={running}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
              >
                {[1, 2, 3, 5].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>

            <button
              onClick={runBatch}
              disabled={running || (status?.pending === 0)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition"
            >
              <Play className="h-4 w-4" />
              Rodar um lote
            </button>

            {!running ? (
              <button
                onClick={startAuto}
                disabled={status?.pending === 0}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition"
              >
                <Zap className="h-4 w-4" />
                Rodar tudo automaticamente
              </button>
            ) : (
              <button
                onClick={stopAuto}
                className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white text-sm font-medium rounded-lg hover:bg-red-600 transition"
              >
                <StopCircle className="h-4 w-4" />
                Parar
              </button>
            )}

            <button
              onClick={fetchStatus}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200 transition"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </button>

            <button
              onClick={handleReset}
              disabled={running}
              className="flex items-center gap-2 px-3 py-2 text-red-500 text-sm rounded-lg hover:bg-red-50 transition ml-auto"
            >
              <Trash2 className="h-4 w-4" />
              Resetar
            </button>
          </div>
        </div>

        {/* Progress + Stats */}
        {status && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">

            {/* Progress card */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 md:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-700">Progresso</h3>
                <span className="text-sm text-gray-500">{status.done} / {status.total} questões</span>
              </div>
              <ProgressBar value={status.done} total={status.total} color="bg-violet-500" />
              <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-gray-400 mb-1 uppercase tracking-wide">V1 (pipeline atual)</p>
                  <ProgressBar value={status.v1.ok} total={status.total} color="bg-indigo-400" />
                  <p className="text-xs text-gray-500 mt-1">
                    {status.v1.ok} ok · {status.v1.error} erros
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1 uppercase tracking-wide">V2 (RAG)</p>
                  <ProgressBar value={status.v2.ok} total={status.total} color="bg-emerald-400" />
                  <p className="text-xs text-gray-500 mt-1">
                    {status.v2.ok} ok · {status.v2.error} erros
                  </p>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-3">
                {progressPct}% completo · {status.pending} questões restantes
              </p>
            </div>

            {/* Stats card */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h3 className="font-semibold text-gray-700 mb-3">Estatísticas</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" />
                    Média desc. V1
                  </span>
                  <span className="font-semibold text-gray-700">{status.stats.avgV1}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                    Média desc. V2
                  </span>
                  <span className="font-semibold text-gray-700">{status.stats.avgV2}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-violet-400" />
                    Overlap médio
                  </span>
                  <span className="font-semibold text-gray-700">{status.stats.avgOverlap}</span>
                </div>
                <hr className="border-gray-100" />
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-indigo-300" />
                    Tempo médio V1
                  </span>
                  <span className="font-mono text-xs text-gray-600">
                    {status.stats.avgV1ms ? `${(status.stats.avgV1ms / 1000).toFixed(1)}s` : '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-emerald-300" />
                    Tempo médio V2
                  </span>
                  <span className="font-mono text-xs text-gray-600">
                    {status.stats.avgV2ms ? `${(status.stats.avgV2ms / 1000).toFixed(1)}s` : '—'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs text-violet-600">
                  <span className="flex items-center gap-1">
                    <TrendingUp className="h-3.5 w-3.5" />
                    V2 vs V1
                  </span>
                  <span className="font-semibold">
                    {status.stats.avgV1 !== '—' && status.stats.avgV2 !== '—'
                      ? `${(parseFloat(status.stats.avgV2) - parseFloat(status.stats.avgV1) >= 0 ? '+' : '')}${(parseFloat(status.stats.avgV2) - parseFloat(status.stats.avgV1)).toFixed(1)} desc.`
                      : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Log */}
        {log.length > 0 && (
          <div className="bg-gray-900 rounded-xl border border-gray-700 p-4 mb-6">
            <p className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Log de execução</p>
            <div ref={logRef} className="h-32 overflow-y-auto space-y-0.5">
              {log.map((line, i) => (
                <p key={i} className="text-xs font-mono text-gray-300">{line}</p>
              ))}
            </div>
          </div>
        )}

        {/* Results table */}
        {status && status.runs.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-700">Resultados por questão</h3>
              <span className="text-sm text-gray-400">{status.runs.length} processadas</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="text-left px-4 py-3">Questão</th>
                    <th className="text-center px-3 py-3 text-indigo-500">V1 primários</th>
                    <th className="text-center px-3 py-3 text-indigo-400">V1 secundários</th>
                    <th className="text-center px-3 py-3 text-indigo-300">V1 tempo</th>
                    <th className="text-center px-3 py-3 text-emerald-500">V2 primários</th>
                    <th className="text-center px-3 py-3 text-emerald-400">V2 secundários</th>
                    <th className="text-center px-3 py-3 text-emerald-300">V2 tempo</th>
                    <th className="text-center px-3 py-3 text-violet-500">Overlap</th>
                    <th className="text-center px-3 py-3">Status V1</th>
                    <th className="text-center px-3 py-3">Status V2</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {status.runs.map((r) => {
                    const v1Total = r.v1_primary + r.v1_secondary;
                    const v2Total = r.v2_primary + r.v2_secondary;
                    const v2Better = v2Total > v1Total;
                    return (
                      <tr key={r.question_id} className={`hover:bg-gray-50 transition ${v2Better ? 'bg-emerald-50/30' : ''}`}>
                        <td className="px-4 py-3">
                          <a
                            href={`/dashboard/questions/${r.question_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-600 hover:underline font-mono text-xs"
                          >
                            #{r.question_id}
                          </a>
                        </td>
                        <td className="text-center px-3 py-3 font-semibold text-indigo-600">{r.v1_status === 'ok' ? r.v1_primary : '—'}</td>
                        <td className="text-center px-3 py-3 text-gray-500">{r.v1_status === 'ok' ? r.v1_secondary : '—'}</td>
                        <td className="text-center px-3 py-3 font-mono text-xs text-gray-400">
                          {r.v1_time_ms ? `${(r.v1_time_ms / 1000).toFixed(1)}s` : '—'}
                        </td>
                        <td className="text-center px-3 py-3 font-semibold text-emerald-600">{r.v2_status === 'ok' ? r.v2_primary : '—'}</td>
                        <td className="text-center px-3 py-3 text-gray-500">{r.v2_status === 'ok' ? r.v2_secondary : '—'}</td>
                        <td className="text-center px-3 py-3 font-mono text-xs text-gray-400">
                          {r.v2_time_ms ? `${(r.v2_time_ms / 1000).toFixed(1)}s` : '—'}
                        </td>
                        <td className="text-center px-3 py-3">
                          <span className={`font-semibold ${r.overlap_count > 0 ? 'text-violet-600' : 'text-gray-300'}`}>
                            {r.overlap_count}
                          </span>
                        </td>
                        <td className="text-center px-3 py-3">{statusBadge(r.v1_status, r.v1_error)}</td>
                        <td className="text-center px-3 py-3">{statusBadge(r.v2_status, r.v2_error)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {status && status.runs.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <FlaskConical className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Nenhuma questão testada ainda. Clique em "Rodar um lote" para começar.</p>
          </div>
        )}

      </div>
    </div>
  );
}
