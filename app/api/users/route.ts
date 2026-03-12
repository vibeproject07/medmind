import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { verifyToken } from '@/lib/jwt';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cookieToken = request.cookies.get('token')?.value;
    let token = authHeader?.replace('Bearer ', '') || cookieToken;

    if (token) {
      token = token.trim().replace(/^["']|["']$/g, '');
      if (token.split('.').length !== 3) {
        return NextResponse.json({ error: 'Token com formato inválido' }, { status: 401 });
      }
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
        error: 'Acesso negado. Apenas administradores e gerentes podem acessar esta funcionalidade.'
      }, { status: 403 });
    }

    const users = (await query('SELECT id, name, username, email, role, company_id, created_at FROM users')).rows;

    return NextResponse.json(users);
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao buscar usuários' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;

    if (token) {
      token = token.trim().replace(/^["']|["']$/g, '');
      if (token.split('.').length !== 3) {
        return NextResponse.json({ error: 'Token com formato inválido' }, { status: 401 });
      }
    }

    if (!token) {
      return NextResponse.json({ error: 'Não autorizado - Token não fornecido' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Token inválido ou expirado. Faça login novamente.' }, { status: 401 });
    }

    if (user.role === 'regular') {
      return NextResponse.json({
        error: 'Acesso negado. Apenas administradores e gerentes podem criar usuários.'
      }, { status: 403 });
    }

    const body = await request.json();
    const { name, username, email, password, role, company_id } = body;

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 });
    }

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

    const existingUser = (await query('SELECT id FROM users WHERE email = $1', [email])).rows[0];
    if (existingUser) {
      return NextResponse.json({ error: 'Email já cadastrado' }, { status: 400 });
    }

    if (username) {
      const existingUsername = (await query('SELECT id FROM users WHERE username = $1', [username])).rows[0];
      if (existingUsername) {
        return NextResponse.json({ error: 'Username já cadastrado' }, { status: 400 });
      }
    }

    const hashedPassword = await hashPassword(password);

    const result = await query(
      'INSERT INTO users (name, username, email, password, role, company_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [name, username || null, email, hashedPassword, userRole, company_id || null]
    );

    return NextResponse.json({
      id: result.rows[0].id,
      name,
      username: username || null,
      email,
      role: userRole,
      company_id: company_id || null
    });
  } catch (error: any) {
    console.error('Erro ao criar usuário:', error);
    return NextResponse.json({
      error: 'Erro ao criar usuário',
      details: error.message
    }, { status: 500 });
  }
}
