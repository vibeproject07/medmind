import { geminiProcessDocument, geminiTransformTranscription } from '@/lib/gemini';
import { extractTextFromDocx, extractTextFromPptx } from '@/lib/document-extract';
import {
  summarizeTokenization,
  type SpacyTokenizationSummary,
} from '@/lib/spacy-tokenizer';
import {
  chunkTokenizedText,
  type ChunkingResult,
} from '@/lib/chunking-agent';

const EXTRACT_TYPES: Record<string, 'docx' | 'pptx'> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'pptx',
};

export interface BroadFileExtractionResult {
  text: string;
  originalText?: string;
  tokenization: SpacyTokenizationSummary;
  chunking: ChunkingResult;
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

    const broadExtractionText = await geminiTransformTranscription({
      transcription: extractedText,
      instruction: 'Produza o material de estudo conforme as instruções do sistema.',
      agentKey: 'broad_file_extraction',
    });
    const { tokenization, chunking } = await chunkTokenizedText({
      text: broadExtractionText,
      sourceType: 'document',
      contentFormat: 'plain',
    });
    return {
      text: broadExtractionText,
      originalText: extractedText,
      tokenization: summarizeTokenization(tokenization),
      chunking,
    };
  }

  const broadExtractionText = await geminiProcessDocument({
    file: buffer,
    mimeType: normalizedMimeType,
    agentKey: 'broad_file_extraction',
  });
  const { tokenization, chunking } = await chunkTokenizedText({
    text: broadExtractionText,
    sourceType: normalizedMimeType.startsWith('image/') ? 'image' : 'document',
    contentFormat: 'plain',
  });
  return {
    text: broadExtractionText,
    tokenization: summarizeTokenization(tokenization),
    chunking,
  };
}