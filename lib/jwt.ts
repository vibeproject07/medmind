import jwt from 'jsonwebtoken';

// Garantir que o JWT_SECRET seja sempre o mesmo
const JWT_SECRET = (() => {
  const secret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
  if (!secret || secret.trim() === '') {
    console.warn('⚠️ JWT_SECRET não definido, usando padrão');
    return 'your-secret-key-change-in-production';
  }
  return secret;
})();

// Log apenas uma vez no início (não em cada requisição)
if (typeof window === 'undefined') {
  console.log('🔐 JWT_SECRET inicializado:', {
    length: JWT_SECRET.length,
    start: JWT_SECRET.substring(0, 10) + '...',
    isDefault: JWT_SECRET === 'your-secret-key-change-in-production'
  });
}

export type UserRole = 'admin' | 'manager' | 'regular';

export interface User {
  id: number;
  name: string;
  username?: string | null;
  email: string;
  role: UserRole;
  company_id?: number | null;
}

export function generateToken(user: User): string {
  return jwt.sign(
    { 
      id: user.id,
      name: user.name || '',
      username: user.username || null,
      email: user.email, 
      role: user.role,
      company_id: user.company_id || null
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function verifyToken(token: string): User | null {
  try {
    if (!token || typeof token !== 'string' || token.trim() === '') {
      console.error('❌ Token vazio ou inválido:', { token: token?.substring(0, 20), type: typeof token });
      return null;
    }
    
    const cleanToken = token.trim();
    
    // Verificar formato básico do JWT antes de tentar verificar
    const parts = cleanToken.split('.');
    if (parts.length !== 3) {
      console.error('❌ Token com formato inválido (não tem 3 partes):', {
        parts: parts.length,
        tokenStart: cleanToken.substring(0, 30)
      });
      return null;
    }
    
    console.log('🔍 Verificando token:', {
      length: cleanToken.length,
      start: cleanToken.substring(0, 30),
      secretLength: JWT_SECRET.length,
      secretStart: JWT_SECRET.substring(0, 10),
      parts: parts.length
    });
    
    let decoded: any;
    try {
      decoded = jwt.verify(cleanToken, JWT_SECRET) as any;
    } catch (verifyError: any) {
      console.error('❌ Erro no jwt.verify:', {
        name: verifyError.name,
        message: verifyError.message,
        tokenStart: cleanToken.substring(0, 30)
      });
      throw verifyError; // Re-throw para ser capturado pelo catch externo
    }
    
    console.log('✅ Token decodificado:', {
      id: decoded?.id,
      email: decoded?.email,
      role: decoded?.role
    });
    
    if (!decoded || typeof decoded.id !== 'number' || !decoded.email) {
      console.error('❌ Token decodificado inválido:', decoded);
      return null;
    }
    
    return {
      id: decoded.id,
      name: decoded.name || '',
      username: decoded.username || null,
      email: decoded.email,
      role: decoded.role || 'regular',
      company_id: decoded.company_id || null,
    };
  } catch (error: any) {
    console.error('❌ Erro ao verificar token:', {
      name: error.name,
      message: error.message,
      tokenLength: token?.length,
      tokenStart: token?.substring(0, 30)
    });
    return null;
  }
}

