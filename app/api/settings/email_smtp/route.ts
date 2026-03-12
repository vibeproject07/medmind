import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

export const runtime = 'nodejs';

export async function PUT(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;

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

    if (user.role === 'regular') {
      return NextResponse.json({
        error: 'Acesso negado. Apenas administradores e gerentes podem configurar o SMTP.'
      }, { status: 403 });
    }

    const { host, port, user: smtpUser, password } = await request.json();

    if (!host || !port || !smtpUser || !password) {
      return NextResponse.json({ error: 'Todos os campos são obrigatórios' }, { status: 400 });
    }

    const value = JSON.stringify({ host, port, user: smtpUser, password });

    const existing = (await query('SELECT id FROM settings WHERE key = $1', ['email_smtp'])).rows[0];

    if (existing) {
      await query(
        'UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2',
        [value, 'email_smtp']
      );
    } else {
      await query(
        'INSERT INTO settings (key, value, description) VALUES ($1, $2, $3)',
        ['email_smtp', value, 'Configuração de SMTP para envio de emails']
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Erro ao salvar configuração de email:', error);
    return NextResponse.json({
      error: 'Erro ao salvar configuração',
      details: error.message
    }, { status: 500 });
  }
}
