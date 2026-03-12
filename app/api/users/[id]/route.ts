import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { verifyToken } from '@/lib/jwt';

export const runtime = 'nodejs';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;

    if (token) {
      token = token.trim().replace(/^["']|["']$/g, '');
    }

    if (!token) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

    if (user.role === 'regular') {
      return NextResponse.json({
        error: 'Acesso negado. Apenas administradores e gerentes podem editar usuários.'
      }, { status: 403 });
    }

    const { name, username, email, password, role, company_id } = await request.json();

    const validRoles = ['admin', 'manager', 'regular'];
    let userRole = role && validRoles.includes(role) ? role : 'regular';

    if (userRole === 'manager' || userRole === 'admin') {
      if (user.role !== 'admin') {
        return NextResponse.json(
          { error: 'Apenas administradores podem alterar para manager ou admin' },
          { status: 403 }
        );
      }
    }

    const targetUser = (await query('SELECT role FROM users WHERE id = $1', [params.id])).rows[0];
    if (targetUser && targetUser.role === 'admin' && userRole !== 'admin' && user.id !== parseInt(params.id)) {
      return NextResponse.json(
        { error: 'Não é possível remover o perfil de admin de outro usuário' },
        { status: 403 }
      );
    }

    if (username) {
      const existingUsername = (await query('SELECT id FROM users WHERE username = $1 AND id != $2', [username, params.id])).rows[0];
      if (existingUsername) {
        return NextResponse.json({ error: 'Username já cadastrado' }, { status: 400 });
      }
    }

    if (password) {
      const hashedPassword = await hashPassword(password);
      await query(
        'UPDATE users SET name = $1, username = $2, email = $3, password = $4, role = $5, company_id = $6, updated_at = NOW() WHERE id = $7',
        [name, username || null, email, hashedPassword, userRole, company_id || null, params.id]
      );
    } else {
      await query(
        'UPDATE users SET name = $1, username = $2, email = $3, role = $4, company_id = $5, updated_at = NOW() WHERE id = $6',
        [name, username || null, email, userRole, company_id || null, params.id]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao atualizar usuário' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;

    if (token) {
      token = token.trim().replace(/^["']|["']$/g, '');
    }

    if (!token) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

    if (user.role === 'regular') {
      return NextResponse.json({
        error: 'Acesso negado. Apenas administradores e gerentes podem excluir usuários.'
      }, { status: 403 });
    }

    await query('DELETE FROM users WHERE id = $1', [params.id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao excluir usuário' }, { status: 500 });
  }
}
