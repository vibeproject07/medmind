import {
  summarizeTokenization,
  tokenizeText,
  type SpacySourceSegment,
  type SpacyTokenizationResult,
  type SpacyTokenizationSummary,
} from './spacy-tokenizer';
import type { ChunkingResult } from './chunking-agent';

export interface SourceContentProcessing {
  tokenization?: SpacyTokenizationSummary;
  tokenizationData?: SpacyTokenizationResult;
  chunking?: ChunkingResult;
  tokenization_error?: string;
  chunking_error?: string;
}

export interface SourceContentPipelineDependencies {
  tokenize: typeof tokenizeText;
  chunk: (input: {
    text: string;
    sourceType?: string;
    segments?: SpacySourceSegment[];
    contentFormat?: 'auto' | 'plain';
    tokenization?: SpacyTokenizationResult;
  }) => Promise<{ tokenization: SpacyTokenizationResult; chunking: ChunkingResult }>;
}

const DEFAULT_DEPENDENCIES: SourceContentPipelineDependencies = {
  tokenize: tokenizeText,
  chunk: async (input) => {
    const { chunkTokenizedText } = await import('./chunking-agent');
    return chunkTokenizedText(input);
  },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Falha auxiliar desconhecida.';
}

/**
 * Enriches already extracted content without ever changing or withholding it.
 * Tokenization and chunking are deliberately separate result fields so an
 * auxiliary service outage cannot erase the source text.
 */
export async function processExtractedSource(
  {
    text,
    sourceType,
    segments = [],
  }: {
    text: string;
    sourceType: string;
    segments?: SpacySourceSegment[];
  },
  dependencies: SourceContentPipelineDependencies = DEFAULT_DEPENDENCIES,
): Promise<SourceContentProcessing> {
  let tokenization: SpacyTokenizationResult;
  try {
    tokenization = await dependencies.tokenize({
      text,
      sourceType,
      segments,
      contentFormat: 'plain',
      view: 'sentences_text_order',
      page: 1,
      pageSize: 1000,
      includeChunkingSentences: true,
    });
  } catch (error) {
    return { tokenization_error: errorMessage(error) };
  }

  const result: SourceContentProcessing = {
    tokenization: summarizeTokenization(tokenization),
    tokenizationData: tokenization,
  };
  try {
    const chunked = await dependencies.chunk({
      text,
      sourceType,
      segments,
      contentFormat: 'plain',
      tokenization,
    });
    result.chunking = chunked.chunking;
  } catch (error) {
    result.chunking_error = errorMessage(error);
  }
  return result;
}

export function canonicalTranscriptionText({
  segments,
  rawText,
  text,
}: {
  segments: SpacySourceSegment[];
  rawText?: string;
  text: string;
}): string {
  // rawText is the complete provider transcript. Segments are provenance and
  // may legitimately be partial, so they must never replace a complete source.
  return rawText || text;
}