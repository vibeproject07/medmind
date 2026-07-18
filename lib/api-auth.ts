import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';

export function getAuthUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  if (!token) return null;
  return verifyToken(token);
}

export function requireAdmin(req: NextRequest) {
  const user = getAuthUser(req);
  if (!user) {
    return { error: NextResponse.json({ error: 'Não autorizado' }, { status: 401 }) };
  }
  if (user.role !== 'admin') {
    return {
      error: NextResponse.json(
        { error: 'Apenas administradores' },
        { status: 403 },
      ),
    };
  }
  return { user };
}
