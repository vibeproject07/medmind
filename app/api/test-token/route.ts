import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import jwt from 'jsonwebtoken';

// Forçar uso do Node.js runtime (não Edge Runtime)
export const runtime = 'nodejs';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();
    
    if (!token) {
      return NextResponse.json({ error: 'Token não fornecido' }, { status: 400 });
    }

    // Tentar decodificar sem verificar primeiro
    const decoded = jwt.decode(token);
    
    // Tentar verificar
    let verified = null;
    let verifyError = null;
    try {
      verified = jwt.verify(token, JWT_SECRET);
    } catch (error: any) {
      verifyError = error.message;
    }

    // Usar a função verifyToken
    const user = verifyToken(token);

    return NextResponse.json({
      tokenLength: token.length,
      tokenStart: token.substring(0, 30),
      decoded,
      verified,
      verifyError,
      userFromVerifyToken: user,
      jwtSecret: JWT_SECRET.substring(0, 10) + '...',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

