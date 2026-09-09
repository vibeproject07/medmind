import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { processWithBroadFileExtraction } from '@/lib/broad-file-extraction';
import {
  downloadFileFromUrlLarge,
  isAudioFile,
  isVideoFile,
  normalizeCloudStorageUrl,
  transcribeMediaBuffer,
  type GroqProgressCallback,
  type GroqTranscriptionProgress,
} from '@/lib/groq-stt';
import {
  summarizeTokenization,
  type SpacyTokenizationSummary,
} from '@/lib/spacy-tokenizer';
import { chunkTokenizedText, type ChunkingResult } from '@/lib/chunking-agent';
import { persistProcessingPipeline } from '@/lib/content-processing-storage';

export const runtime = 'nodejs';

const STREAM_CONTENT_TYPE = 'application/x-ndjson';

function mimeTypeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    wav: 'audio/wav',
    webm: 'video/webm',
    m4a: 'audio/mp4',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    opus: 'audio/opus',
    mpeg: 'video/mpeg',
    mpga: 'audio/mpeg',
  };
  return ext ? types[ext] ?? '' : '';
}

function normalizedMimeType(mimeType: string, filename: string): string {
  const normalized = mimeType.toLowerCase().split(';', 1)[0].trim();
  if (normalized && normalized !== 'application/octet-stream') return normalized;
  return mimeTypeFromFilename(filename) || normalized;
}

function isSupportedDocument(mimeType: string): boolean {
  return (
    mimeType === 'application/pdf' ||
    mimeType.startsWith('image/') ||
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/vnd.ms-powerpoint' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  );
}

type LinkResult = {
  text: string;
  rawText?: string;
  originalText?: string;
  sourceType: 'audio' | 'video' | 'document' | 'image';
  filename: string;
  originalSize?: number;
  extractedSize?: number;
  videoConvertedToAudio?: boolean;
  segments?: unknown[];
  words?: unknown[];
  duration?: number;
  partCount?: number;
  tokenization: SpacyTokenizationSummary;
  chunking?: ChunkingResult;
  processing_run_id: string;
};

async function processLink(
  url: string,
  userId: number,
  onProgress?: GroqProgressCallback,
): Promise<LinkResult> {
  const normalizedUrl = await normalizeCloudStorageUrl(url);
  const downloaded = await downloadFileFromUrlLarge(normalizedUrl);
  const mimeType = normalizedMimeType(downloaded.mimeType, downloaded.filename);

  if (isAudioFile(downloaded.filename, mimeType) || isVideoFile(downloaded.filename, mimeType)) {
    const result = await transcribeMediaBuffer(
      downloaded.buffer,
      downloaded.filename,
      mimeType,
      onProgress,
    );
    const canonicalText =
      result.segments
        .map((segment) => segment.text.trim())
        .filter(Boolean)
        .join('\n\n') || result.rawText || result.text;
    const { tokenization, chunking } = await chunkTokenizedText({
      text: canonicalText,
      sourceType: result.videoConvertedToAudio ? 'video' : 'audio',
      segments: result.segments,
      contentFormat: 'plain',
    });
    const processingRunId = await persistProcessingPipeline({
      userId,
      sourceType: result.videoConvertedToAudio ? 'video' : 'audio',
      sourceName: downloaded.filename,
      extractionText: canonicalText,
      processedText: canonicalText,
      extractionMetadata: {
        url,
        originalSize: result.originalSize,
        extractedSize: result.extractedSize,
        duration: result.duration,
        partCount: result.partCount,
      },
      tokenization,
      chunking,
    });
    return {
      ...result,
      rawText: canonicalText,
      tokenization: summarizeTokenization(tokenization),
      chunking,
      processing_run_id: processingRunId,
      sourceType: result.videoConvertedToAudio ? 'video' : 'audio',
      filename: downloaded.filename,
    };
  }

  if (!isSupportedDocument(mimeType)) {
    throw new Error(
      'O link não parece ser um PDF, Word, Slides, imagem, áudio ou vídeo reconhecido. ' +
        'Use um link direto para o arquivo.',
    );
  }

  onProgress?.({
    stage: 'preparing',
    message: 'Enviando o arquivo do link para o agente de extração abrangente.',
  });
  const result = await processWithBroadFileExtraction(downloaded.buffer, mimeType);
  const processingRunId = await persistProcessingPipeline({
    userId,
    sourceType: mimeType.startsWith('image/') ? 'image' : 'document',
    sourceName: downloaded.filename,
    extractionText: result.originalText ?? result.text,
    processedText: result.text,
    extractionMetadata: { url, mimeType, sizeBytes: downloaded.buffer.length },
    tokenization: result.tokenizationData,
    chunking: result.chunking,
  });
  const { tokenizationData: _tokenizationData, ...publicResult } = result;
  return {
    ...publicResult,
    sourceType: mimeType.startsWith('image/') ? 'image' : 'document',
    filename: downloaded.filename,
    processing_run_id: processingRunId,
  };
}

function streamLinkProcessing(url: string, userId: number): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };
      const onProgress = (progress: GroqTranscriptionProgress) => {
        send({ type: 'progress', progress });
      };

      processLink(url, userId, onProgress)
        .then((result) => send({ type: 'complete', result }))
        .catch((error) => {
          send({
            type: 'error',
            error: error instanceof Error ? error.message : 'Erro ao processar o link.',
          });
        })
        .finally(() => controller.close());
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': `${STREAM_CONTENT_TYPE}; charset=utf-8`,
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    if (token) token = token.trim().replace(/^["']|["']$/g, '');
    const user = token ? verifyToken(token) : null;
    if (!user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      return NextResponse.json(
        { error: 'Envie um link válido no corpo: { "url": "https://..." }' },
        { status: 400 },
      );
    }

    if (request.headers.get('accept')?.includes(STREAM_CONTENT_TYPE)) {
      return streamLinkProcessing(url, Number(user.id));
    }

    return NextResponse.json(await processLink(url, Number(user.id)));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao processar o link.' },
      { status: 500 },
    );
  }
}