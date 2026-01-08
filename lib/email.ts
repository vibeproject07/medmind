import nodemailer from 'nodemailer';
import { getDatabase } from './db';
import crypto from 'crypto';

// Buscar configuração SMTP do banco
function getSmtpConfig() {
  const db = getDatabase();
  const emailSetting = db.prepare('SELECT * FROM settings WHERE key = ?').get('email_smtp') as any;
  
  if (!emailSetting) {
    throw new Error('Configuração SMTP não encontrada');
  }

  const smtpConfig = JSON.parse(emailSetting.value);
  
  if (!smtpConfig.host || !smtpConfig.port || !smtpConfig.user || !smtpConfig.password) {
    throw new Error('Configuração SMTP incompleta');
  }

  return {
    host: smtpConfig.host.trim(),
    port: parseInt(smtpConfig.port),
    user: smtpConfig.user.trim(),
    password: smtpConfig.password.trim(),
  };
}

// Criar transporter do nodemailer
function createTransporter() {
  const config = getSmtpConfig();
  
  return nodemailer.createTransport({
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
  });
}

// Gerar token único
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Salvar token no banco
export function saveEmailToken(userId: number, token: string, type: 'email_verification' | 'password_reset', expiresInHours: number = 24): void {
  const db = getDatabase();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + expiresInHours);

  // Invalidar tokens anteriores do mesmo tipo para o mesmo usuário
  db.prepare('UPDATE email_tokens SET used = 1 WHERE user_id = ? AND type = ? AND used = 0').run(userId, type);

  // Inserir novo token
  db.prepare(`
    INSERT INTO email_tokens (user_id, token, type, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, token, type, expiresAt.toISOString());
}

// Verificar e usar token
export function verifyAndUseToken(token: string, type: 'email_verification' | 'password_reset'): number | null {
  const db = getDatabase();
  const tokenRecord = db.prepare(`
    SELECT * FROM email_tokens 
    WHERE token = ? AND type = ? AND used = 0 AND expires_at > datetime('now')
  `).get(token, type) as any;

  if (!tokenRecord) {
    return null;
  }

  // Marcar token como usado
  db.prepare('UPDATE email_tokens SET used = 1 WHERE id = ?').run(tokenRecord.id);

  return tokenRecord.user_id;
}

// Enviar email de validação
export async function sendVerificationEmail(email: string, name: string, token: string): Promise<void> {
  const config = getSmtpConfig();
  const transporter = createTransporter();
  
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const verificationUrl = `${baseUrl}/verify-email?token=${token}`;

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
        <p style="color: #6b7280; font-size: 12px; margin-top: 20px;">
          Este link expira em 24 horas.
        </p>
      </div>
    `,
    text: `
      Bem-vindo ao MedMind, ${name}!
      
      Obrigado por se cadastrar. Para completar seu cadastro, confirme seu endereço de email acessando o link abaixo:
      
      ${verificationUrl}
      
      Este link expira em 24 horas.
    `,
  });
}

// Enviar email de recuperação de senha
export async function sendPasswordResetEmail(email: string, name: string, token: string): Promise<void> {
  const config = getSmtpConfig();
  const transporter = createTransporter();
  
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

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
        <p style="color: #6b7280; font-size: 12px; margin-top: 20px;">
          Este link expira em 1 hora.
        </p>
        <p style="color: #dc2626; font-size: 12px; margin-top: 20px;">
          Se você não solicitou esta recuperação de senha, ignore este email.
        </p>
      </div>
    `,
    text: `
      Recuperação de Senha
      
      Olá, ${name}!
      
      Recebemos uma solicitação para redefinir sua senha. Acesse o link abaixo para criar uma nova senha:
      
      ${resetUrl}
      
      Este link expira em 1 hora.
      
      Se você não solicitou esta recuperação de senha, ignore este email.
    `,
  });
}

