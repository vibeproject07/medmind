/**
 * Extração e agregação de usage de tokens das respostas Gemini (SDK e REST).
 */

export interface AgentTokenUsage {
  agent: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  thoughts_tokens?: number;
}

export interface TokenUsageTotals {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  thoughts_tokens: number;
  by_agent: Record<
    string,
    { input_tokens: number; output_tokens: number; total_tokens: number; calls: number }
  >;
}

export const GEMINI_25_FLASH_USD_PER_1M = {
  input: 0.3,
  output: 2.5,
} as const;

export function emptyTokenTotals(): TokenUsageTotals {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    thoughts_tokens: 0,
    by_agent: {},
  };
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

export function parseGeminiUsageMetadata(source: unknown): {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  thoughts_tokens: number;
} {
  if (!source || typeof source !== 'object') {
    return { input_tokens: 0, output_tokens: 0, total_tokens: 0, thoughts_tokens: 0 };
  }

  const root = source as Record<string, unknown>;
  const meta =
    (root.usageMetadata as Record<string, unknown> | undefined) ??
    (root.usage_metadata as Record<string, unknown> | undefined) ??
    root;

  const input_tokens = num(
    meta.promptTokenCount ?? meta.prompt_token_count ?? meta.inputTokenCount,
  );
  const output_tokens = num(
    meta.candidatesTokenCount ??
      meta.candidates_token_count ??
      meta.outputTokenCount ??
      meta.output_token_count,
  );
  const thoughts_tokens = num(
    meta.thoughtsTokenCount ?? meta.thoughts_token_count,
  );
  const total_tokens =
    num(meta.totalTokenCount ?? meta.total_token_count) ||
    input_tokens + output_tokens + thoughts_tokens;

  return { input_tokens, output_tokens, total_tokens, thoughts_tokens };
}

export function buildAgentTokenUsage(
  agent: string,
  model: string,
  responseOrMeta: unknown,
): AgentTokenUsage {
  const parsed = parseGeminiUsageMetadata(responseOrMeta);
  const usage: AgentTokenUsage = {
    agent,
    model,
    input_tokens: parsed.input_tokens,
    output_tokens: parsed.output_tokens,
    total_tokens: parsed.total_tokens,
  };
  if (parsed.thoughts_tokens > 0) usage.thoughts_tokens = parsed.thoughts_tokens;
  return usage;
}

export function addTokenUsage(
  totals: TokenUsageTotals,
  usage: AgentTokenUsage | null | undefined,
): void {
  if (!usage) return;
  totals.input_tokens += usage.input_tokens;
  totals.output_tokens += usage.output_tokens;
  totals.total_tokens += usage.total_tokens;
  totals.thoughts_tokens += usage.thoughts_tokens ?? 0;

  const prev = totals.by_agent[usage.agent] ?? {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    calls: 0,
  };
  prev.input_tokens += usage.input_tokens;
  prev.output_tokens += usage.output_tokens;
  prev.total_tokens += usage.total_tokens;
  prev.calls += 1;
  totals.by_agent[usage.agent] = prev;
}

export function sumAgentUsages(usages: AgentTokenUsage[]): TokenUsageTotals {
  const totals = emptyTokenTotals();
  for (const u of usages) addTokenUsage(totals, u);
  return totals;
}

export function estimateUsdCost(
  inputTokens: number,
  outputTokens: number,
  rates = GEMINI_25_FLASH_USD_PER_1M,
): { input_usd: number; output_usd: number; total_usd: number } {
  const input_usd = (inputTokens / 1_000_000) * rates.input;
  const output_usd = (outputTokens / 1_000_000) * rates.output;
  return {
    input_usd: Math.round(input_usd * 1_000_000) / 1_000_000,
    output_usd: Math.round(output_usd * 1_000_000) / 1_000_000,
    total_usd: Math.round((input_usd + output_usd) * 1_000_000) / 1_000_000,
  };
}
