import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

// Forçar uso do Node.js runtime (não Edge Runtime)
export const runtime = 'nodejs';

export async function PUT(request: NextRequest) {
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

    const { host, port, user: smtpUser, password } = await request.json();

    if (!host || !port || !smtpUser || !password) {
      return NextResponse.json({ error: 'Todos os campos são obrigatórios' }, { status: 400 });
    }

    const db = getDatabase();
    const value = JSON.stringify({ host, port, user: smtpUser, password });

    // Verificar se já existe
    const existing = db.prepare('SELECT * FROM settings WHERE key = ?').get('email_smtp');
    
    if (existing) {
      db.prepare(`
        UPDATE settings 
        SET value = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE key = ?
      `).run(value, 'email_smtp');
    } else {
      db.prepare(`
        INSERT INTO settings (key, value, description)
        VALUES (?, ?, ?)
      `).run('email_smtp', value, 'Configuração de SMTP para envio de emails');
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Erro ao salvar configuração de email:', error);
    return NextResponse.json({ 
      error: 'Erro ao salvar configuração',
      details: error.message 
    }, { status: 500 });
  }
}

