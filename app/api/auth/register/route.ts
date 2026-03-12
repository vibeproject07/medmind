import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, getUserByEmail } from '@/lib/auth';
import { getDatabase } from '@/lib/db';
import { generateToken as generateEmailToken, saveEmailToken, sendVerificationEmail } from '@/lib/email';

// Forçar uso do Node.js runtime (não Edge Runtime)
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

    const db = getDatabase();

    // Verificar se email já existe
    const existingUserByEmail = getUserByEmail(email);
    if (existingUserByEmail) {
      return NextResponse.json(
        { error: 'Email já cadastrado' },
        { status: 400 }
      );
    }

    // Verificar se username já existe (se fornecido)
    if (username) {
      const existingUserByUsername = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (existingUserByUsername) {
        return NextResponse.json(
          { error: 'Username já cadastrado' },
          { status: 400 }
        );
      }
    }

    const hashedPassword = await hashPassword(password);

    // Validar período acadêmico se for estudante
    let finalAcademicPeriod = null;
    if (academic_status === 'student' && academic_period) {
      const period = parseInt(academic_period);
      if (period >= 1 && period <= 12) {
        finalAcademicPeriod = period;
      }
    }

    // Validar campos relacionados a estudantes
    const finalInstitution = (academic_status === 'student' && institution) ? institution.trim() : null;
    const finalTeachingMethodology = (academic_status === 'student' && teaching_methodology) ? teaching_methodology : null;

    const result = db.prepare(`
      INSERT INTO users (name, username, email, password, role, email_verified, academic_status, academic_period, institution, teaching_methodology)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `).run(name, username || null, email, hashedPassword, 'regular', academic_status || null, finalAcademicPeriod, finalInstitution, finalTeachingMethodology);

    const userId = result.lastInsertRowid as number;

    // Gerar token de validação de email
    const verificationToken = generateEmailToken();
    saveEmailToken(userId, verificationToken, 'email_verification', 24);

    // Enviar email de validação
    let emailSent = false;
    let emailError = null;
    try {
      console.log('📧 Tentando enviar email de validação para:', email);
      await sendVerificationEmail(email, name, verificationToken);
      emailSent = true;
      console.log('✅ Email de validação enviado com sucesso');
    } catch (emailError: any) {
      console.error('❌ Erro ao enviar email de validação:', {
        message: emailError.message,
        code: emailError.code,
        response: emailError.response,
        stack: emailError.stack
      });
      emailError = emailError.message || 'Erro desconhecido ao enviar email';
      // Não falhar o cadastro se o email não puder ser enviado
      // O usuário pode solicitar reenvio depois
    }

    return NextResponse.json({
      success: true,
      message: emailSent 
        ? 'Conta criada com sucesso! Verifique seu email para confirmar sua conta.'
        : `Conta criada com sucesso! Porém, não foi possível enviar o email de validação. ${emailError ? `Erro: ${emailError}` : ''}`,
      userId,
      emailSent,
      emailError: emailError || null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Erro ao processar cadastro' },
      { status: 500 }
    );
  }
}

