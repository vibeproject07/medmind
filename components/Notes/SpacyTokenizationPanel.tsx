'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  Hash,
  Loader2,
  RefreshCw,
  Sparkles,
  TextCursorInput,
} from 'lucide-react';
import type {
  SpacySentence,
  SpacyToken,
  SpacyTokenFrequency,
  SpacyTokenizationResult,
} from '@/lib/spacy-tokenizer';

type PanelTab = 'sentences' | 'tokens' | 'frequencies';
type PaginationInfo = {
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
  next_page: number | null;
};

const PAGE_SIZE = 50;

function formatNumber(value: number) {
  return new Intl.NumberFormat('pt-BR').format(value);
}

function formatOffset(value: number) {
  return value.toLocaleString('pt-BR');
}

function getPageInfo(
  data: SpacyTokenizationResult | null,
  tab: PanelTab,
): PaginationInfo | null {
  if (!data) return null;
  const key =
    tab === 'sentences'
      ? 'sentences_in_text_order'
      : tab === 'tokens'
        ? 'tokens'
        : 'token_frequencies';
  return data.pagination?.[key] ?? null;
}

function Timestamp({ sentence }: { sentence: SpacySentence }) {
  if (sentence.start_time == null || sentence.end_time == null) return null;
  return (
    <span className="font-mono text-[11px] text-violet-600 bg-violet-50 px-2 py-0.5 rounded-md">
      {sentence.start_time.toFixed(1)}s–{sentence.end_time.toFixed(1)}s
    </span>
  );
}

