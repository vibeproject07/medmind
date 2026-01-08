import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

// Forçar uso do Node.js runtime (não Edge Runtime)
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // Tentar pegar token do header Authorization ou do cookie
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    
    // Limpar token: remover espaços e possíveis aspas
    if (token) {
      token = token.trim().replace(/^["']|["']$/g, '');
    }
    
    if (!token) {
      return NextResponse.json({ error: 'Não autorizado - Token não fornecido' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

    const db = getDatabase();
    const settings = db.prepare('SELECT * FROM settings').all();

    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao buscar configurações' }, { status: 500 });
  }
}

