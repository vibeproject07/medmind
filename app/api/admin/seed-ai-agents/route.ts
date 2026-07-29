import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { seedMissingAgentsFromDefaults } from '@/lib/seed-ai-agents';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const user = verifyToken(token);
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const result = await seedMissingAgentsFromDefaults();
  return NextResponse.json({
    message: `${result.inserted.length} agente(s) inserido(s), ${result.skipped.length} já existiam.`,
    ...result,
  });
}
