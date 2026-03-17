import { NextRequest, NextResponse } from 'next/server';
import { groqChat, getGroqReply } from '@/lib/groq';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: 'GROQ_API_KEY não configurada no servidor. Defina em .env.local' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { messages, model, temperature, max_tokens } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'O corpo da requisição deve incluir "messages" (array de { role, content })' },
        { status: 400 }
      );
    }

    const response = await groqChat(messages, {
      model: model ?? 'llama-3.2-90b-vision-preview',
      temperature,
      max_tokens,
    });

    const reply = getGroqReply(response);
    return NextResponse.json({
      reply,
      usage: response.usage,
      id: response.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao chamar a API Groq';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
