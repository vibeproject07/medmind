import { NextRequest, NextResponse } from 'next/server';
import {
  downloadFileFromUrlLarge,
  MAX_SIZE_FOR_CHUNKED_TRANSCRIPTION,
  normalizeCloudStorageUrl,
  transcribeMediaBuffer,
  type GroqProgressCallback,
  type GroqTranscriptionProgress,
  type GroqTranscriptionResult,
} from '@/lib/groq-stt';
import { verifyToken } from '@/lib/jwt';
import type { SpacyTokenizationSummary } from '@/lib/spacy-tokenizer';
import type { ChunkingResult } from '@/lib/chunking-agent';
import { persistProcessingPipeline } from '@/lib/content-processing-storage';
import {
  canonicalTranscriptionText,
  processExtractedSource,
} from '@/lib/source-content-pipeline';

export const runtime = 'nodejs';

const STREAM_CONTENT_TYPE = 'application/x-ndjson';

interface PreparedMedia {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
}

export interface GroqTranscriptionApiResult extends GroqTranscriptionResult {
  originalSize: number;
  extractedSize: number;
  videoConvertedToAudio: boolean;
  tokenization?: SpacyTokenizationSummary;
  chunking?: ChunkingResult;
  tokenization_error?: string;
  chunking_error?: string;
  processing_error?: string;
  processing_run_id?: string;
}

async function parseRequestMedia(
  request: NextRequest,
): Promise<PreparedMedia | NextResponse> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file || typeof file === 'string') {
      return NextResponse.json(
        { error: 'Envie um arquivo de áudio ou vídeo no campo "file".' },
        { status: 400 },
      );
    }
    if (file.size > MAX_SIZE_FOR_CHUNKED_TRANSCRIPTION) {
      return NextResponse.json(
        {
          error: `Arquivo muito grande. Máximo ${Math.round(
            MAX_SIZE_FOR_CHUNKED_TRANSCRIPTION / 1024 / 1024,
          )} MB.`,
        },
        { status: 400 },
      );
    }
    const type = (file.type || '').toLowerCase();
    const hasSupportedMediaExtension =
      /\.(flac|mp3|mp4|mpeg|mpga|m4a|ogg|opus|wav|webm|mov|avi|mkv|m4v)$/i.test(
        file.name || '',
      );
    if (
      !type.startsWith('audio/') &&
      !type.startsWith('video/') &&
      !hasSupportedMediaExtension
    ) {
      return NextResponse.json(
        { error: 'Formato não suportado. Use áudio ou vídeo.' },
        { status: 400 },
      );
    }
    return {
      buffer: Buffer.from(await file.arrayBuffer()),
      filename: file.name || 'audio',
      mimeType: file.type,
    };
  }

  if (contentType.includes('application/json')) {
    const body = await request.json();
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      return NextResponse.json(
        { error: 'Envie um link válido no corpo: { "url": "https://..." }' },
        { status: 400 },
      );
    }

    // Links também são baixados no servidor para que vídeos nunca sejam enviados
    // inteiros à Groq: o áudio é extraído primeiro, assim como nos uploads.
    const normalizedUrl = await normalizeCloudStorageUrl(url);
    const downloaded = await downloadFileFromUrlLarge(normalizedUrl);
    return {
      buffer: downloaded.buffer,
      filename: downloaded.filename,
    };
  }

  return NextResponse.json(
    { error: 'Envie multipart/form-data com arquivo ou application/json com { "url": "..." }' },
    { status: 400 },
  );
}

async function transcribePreparedMedia(
  media: PreparedMedia,
  userId: number,
  onProgress?: GroqProgressCallback,
): Promise<GroqTranscriptionApiResult> {
  const result = await transcribeMediaBuffer(
    media.buffer,
    media.filename,
    media.mimeType,
    onProgress,
  );
  const canonicalText = canonicalTranscriptionText(result);
  const processing = await processExtractedSource({
    text: canonicalText,
    sourceType: result.videoConvertedToAudio ? 'video' : 'audio',
    segments: result.segments,
  });
  let processingRunId: string | undefined;
  let processingError: string | undefined;
  if (processing.tokenizationData && processing.chunking) {
    try {
      processingRunId = await persistProcessingPipeline({
        userId,
        sourceType: result.videoConvertedToAudio ? 'video' : 'audio',
        sourceName: media.filename,
        extractionText: canonicalText,
        processedText: canonicalText,
        wholeTranscription: canonicalText,
        cleanedTranscription: canonicalText,
        transcriptionSegments: result.segments,
        extractionMetadata: {
          originalSize: result.originalSize,
          extractedSize: result.extractedSize,
          duration: result.duration,
          partCount: result.partCount,
          videoConvertedToAudio: result.videoConvertedToAudio,
        },
        tokenization: processing.tokenizationData,
        chunking: processing.chunking,
      });
    } catch (error) {
      processingError = error instanceof Error ? error.message : 'Falha ao persistir análise.';
    }
  }
  const { tokenizationData: _tokenizationData, ...publicProcessing } = processing;
  return {
    ...result,
    rawText: canonicalText,
    ...publicProcessing,
    ...(processingRunId ? { processing_run_id: processingRunId } : {}),
    ...(processingError ? { processing_error: processingError } : {}),
  };
}

function streamTranscription(media: PreparedMedia, userId: number): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };
      const onProgress = (progress: GroqTranscriptionProgress) => {
        send({ type: 'progress', progress });
      };

      transcribePreparedMedia(media, userId, onProgress)
        .then((result) => send({ type: 'complete', result }))
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Erro ao transcrever.';
          send({ type: 'error', error: message });
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
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: 'GROQ_API_KEY não configurada no servidor.' },
        { status: 500 },
      );
    }
    const authorization = request.headers.get('authorization');
    const bearerToken = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : null;
    const token = bearerToken || request.cookies.get('token')?.value || '';
    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const media = await parseRequestMedia(request);
    if (media instanceof NextResponse) return media;

    if (request.headers.get('accept')?.includes(STREAM_CONTENT_TYPE)) {
      return streamTranscription(media, Number(user.id));
    }

    return NextResponse.json(await transcribePreparedMedia(media, Number(user.id)));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao transcrever.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}