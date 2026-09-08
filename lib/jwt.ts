import jwt, { JwtPayload, Secret } from 'jsonwebtoken';

/**
 * JWTs must never be signed with a public fallback. SESSION_SECRET supports
 * existing Replit deployments while JWT_SECRET remains the preferred explicit
 * configuration name.
 */
function getJwtSecret(): Secret {
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new Error(
      'JWT_SECRET (ou SESSION_SECRET) deve ser configurado com pelo menos 32 caracteres.',
    );
  }
  return secret;
}

const JWT_SECRET = getJwtSecret();

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
      return null;
    }

    const decoded = jwt.verify(token.trim(), JWT_SECRET, {
      algorithms: ['HS256'],
    }) as JwtPayload;
    if (
      !decoded ||
      typeof decoded === 'string' ||
      typeof decoded.id !== 'number' ||
      !Number.isInteger(decoded.id) ||
      typeof decoded.email !== 'string' ||
      !decoded.email ||
      !['admin', 'manager', 'regular'].includes(String(decoded.role))
    ) {
      return null;
    }

    return {
      id: decoded.id,
      name: typeof decoded.name === 'string' ? decoded.name : '',
      username: typeof decoded.username === 'string' ? decoded.username : null,
      email: decoded.email,
      role: decoded.role as UserRole,
      company_id: typeof decoded.company_id === 'number' ? decoded.company_id : null,
    };
  } catch {
    return null;
  }
}

