import nodemailer from 'nodemailer';
import { query } from './db';
import crypto from 'crypto';

async function getSmtpConfig() {
  const result = await query('SELECT * FROM settings WHERE key = $1', ['email_smtp']);
  const emailSetting = result.rows[0];

  if (!emailSetting) {
    throw new Error('Configuração SMTP não encontrada. Acesse o Dashboard → Configurações para configurar.');
  }

  const smtpConfig = JSON.parse(emailSetting.value);

  if (!smtpConfig.host || !smtpConfig.port || !smtpConfig.user || !smtpConfig.password) {
    throw new Error('Configuração SMTP incompleta. Preencha todos os campos (Host, Porta, Usuário e Senha) nas Configurações.');
  }

  if (smtpConfig.host.trim() === '' || smtpConfig.port.trim() === '' ||
      smtpConfig.user.trim() === '' || smtpConfig.password.trim() === '') {
    throw new Error('Configuração SMTP incompleta. Preencha todos os campos nas Configurações.');
  }

  return {
    host: smtpConfig.host.trim(),
    port: parseInt(smtpConfig.port),
    user: smtpConfig.user.trim(),
    password: smtpConfig.password.trim(),
  };
}

async function createTransporter() {
  const config = await getSmtpConfig();
  try {
    return { transporter: nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: {
        user: config.user,
        pass: config.password,
      },
      tls: {
        rejectUnauthorized: false,
      },
    }), config };
  } catch (error: any) {
    throw new Error(`Erro ao criar transporter SMTP: ${error.message}. Verifique as configurações.`);
  }
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function saveEmailToken(userId: number, token: string, type: 'email_verification' | 'password_reset', expiresInHours: number = 24): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + expiresInHours);

  await query(
    'UPDATE email_tokens SET used = 1 WHERE user_id = $1 AND type = $2 AND used = 0',
    [userId, type]
  );

  await query(
    'INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ($1, $2, $3, $4)',
    [userId, token, type, expiresAt.toISOString()]
  );
}

export async function verifyAndUseToken(token: string, type: 'email_verification' | 'password_reset'): Promise<number | null> {
  const result = await query(
    'SELECT * FROM email_tokens WHERE token = $1 AND type = $2 AND used = 0 AND expires_at > NOW()',
    [token, type]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const tokenRecord = result.rows[0];
  await query('UPDATE email_tokens SET used = 1 WHERE id = $1', [tokenRecord.id]);

  return tokenRecord.user_id;
}

export async function sendVerificationEmail(email: string, name: string, token: string): Promise<void> {
  let transporter: any;
  let config: any;

  try {
    const result = await createTransporter();
    transporter = result.transporter;
    config = result.config;
  } catch (error: any) {
    throw new Error(`Erro na configuração SMTP: ${error.message}`);
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const verificationUrl = `${baseUrl}/verify-email?token=${token}`;

  try {
    await transporter.sendMail({
      from: `"MedMind" <${config.user}>`,
      to: email,
      subject: 'Confirme seu email - MedMind',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4F46E5;">Bem-vindo ao MedMind, ${name}!</h2>
          <p>Obrigado por se cadastrar. Para completar seu cadastro, confirme seu endereço de email clicando no botão abaixo:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Confirmar Email
            </a>
          </div>
          <p>Ou copie e cole este link no seu navegador:</p>
          <p style="color: #6b7280; font-size: 12px; word-break: break-all;">${verificationUrl}</p>
          <p style="color: #6b7280; font-size: 12px; margin-top: 20px;">Este link expira em 24 horas.</p>
        </div>
      `,
      text: `Bem-vindo ao MedMind, ${name}!\n\nConfirme seu email: ${verificationUrl}\n\nEste link expira em 24 horas.`,
    });
  } catch (error: any) {
    if (error.code === 'EAUTH') {
      throw new Error('Erro de autenticação SMTP. Verifique se o usuário e senha estão corretos. Para Gmail, use uma Senha de App.');
    } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
      throw new Error(`Não foi possível conectar ao servidor SMTP (${config.host}:${config.port}). Verifique o host e porta.`);
    } else if (error.code === 'EENVELOPE') {
      throw new Error('Erro no endereço de email. Verifique se o email de destino é válido.');
    } else {
      throw new Error(`Erro ao enviar email: ${error.message || 'Erro desconhecido'}`);
    }
  }
}

export async function sendPasswordResetEmail(email: string, name: string, token: string): Promise<void> {
  let transporter: any;
  let config: any;

  try {
    const result = await createTransporter();
    transporter = result.transporter;
    config = result.config;
  } catch (error: any) {
    throw new Error(`Erro na configuração SMTP: ${error.message}`);
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  try {
    await transporter.sendMail({
      from: `"MedMind" <${config.user}>`,
      to: email,
      subject: 'Recuperação de Senha - MedMind',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4F46E5;">Recuperação de Senha</h2>
          <p>Olá, ${name}!</p>
          <p>Recebemos uma solicitação para redefinir sua senha. Clique no botão abaixo para criar uma nova senha:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Redefinir Senha
            </a>
          </div>
          <p>Ou copie e cole este link no seu navegador:</p>
          <p style="color: #6b7280; font-size: 12px; word-break: break-all;">${resetUrl}</p>
          <p style="color: #6b7280; font-size: 12px; margin-top: 20px;">Este link expira em 1 hora.</p>
          <p style="color: #dc2626; font-size: 12px; margin-top: 20px;">Se você não solicitou esta recuperação de senha, ignore este email.</p>
        </div>
      `,
      text: `Recuperação de Senha\n\nOlá, ${name}!\n\nAcesse o link abaixo para criar uma nova senha:\n\n${resetUrl}\n\nEste link expira em 1 hora.\n\nSe você não solicitou esta recuperação de senha, ignore este email.`,
    });
  } catch (error: any) {
    if (error.code === 'EAUTH') {
      throw new Error('Erro de autenticação SMTP. Verifique se o usuário e senha estão corretos. Para Gmail, use uma Senha de App.');
    } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
      throw new Error(`Não foi possível conectar ao servidor SMTP (${config.host}:${config.port}). Verifique o host e porta.`);
    } else if (error.code === 'EENVELOPE') {
      throw new Error('Erro no endereço de email. Verifique se o email de destino é válido.');
    } else {
      throw new Error(`Erro ao enviar email: ${error.message || 'Erro desconhecido'}`);
    }
  }
}
