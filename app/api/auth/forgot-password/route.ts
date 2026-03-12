import { NextRequest, NextResponse } from 'next/server';
import { getUserByEmail } from '@/lib/auth';
import { generateToken, saveEmailToken, sendPasswordResetEmail } from '@/lib/email';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email é obrigatório' }, { status: 400 });
    }

    const user = await getUserByEmail(email);

    if (!user) {
      return NextResponse.json({
        success: true,
        message: 'Se o email estiver cadastrado, você receberá um link para redefinir sua senha.',
      });
    }

    const resetToken = generateToken();
    await saveEmailToken(user.id, resetToken, 'password_reset', 1);

    try {
      await sendPasswordResetEmail(user.email, user.name, resetToken);
    } catch (emailError: any) {
      console.error('Erro ao enviar email de recuperação:', emailError);
      return NextResponse.json({
        error: 'Erro ao enviar email. Verifique a configuração SMTP.',
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Se o email estiver cadastrado, você receberá um link para redefinir sua senha.',
    });
  } catch (error: any) {
    console.error('Erro ao processar recuperação de senha:', error);
    return NextResponse.json({
      error: 'Erro ao processar solicitação',
      details: error.message
    }, { status: 500 });
  }
}
