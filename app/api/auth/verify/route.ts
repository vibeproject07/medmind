import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';

// Forçar uso do Node.js runtime (não Edge Runtime)
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('token')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Token não fornecido' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

    return NextResponse.json({ valid: true, user });
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao verificar token' }, { status: 500 });
  }
}

