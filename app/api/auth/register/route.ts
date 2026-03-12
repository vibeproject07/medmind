import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, getUserByEmail } from '@/lib/auth';
import { query } from '@/lib/db';
import { generateToken as generateEmailToken, saveEmailToken, sendVerificationEmail } from '@/lib/email';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { name, username, email, password, academic_status, academic_period, institution, teaching_methodology } = await request.json();

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Nome, email e senha são obrigatórios' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'A senha deve ter pelo menos 6 caracteres' },
        { status: 400 }
      );
    }

    const existingUserByEmail = await getUserByEmail(email);
    if (existingUserByEmail) {
      return NextResponse.json(
        { error: 'Email já cadastrado' },
        { status: 400 }
      );
    }

    if (username) {
      const existingUsername = (await query('SELECT id FROM users WHERE username = $1', [username])).rows[0];
      if (existingUsername) {
        return NextResponse.json(
          { error: 'Username já cadastrado' },
          { status: 400 }
        );
      }
    }

    const hashedPassword = await hashPassword(password);

    let finalAcademicPeriod = null;
    if (academic_status === 'student' && academic_period) {
      const period = parseInt(academic_period);
      if (period >= 1 && period <= 12) {
        finalAcademicPeriod = period;
      }
    }

    const finalInstitution = (academic_status === 'student' && institution) ? institution.trim() : null;
    const finalTeachingMethodology = (academic_status === 'student' && teaching_methodology) ? teaching_methodology : null;

    const result = await query(
      `INSERT INTO users (name, username, email, password, role, email_verified, academic_status, academic_period, institution, teaching_methodology)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9) RETURNING id`,
      [name, username || null, email, hashedPassword, 'regular', academic_status || null, finalAcademicPeriod, finalInstitution, finalTeachingMethodology]
    );

    const userId = result.rows[0].id as number;

    const verificationToken = generateEmailToken();
    await saveEmailToken(userId, verificationToken, 'email_verification', 24);

    let emailSent = false;
    let emailErrorMsg: string | null = null;
    try {
      console.log('📧 Tentando enviar email de validação para:', email);
      await sendVerificationEmail(email, name, verificationToken);
      emailSent = true;
      console.log('✅ Email de validação enviado com sucesso');
    } catch (emailErr: any) {
      console.error('❌ Erro ao enviar email de validação:', emailErr.message);
      emailErrorMsg = emailErr.message || 'Erro desconhecido ao enviar email';
    }

    return NextResponse.json({
      success: true,
      message: emailSent
        ? 'Conta criada com sucesso! Verifique seu email para confirmar sua conta.'
        : `Conta criada com sucesso! Porém, não foi possível enviar o email de validação. ${emailErrorMsg ? `Erro: ${emailErrorMsg}` : ''}`,
      userId,
      emailSent,
      emailError: emailErrorMsg,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Erro ao processar cadastro' },
      { status: 500 }
    );
  }
}
