import { NextRequest, NextResponse } from 'next/server';
import { getUserByUsernameOrEmail, getUserPasswordByUsernameOrEmail, verifyPassword } from '@/lib/auth';
import { generateToken, verifyToken } from '@/lib/jwt';

// Forçar uso do Node.js runtime (não Edge Runtime)
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { identifier, password } = await request.json();

    if (!identifier || !password) {
      return NextResponse.json({ error: 'Credenciais obrigatórias' }, { status: 400 });
    }

    const user = getUserByUsernameOrEmail(identifier);
    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 });
    }

    const hashedPassword = getUserPasswordByUsernameOrEmail(identifier);
    if (!hashedPassword) {
      return NextResponse.json({ error: 'Senha não encontrada' }, { status: 401 });
    }

    const isValid = await verifyPassword(password, hashedPassword);
    if (!isValid) {
      return NextResponse.json({ error: 'Senha inválida' }, { status: 401 });
    }

    // Gerar token
    const token = generateToken(user);
    
    // Testar token imediatamente
    const testUser = verifyToken(token);
    
    // Verificar JWT_SECRET
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

    return NextResponse.json({
      success: true,
      token: token.substring(0, 50) + '...',
      tokenLength: token.length,
      tokenValid: !!testUser,
      testUser: testUser ? {
        id: testUser.id,
        email: testUser.email,
        role: testUser.role
      } : null,
      jwtSecretLength: JWT_SECRET.length,
      jwtSecretStart: JWT_SECRET.substring(0, 10) + '...',
      originalUser: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });
  } catch (error: any) {
    return NextResponse.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
}