export default function SpacyTokenizationPanel({
  content,
  sourceType = 'note',
}: {
  content: string;
  sourceType?: string;
}) {
  const [data, setData] = useState<SpacyTokenizationResult | null>(null);
  const [activeTab, setActiveTab] = useState<PanelTab>('sentences');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (requestedPage: number) => {
      if (!content.trim()) {
        setData(null);
        setError(null);
        return;
      }

      const token = localStorage.getItem('token');
      if (!token) {
        setError('Sessão administrativa não encontrada.');
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/text/tokenize', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token.trim().replace(/^["']|["']$/g, '')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: content,
            sourceType,
            contentFormat: 'plain',
            view: 'mixed',
            page: requestedPage,
            pageSize: PAGE_SIZE,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || 'Não foi possível gerar a saída da spaCy.');
        }
        setData(result as SpacyTokenizationResult);
        setPage(requestedPage);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Não foi possível gerar a saída da spaCy.',
        );
      } finally {
        setLoading(false);
      }
    },
    [content, sourceType],
  );

  useEffect(() => {
    setPage(1);
    void fetchPage(1);
  }, [fetchPage]);

  const pageInfo = getPageInfo(data, activeTab);
  const sentences = data?.sentences_in_text_order ?? [];
  const tokens = data?.tokens ?? [];
  const frequencies = data?.token_frequencies ?? [];

  const tabItems = useMemo(
    () => [
      {
        id: 'sentences' as const,
        label: 'Frases',
        icon: TextCursorInput,
        count: data?.sentence_total ?? 0,
      },
      {
        id: 'tokens' as const,
        label: 'Tokens',
        icon: Hash,
        count: data?.token_total ?? 0,
      },
      {
        id: 'frequencies' as const,
        label: 'Frequência',
        icon: Sparkles,
        count: data?.token_frequencies?.length ?? 0,
      },
    ],
    [data],
  );

  const handleTabChange = (tab: PanelTab) => {
    setActiveTab(tab);
    if (page !== 1) void fetchPage(1);
  };

  const renderSentences = () => {
    if (sentences.length === 0) {
      return <p className="py-8 text-center text-sm text-gray-400">Nenhuma frase nesta página.</p>;
    }
    return (
      <div className="divide-y divide-gray-100">
        {sentences.map((sentence) => (
          <div key={`${sentence.index}-${sentence.start_char}`} className="py-4 first:pt-1 last:pb-1">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold">
                {sentence.number}
              </span>
              <Timestamp sentence={sentence} />
              <span className="text-[11px] text-gray-400 font-mono">
                chars {formatOffset(sentence.start_char)}–{formatOffset(sentence.end_char)}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-gray-700 mb-2">{sentence.text}</p>
            <div className="flex flex-wrap gap-1.5">
              {sentence.tokens.map((token, tokenIndex) => (
                <span
                  key={`${sentence.index}-${tokenIndex}-${token}`}
                  className="px-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-700 font-mono"
                >
                  {token}
                </span>
              ))}
              {sentence.tokens_truncated && (
                <span className="px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-700">
                  + tokens não exibidos
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderTokens = () => {
    if (tokens.length === 0) {
      return <p className="py-8 text-center text-sm text-gray-400">Nenhum token nesta página.</p>;
    }
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {tokens.map((token: SpacyToken) => (
          <div
            key={`${token.index}-${token.start_char}`}
            className="rounded-lg border border-gray-100 bg-gray-50/70 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm font-semibold text-gray-800 break-all">{token.text}</span>
              <span className="text-[10px] text-gray-400 font-mono">#{token.index}</span>
            </div>
            <p className="mt-1 text-[11px] text-gray-400 font-mono">
              chars {formatOffset(token.start_char)}–{formatOffset(token.end_char)}
              {token.sentence_index != null && ` · frase ${token.sentence_index + 1}`}
            </p>
          </div>
        ))}
      </div>
    );
  };

  const renderFrequencies = () => {
    if (frequencies.length === 0) {
      return <p className="py-8 text-center text-sm text-gray-400">Nenhuma frequência nesta página.</p>;
    }
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="pb-2 pr-4">Token</th>
              <th className="pb-2 pr-4">Ocorrências</th>
              <th className="pb-2">Primeira posição</th>
            </tr>
          </thead>
          <tbody>
            {frequencies.map((frequency: SpacyTokenFrequency) => (
              <tr key={frequency.token} className="border-b border-gray-50 last:border-0">
                <td className="py-2 pr-4 font-mono font-medium text-gray-700">{frequency.token}</td>
                <td className="py-2 pr-4 text-gray-600">{formatNumber(frequency.count)}</td>
                <td className="py-2 text-gray-400 font-mono">#{frequency.first_token_index}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <section
      aria-labelledby="spacy-tokenization-title"
      className="bg-white rounded-xl border border-indigo-100 shadow-sm overflow-hidden"
    >
      <div className="px-5 sm:px-6 py-4 bg-gradient-to-r from-indigo-50/80 via-white to-violet-50/50 border-b border-indigo-100">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center flex-shrink-0">
              <BrainCircuit className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="spacy-tokenization-title" className="text-base font-semibold text-gray-800">
                  Saída da spaCy
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold uppercase tracking-wide">
                  Admin
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Tokenização em português aplicada ao conteúdo desta nota.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void fetchPage(1)}
            disabled={loading || !content.trim()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 transition text-xs font-semibold flex-shrink-0"
            title="Atualizar análise"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-indigo-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            Gerando análise da spaCy…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Não foi possível carregar a tokenização.</p>
              <p className="mt-1 text-xs">{error}</p>
              <button type="button" onClick={() => void fetchPage(1)} className="mt-2 underline font-semibold">
                Tentar novamente
              </button>
            </div>
          </div>
        ) : !content.trim() ? (
          <p className="py-6 text-center text-sm text-gray-400 italic">Esta nota não possui conteúdo para tokenizar.</p>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-5">
              {[
                { label: 'Tokens', value: data.token_total },
                { label: 'Frases', value: data.sentence_total },
                { label: 'Caracteres', value: data.processed_character_total },
                { label: 'Pipeline', value: data.pipeline.replace('spacy.blank.', '') },
              ].map((metric) => (
                <div key={metric.label} className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{metric.label}</p>
                  <p className="mt-1 text-sm font-bold text-gray-800 truncate" title={String(metric.value)}>
                    {typeof metric.value === 'number' ? formatNumber(metric.value) : metric.value}
                  </p>
                </div>
              ))}
            </div>

            {data.warnings.length > 0 && (
              <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <span className="font-semibold">Avisos:</span> {data.warnings.join(' · ')}
              </div>
            )}

            <div className="flex gap-1 border-b border-gray-100 mb-4 overflow-x-auto">
              {tabItems.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => handleTabChange(tab.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold whitespace-nowrap border-b-2 transition ${
                      activeTab === tab.id
                        ? 'text-indigo-700 border-indigo-500'
                        : 'text-gray-400 border-transparent hover:text-gray-700'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                    <span className="text-[10px] opacity-70">({formatNumber(tab.count)})</span>
                  </button>
                );
              })}
            </div>

            <div className="min-h-[150px]">
              {activeTab === 'sentences'
                ? renderSentences()
                : activeTab === 'tokens'
                  ? renderTokens()
                  : renderFrequencies()}
            </div>

            {pageInfo && pageInfo.total > PAGE_SIZE && (
              <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between gap-3">
                <p className="text-xs text-gray-400">
                  Página {pageInfo.page} · {formatNumber(pageInfo.total)} itens
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void fetchPage(page - 1)}
                    disabled={loading || page <= 1}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition text-xs"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => void fetchPage(page + 1)}
                    disabled={loading || !pageInfo.has_more}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition text-xs"
                  >
                    Próxima
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}