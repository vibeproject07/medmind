import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { geminiProcessDocument, geminiTransformTranscription, EXTRACT_TEXT_INSTRUCTION } from '@/lib/gemini';
import { extractTextFromDocx, extractTextFromPptx } from '@/lib/document-extract';
import { getAgentPrompt } from '@/lib/ai-agents';
import { getDefault } from '@/lib/ai-agents-defaults';

export const runtime = 'nodejs';

const GEMINI_NATIVE_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

const EXTRACT_TYPES: Record<string, 'docx' | 'pptx'> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'pptx',
};

const ALLOWED_MIME_TYPES = [
  ...GEMINI_NATIVE_TYPES,
  ...Object.keys(EXTRACT_TYPES),
];

function isAllowedMimeType(type: string): boolean {
  return ALLOWED_MIME_TYPES.includes(type) || type.startsWith('image/');
}

function getAgentKeyByMimeType(mimeType: string): string {
  const m = (mimeType || '').toLowerCase();
  if (m.startsWith('image/')) return 'resumo_imagem';
  if (
    m === 'application/vnd.ms-powerpoint' ||
    m === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return 'resumo_slides_pdf';
  }
  return 'resumo_documento';
}

async function resolveAgent(agentKey: string) {
  const prompt = await getAgentPrompt(agentKey).catch(() => '');
  const def = getDefault(agentKey);
  return {
    systemPrompt: prompt || def?.system_prompt || '',
    temperature: def?.temperature ?? 0.2,
    maxOutputTokens: def?.max_output_tokens ?? 8192,
  };
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;

    if (token) {
      token = token.trim().replace(/^["']|["']$/g, '');
    }

    if (!token) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Envie o arquivo em multipart/form-data com o campo "file".' },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file || typeof file === 'string') {
      return NextResponse.json(
        { error: 'Envie um arquivo no campo "file".' },
        { status: 400 }
      );
    }

    const mimeType = (file.type || 'application/octet-stream').toLowerCase();
    if (!isAllowedMimeType(mimeType)) {
      return NextResponse.json(
        {
          error:
            'Formato não suportado. Use PDF, Word (.docx), PowerPoint (.pptx) ou imagem.',
        },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const extractType = EXTRACT_TYPES[mimeType];

    if (extractType) {
      let extractedText: string;
      try {
        if (extractType === 'docx') {
          extractedText = await extractTextFromDocx(buffer);
        } else {
          extractedText = await extractTextFromPptx(buffer);
        }
      } catch (extractErr) {
        const msg = extractErr instanceof Error ? extractErr.message : 'Erro ao extrair texto do arquivo.';
        return NextResponse.json({ error: msg }, { status: 422 });
      }

      const agentKey = extractType === 'pptx' ? 'resumo_pptx' : 'resumo_docx';
      const { systemPrompt, temperature, maxOutputTokens } = await resolveAgent(agentKey);

      const summary = await geminiTransformTranscription({
        transcription: extractedText,
        instruction: 'Produza o material de estudo conforme as instruções do sistema acima.',
        systemPrompt,
        temperature,
        maxOutputTokens,
      });

      return NextResponse.json({ text: summary, originalText: extractedText });
    }

    const agentKey = getAgentKeyByMimeType(mimeType);
    const { temperature, maxOutputTokens } = await resolveAgent(agentKey);
    const result = await geminiProcessDocument({
      file: buffer,
      mimeType,
      agentKey,
      temperature,
      maxOutputTokens,
    });

    const isPdfOrWord =
      mimeType === 'application/pdf' ||
      mimeType === 'application/msword' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    let originalText: string | undefined;
    if (isPdfOrWord) {
      try {
        originalText = await geminiProcessDocument({
          file: buffer,
          mimeType,
          instruction: EXTRACT_TEXT_INSTRUCTION,
          temperature: 0.0,
          maxOutputTokens: 16384,
        });
      } catch {
        originalText = undefined;
      }
    }

    return NextResponse.json({ text: result, originalText });
  } catch (error: unknown) {
    let message = 'Erro ao processar o documento.';
    if (error instanceof Error) {
      message = error.message;
    }
    const err = error as { error?: { code?: number; status?: string; message?: string }; message?: string };
    if (err?.error?.code === 404 || err?.error?.status === 'Not Found') {
      message = 'Serviço de processamento de documentos temporariamente indisponível. Verifique a chave GEMINI_API_KEY e tente novamente.';
    } else if (err?.error?.message && typeof err.error.message === 'string') {
      message = err.error.message;
    } else if (typeof err?.message === 'string' && err.message) {
      message = err.message;
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
