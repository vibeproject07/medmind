import { NextRequest, NextResponse } from 'next/server';
import { getUserByUsernameOrEmail, getUserPasswordByUsernameOrEmail, verifyPassword } from '@/lib/auth';
import { generateToken } from '@/lib/jwt';
import { getDatabase } from '@/lib/db';

// Forçar uso do Node.js runtime (não Edge Runtime)
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { email, username, password } = await request.json();

    // Aceita email ou username (o campo email pode conter username ou email)
    const identifier = username || email;

    if (!identifier || !password) {
      return NextResponse.json(
        { error: 'Username/Email e senha são obrigatórios' },
        { status: 400 }
      );
    }

    const user = getUserByUsernameOrEmail(identifier);
    if (!user) {
      return NextResponse.json(
        { error: 'Username/Email ou senha inválidos' },
        { status: 401 }
      );
    }

    // Verificar se o email foi validado (exceto para admin)
    const db = getDatabase();
    const userRecord = db.prepare('SELECT email_verified FROM users WHERE id = ?').get(user.id) as any;
    
    if (user.role !== 'admin' && (!userRecord || !userRecord.email_verified)) {
      return NextResponse.json(
        { 
          error: 'Email não confirmado. Verifique sua caixa de entrada e confirme seu email antes de fazer login.',
          requiresVerification: true
        },
        { status: 403 }
      );
    }

    const hashedPassword = getUserPasswordByUsernameOrEmail(identifier);
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
    
    // Log para debug
    console.log('🔑 Token gerado no login:', {
      tokenLength: token.length,
      tokenStart: token.substring(0, 30) + '...',
      userId: user.id,
      userEmail: user.email
    });
    
    // Testar o token imediatamente após gerar
    const { verifyToken } = await import('@/lib/jwt');
    const testUser = verifyToken(token);
    console.log('✅ Token testado após geração:', testUser ? 'VÁLIDO' : 'INVÁLIDO');

    // Criar resposta com cookie
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

    // Salvar token em cookie para o middleware
    response.cookies.set('token', token, {
      httpOnly: false, // Permitir acesso via JavaScript também
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 dias
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

