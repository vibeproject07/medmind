export interface SpacySourceSegment {
  id?: number | string;
  start: number;
  end: number;
  text: string;
  part?: number;
}

export interface SpacyToken {
  index: number;
  spacy_index: number;
  text: string;
  start_char: number;
  end_char: number;
  sentence_index: number | null;
  is_punct: boolean;
  like_num: boolean;
}

export interface SpacySentence {
  index: number;
  number: number;
  text: string;
  start_char: number;
  end_char: number;
  token_start: number;
  token_end: number;
  token_count: number;
  tokens: string[];
  tokens_truncated?: boolean;
  start_time: number | null;
  end_time: number | null;
  segment_ids: Array<number | string>;
}

export interface SpacyTokenFrequency {
  token: string;
  count: number;
  first_token_index: number;
}

export interface SpacyTokenizationResult {
  schema_version: '1.0';
  pipeline: string;
  language: 'pt';
  source_type: string;
  input_character_total: number;
  processed_character_total: number;
  normalization_applied: boolean;
  offset_basis: 'input_text' | 'processed_text';
  processed_text: string | null;
  timestamp_mapping_complete: boolean;
  spacy_token_total: number;
  token_total: number;
  sentence_total: number;
  view: 'totals' | 'tokens' | 'sentences_text_order' | 'sentences_token_order' | 'mixed';
  tokens?: SpacyToken[];
  sentences?: SpacySentence[];
  sentences_in_text_order?: SpacySentence[];
  sentences_in_token_order?: SpacySentence[];
  token_frequencies?: SpacyTokenFrequency[];
  pagination: Record<
    string,
    {
      page: number;
      page_size: number;
      total: number;
      has_more: boolean;
      next_page: number | null;
    }
  >;
  warnings: string[];
}

export type SpacyTokenizationSummary = Pick<
  SpacyTokenizationResult,
  | 'schema_version'
  | 'pipeline'
  | 'language'
  | 'source_type'
  | 'input_character_total'
  | 'processed_character_total'
  | 'normalization_applied'
  | 'offset_basis'
  | 'timestamp_mapping_complete'
  | 'spacy_token_total'
  | 'token_total'
  | 'sentence_total'
  | 'pagination'
  | 'warnings'
> & { sentences_in_text_order: SpacySentence[] };

export interface TokenizeTextInput {
  text: string;
  sourceType?: string;
  segments?: SpacySourceSegment[];
  contentFormat?: 'auto' | 'plain';
  view?: 'totals' | 'tokens' | 'sentences_text_order' | 'sentences_token_order' | 'mixed';
  page?: number;
  pageSize?: number;
}

const DEFAULT_TOKENIZER_URL = 'http://127.0.0.1:5002';
const TOKENIZER_TIMEOUT_MS = 120_000;

export class SpacyTokenizerError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'SpacyTokenizerError';
  }
}

export async function tokenizeText({
  text,
  sourceType = 'text',
  segments = [],
  contentFormat = 'auto',
  view = 'sentences_text_order',
  page = 1,
  pageSize = 250,
}: TokenizeTextInput): Promise<SpacyTokenizationResult> {
  if (!text?.trim()) {
    throw new Error('Não há texto para tokenizar.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOKENIZER_TIMEOUT_MS);

  try {
    const baseUrl = (process.env.SPACY_TOKENIZER_URL || DEFAULT_TOKENIZER_URL).replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/tokenize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        source_type: sourceType,
        segments,
        content_format: contentFormat,
        view,
        page,
        page_size: pageSize,
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail =
        typeof data?.detail === 'string'
          ? data.detail
          : `Falha no serviço spaCy (${response.status}).`;
      throw new SpacyTokenizerError(detail, response.status);
    }
    return data as SpacyTokenizationResult;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('O serviço spaCy excedeu o tempo limite de processamento.');
    }
    if (error instanceof Error) throw error;
    throw new Error('Não foi possível tokenizar o conteúdo.');
  } finally {
    clearTimeout(timeout);
  }
}

export function summarizeTokenization(
  result: SpacyTokenizationResult,
): SpacyTokenizationSummary {
  return {
    schema_version: result.schema_version,
    pipeline: result.pipeline,
    language: result.language,
    source_type: result.source_type,
    input_character_total: result.input_character_total,
    processed_character_total: result.processed_character_total,
    normalization_applied: result.normalization_applied,
    offset_basis: result.offset_basis,
    timestamp_mapping_complete: result.timestamp_mapping_complete,
    spacy_token_total: result.spacy_token_total,
    token_total: result.token_total,
    sentence_total: result.sentence_total,
    sentences_in_text_order:
      result.sentences || result.sentences_in_text_order || [],
    pagination: result.pagination,
    warnings: result.warnings,
  };
}