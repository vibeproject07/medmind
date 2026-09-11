import { extractTextFromDocx, extractTextFromPptx } from '@/lib/document-extract';
import {
  extractImageAsJson,
  extractPdfInBatches,
  extractTextInBatches,
} from '@/lib/broad-extraction-batching';
import type {
  SpacyTokenizationResult,
  SpacyTokenizationSummary,
} from '@/lib/spacy-tokenizer';
import type { ChunkingResult } from '@/lib/chunking-agent';
import { cleanExtractionAgentOutput } from '@/lib/immediate-agent-output-cleaners';
import {
  processExtractedSource,
  type SourceContentProcessing,
} from '@/lib/source-content-pipeline';

const EXTRACT_TYPES: Record<string, 'docx' | 'pptx'> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'pptx',
};

export interface BroadFileExtractionDependencies {
  extractDocx: (buffer: Buffer) => Promise<string>;
  extractPptx: (buffer: Buffer) => Promise<string>;
  transformExtractedText: (input: {
    transcription: string;
    instruction: string;
    agentKey: string;
  }) => Promise<string>;
  processNativeDocument: (input: {
    file: Buffer;
    mimeType: string;
    agentKey: string;
  }) => Promise<string>;
  processExtracted: typeof processExtractedSource;
}

export interface BroadFileExtractionResult {
  text: string;
  originalText?: string;
  transformedText?: string;
  wholeExtractionText?: string;
  tokenization?: SpacyTokenizationSummary;
  tokenizationData?: SpacyTokenizationResult;
  chunking?: ChunkingResult;
  tokenization_error?: string;
  chunking_error?: string;
  transformation_error?: string;
  jsonWithDiscardFalse: string[];
  newJson?: string;
}

/**
 * Mantém a extração fiel como conteúdo canônico. A análise abrangente em lotes
 * e os enriquecimentos são resultados separados e nunca substituem a fonte.
 */
export async function processWithBroadFileExtraction(
  buffer: Buffer,
  mimeType: string,
  suppliedDependencies?: BroadFileExtractionDependencies,
): Promise<BroadFileExtractionResult> {
  const normalizedMimeType = mimeType.toLowerCase();
  const extractType = EXTRACT_TYPES[normalizedMimeType];
  const processExtracted = suppliedDependencies?.processExtracted ?? processExtractedSource;

  let canonicalText: string;
  let transformedText: string | undefined;
  let transformationError: string | undefined;
  let wholeExtractionText: string | undefined;
  let jsonWithDiscardFalse: string[] = [];
  let newJson: string | undefined;

  if (extractType) {
    canonicalText = extractType === 'docx'
      ? await (suppliedDependencies?.extractDocx ?? extractTextFromDocx)(buffer)
      : await (suppliedDependencies?.extractPptx ?? extractTextFromPptx)(buffer);

    try {
      if (suppliedDependencies) {
        transformedText = await suppliedDependencies.transformExtractedText({
          transcription: canonicalText,
          instruction: 'Produza o material de estudo conforme as instruções do sistema.',
          agentKey: 'broad_file_extraction',
        });
      } else {
        wholeExtractionText = await extractTextInBatches(canonicalText);
        const cleaned = cleanExtractionAgentOutput(wholeExtractionText, { requireJson: true });
        transformedText = cleaned.cleanedText;
        jsonWithDiscardFalse = cleaned.jsonWithDiscardFalse;
        newJson = cleaned.newJson ?? undefined;
      }
    } catch (error) {
      transformationError =
        error instanceof Error ? error.message : 'Falha ao transformar o texto extraído.';
    }
  } else {
    const processNativeDocument = suppliedDependencies?.processNativeDocument
      ?? (await import('./gemini')).geminiProcessDocument;
    canonicalText = await processNativeDocument({
      file: buffer,
      mimeType: normalizedMimeType,
      agentKey: 'extrair_texto',
    });
    try {
      if (suppliedDependencies) {
        transformedText = await processNativeDocument({
          file: buffer,
          mimeType: normalizedMimeType,
          agentKey: 'broad_file_extraction',
        });
      } else {
        wholeExtractionText = normalizedMimeType === 'application/pdf'
          ? await extractPdfInBatches(buffer)
          : await extractImageAsJson(buffer, normalizedMimeType);
        const cleaned = cleanExtractionAgentOutput(wholeExtractionText, { requireJson: true });
        transformedText = cleaned.cleanedText;
        jsonWithDiscardFalse = cleaned.jsonWithDiscardFalse;
        newJson = cleaned.newJson ?? undefined;
      }
    } catch (error) {
      transformationError =
        error instanceof Error ? error.message : 'Falha ao transformar o conteúdo extraído.';
    }
  }

  const processing: SourceContentProcessing = await processExtracted({
    text: canonicalText,
    sourceType: normalizedMimeType.startsWith('image/') ? 'image' : 'document',
  });

  return {
    text: canonicalText,
    originalText: canonicalText,
    ...(transformedText ? { transformedText } : {}),
    ...(wholeExtractionText ? { wholeExtractionText } : {}),
    ...processing,
    ...(transformationError ? { transformation_error: transformationError } : {}),
    jsonWithDiscardFalse,
    ...(newJson ? { newJson } : {}),
  };
}