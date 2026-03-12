import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { geminiTransformTranscription } from '@/lib/gemini';

export const runtime = 'nodejs';

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

    const body = await request.json().catch(() => ({}));
    const transcription =
      (typeof body?.transcription === 'string' ? body.transcription : '') ||
      (typeof body?.text === 'string' ? body.text : '');
    const instruction = typeof body?.instruction === 'string' ? body.instruction : '';
    const model = typeof body?.model === 'string' ? body.model : undefined;

    if (!transcription || !transcription.trim()) {
      return NextResponse.json({ error: 'Envie a transcrição em { transcription: string }.' }, { status: 400 });
    }
    if (!instruction || !instruction.trim()) {
      return NextResponse.json({ error: 'Envie a instrução em { instruction: string }.' }, { status: 400 });
    }

    // Guarda simples para evitar payloads absurdos
    if (transcription.length > 2_000_000) {
      return NextResponse.json({ error: 'Transcrição muito grande. Reduza o texto e tente novamente.' }, { status: 400 });
    }
    if (instruction.length > 20_000) {
      return NextResponse.json({ error: 'Instrução muito grande. Reduza o texto e tente novamente.' }, { status: 400 });
    }

    const result = await geminiTransformTranscription({
      transcription,
      instruction,
      model,
    });

    return NextResponse.json({ text: result });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Erro ao transformar transcrição.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

