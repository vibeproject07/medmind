import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/note-sources';

export const runtime = 'nodejs';

const MAX_TEXT_LENGTH = 4_000;

function limitedText(value: unknown): string | null {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT_LENGTH) : null;
}

export async function POST(request: NextRequest) {
  const user = getRequestUser(request);
  if (!user) {
    const stack = new Error('Diagnóstico de upload recebido sem autenticação.').stack;
    console.log('[source-upload][replit] Diagnóstico recusado por falta de autenticação.', {
      stack,
    });
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    console.log('[source-upload][replit] Falha reportada pelo navegador.', {
      userId: user.id,
      message: limitedText(body?.message),
      noteId: Number.isInteger(body?.context?.noteId) ? body.context.noteId : null,
      sourceId: Number.isInteger(body?.context?.sourceId) ? body.context.sourceId : null,
      fileType: limitedText(body?.context?.fileType),
      fileSize: Number.isFinite(body?.context?.fileSize) ? body.context.fileSize : null,
      status: Number.isFinite(body?.context?.status) ? body.context.status : null,
      statusText: limitedText(body?.context?.statusText),
      readyState: Number.isFinite(body?.context?.readyState) ? body.context.readyState : null,
      apiError: limitedText(body?.context?.apiError),
      errorName: limitedText(body?.errorName),
      errorMessage: limitedText(body?.errorMessage),
      stack: limitedText(body?.stack),
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const stack = error instanceof Error ? error.stack : new Error(String(error)).stack;
    console.log('[source-upload][replit] Falha ao registrar diagnóstico do navegador.', {
      error: error instanceof Error ? error.message : String(error),
      stack,
    });
    return NextResponse.json({ error: 'Diagnóstico inválido.' }, { status: 400 });
  }
}