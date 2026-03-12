import { NextRequest, NextResponse } from 'next/server';
import { getUserByUsernameOrEmail, getUserPasswordByUsernameOrEmail, verifyPassword } from '@/lib/auth';
import { generateToken } from '@/lib/jwt';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { email, username, password } = await request.json();

    const identifier = username || email;

    if (!identifier || !password) {
      return NextResponse.json(
        { error: 'Username/Email e senha são obrigatórios' },
        { status: 400 }
      );
    }

    const user = await getUserByUsernameOrEmail(identifier);
    if (!user) {
      return NextResponse.json(
        { error: 'Username/Email ou senha inválidos' },
        { status: 401 }
      );
    }

    const userRecord = (await query('SELECT email_verified FROM users WHERE id = $1', [user.id])).rows[0];

    if (user.role !== 'admin' && (!userRecord || !userRecord.email_verified)) {
      return NextResponse.json(
        {
          error: 'Email não confirmado. Verifique sua caixa de entrada e confirme seu email antes de fazer login.',
          requiresVerification: true
        },
        { status: 403 }
      );
    }

    const hashedPassword = await getUserPasswordByUsernameOrEmail(identifier);
    if (!hashedPassword) {
      return NextResponse.json(
        { error: 'Username/Email ou senha inválidos' },
        { status: 401 }
      );
    }

    const isValid = await verifyPassword(password, hashedPassword);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Username/Email ou senha inválidos' },
        { status: 401 }
      );
    }

    const token = generateToken(user);

    const { verifyToken } = await import('@/lib/jwt');
    const testUser = verifyToken(token);
    console.log('✅ Token testado após geração:', testUser ? 'VÁLIDO' : 'INVÁLIDO');

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
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: 'Erro ao processar login' },
      { status: 500 }
    );
  }
}
