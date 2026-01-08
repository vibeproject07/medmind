import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { verifyAndUseToken } from '@/lib/email';

// Forçar uso do Node.js runtime (não Edge Runtime)
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json();

    if (!token || !password) {
      return NextResponse.json({ 
        error: 'Token e senha são obrigatórios' 
      }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ 
        error: 'A senha deve ter pelo menos 6 caracteres' 
      }, { status: 400 });
    }

    // Verificar e usar token
    const userId = verifyAndUseToken(token, 'password_reset');

    if (!userId) {
      return NextResponse.json({ 
        error: 'Token inválido ou expirado' 
      }, { status: 400 });
    }

    // Atualizar senha
    const hashedPassword = await hashPassword(password);
    const db = getDatabase();
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, userId);

    return NextResponse.json({
      success: true,
      message: 'Senha redefinida com sucesso!',
    });
  } catch (error: any) {
    console.error('Erro ao redefinir senha:', error);
    return NextResponse.json({ 
      error: 'Erro ao redefinir senha',
      details: error.message 
    }, { status: 500 });
  }
}

