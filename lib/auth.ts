import bcrypt from 'bcryptjs';
import { getDatabase } from './db';
import type { User } from './jwt';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

// generateToken e verifyToken foram movidos para lib/jwt.ts para compatibilidade com Edge Runtime

export function getUserByEmail(email: string): User | null {
  const db = getDatabase();
  const user = db.prepare('SELECT id, name, username, email, role, company_id, email_verified FROM users WHERE email = ?').get(email) as any;
  return user || null;
}

export function getUserByUsername(username: string): User | null {
  const db = getDatabase();
  const user = db.prepare('SELECT id, name, username, email, role, company_id FROM users WHERE username = ?').get(username) as any;
  return user || null;
}

export function getUserByUsernameOrEmail(identifier: string): User | null {
  const db = getDatabase();
  // Tenta primeiro por username, depois por email
  let user = db.prepare('SELECT id, name, username, email, role, company_id FROM users WHERE username = ?').get(identifier) as any;
  if (!user) {
    user = db.prepare('SELECT id, name, username, email, role, company_id FROM users WHERE email = ?').get(identifier) as any;
  }
  return user || null;
}

export function getUserById(id: number): User | null {
  const db = getDatabase();
  const user = db.prepare('SELECT id, name, username, email, role, company_id FROM users WHERE id = ?').get(id) as any;
  return user || null;
}

export function getUserPassword(identifier: string, byUsername: boolean = false): string | null {
  const db = getDatabase();
  const query = byUsername 
    ? 'SELECT password FROM users WHERE username = ?'
    : 'SELECT password FROM users WHERE email = ?';
  const result = db.prepare(query).get(identifier) as any;
  return result?.password || null;
}

export function getUserPasswordByUsernameOrEmail(identifier: string): string | null {
  const db = getDatabase();
  // Tenta primeiro por username, depois por email
  let result = db.prepare('SELECT password FROM users WHERE username = ?').get(identifier) as any;
  if (!result) {
    result = db.prepare('SELECT password FROM users WHERE email = ?').get(identifier) as any;
  }
  return result?.password || null;
}

