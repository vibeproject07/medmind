import bcrypt from 'bcryptjs';
import { query } from './db';
import type { User } from './jwt';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const result = await query(
    'SELECT id, name, username, email, role, company_id, email_verified FROM users WHERE email = $1',
    [email]
  );
  return result.rows[0] || null;
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const result = await query(
    'SELECT id, name, username, email, role, company_id FROM users WHERE username = $1',
    [username]
  );
  return result.rows[0] || null;
}

export async function getUserByUsernameOrEmail(identifier: string): Promise<User | null> {
  let result = await query(
    'SELECT id, name, username, email, role, company_id FROM users WHERE username = $1',
    [identifier]
  );
  if (result.rows.length === 0) {
    result = await query(
      'SELECT id, name, username, email, role, company_id FROM users WHERE email = $1',
      [identifier]
    );
  }
  return result.rows[0] || null;
}

export async function getUserById(id: number): Promise<User | null> {
  const result = await query(
    'SELECT id, name, username, email, role, company_id FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

export async function getUserPasswordByUsernameOrEmail(identifier: string): Promise<string | null> {
  let result = await query(
    'SELECT password FROM users WHERE username = $1',
    [identifier]
  );
  if (result.rows.length === 0) {
    result = await query(
      'SELECT password FROM users WHERE email = $1',
      [identifier]
    );
  }
  return result.rows[0]?.password || null;
}
