import { NextRequest, NextResponse } from 'next/server';
import {
  groqTranscribeFile,
  groqTranscribeFromUrl,
  groqTranscribeLargeFile,
  extractAudioFromVideo,
  isVideoFile,
  downloadFileFromUrlLarge,
  normalizeCloudStorageUrl,
  isCloudStorageUrl,
  MAX_SIZE_FOR_CHUNKED_TRANSCRIPTION,
} from '@/lib/groq-stt';

export const runtime = 'nodejs';

const MAX_SINGLE_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

/**
 * Rota usada apenas pelo Teste Groq 2: extrai áudio do vídeo antes de transcrever,
 * reduzindo o tamanho do arquivo. Retorna text + originalSize e extractedSize para exibir a diferença.
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: 'GROQ_API_KEY não configurada no servidor.' },
        { status: 500 }
      );
    }

    const contentType = request.headers.get('content-type') ?? '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      if (!file || typeof file === 'string') {
        return NextResponse.json(
          { error: 'Envie um arquivo de áudio ou vídeo no campo "file".' },
          { status: 400 }
        );
      }
      if (file.size > MAX_SIZE_FOR_CHUNKED_TRANSCRIPTION) {
        return NextResponse.json(
          { error: `Arquivo muito grande. Máximo ${Math.round(MAX_SIZE_FOR_CHUNKED_TRANSCRIPTION / 1024 / 1024)} MB.` },
          { status: 400 }
        );
      }
      const type = (file.type || '').toLowerCase();
      if (!type.startsWith('audio/') && !type.startsWith('video/')) {
        return NextResponse.json(
          { error: 'Formato não suportado. Use áudio ou vídeo.' },
          { status: 400 }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const filename = file.name || 'audio';
      let bufferToTranscribe = buffer;
      let nameToTranscribe = filename;
      let originalSize = buffer.length;
      let extractedSize = buffer.length;

      if (isVideoFile(filename, file.type)) {
        const extracted = await extractAudioFromVideo(buffer, filename);
        bufferToTranscribe = extracted.audioBuffer as any;
        nameToTranscribe = extracted.audioFilename;
        originalSize = extracted.originalSize;
        extractedSize = extracted.extractedSize;
      }

      const result =
        bufferToTranscribe.length > MAX_SINGLE_FILE_SIZE
          ? await groqTranscribeLargeFile(bufferToTranscribe, nameToTranscribe)
          : await groqTranscribeFile(bufferToTranscribe, nameToTranscribe);

      return NextResponse.json({
        text: result.text,
        originalSize,
        extractedSize,
      });
    }

    if (contentType.includes('application/json')) {
      const body = await request.json();
      const url = typeof body?.url === 'string' ? body.url.trim() : '';
      if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        return NextResponse.json(
          { error: 'Envie um link válido no corpo: { "url": "https://..." }' },
          { status: 400 }
        );
      }

      if (isCloudStorageUrl(url)) {
        const normalizedUrl = await normalizeCloudStorageUrl(url);
        const { buffer, filename } = await downloadFileFromUrlLarge(normalizedUrl);
        let bufferToTranscribe = buffer;
        let nameToTranscribe = filename;
        let originalSize = buffer.length;
        let extractedSize = buffer.length;

        if (isVideoFile(filename)) {
          const extracted = await extractAudioFromVideo(buffer, filename);
          bufferToTranscribe = extracted.audioBuffer;
          nameToTranscribe = extracted.audioFilename;
          originalSize = extracted.originalSize;
          extractedSize = extracted.extractedSize;
        }

        const result =
          bufferToTranscribe.length > MAX_SINGLE_FILE_SIZE
            ? await groqTranscribeLargeFile(bufferToTranscribe, nameToTranscribe)
            : await groqTranscribeFile(bufferToTranscribe, nameToTranscribe);

        return NextResponse.json({
          text: result.text,
          originalSize,
          extractedSize,
        });
      }

      const result = await groqTranscribeFromUrl(url);
      return NextResponse.json({
        text: result.text,
        originalSize: 0,
        extractedSize: 0,
      });
    }

    return NextResponse.json(
      { error: 'Envie multipart/form-data com arquivo ou application/json com { "url": "..." }' },
      { status: 400 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao transcrever.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
