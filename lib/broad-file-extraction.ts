import { geminiProcessDocument, geminiTransformTranscription } from '@/lib/gemini';
import { extractTextFromDocx, extractTextFromPptx } from '@/lib/document-extract';
import {
  summarizeTokenization,
  tokenizeText,
  type SpacyTokenizationSummary,
} from '@/lib/spacy-tokenizer';

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
}

/**
 * Processa documentos e imagens com o agente abrangente configurado no banco.
 *
 * DOCX/PPTX passam primeiro pelo extrator local para preservar a ordem do texto;
 * o conteúdo extraído também é enviado ao mesmo agente abrangente para a síntese.
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

    const text = await geminiTransformTranscription({
      transcription: extractedText,
      instruction: 'Produza o material de estudo conforme as instruções do sistema.',
      agentKey: 'broad_file_extraction',
    });

    const tokenization = await tokenizeText({
      text,
      sourceType: 'document',
      contentFormat: 'plain',
      view: 'sentences_text_order',
    });
    return {
      text,
      originalText: extractedText,
      tokenization: summarizeTokenization(tokenization),
    };
  }

  const text = await geminiProcessDocument({
    file: buffer,
    mimeType: normalizedMimeType,
    agentKey: 'broad_file_extraction',
  });

  const tokenization = await tokenizeText({
    text,
    sourceType: normalizedMimeType.startsWith('image/') ? 'image' : 'document',
    contentFormat: 'plain',
    view: 'sentences_text_order',
  });
  return { text, tokenization: summarizeTokenization(tokenization) };
}