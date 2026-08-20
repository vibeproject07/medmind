import { NextRequest, NextResponse } from 'next/server';
import {
  ensureNoteSourcesSchema,
  getAccessibleNote,
  getAccessibleSource,
  getRequestUser,
} from '@/lib/note-sources';
import { readSourceObject } from '@/lib/s3';
import { geminiProcessDocument, geminiTransformTranscription } from '@/lib/gemini';
import { extractTextFromDocx, extractTextFromPptx } from '@/lib/document-extract';
import {
  extractAudioFromVideo,
  groqTranscribeFile,
  groqTranscribeLargeFile,
  isVideoFile,
  MAX_SIZE_FOR_CHUNKED_TRANSCRIPTION,
} from '@/lib/groq-stt';

export const runtime = 'nodejs';

const MAX_SINGLE_FILE_SIZE = 25 * 1024 * 1024;
const MAX_DOCUMENT_PROCESS_BYTES = 30 * 1024 * 1024;
const MAX_TEXT_PROCESS_BYTES = 5 * 1024 * 1024;

const DOCX_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);
const PPTX_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
]);

function parsePositiveInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; sourceId: string } },
) {
  try {
    const noteId = parsePositiveInteger(params.id);
    const sourceId = parsePositiveInteger(params.sourceId);
    if (!noteId || !sourceId) return NextResponse.json({ error: 'Fonte ou nota inválida.' }, { status: 400 });

    const user = getRequestUser(request);
    if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });

    await ensureNoteSourcesSchema();
    const note = await getAccessibleNote(noteId, user);
    if (!note) return NextResponse.json({ error: 'Nota não encontrada ou sem acesso.' }, { status: 404 });
    const source = await getAccessibleSource(noteId, sourceId, user);
    if (!source) return NextResponse.json({ error: 'Fonte não encontrada.' }, { status: 404 });
    if (source.status !== 'ready') {
      return NextResponse.json({ error: 'Aguarde a conclusão do upload antes de processar.' }, { status: 409 });
    }

    const mimeType = source.mime_type.toLowerCase();
    const maxProcessBytes = source.category === 'audio' || source.category === 'video'
      ? MAX_SIZE_FOR_CHUNKED_TRANSCRIPTION
      : source.category === 'text'
        ? MAX_TEXT_PROCESS_BYTES
        : MAX_DOCUMENT_PROCESS_BYTES;
    if (Number(source.size_bytes) > maxProcessBytes) {
      return NextResponse.json(
        {
          error: `Este arquivo pode ser armazenado, mas excede o limite de ${Math.round(maxProcessBytes / 1024 / 1024)} MB para processamento por IA.`,
        },
        { status: 413 },
      );
    }

    const buffer = await readSourceObject(source.object_key);

    if (source.category === 'audio' || source.category === 'video') {
      if (!process.env.GROQ_API_KEY) {
        return NextResponse.json({ error: 'Serviço de transcrição não configurado.' }, { status: 503 });
      }

      let audio = buffer;
      let filename = source.original_name;
      if (isVideoFile(filename, mimeType)) {
        const extracted = await extractAudioFromVideo(buffer, filename);
        audio = Buffer.from(extracted.audioBuffer);
        filename = extracted.audioFilename;
      }
      const transcription = audio.length > MAX_SINGLE_FILE_SIZE
        ? await groqTranscribeLargeFile(audio, filename)
        : await groqTranscribeFile(audio, filename);
      const text = await geminiTransformTranscription({
        transcription: transcription.text,
        instruction: 'Resuma a transcrição em material de estudo claro, organizado e em português do Brasil.',
        agentKey: 'ajuste_transcricao',
      });
      return NextResponse.json({ originalText: transcription.text, text });
    }

    if (source.category === 'text') {
      const originalText = buffer.toString('utf8');
      const text = await geminiTransformTranscription({
        transcription: originalText,
        instruction: 'Organize o conteúdo em material de estudo claro, estruturado e em português do Brasil.',
        agentKey: 'ajuste_transcricao',
      });
      return NextResponse.json({ originalText, text });
    }

    let originalText: string | undefined;
    if (DOCX_TYPES.has(mimeType)) {
      originalText = await extractTextFromDocx(buffer);
    } else if (PPTX_TYPES.has(mimeType)) {
      originalText = await extractTextFromPptx(buffer);
    }

    if (originalText !== undefined) {
      const text = await geminiTransformTranscription({
        transcription: originalText,
        instruction: 'Produza o material de estudo conforme as instruções do sistema.',
        agentKey: PPTX_TYPES.has(mimeType) ? 'resumo_pptx' : 'resumo_docx',
      });
      return NextResponse.json({ originalText, text });
    }

    const agentKey = source.category === 'image' ? 'resumo_imagem' : 'resumo_documento';
    const text = await geminiProcessDocument({ file: buffer, mimeType, agentKey });
    if (mimeType === 'application/pdf') {
      try {
        originalText = await geminiProcessDocument({ file: buffer, mimeType, agentKey: 'extrair_texto' });
      } catch {
        originalText = undefined;
      }
    }
    return NextResponse.json({ originalText, text });
  } catch (error) {
    console.error('[note sources] Erro ao processar fonte no S3:', error);
    const message = error instanceof Error ? error.message : 'Não foi possível processar a fonte.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}