import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { getAgent, upsertAgent, resetAgent, deleteAgent } from '@/lib/ai-agents';
import { getDefault } from '@/lib/ai-agents-defaults';

function getToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return req.cookies.get('token')?.value ?? null;
}

export async function GET(req: NextRequest, { params }: { params: { key: string } }) {
  const token = getToken(req);
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const user = verifyToken(token);
  if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  if (user.role === 'regular') return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });

  const agent = await getAgent(params.key);
  if (!agent) return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 });
  return NextResponse.json(agent);
}

export async function PUT(req: NextRequest, { params }: { params: { key: string } }) {
  const token = getToken(req);
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const user = verifyToken(token);
  if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Apenas administradores podem editar agentes' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { name, description, system_prompt, model, temperature, max_output_tokens } = body as Record<string, unknown>;

  if (Number.isFinite(temperature) && ((temperature as number) < 0 || (temperature as number) > 1)) {
    return NextResponse.json({ error: 'Temperatura deve estar entre 0 e 1.' }, { status: 400 });
  }
  if (Number.isFinite(max_output_tokens) && ((max_output_tokens as number) < 256 || (max_output_tokens as number) > 16384)) {
    return NextResponse.json({ error: 'Máximo de tokens deve estar entre 256 e 16384.' }, { status: 400 });
  }

  const agent = await upsertAgent(params.key, {
    name: typeof name === 'string' ? name : undefined,
    description: typeof description === 'string' ? description : undefined,
    system_prompt: typeof system_prompt === 'string' ? system_prompt : undefined,
    model: typeof model === 'string' ? model : undefined,
    temperature: typeof temperature === 'number' ? temperature : undefined,
    max_output_tokens: typeof max_output_tokens === 'number' ? max_output_tokens : undefined,
  });

  if (!agent) return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 });
  return NextResponse.json(agent);
}

export async function DELETE(req: NextRequest, { params }: { params: { key: string } }) {
  const token = getToken(req);
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const user = verifyToken(token);
  if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Apenas administradores podem excluir/resetar agentes' }, { status: 403 });

  const isBuiltin = !!getDefault(params.key);

  if (isBuiltin) {
    const agent = await resetAgent(params.key);
    if (!agent) return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 });
    return NextResponse.json({ agent, action: 'reset' });
  } else {
    const deleted = await deleteAgent(params.key);
    if (!deleted) return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 });
    return NextResponse.json({ agent: { key: params.key }, action: 'deleted' });
  }
}
