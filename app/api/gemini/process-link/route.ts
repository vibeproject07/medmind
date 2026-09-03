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
  tokenizeText,
  type SpacyTokenizationSummary,
} from '@/lib/spacy-tokenizer';

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
};

async function processLink(
  url: string,
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
    const tokenization = await tokenizeText({
      text: canonicalText,
      sourceType: result.videoConvertedToAudio ? 'video' : 'audio',
      segments: result.segments,
      contentFormat: 'plain',
      view: 'sentences_text_order',
    });
    return {
      ...result,
      rawText: canonicalText,
      tokenization: summarizeTokenization(tokenization),
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
  return {
    ...result,
    sourceType: mimeType.startsWith('image/') ? 'image' : 'document',
    filename: downloaded.filename,
  };
}

function streamLinkProcessing(url: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };
      const onProgress = (progress: GroqTranscriptionProgress) => {
        send({ type: 'progress', progress });
      };

      processLink(url, onProgress)
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
    if (!token || !verifyToken(token)) {
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
      return streamLinkProcessing(url);
    }

    return NextResponse.json(await processLink(url));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao processar o link.' },
      { status: 500 },
    );
  }
}