import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { generateToken } from '@/lib/jwt';

export const runtime = 'nodejs';

export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Não disponível em produção' }, { status: 403 });
  }

  try {
    const res = await query(
      `SELECT id, name, username, email, role, company_id
       FROM users WHERE role = 'regular' ORDER BY id ASC LIMIT 1`
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Nenhum usuário regular encontrado' }, { status: 404 });
    }

    const user = res.rows[0];
    const token = generateToken(user);

    const response = NextResponse.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        username: user.username || null,
        email: user.email,
        role: user.role,
        company_id: user.company_id || null,
      },
    });

    response.cookies.set('token', token, {
      httpOnly: false,
      secure: false,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    return response;
  } catch (err) {
    console.error('[dev-login-user] erro:', err);
    return NextResponse.json({ error: 'Erro ao gerar login rápido' }, { status: 500 });
  }
}
