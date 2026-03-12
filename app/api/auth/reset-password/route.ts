import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { verifyAndUseToken } from '@/lib/email';

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

    const userId = await verifyAndUseToken(token, 'password_reset');

    if (!userId) {
      return NextResponse.json({
        error: 'Token inválido ou expirado'
      }, { status: 400 });
    }

    const hashedPassword = await hashPassword(password);
    await query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, userId]);

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
