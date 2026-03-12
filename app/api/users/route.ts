import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { verifyToken } from '@/lib/jwt';

// Forçar uso do Node.js runtime (não Edge Runtime)
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // Log de todos os headers recebidos
    const allHeaders = Object.fromEntries(request.headers.entries());
    console.log('📥 GET /api/users - Headers recebidos:', {
      authorization: request.headers.get('authorization')?.substring(0, 50) || 'não encontrado',
      cookie: request.headers.get('cookie')?.substring(0, 100) || 'não encontrado',
      allHeadersKeys: Object.keys(allHeaders)
    });

    // Tentar pegar token do header Authorization ou do cookie
    const authHeader = request.headers.get('authorization');
    const cookieToken = request.cookies.get('token')?.value;
    
    console.log('🔍 GET /api/users - Tokens encontrados:', {
      hasAuthHeader: !!authHeader,
      authHeaderStart: authHeader?.substring(0, 30) || null,
      hasCookie: !!cookieToken,
      cookieTokenStart: cookieToken?.substring(0, 30) || null
    });
    
    let token = authHeader?.replace('Bearer ', '') || cookieToken;
    
    // Limpar token: remover espaços e possíveis aspas
    if (token) {
      token = token.trim().replace(/^["']|["']$/g, '');
      
      // Validar formato básico do JWT
      if (token.split('.').length !== 3) {
        console.error('❌ Token com formato inválido no GET /api/users:', {
          tokenLength: token.length,
          tokenStart: token.substring(0, 50),
          parts: token.split('.').length
        });
        return NextResponse.json({ 
          error: 'Token com formato inválido',
          debug: { tokenLength: token.length, tokenStart: token.substring(0, 20) }
        }, { status: 401 });
      }
    }
    
    if (!token) {
      console.error('❌ GET /api/users - Token não fornecido');
      return NextResponse.json({ 
        error: 'Não autorizado - Token não fornecido',
        debug: {
          hasAuthHeader: !!authHeader,
          hasCookie: !!cookieToken
        }
      }, { status: 401 });
    }

    console.log('🔍 GET /api/users - Verificando token:', {
      tokenLength: token.length,
      tokenStart: token.substring(0, 30) + '...',
      hasAuthHeader: !!authHeader,
      hasCookie: !!cookieToken
    });

    const user = verifyToken(token);
    
    console.log('👤 GET /api/users - Usuário verificado:', user ? { id: user.id, email: user.email, role: user.role } : 'null');
    
    if (!user) {
      console.error('❌ GET /api/users - Token inválido ou usuário não encontrado');
      return NextResponse.json({ 
        error: 'Token inválido',
        debug: {
          tokenLength: token.length,
          tokenStart: token.substring(0, 20)
        }
      }, { status: 401 });
    }

    // Verificar permissão: apenas admin e manager podem ver usuários
    if (user.role === 'regular') {
      return NextResponse.json({ 
        error: 'Acesso negado. Apenas administradores e gerentes podem acessar esta funcionalidade.' 
      }, { status: 403 });
    }

    const db = getDatabase();
    const users = db.prepare('SELECT id, name, username, email, role, company_id, created_at FROM users').all();

    return NextResponse.json(users);
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao buscar usuários' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Tentar pegar token do header Authorization ou do cookie PRIMEIRO
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    
    // Limpar token: remover espaços e possíveis aspas
    if (token) {
      token = token.trim().replace(/^["']|["']$/g, '');
      
      // Validar formato básico do JWT
      if (token.split('.').length !== 3) {
        console.error('❌ Token com formato inválido:', token.substring(0, 50));
        return NextResponse.json({ 
          error: 'Token com formato inválido',
          debug: { tokenLength: token.length, tokenStart: token.substring(0, 20) }
        }, { status: 401 });
      }
    }
    
    if (!token) {
      return NextResponse.json({ error: 'Não autorizado - Token não fornecido' }, { status: 401 });
    }

    // Verificar token ANTES de ler o body
    console.log('🔍 Verificando token:', {
      tokenLength: token.length,
      tokenStart: token.substring(0, 20) + '...',
      hasAuthHeader: !!authHeader,
      hasCookie: !!request.cookies.get('token')?.value
    });
    
    const user = verifyToken(token);
    
    console.log('👤 Usuário verificado:', user ? { id: user.id, email: user.email, role: user.role } : 'null');
    
    if (!user) {
      return NextResponse.json({ 
        error: 'Token inválido ou expirado. Faça login novamente.',
        debug: {
          tokenLength: token.length,
          tokenStart: token.substring(0, 20)
        }
      }, { status: 401 });
    }

    // Verificar permissão: apenas admin e manager podem criar usuários
    if (user.role === 'regular') {
      return NextResponse.json({ 
        error: 'Acesso negado. Apenas administradores e gerentes podem criar usuários.' 
      }, { status: 403 });
    }

    // Agora ler o body
    const body = await request.json();
    const { name, username, email, password, role, company_id } = body;

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 });
    }

    // Apenas admin pode criar managers ou admins
    const validRoles = ['admin', 'manager', 'regular'];
    let userRole = role && validRoles.includes(role) ? role : 'regular';
    
    if (userRole === 'manager' || userRole === 'admin') {
      if (user.role !== 'admin') {
        return NextResponse.json(
          { error: 'Apenas administradores podem criar managers ou admins' },
          { status: 403 }
        );
      }
    }

    const db = getDatabase();
    const existingUser = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return NextResponse.json({ error: 'Email já cadastrado' }, { status: 400 });
    }

    // Verificar se username já existe (se fornecido)
    if (username) {
      const existingUsername = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (existingUsername) {
        return NextResponse.json({ error: 'Username já cadastrado' }, { status: 400 });
      }
    }

    const hashedPassword = await hashPassword(password);
    
    const result = db.prepare(`
      INSERT INTO users (name, username, email, password, role, company_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, username || null, email, hashedPassword, userRole, company_id || null);

    return NextResponse.json({ 
      id: result.lastInsertRowid, 
      name,
      username: username || null,
      email, 
      role: userRole,
      company_id: company_id || null
    });
  } catch (error: any) {
    console.error('Erro completo ao criar usuário:', error);
    return NextResponse.json({ 
      error: 'Erro ao criar usuário',
      details: error.message 
    }, { status: 500 });
  }
}

