import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { listAgents, createAgent } from '@/lib/ai-agents';

function getToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return req.cookies.get('token')?.value ?? null;
}

export async function GET(req: NextRequest) {
  const token = getToken(req);
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const user = verifyToken(token);
  if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  if (user.role === 'regular') return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });

  try {
    const agents = await listAgents();
    return NextResponse.json(agents);
  } catch (err) {
    console.error('[ai-agents] GET error:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const token = getToken(req);
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const user = verifyToken(token);
  if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Apenas administradores podem criar agentes' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { key, name, description, system_prompt, model, temperature, max_output_tokens } = body;

  if (typeof key !== 'string' || !key.trim()) {
    return NextResponse.json({ error: 'O campo "key" é obrigatório' }, { status: 400 });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'O campo "nome" é obrigatório' }, { status: 400 });
  }
  if (typeof system_prompt !== 'string' || !system_prompt.trim()) {
    return NextResponse.json({ error: 'O prompt do sistema é obrigatório' }, { status: 400 });
  }

  const keySlug = (key as string).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');

  try {
    const { agent, conflict } = await createAgent({
      key: keySlug,
      name: (name as string).trim(),
      description: typeof description === 'string' ? description.trim() : '',
      system_prompt: (system_prompt as string).trim(),
      model: typeof model === 'string' ? model : 'gemini-2.5-flash',
      temperature: typeof temperature === 'number' ? temperature : 0.2,
      max_output_tokens: typeof max_output_tokens === 'number' ? max_output_tokens : 4096,
    });

    if (conflict) {
      return NextResponse.json({ error: 'Já existe um agente com essa chave. Escolha uma chave diferente.' }, { status: 409 });
    }
    if (!agent) {
      return NextResponse.json({ error: 'Erro ao criar agente' }, { status: 500 });
    }

    return NextResponse.json(agent, { status: 201 });
  } catch (err) {
    console.error('[ai-agents] POST error:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
