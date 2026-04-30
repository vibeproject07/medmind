import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { geminiTransformTranscription } from '@/lib/gemini';

export const runtime = 'nodejs';

const ALLOWED_AGENT_KEYS = new Set(['transform_base', 'ajuste_transcricao']);

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
    const requestedAgentKey = typeof body?.agentKey === 'string' ? body.agentKey : 'transform_base';
    const agentKey = ALLOWED_AGENT_KEYS.has(requestedAgentKey) ? requestedAgentKey : 'transform_base';

    if (!transcription || !transcription.trim()) {
      return NextResponse.json({ error: 'Envie a transcrição em { transcription: string }.' }, { status: 400 });
    }
    if (!instruction || !instruction.trim()) {
      return NextResponse.json({ error: 'Envie a instrução em { instruction: string }.' }, { status: 400 });
    }

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
      agentKey,
    });

    return NextResponse.json({ text: result });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Erro ao transformar transcrição.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
