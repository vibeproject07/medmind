import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import nodemailer from 'nodemailer';

// Forçar uso do Node.js runtime (não Edge Runtime)
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    // Tentar pegar token do header Authorization ou do cookie
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    
    // Limpar token: remover espaços e possíveis aspas
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

    // Buscar configuração SMTP do banco de dados
    const db = getDatabase();
    const emailSetting = db.prepare('SELECT * FROM settings WHERE key = ?').get('email_smtp') as any;
    
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
      passwordLength: smtpConfig.password?.length
    });
    
    if (!smtpConfig.host || !smtpConfig.port || !smtpConfig.user || !smtpConfig.password) {
      return NextResponse.json({ 
        error: 'Configuração de email incompleta. Preencha todos os campos.' 
      }, { status: 400 });
    }

    // Limpar senha de possíveis espaços extras
    const cleanPassword = smtpConfig.password.trim();
    
    // Criar transporter do nodemailer
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host.trim(),
      port: parseInt(smtpConfig.port),
      secure: parseInt(smtpConfig.port) === 465, // true para 465, false para outras portas
      auth: {
        user: smtpConfig.user.trim(),
        pass: cleanPassword,
      },
      // Adicionar opções de debug
      debug: true,
      logger: true,
      // Para Gmail e outros provedores que podem precisar
      tls: {
        rejectUnauthorized: false, // Aceitar certificados auto-assinados
      },
    });
    
    console.log('🔧 Transporter criado:', {
      host: smtpConfig.host,
      port: parseInt(smtpConfig.port),
      secure: parseInt(smtpConfig.port) === 465,
      user: smtpConfig.user
    });

    // Enviar email de teste para o próprio usuário configurado
    const testEmail = {
      from: `"MedMind" <${smtpConfig.user}>`,
      to: smtpConfig.user, // Enviar para si mesmo
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
      text: `
        Teste de Email - MedMind
        
        Este é um email de teste enviado pelo sistema MedMind.
        Se você recebeu este email, significa que a configuração SMTP está funcionando corretamente!
        
        Configuração usada:
        Host: ${smtpConfig.host}
        Porta: ${smtpConfig.port}
        Usuário: ${smtpConfig.user}
        
        Enviado em: ${new Date().toLocaleString('pt-BR')}
      `,
    };

    // Verificar conexão antes de enviar
    console.log('🔍 Verificando conexão SMTP...');
    try {
      await transporter.verify();
      console.log('✅ Conexão SMTP verificada com sucesso');
    } catch (verifyError: any) {
      console.error('❌ Erro na verificação SMTP:', {
        code: verifyError.code,
        command: verifyError.command,
        message: verifyError.message
      });
      throw verifyError;
    }

    // Enviar email
    console.log('📤 Enviando email de teste para:', smtpConfig.user);
    const info = await transporter.sendMail(testEmail);
    console.log('✅ Email enviado com sucesso:', info.messageId);

    return NextResponse.json({
      success: true,
      message: 'Email de teste enviado com sucesso!',
      messageId: info.messageId,
      to: smtpConfig.user,
    });
  } catch (error: any) {
    console.error('❌ Erro completo ao enviar email de teste:', {
      name: error.name,
      code: error.code,
      command: error.command,
      message: error.message,
      response: error.response,
      responseCode: error.responseCode,
      stack: error.stack
    });
    
    // Mensagens de erro mais específicas
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

