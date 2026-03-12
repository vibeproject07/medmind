import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
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

    if (user.role !== 'admin') {
      return NextResponse.json({
        error: 'Acesso negado. Apenas administradores podem acessar esta funcionalidade.'
      }, { status: 403 });
    }

    const companies = (await query('SELECT id, name, created_at FROM companies ORDER BY name')).rows;

    return NextResponse.json(companies);
  } catch (error) {
    console.error('Erro ao buscar empresas:', error);
    return NextResponse.json({ error: 'Erro ao buscar empresas' }, { status: 500 });
  }
}
