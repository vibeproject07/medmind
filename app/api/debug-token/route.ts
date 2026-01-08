import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';

// Forçar uso do Node.js runtime (não Edge Runtime)
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token } = body;

    if (!token) {
      return NextResponse.json({ error: 'Token não fornecido' }, { status: 400 });
    }

    const authHeader = request.headers.get('authorization');
    const tokenFromHeader = authHeader?.replace('Bearer ', '');
    const tokenFromCookie = request.cookies.get('token')?.value;

    const user = verifyToken(token);

    return NextResponse.json({
      tokenProvided: !!token,
      tokenLength: token?.length || 0,
      tokenStart: token?.substring(0, 30) || '',
      hasAuthHeader: !!authHeader,
      tokenFromHeader: tokenFromHeader?.substring(0, 30) || null,
      tokenFromCookie: tokenFromCookie?.substring(0, 30) || null,
      user: user ? {
        id: user.id,
        email: user.email,
        role: user.role
      } : null,
      isValid: !!user
    });
  } catch (error: any) {
    return NextResponse.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
}

