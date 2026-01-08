import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { verifyToken } from '@/lib/jwt';

// Forçar uso do Node.js runtime (não Edge Runtime)
export const runtime = 'nodejs';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Tentar pegar token do header Authorization ou do cookie
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    
    // Limpar token: remover espaços e possíveis aspas
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

    const { name, username, email, password, role, company_id } = await request.json();
    const db = getDatabase();

    // Validar role
    const validRoles = ['admin', 'manager', 'regular'];
    let userRole = role && validRoles.includes(role) ? role : 'regular';

    // Apenas admin pode alterar para manager ou admin
    if (userRole === 'manager' || userRole === 'admin') {
      if (user.role !== 'admin') {
        return NextResponse.json(
          { error: 'Apenas administradores podem alterar para manager ou admin' },
          { status: 403 }
        );
      }
    }

    // Verificar se está tentando alterar o próprio role de admin
    const targetUser = db.prepare('SELECT role FROM users WHERE id = ?').get(params.id) as any;
    if (targetUser && targetUser.role === 'admin' && userRole !== 'admin' && user.id !== parseInt(params.id)) {
      return NextResponse.json(
        { error: 'Não é possível remover o perfil de admin de outro usuário' },
        { status: 403 }
      );
    }

    // Verificar se username já existe em outro usuário (se fornecido)
    if (username) {
      const existingUsername = db.prepare('SELECT * FROM users WHERE username = ? AND id != ?').get(username, params.id);
      if (existingUsername) {
        return NextResponse.json({ error: 'Username já cadastrado' }, { status: 400 });
      }
    }

    let updateQuery = 'UPDATE users SET name = ?, username = ?, email = ?, role = ?, company_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
    const updateParams: any[] = [name, username || null, email, userRole, company_id || null, params.id];

    if (password) {
      const hashedPassword = await hashPassword(password);
      updateQuery = 'UPDATE users SET name = ?, username = ?, email = ?, password = ?, role = ?, company_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
      updateParams.splice(5, 0, hashedPassword);
    }

    db.prepare(updateQuery).run(...updateParams);

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
    // Tentar pegar token do header Authorization ou do cookie
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    
    // Limpar token: remover espaços e possíveis aspas
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

    const db = getDatabase();
    db.prepare('DELETE FROM users WHERE id = ?').run(params.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao excluir usuário' }, { status: 500 });
  }
}

