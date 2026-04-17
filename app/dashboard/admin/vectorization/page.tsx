'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Database, Zap, Play, RefreshCw, CheckCircle2,
  Clock, AlertCircle, ChevronRight, ExternalLink,
  Code2, Layers, Activity, BookOpen,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PgVectorStats {
  total: number;
  withEmbedding: number;
  pending: number;
  percent: number;
}

interface PineconeStats {
  enabled: boolean;
  indexName?: string;
  vectorCount?: number;
  indexFullness?: number;
  error?: string;
}

interface DeCSStats {
  total: number;
  withEmbedding: number;
  pending: number;
  percent: number;
  available: boolean;
}

interface StatusData {
  pgvector: PgVectorStats;
  pinecone: PineconeStats;
  decs: DeCSStats;
}

interface BatchOptions {
  concurrency: number;
  delay: number;
  limit: number;
  noResume: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('token') ?? '';
}

function fmtNum(n: number): string {
  return n.toLocaleString('pt-BR');
}

function etaLabel(pending: number, concurrency: number, delayMs: number): string {
  if (pending <= 0) return '—';
  const reqPerSec = concurrency / (1 + delayMs / 1000);
  const seconds   = Math.round(pending / reqPerSec);
  if (seconds < 60)  return `~${seconds}s`;
  if (seconds < 3600) return `~${Math.round(seconds / 60)}min`;
  return `~${(seconds / 3600).toFixed(1)}h`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FnBadge({ name }: { name: string }) {
  return (
    <code className="inline-block px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-[11px] font-mono border border-gray-200">
      {name}
    </code>
  );
}

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function VectorizationPage() {
  const [status, setStatus]     = useState<StatusData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [lastStarted, setLastStarted] = useState<string | null>(null);

  const [opts, setOpts] = useState<BatchOptions>({
    concurrency: 3,
    delay: 350,
    limit: 0,
    noResume: false,
  });

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/embed-batch', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh every 8 s
  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 8000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  async function startBatch() {
    setStarting(true);
    try {
      const res = await fetch('/api/admin/embed-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify(opts),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erro ao iniciar');
      setLastStarted(
        `Batch iniciado (PID ${data.pid}) — backends: ${data.backends.join(' + ')}`
      );
      setTimeout(fetchStatus, 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setStarting(false);
    }
  }

  const pg = status?.pgvector;
  const pc = status?.pinecone;
  const dc = status?.decs;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Layers className="w-6 h-6 text-indigo-600" />
          Vetorização de Questões
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Gera embeddings com <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">gemini-embedding-001</code> (3072 dims)
          e armazena nos dois backends configurados.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {lastStarted && (
        <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {lastStarted}
        </div>
      )}

      {/* Backend cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* ── pgvector ── */}
        <div className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-100">
              <Database className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">pgvector</p>
              <p className="text-xs text-gray-500">Coluna <code className="bg-gray-100 px-1 rounded">vector(3072)</code> no PostgreSQL</p>
            </div>
          </div>

          {/* Progress */}
          {loading ? (
            <div className="h-3 bg-gray-100 rounded-full animate-pulse" />
          ) : pg ? (
            <div className="space-y-1.5">
              <ProgressBar percent={pg.percent} color="bg-blue-500" />
              <div className="flex justify-between text-xs text-gray-500">
                <span>{fmtNum(pg.withEmbedding)} indexadas</span>
                <span className="font-medium">{pg.percent}%</span>
                <span>{fmtNum(pg.total)} total</span>
              </div>
              {pg.pending > 0 && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {fmtNum(pg.pending)} pendentes · ETA {etaLabel(pg.pending, opts.concurrency, opts.delay)}
                </p>
              )}
              {pg.pending === 0 && (
                <p className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Todas as questões vetorizadas
                </p>
              )}
            </div>
          ) : null}

          {/* Functions */}
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <p className="text-xs font-semibold text-gray-500 flex items-center gap-1">
              <Code2 className="w-3 h-3" /> Funções em <code className="bg-gray-100 px-1 rounded">lib/embeddings.ts</code>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[
                'generateEmbedding()',
                'buildQuestionText()',
                'saveQuestionEmbedding()',
                'getQuestionEmbedding()',
                'findSimilarQuestions()',
                'semanticSearchQuestions()',
                'ensureEmbeddingColumn()',
                'ensureEmbeddingIndex()',
              ].map((fn) => <FnBadge key={fn} name={fn} />)}
            </div>
            <p className="text-[11px] text-gray-400">
              Índice: HNSW com <code className="bg-gray-100 px-1 rounded">vector_cosine_ops</code>
            </p>
          </div>

          {/* Search example */}
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
            <p className="text-[11px] font-semibold text-gray-500 mb-1">Busca semântica (SQL)</p>
            <pre className="text-[10px] text-gray-600 leading-relaxed overflow-x-auto">{`SELECT id, statement,
  1 - (embedding <=> $1::vector) AS score
FROM questions
WHERE embedding IS NOT NULL
ORDER BY embedding <=> $1::vector
LIMIT 10`}</pre>
          </div>
        </div>

        {/* ── Pinecone ── */}
        <div className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-purple-100">
              <Zap className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">Pinecone</p>
              <p className="text-xs text-gray-500">Serverless · AWS us-east-1 · cosine</p>
            </div>
          </div>

          {/* Status */}
          {loading ? (
            <div className="h-3 bg-gray-100 rounded-full animate-pulse" />
          ) : pc?.enabled === false ? (
            <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200 text-amber-700 text-xs">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              PINECONE_API_KEY não configurada — usando apenas pgvector
            </div>
          ) : pc?.error ? (
            <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg border border-red-200 text-red-700 text-xs">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {pc.error}
            </div>
          ) : pc ? (
            <div className="space-y-2">
              {pg && pc.vectorCount !== undefined && (
                <>
                  <ProgressBar
                    percent={pg.total > 0 ? Math.round((pc.vectorCount / pg.total) * 100 * 10) / 10 : 0}
                    color="bg-purple-500"
                  />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{fmtNum(pc.vectorCount)} vectors</span>
                    <span className="font-medium">
                      {pg.total > 0 ? Math.round((pc.vectorCount / pg.total) * 100 * 10) / 10 : 0}%
                    </span>
                    <span>{fmtNum(pg.total)} total</span>
                  </div>
                </>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-purple-50 rounded-lg p-2 border border-purple-100">
                  <p className="text-purple-500 font-medium">Index</p>
                  <p className="text-gray-700 font-mono text-[11px] truncate">{pc.indexName}</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-2 border border-purple-100">
                  <p className="text-purple-500 font-medium">Fullness</p>
                  <p className="text-gray-700">{((pc.indexFullness ?? 0) * 100).toFixed(2)}%</p>
                </div>
              </div>
              {pc.vectorCount === pg?.withEmbedding && pc.vectorCount! > 0 && (
                <p className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Sincronizado com pgvector
                </p>
              )}
            </div>
          ) : null}

          {/* Functions */}
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <p className="text-xs font-semibold text-gray-500 flex items-center gap-1">
              <Code2 className="w-3 h-3" /> Funções em <code className="bg-gray-100 px-1 rounded">lib/pinecone.ts</code>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[
                'isPineconeEnabled()',
                'getPineconeClient()',
                'getPineconeIndex()',
                'upsertQuestionEmbedding()',
                'queryPineconeSimilar()',
                'deleteQuestionEmbedding()',
                'getPineconeIndexStats()',
              ].map((fn) => <FnBadge key={fn} name={fn} />)}
            </div>
            <p className="text-[11px] text-gray-400">
              Vector ID: <code className="bg-gray-100 px-1 rounded">q-{'{questionId}'}</code> ·
              Metadata: statement_preview, exam_year, exam_board, tags
            </p>
          </div>

          {/* Search example */}
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
            <p className="text-[11px] font-semibold text-gray-500 mb-1">Busca semântica (Pinecone)</p>
            <pre className="text-[10px] text-gray-600 leading-relaxed overflow-x-auto">{`await index.query({
  vector: embedding,   // number[3072]
  topK: 10,
  includeMetadata: true,
})`}</pre>
          </div>
        </div>
      </div>

      {/* ── DeCS 2026 card ── */}
      <div className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-teal-100">
            <BookOpen className="w-4 h-4 text-teal-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-sm">DeCS 2026 — Vocabulário Local</p>
            <p className="text-xs text-gray-500">
              35.034 descritores · pgvector cosine · tabela{' '}
              <code className="bg-gray-100 px-1 rounded">decs_descriptors</code>
            </p>
          </div>
        </div>

        {loading ? (
          <div className="h-3 bg-gray-100 rounded-full animate-pulse" />
        ) : !dc?.available ? (
          <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200 text-amber-700 text-xs">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>
              Tabela vazia. Execute:{' '}
              <code className="font-mono bg-amber-100 px-1 rounded">
                node --env-file=.env.local scripts/import-decs-xml.mjs
              </code>
              {' '}e depois{' '}
              <code className="font-mono bg-amber-100 px-1 rounded">
                node --env-file=.env.local scripts/embed-decs-descriptors.mjs
              </code>
            </span>
          </div>
        ) : dc ? (
          <div className="space-y-3">
            {/* Progress bar */}
            <div className="space-y-1.5">
              <ProgressBar percent={dc.percent} color="bg-teal-500" />
              <div className="flex justify-between text-xs text-gray-500">
                <span>{fmtNum(dc.withEmbedding)} vetorizados</span>
                <span className="font-medium">{dc.percent}%</span>
                <span>{fmtNum(dc.total)} total</span>
              </div>
              {dc.pending > 0 && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {fmtNum(dc.pending)} pendentes · execute embed-decs-descriptors.mjs
                </p>
              )}
              {dc.pending === 0 && dc.total > 0 && (
                <p className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Todos os descritores vetorizados
                </p>
              )}
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-teal-50 rounded-lg p-2 border border-teal-100 text-center">
                <p className="text-teal-500 font-medium">Descritores</p>
                <p className="text-gray-800 font-semibold">{fmtNum(dc.total)}</p>
              </div>
              <div className="bg-teal-50 rounded-lg p-2 border border-teal-100 text-center">
                <p className="text-teal-500 font-medium">Embeddings</p>
                <p className="text-gray-800 font-semibold">{fmtNum(dc.withEmbedding)}</p>
              </div>
              <div className="bg-teal-50 rounded-lg p-2 border border-teal-100 text-center">
                <p className="text-teal-500 font-medium">Modelo</p>
                <p className="text-gray-800 font-mono text-[10px]">gemini-emb-001</p>
              </div>
            </div>
          </div>
        ) : null}

        {/* Functions */}
        <div className="border-t border-gray-100 pt-3 space-y-2">
          <p className="text-xs font-semibold text-gray-500 flex items-center gap-1">
            <Code2 className="w-3 h-3" /> Pipeline em{' '}
            <code className="bg-gray-100 px-1 rounded">lib/decs-pipeline.ts</code>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[
              'searchDeCSLocal()',
              'findBestDeCSMatch()',
              'isLocalDeCSAvailable()',
              'isCategoryAcceptable()',
              'validateWithGemini()',
            ].map((fn) => <FnBadge key={fn} name={fn} />)}
          </div>
          <p className="text-[11px] text-gray-400">
            Estratégia: pgvector local → fallback BVS API · Índice HNSW cosine
          </p>
        </div>

        {/* Search example */}
        <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
          <p className="text-[11px] font-semibold text-gray-500 mb-1">Busca local DeCS (pgvector)</p>
          <pre className="text-[10px] text-gray-600 leading-relaxed overflow-x-auto">{`SELECT ui, name_pt,
  1 - (embedding <=> $1::vector) AS score
FROM decs_descriptors
WHERE embedding IS NOT NULL
ORDER BY embedding <=> $1::vector
LIMIT 5`}</pre>
        </div>
      </div>

      {/* Batch script info */}
      <div className="border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Activity className="w-4 h-4 text-gray-500" />
          <p className="font-semibold text-gray-900 text-sm">Executor do Batch</p>
          <code className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600 ml-1">
            scripts/batch-embed-questions.mjs
          </code>
        </div>

        <div className="p-5 space-y-5">
          {/* Options */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Concorrência
                <span className="ml-1 text-gray-400 font-normal">(req paralelas)</span>
              </label>
              <input
                type="number" min={1} max={10} value={opts.concurrency}
                onChange={(e) => setOpts((o) => ({ ...o, concurrency: parseInt(e.target.value) || 3 }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Delay (ms)
                <span className="ml-1 text-gray-400 font-normal">(entre batches)</span>
              </label>
              <input
                type="number" min={100} step={50} value={opts.delay}
                onChange={(e) => setOpts((o) => ({ ...o, delay: parseInt(e.target.value) || 350 }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Limite
                <span className="ml-1 text-gray-400 font-normal">(0 = todas)</span>
              </label>
              <input
                type="number" min={0} value={opts.limit}
                onChange={(e) => setOpts((o) => ({ ...o, limit: parseInt(e.target.value) || 0 }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 text-xs font-medium text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox" checked={opts.noResume}
                  onChange={(e) => setOpts((o) => ({ ...o, noResume: e.target.checked }))}
                  className="rounded border-gray-300 text-indigo-600"
                />
                Re-embedar existentes
              </label>
            </div>
          </div>

          {/* ETA preview */}
          <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
            <Clock className="w-3.5 h-3.5" />
            Com concorrência {opts.concurrency} e delay {opts.delay}ms:
            <span className="font-medium text-gray-700">
              ~{((opts.concurrency / (1 + opts.delay / 1000))).toFixed(1)} req/s
            </span>
            {pg && pg.pending > 0 && (
              <span>
                · ETA para {fmtNum(pg.pending)} pendentes:
                <span className="font-semibold text-indigo-600 ml-1">
                  {etaLabel(pg.pending, opts.concurrency, opts.delay)}
                </span>
              </span>
            )}
          </div>

          {/* Action row */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={startBatch}
              disabled={starting}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {starting
                ? <RefreshCw className="w-4 h-4 animate-spin" />
                : <Play className="w-4 h-4" />}
              {starting ? 'Iniciando…' : 'Iniciar batch'}
            </button>

            <button
              onClick={() => { setLoading(true); fetchStatus(); }}
              className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Atualizar
            </button>

            <span className="text-xs text-gray-400 ml-auto">
              Auto-refresh a cada 8s
            </span>
          </div>

          {/* Script CLI hint */}
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-500 font-medium mb-1.5">
              Ou execute diretamente no terminal:
            </p>
            <div className="bg-gray-900 rounded-lg px-4 py-3 flex items-start gap-2">
              <ChevronRight className="w-3.5 h-3.5 text-green-400 mt-0.5 flex-shrink-0" />
              <code className="text-[11px] text-green-300 font-mono leading-relaxed">
                node scripts/batch-embed-questions.mjs
                --concurrency {opts.concurrency}
                --delay {opts.delay}
                {opts.limit > 0 ? ` --limit ${opts.limit}` : ''}
                {opts.noResume ? ' --no-resume' : ''}
              </code>
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              Grava progresso em <code className="bg-gray-100 px-1 rounded">embedding_results.json</code>.
              O processo roda em background — monitore o progresso pelo painel acima.
            </p>
          </div>
        </div>
      </div>

      {/* API routes reference */}
      <div className="border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <ExternalLink className="w-4 h-4 text-gray-500" />
          <p className="font-semibold text-gray-900 text-sm">Rotas de API</p>
        </div>
        <div className="divide-y divide-gray-100">
          {[
            {
              method: 'GET', path: '/api/admin/embed-batch',
              desc: 'Progresso ao vivo (pgvector + Pinecone)',
              file: 'app/api/admin/embed-batch/route.ts',
            },
            {
              method: 'POST', path: '/api/admin/embed-batch',
              desc: 'Inicia o batch em background (detached)',
              file: 'app/api/admin/embed-batch/route.ts',
            },
            {
              method: 'GET', path: '/api/pinecone/status',
              desc: 'Stats do índice Pinecone',
              file: 'app/api/pinecone/status/route.ts',
            },
            {
              method: 'POST', path: '/api/questions/[id]/embedding',
              desc: 'Gera e salva embedding de uma questão',
              file: 'app/api/questions/[id]/embedding/route.ts',
            },
            {
              method: 'GET', path: '/api/questions/semantic-search',
              desc: 'Busca semântica por texto livre',
              file: 'app/api/questions/semantic-search/route.ts',
            },
          ].map(({ method, path, desc, file }) => (
            <div key={`${method}${path}`} className="px-5 py-3 flex items-center gap-3">
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded font-mono ${
                method === 'GET' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
              }`}>
                {method}
              </span>
              <code className="text-xs text-gray-800 font-mono">{path}</code>
              <span className="text-xs text-gray-500 flex-1 hidden sm:block">{desc}</span>
              <code className="text-[10px] text-gray-400 hidden md:block">{file}</code>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
