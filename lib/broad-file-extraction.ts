import { extractTextFromDocx, extractTextFromPptx } from '@/lib/document-extract';
import {
  BroadExtractionAbortedError,
  extractImageAsJson,
  extractPdfInBatches,
  extractTextInBatches,
  type BroadExtractionProgressCallback,
} from '@/lib/broad-extraction-batching';
import type {
  SpacyTokenizationResult,
  SpacyTokenizationSummary,
} from '@/lib/spacy-tokenizer';
import type { ChunkingResult } from '@/lib/chunking-agent';
import { cleanExtractionAgentOutput } from '@/lib/immediate-agent-output-cleaners';
import {
  parseExtractionJsonOutput,
  type ExtractionJsonValue,
} from '@/lib/immediate-agent-output-cleaners';
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

function canonicalTextFromExtractionJson(json: string): string {
  const parsed = parseExtractionJsonOutput(json);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || !Array.isArray(parsed.unidades)) {
    throw new Error('O agente de extração não retornou unidades válidas.');
  }
  const texts = parsed.unidades
    .filter((unit): unit is { [key: string]: ExtractionJsonValue } =>
      Boolean(unit) && !Array.isArray(unit) && typeof unit === 'object',
    )
    .map((unit) => String(unit.texto ?? '').trim())
    .filter(Boolean);
  if (texts.length === 0) {
    throw new Error('O agente de extração não retornou texto utilizável.');
  }
  return texts.join('\n\n');
}

/**
 * Mantém a extração fiel como conteúdo canônico. A análise abrangente em lotes
 * e os enriquecimentos são resultados separados e nunca substituem a fonte.
 */
export async function processWithBroadFileExtraction(
  buffer: Buffer,
  mimeType: string,
  suppliedDependencies?: BroadFileExtractionDependencies,
  onProgress?: BroadExtractionProgressCallback,
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
        wholeExtractionText = await extractTextInBatches(canonicalText, onProgress);
        const cleaned = cleanExtractionAgentOutput(wholeExtractionText, { requireJson: true });
        transformedText = cleaned.cleanedText;
        jsonWithDiscardFalse = cleaned.jsonWithDiscardFalse;
        newJson = cleaned.newJson ?? undefined;
      }
    } catch (error) {
      if (error instanceof BroadExtractionAbortedError) throw error;
      transformationError =
        error instanceof Error ? error.message : 'Falha ao transformar o texto extraído.';
    }
  } else {
    if (suppliedDependencies) {
      const output = await suppliedDependencies.processNativeDocument({
        file: buffer,
        mimeType: normalizedMimeType,
        agentKey: 'broad_file_extraction',
      });
      canonicalText = canonicalTextFromExtractionJson(output);
      wholeExtractionText = output;
      const cleaned = cleanExtractionAgentOutput(output, { requireJson: true });
      transformedText = cleaned.cleanedText;
      jsonWithDiscardFalse = cleaned.jsonWithDiscardFalse;
      newJson = cleaned.newJson ?? undefined;
    } else {
      try {
        wholeExtractionText = normalizedMimeType === 'application/pdf'
          ? await extractPdfInBatches(buffer, onProgress)
          : await extractImageAsJson(buffer, normalizedMimeType);
        canonicalText = canonicalTextFromExtractionJson(wholeExtractionText);
        const cleaned = cleanExtractionAgentOutput(wholeExtractionText, { requireJson: true });
        transformedText = cleaned.cleanedText;
        jsonWithDiscardFalse = cleaned.jsonWithDiscardFalse;
        newJson = cleaned.newJson ?? undefined;
      } catch (error) {
        if (error instanceof BroadExtractionAbortedError) throw error;
        throw new Error(
          error instanceof Error ? error.message : 'Falha ao extrair o conteúdo.',
        );
      }
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