import type { ChunkingResult } from './chunking-agent';
import type { SpacyTokenizationSummary } from './spacy-tokenizer';

export interface NoteSourceProvenance {
  sourceType: string;
  sourceReference?: string;
  filename?: string;
  segments?: unknown[];
  words?: unknown[];
  duration?: number;
  partCount?: number;
  tokenization?: SpacyTokenizationSummary;
  chunking?: ChunkingResult;
  tokenization_error?: string;
  chunking_error?: string;
  transformation_error?: string;
}

export function provenanceFromSourceResult(
  result: {
    sourceType?: string;
    filename?: string;
    segments?: unknown[];
    words?: unknown[];
    duration?: number;
    partCount?: number;
    tokenization?: SpacyTokenizationSummary;
    chunking?: ChunkingResult;
    tokenization_error?: string;
    chunking_error?: string;
    transformation_error?: string;
  },
  sourceReference?: string,
): NoteSourceProvenance {
  return {
    sourceType: result.sourceType ?? 'unknown',
    ...(sourceReference ? { sourceReference } : {}),
    ...(result.filename ? { filename: result.filename } : {}),
    ...(result.segments ? { segments: result.segments } : {}),
    ...(result.words ? { words: result.words } : {}),
    ...(result.duration !== undefined ? { duration: result.duration } : {}),
    ...(result.partCount !== undefined ? { partCount: result.partCount } : {}),
    ...(result.tokenization ? { tokenization: result.tokenization } : {}),
    ...(result.chunking ? { chunking: result.chunking } : {}),
    ...(result.tokenization_error ? { tokenization_error: result.tokenization_error } : {}),
    ...(result.chunking_error ? { chunking_error: result.chunking_error } : {}),
    ...(result.transformation_error
      ? { transformation_error: result.transformation_error }
      : {}),
  };
}

export function normalizeNoteSourceProvenance(value: unknown): NoteSourceProvenance | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A proveniência da fonte deve ser um objeto.');
  }
  const sourceType = (value as { sourceType?: unknown }).sourceType;
  if (typeof sourceType !== 'string' || !sourceType.trim()) {
    throw new Error('A proveniência da fonte não informa o tipo da origem.');
  }
  return value as NoteSourceProvenance;
}