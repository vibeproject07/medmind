import { geminiProcessDocument, geminiTransformTranscription } from '@/lib/gemini';
import { extractTextFromDocx, extractTextFromPptx } from '@/lib/document-extract';
import {
  summarizeTokenization,
  type SpacyTokenizationResult,
  type SpacyTokenizationSummary,
} from '@/lib/spacy-tokenizer';
import {
  chunkTokenizedText,
  type ChunkingResult,
} from '@/lib/chunking-agent';
import { cleanExtractionAgentOutput } from '@/lib/immediate-agent-output-cleaners';

const EXTRACT_TYPES: Record<string, 'docx' | 'pptx'> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'pptx',
};

export interface BroadFileExtractionResult {
  text: string;
  wholeExtractionText: string;
  originalText?: string;
  tokenization: SpacyTokenizationSummary;
  tokenizationData: SpacyTokenizationResult;
  chunking: ChunkingResult;
  jsonWithDiscardFalse: string[];
  newJson: string;
}

/**
 * Processa documentos e imagens com o agente abrangente configurado no banco.
 *
 * DOCX/PPTX passam primeiro pelo extrator local para preservar a ordem do texto;
 * o conteúdo extraído também é enviado ao agente abrangente para a síntese.
 * A saída abrangente é tokenizada e as sentenças numeradas seguem para o agente
 * de chunking.
 */
export async function processWithBroadFileExtraction(
  buffer: Buffer,
  mimeType: string,
): Promise<BroadFileExtractionResult> {
  const normalizedMimeType = mimeType.toLowerCase();
  const extractType = EXTRACT_TYPES[normalizedMimeType];

  if (extractType) {
    const extractedText =
      extractType === 'docx'
        ? await extractTextFromDocx(buffer)
        : await extractTextFromPptx(buffer);

    const rawBroadExtractionText = await geminiTransformTranscription({
      transcription: extractedText,
      instruction: 'Produza o material de estudo conforme as instruções do sistema.',
      agentKey: 'broad_file_extraction',
    });
    const { cleanedText: broadExtractionText, newJson, jsonWithDiscardFalse } =
      cleanExtractionAgentOutput(rawBroadExtractionText, { requireJson: true });
    const { tokenization, chunking } = await chunkTokenizedText({
      text: broadExtractionText,
      sourceType: 'document',
      contentFormat: 'plain',
    });
    return {
      text: broadExtractionText,
      wholeExtractionText: rawBroadExtractionText,
      originalText: extractedText,
      tokenization: summarizeTokenization(tokenization),
      tokenizationData: tokenization,
      chunking,
      jsonWithDiscardFalse,
      newJson: newJson!,
    };
  }

  const rawBroadExtractionText = await geminiProcessDocument({
    file: buffer,
    mimeType: normalizedMimeType,
    agentKey: 'broad_file_extraction',
  });
  const { cleanedText: broadExtractionText, newJson, jsonWithDiscardFalse } =
    cleanExtractionAgentOutput(rawBroadExtractionText, { requireJson: true });
  const { tokenization, chunking } = await chunkTokenizedText({
    text: broadExtractionText,
    sourceType: normalizedMimeType.startsWith('image/') ? 'image' : 'document',
    contentFormat: 'plain',
  });
  return {
    text: broadExtractionText,
    wholeExtractionText: rawBroadExtractionText,
    tokenization: summarizeTokenization(tokenization),
    tokenizationData: tokenization,
    chunking,
    jsonWithDiscardFalse,
    newJson: newJson!,
  };
}