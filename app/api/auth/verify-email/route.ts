import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { verifyAndUseToken } from '@/lib/email';

// Forçar uso do Node.js runtime (não Edge Runtime)
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'Token não fornecido' }, { status: 400 });
    }

    // Verificar e usar token
    const userId = verifyAndUseToken(token, 'email_verification');

    if (!userId) {
      return NextResponse.json({ 
        error: 'Token inválido ou expirado' 
      }, { status: 400 });
    }

    // Marcar email como verificado
    const db = getDatabase();
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);

    return NextResponse.json({
      success: true,
      message: 'Email confirmado com sucesso! Você já pode fazer login.',
    });
  } catch (error: any) {
    console.error('Erro ao verificar email:', error);
    return NextResponse.json({ 
      error: 'Erro ao verificar email',
      details: error.message 
    }, { status: 500 });
  }
}

