import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import nodemailer from 'nodemailer';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;

    if (token) {
      token = token.trim().replace(/^["']|["']$/g, '');
    }

    if (!token) {
      return NextResponse.json({ error: 'Não autorizado - Token não fornecido' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

    if (user.role === 'regular') {
      return NextResponse.json({
        error: 'Acesso negado. Apenas administradores e gerentes podem testar o SMTP.'
      }, { status: 403 });
    }

    const emailSetting = (await query('SELECT * FROM settings WHERE key = $1', ['email_smtp'])).rows[0];

    if (!emailSetting) {
      return NextResponse.json({
        error: 'Configuração de email não encontrada. Configure o SMTP primeiro.'
      }, { status: 400 });
    }

    const smtpConfig = JSON.parse(emailSetting.value);

    console.log('📧 Configuração SMTP carregada:', {
      host: smtpConfig.host,
      port: smtpConfig.port,
      user: smtpConfig.user,
      hasPassword: !!smtpConfig.password,
    });

    if (!smtpConfig.host || !smtpConfig.port || !smtpConfig.user || !smtpConfig.password) {
      return NextResponse.json({
        error: 'Configuração de email incompleta. Preencha todos os campos.'
      }, { status: 400 });
    }

    const cleanPassword = smtpConfig.password.trim();

    const transporter = nodemailer.createTransport({
      host: smtpConfig.host.trim(),
      port: parseInt(smtpConfig.port),
      secure: parseInt(smtpConfig.port) === 465,
      auth: {
        user: smtpConfig.user.trim(),
        pass: cleanPassword,
      },
      debug: true,
      logger: true,
      tls: {
        rejectUnauthorized: false,
      },
    });

    try {
      await transporter.verify();
      console.log('✅ Conexão SMTP verificada com sucesso');
    } catch (verifyError: any) {
      console.error('❌ Erro na verificação SMTP:', verifyError.message);
      throw verifyError;
    }

    const testEmail = {
      from: `"MedMind" <${smtpConfig.user}>`,
      to: smtpConfig.user,
      subject: 'Teste de Email - MedMind',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4F46E5;">Teste de Email - MedMind</h2>
          <p>Este é um email de teste enviado pelo sistema MedMind.</p>
          <p>Se você recebeu este email, significa que a configuração SMTP está funcionando corretamente!</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="color: #6b7280; font-size: 12px;">
            <strong>Configuração usada:</strong><br>
            Host: ${smtpConfig.host}<br>
            Porta: ${smtpConfig.port}<br>
            Usuário: ${smtpConfig.user}
          </p>
          <p style="color: #6b7280; font-size: 12px; margin-top: 20px;">
            Enviado em: ${new Date().toLocaleString('pt-BR')}
          </p>
        </div>
      `,
      text: `Teste de Email - MedMind\n\nSe você recebeu este email, a configuração SMTP está funcionando!\n\nHost: ${smtpConfig.host}, Porta: ${smtpConfig.port}, Usuário: ${smtpConfig.user}`,
    };

    const info = await transporter.sendMail(testEmail);
    console.log('✅ Email enviado com sucesso:', info.messageId);

    return NextResponse.json({
      success: true,
      message: 'Email de teste enviado com sucesso!',
      messageId: info.messageId,
      to: smtpConfig.user,
    });
  } catch (error: any) {
    console.error('❌ Erro ao enviar email de teste:', error.message);

    let errorMessage = 'Erro ao enviar email de teste';
    if (error.code === 'EAUTH') {
      errorMessage = 'Erro de autenticação. Verifique o usuário e senha SMTP.';
    } else if (error.code === 'ECONNECTION') {
      errorMessage = 'Erro de conexão. Verifique o host e porta SMTP.';
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = 'Timeout na conexão. Verifique se o servidor SMTP está acessível.';
    } else if (error.responseCode === 535) {
      errorMessage = 'Erro de autenticação (535). Verifique se a senha está correta e se o acesso de apps menos seguros está habilitado (Gmail).';
    } else if (error.responseCode === 534) {
      errorMessage = 'Erro de autenticação (534). Verifique se a senha está correta.';
    } else if (error.command === 'AUTH PLAIN' || error.command === 'AUTH LOGIN') {
      errorMessage = 'Erro de autenticação. Verifique o usuário e senha SMTP.';
    } else if (error.message) {
      errorMessage = `Erro: ${error.message}`;
    }

    return NextResponse.json({
      error: errorMessage,
      details: {
        code: error.code,
        command: error.command,
        responseCode: error.responseCode,
        message: error.message
      }
    }, { status: 500 });
  }
}
