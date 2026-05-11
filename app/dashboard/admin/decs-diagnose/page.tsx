'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Play, ChevronDown, ChevronRight, CheckCircle2,
  AlertCircle, Clock, ChevronLeft, Microscope, Tag, Database,
  BrainCircuit, GitBranch, Loader2, Info,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface StepResult {
  step: number;
  title: string;
  agent?: { key: string; model: string; source: string };
  input_preview?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  elapsed_ms?: number;
  error?: string | null;
  status?: 'ok' | 'error' | 'empty';
}

interface DiagnoseResult {
  pipeline: 'v1' | 'v2';
  question_id: number;
  steps: StepResult[];
  final: {
    primary: Array<{ code: string; term: string }>;
    secondary: Array<{ code: string; term: string }>;
  } | null;
  error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getToken() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('token') ?? '';
}

function stepIcon(step: number) {
  const icons = [Microscope, Search, Database, BrainCircuit, GitBranch];
  const Icon = icons[(step - 1) % icons.length] || Info;
  return <Icon className="w-4 h-4" />;
}

function statusBadge(status?: string, error?: string | null) {
  if (error) return <span className="flex items-center gap-1 text-xs text-red-600 font-medium"><AlertCircle className="w-3 h-3" /> Erro</span>;
  if (status === 'ok') return <span className="flex items-center gap-1 text-xs text-green-600 font-medium"><CheckCircle2 className="w-3 h-3" /> OK</span>;
  if (status === 'empty') return <span className="flex items-center gap-1 text-xs text-yellow-600 font-medium"><AlertCircle className="w-3 h-3" /> Vazio</span>;
  return null;
}

function timer(ms?: number) {
  if (!ms) return null;
  return <span className="flex items-center gap-1 text-xs text-gray-400"><Clock className="w-3 h-3" /> {ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}</span>;
}

// ── Step Card ──────────────────────────────────────────────────────────────────

function StepCard({ step }: { step: StepResult }) {
  const [open, setOpen] = useState(step.step === 1);

  const borderColor = step.error
    ? 'border-red-200'
    : step.status === 'empty'
    ? 'border-yellow-200'
    : 'border-green-200';

  const headerBg = step.error
    ? 'bg-red-50'
    : step.status === 'empty'
    ? 'bg-yellow-50'
    : 'bg-green-50';

  return (
    <div className={`border rounded-xl overflow-hidden ${borderColor}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-3 p-4 text-left hover:opacity-90 transition ${headerBg}`}
      >
        <div className="w-7 h-7 rounded-full bg-white/70 flex items-center justify-center text-gray-600 flex-shrink-0 shadow-sm">
          {stepIcon(step.step)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Etapa {step.step}</span>
            {statusBadge(step.status, step.error)}
            {timer(step.elapsed_ms)}
          </div>
          <p className="font-semibold text-gray-800 text-sm mt-0.5 truncate">{step.title}</p>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
      </button>

      {open && (
        <div className="p-4 space-y-4 bg-white">
          {/* Agent info */}
          {step.agent && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm">
              <p className="font-semibold text-blue-700 mb-1">Agente usado</p>
              <p className="text-blue-800"><span className="font-mono text-xs bg-blue-100 px-1 rounded">{step.agent.key}</span> · modelo: <strong>{step.agent.model}</strong></p>
              <p className="text-blue-600 text-xs mt-1">Origem: {step.agent.source}</p>
            </div>
          )}

          {/* Error */}
          {step.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="font-semibold text-red-700 text-sm mb-1">Erro</p>
              <p className="text-red-600 text-sm font-mono">{step.error}</p>
            </div>
          )}

          {/* Input preview */}
          {step.input_preview && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Texto enviado ao Gemini (primeiros 400 chars)</p>
              <div className="bg-gray-50 border rounded-lg p-3 text-xs font-mono text-gray-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
                {step.input_preview}
              </div>
            </div>
          )}

          {/* Structured input */}
          {step.input && Object.keys(step.input).length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Entrada</p>
              <OutputBlock data={step.input} />
            </div>
          )}

          {/* Output */}
          {step.output && <OutputRenderer step={step} />}
        </div>
      )}
    </div>
  );
}

// ── Output renderers ────────────────────────────────────────────────────────────

