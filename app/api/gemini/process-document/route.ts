import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { geminiProcessDocument, EXTRACT_TEXT_INSTRUCTION } from '@/lib/gemini';

export const runtime = 'nodejs';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

function isAllowedMimeType(type: string): boolean {
  return ALLOWED_MIME_TYPES.includes(type) || type.startsWith('image/');
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
            'Formato não suportado. Use PDF, Word (.doc, .docx), PowerPoint (.ppt, .pptx) ou imagem.',
        },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await geminiProcessDocument({
      file: buffer,
      mimeType,
    });

    const isTextDocument =
      mimeType === 'application/pdf' ||
      mimeType === 'application/msword' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    let originalText: string | undefined;
    if (isTextDocument) {
      try {
        originalText = await geminiProcessDocument({
          file: buffer,
          mimeType,
          instruction: EXTRACT_TEXT_INSTRUCTION,
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
    // Tratar resposta de API (ex.: Gemini retorna { error: { code, status, message } })
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
