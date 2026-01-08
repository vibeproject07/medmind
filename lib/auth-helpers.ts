import { verifyToken } from './jwt';
import type { User } from './jwt';

export function getCurrentUserFromToken(token: string | null): User | null {
  if (!token) return null;
  return verifyToken(token);
}