function OutputBlock({ data }: { data: unknown }) {
  return (
    <pre className="bg-gray-900 text-green-300 rounded-lg p-3 text-xs overflow-auto max-h-64 whitespace-pre-wrap">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function OutputRenderer({ step }: { step: StepResult }) {
  const out = step.output;
  if (!out) return null;

  // Step 1 V1/V2 — themes
  if (step.step === 1) {
    const primary = out.themes_primary as string[] | undefined;
    const secondary = out.themes_secondary as string[] | undefined;
    return (
      <div className="space-y-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Temas identificados</p>
        {primary && primary.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-green-700 mb-1">Primários ({primary.length})</p>
            <div className="flex flex-wrap gap-2">
              {primary.map((t, i) => <span key={i} className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">{t}</span>)}
            </div>
          </div>
        )}
        {secondary && secondary.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-yellow-700 mb-1">Secundários ({secondary.length})</p>
            <div className="flex flex-wrap gap-2">
              {secondary.map((t, i) => <span key={i} className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium">{t}</span>)}
            </div>
          </div>
        )}
        {(!primary?.length && !secondary?.length) && <p className="text-sm text-gray-500 italic">Nenhum tema extraído.</p>}
      </div>
    );
  }

  // Step 2 V1 — term_results
  if ('term_results' in out) {
    const termResults = out.term_results as Array<{ term: string; role: string; search_source: string; candidates_found: number; category_filtered_out: number; accepted: Array<{ code: string; term: string; similarity?: number; tree_ids?: string[] }> }>;
    return (
      <div className="space-y-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Candidatos por termo</p>
        {termResults.map((tr, i) => (
          <div key={i} className="border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 flex items-center justify-between flex-wrap gap-2">
              <span className="font-semibold text-sm text-gray-800">"{tr.term}"</span>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className={`px-2 py-0.5 rounded-full font-medium ${tr.role === 'primary' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{tr.role === 'primary' ? 'Primário' : 'Secundário'}</span>
                <span>via <strong>{tr.search_source || 'N/A'}</strong></span>
                {tr.category_filtered_out > 0 && <span className="text-red-500">{tr.category_filtered_out} rejeitado(s) por categoria B</span>}
              </div>
            </div>
            {tr.accepted.length > 0 ? (
              <div className="divide-y">
                {tr.accepted.map((c, j) => (
                  <div key={j} className="px-3 py-2 flex items-center gap-3 text-sm">
                    <span className="font-mono text-xs text-gray-400 bg-gray-100 px-1 rounded">{c.code}</span>
                    <span className="font-medium text-gray-800">{c.term}</span>
                    {c.similarity != null && <span className="text-xs text-blue-500 ml-auto">sim: {(c.similarity).toFixed(3)}</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-3 py-2 text-sm text-gray-400 italic">Sem candidatos aceitos</p>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Step 2 V2 — concept_results
  if ('concept_results' in out) {
    const conceptResults = out.concept_results as Array<{ term: string; role: string; search_path: string; local_found: number; local_after_filter: number; candidates: Array<{ code: string; term: string; source: string; similarity?: number; has_scope_note: boolean; tree_ids?: string[] }> }>;
    return (
      <div className="space-y-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Busca por conceito</p>
        {conceptResults.map((cr, i) => (
          <div key={i} className="border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 flex items-center justify-between flex-wrap gap-2">
              <span className="font-semibold text-sm text-gray-800">"{cr.term}"</span>
              <div className="flex items-center gap-2 text-xs">
                <span className={`px-2 py-0.5 rounded-full font-medium ${cr.role === 'primary' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{cr.role === 'primary' ? 'Primário' : 'Secundário'}</span>
                <span className="text-gray-500">via <strong>{cr.search_path || 'N/A'}</strong></span>
              </div>
            </div>
            {cr.candidates.length > 0 ? (
              <div className="divide-y">
                {cr.candidates.map((c, j) => (
                  <div key={j} className="px-3 py-2 flex items-center gap-2 text-sm flex-wrap">
                    <span className="font-mono text-xs text-gray-400 bg-gray-100 px-1 rounded">{c.code}</span>
                    <span className="font-medium text-gray-800">{c.term}</span>
                    <span className="text-xs text-gray-400">({c.source})</span>
                    {c.similarity != null && <span className="text-xs text-blue-500">sim: {(c.similarity).toFixed(3)}</span>}
                    {c.has_scope_note && <span className="text-xs text-gray-400 ml-auto">✓ scope_note</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-3 py-2 text-sm text-gray-400 italic">Sem candidatos encontrados</p>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Step 3 V1 — enrich/dedup
  if ('deduped_count' in out) {
    const o = out as { enriched_count: number; deduped_count: number; duplicates_removed: number; candidates: Array<{ code: string; term: string; role: string; has_scope_note: boolean }> };
    return (
      <div className="space-y-3">
        <div className="flex gap-4 text-sm">
          <div className="bg-blue-50 rounded-lg px-3 py-2 text-center">
            <p className="font-bold text-blue-700">{o.enriched_count}</p>
            <p className="text-blue-600 text-xs">enriquecidos</p>
          </div>
          <div className="bg-green-50 rounded-lg px-3 py-2 text-center">
            <p className="font-bold text-green-700">{o.deduped_count}</p>
            <p className="text-green-600 text-xs">após dedup</p>
          </div>
          {o.duplicates_removed > 0 && (
            <div className="bg-yellow-50 rounded-lg px-3 py-2 text-center">
              <p className="font-bold text-yellow-700">{o.duplicates_removed}</p>
              <p className="text-yellow-600 text-xs">duplicatas</p>
            </div>
          )}
        </div>
        <div className="divide-y border rounded-lg overflow-hidden">
          {o.candidates.map((c, i) => (
            <div key={i} className="px-3 py-2 flex items-center gap-2 text-sm">
              <span className="font-mono text-xs text-gray-400 bg-gray-100 px-1 rounded">{c.code}</span>
              <span className="font-medium text-gray-800">{c.term}</span>
              <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${c.role === 'primary' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{c.role === 'primary' ? 'Primário' : 'Secundário'}</span>
              {c.has_scope_note && <span className="text-xs text-gray-400">✓ scope</span>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Step 4 V1 — validation
  if ('approved_codes' in out) {
    const o = out as { approved_codes: string[]; rejected_codes: string[]; final_count: number };
    return (
      <div className="space-y-3">
        <div className="flex gap-4 text-sm">
          <div className="bg-green-50 rounded-lg px-3 py-2 text-center">
            <p className="font-bold text-green-700">{o.approved_codes.length}</p>
            <p className="text-green-600 text-xs">aprovados</p>
          </div>
          <div className="bg-red-50 rounded-lg px-3 py-2 text-center">
            <p className="font-bold text-red-700">{o.rejected_codes.length}</p>
            <p className="text-red-600 text-xs">rejeitados</p>
          </div>
        </div>
        {o.approved_codes.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-green-700 mb-1">Aprovados pelo Gemini</p>
            <div className="flex flex-wrap gap-1">{o.approved_codes.map((c, i) => <span key={i} className="font-mono text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded">{c}</span>)}</div>
          </div>
        )}
        {o.rejected_codes.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-red-700 mb-1">Rejeitados pelo Gemini</p>
            <div className="flex flex-wrap gap-1">{o.rejected_codes.map((c, i) => <span key={i} className="font-mono text-xs bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded">{c}</span>)}</div>
          </div>
        )}
      </div>
    );
  }

  // Step 3 V2 — selector output
  if ('selected_primary' in out) {
    const o = out as { gemini_raw: unknown; selected_primary: Array<{ code: string; term: string }>; selected_secondary: Array<{ code: string; term: string }> };
    return (
      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-green-700 mb-1">Primários selecionados ({o.selected_primary.length})</p>
          {o.selected_primary.length === 0 ? <p className="text-sm text-gray-400 italic">Nenhum</p> : (
            <div className="divide-y border rounded-lg overflow-hidden">
              {o.selected_primary.map((d, i) => (
                <div key={i} className="px-3 py-2 flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-gray-400 bg-gray-100 px-1 rounded">{d.code}</span>
                  <span className="font-medium text-gray-800">{d.term}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold text-yellow-700 mb-1">Secundários selecionados ({o.selected_secondary.length})</p>
          {o.selected_secondary.length === 0 ? <p className="text-sm text-gray-400 italic">Nenhum</p> : (
            <div className="divide-y border rounded-lg overflow-hidden">
              {o.selected_secondary.map((d, i) => (
                <div key={i} className="px-3 py-2 flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-gray-400 bg-gray-100 px-1 rounded">{d.code}</span>
                  <span className="font-medium text-gray-800">{d.term}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Step 4 V2 — hierarchy
  if ('hierarchy' in out) {
    const hierarchy = out.hierarchy as Array<{ code: string; term: string; tree_ids: string[]; parents: Array<{ id: string; term: string }>; children: Array<{ id: string; term: string }> }>;
    return (
      <div className="space-y-3">
        {hierarchy.map((h, i) => (
          <div key={i} className="border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-gray-50">
              <span className="font-semibold text-sm text-gray-800">{h.term}</span>
              <span className="ml-2 font-mono text-xs text-gray-400">[{h.code}]</span>
            </div>
            <div className="px-3 py-2 text-xs space-y-1">
              {h.parents.length > 0 && <p className="text-gray-500">⬆ Pai: <strong className="text-gray-700">{h.parents.map(p => p.term).join(', ')}</strong></p>}
              {h.children.length > 0 && <p className="text-gray-500">⬇ Filhos: <strong className="text-gray-700">{h.children.map(c => c.term).join(', ')}</strong></p>}
              {h.tree_ids.length > 0 && <p className="text-gray-400 font-mono">{h.tree_ids.join(' | ')}</p>}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Fallback — raw JSON
  return (
    <div>
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Saída</p>
      <OutputBlock data={out} />
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function DeCSdiagnosePage() {
  const router = useRouter();
  const [questionId, setQuestionId] = useState('');
  const [pipeline, setPipeline] = useState<'v1' | 'v2'>('v1');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiagnoseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const id = parseInt(questionId);
    if (!id) { setError('Informe um ID de questão válido'); return; }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin/decs-diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ questionId: id, pipeline }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg transition">
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Diagnóstico de Pipeline DeCS</h1>
          <p className="text-sm text-gray-500">Analise cada etapa do pipeline de classificação para uma questão específica</p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white border rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-600 mb-1">ID da Questão</label>
            <input
              type="number"
              value={questionId}
              onChange={e => setQuestionId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && run()}
              placeholder="Ex: 1234"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Pipeline</label>
            <div className="flex gap-2">
              {(['v1', 'v2'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPipeline(p)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold border transition ${
                    pipeline === p
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {p === 'v1' ? 'V1 (padrão)' : 'V2 (RAG)'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Pipeline description */}
        <div className={`rounded-lg p-3 text-xs text-gray-600 border ${pipeline === 'v1' ? 'bg-blue-50 border-blue-100' : 'bg-violet-50 border-violet-100'}`}>
          {pipeline === 'v1' ? (
            <><strong>Pipeline V1:</strong> Extração de temas → Busca pgvector/BVS → Enriquecimento → Validação Gemini (4 etapas)</>
          ) : (
            <><strong>Pipeline V2 (RAG):</strong> Extração semântica profunda → Busca pgvector/texto/BVS → Seleção Gemini → Hierarquia (4 etapas)</>
          )}
        </div>

        <button
          onClick={run}
          disabled={loading || !questionId}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {loading ? 'Executando diagnóstico...' : 'Diagnosticar questão'}
        </button>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Summary header */}
          <div className="bg-white border rounded-xl p-5">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <div>
                <h2 className="font-bold text-gray-900">Questão #{result.question_id} — {result.pipeline.toUpperCase()}</h2>
                <p className="text-sm text-gray-500">{result.steps.length} etapas executadas</p>
              </div>
              <div className="flex gap-2">
                {result.steps.map(s => (
                  <div key={s.step} className={`w-2 h-2 rounded-full ${s.error ? 'bg-red-400' : s.status === 'empty' ? 'bg-yellow-400' : 'bg-green-400'}`} title={`Etapa ${s.step}: ${s.status}`} />
                ))}
              </div>
            </div>

            {/* Final result */}
            {result.final ? (
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Tag className="w-4 h-4 text-green-600" />
                    <p className="font-semibold text-green-700 text-sm">Descritores Primários ({result.final.primary.length})</p>
                  </div>
                  {result.final.primary.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">Nenhum</p>
                  ) : (
                    <ul className="space-y-1">
                      {result.final.primary.map((d, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm">
                          <span className="font-mono text-xs text-gray-400 bg-white/70 px-1 rounded">{d.code}</span>
                          <span className="font-medium text-gray-800">{d.term}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Tag className="w-4 h-4 text-yellow-600" />
                    <p className="font-semibold text-yellow-700 text-sm">Descritores Secundários ({result.final.secondary.length})</p>
                  </div>
                  {result.final.secondary.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">Nenhum</p>
                  ) : (
                    <ul className="space-y-1">
                      {result.final.secondary.map((d, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm">
                          <span className="font-mono text-xs text-gray-400 bg-white/70 px-1 rounded">{d.code}</span>
                          <span className="font-medium text-gray-800">{d.term}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-700 font-medium">Pipeline falhou: {result.error}</p>
              </div>
            )}
          </div>

          {/* Steps */}
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Detalhamento por etapa</h3>
            {result.steps.map(step => <StepCard key={step.step} step={step} />)}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && (
        <div className="text-center py-16 text-gray-400">
          <Microscope className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Informe um ID de questão e clique em "Diagnosticar"</p>
          <p className="text-sm mt-1">O diagnóstico mostra cada etapa do pipeline com entradas e saídas detalhadas</p>
        </div>
      )}
    </div>
  );
}
