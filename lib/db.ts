import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const dbPath = path.join(process.cwd(), 'medmind.db');

// Garantir que o diretório existe
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    initializeDatabase(db);
  }
  return db;
}

function initializeDatabase(database: Database.Database) {
  // Tabela de usuários
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'regular' CHECK(role IN ('admin', 'manager', 'regular')),
      company_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (company_id) REFERENCES companies(id)
    )
  `);

  // Adicionar coluna username se não existir (migration)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN username TEXT UNIQUE`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar coluna email_verified se não existir (migration)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Tabela para tokens de validação e recuperação de senha
  database.exec(`
    CREATE TABLE IF NOT EXISTS email_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('email_verification', 'password_reset')),
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Criar índice para busca rápida por token
  try {
    database.exec(`CREATE INDEX IF NOT EXISTS idx_email_tokens_token ON email_tokens(token)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_email_tokens_user_id ON email_tokens(user_id)`);
  } catch (error) {
    // Índices já existem, ignorar erro
  }

  // Marcar admin como email verificado
  try {
    database.prepare('UPDATE users SET email_verified = 1 WHERE email = ?').run('admin');
  } catch (error) {
    // Ignorar erro
  }

  // Tabela de empresas (para managers)
  database.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tabela de configurações
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Inserir configuração padrão de email se não existir
  const emailConfig = database.prepare('SELECT * FROM settings WHERE key = ?').get('email_smtp');
  if (!emailConfig) {
    database.prepare(`
      INSERT INTO settings (key, value, description)
      VALUES (?, ?, ?)
    `).run('email_smtp', JSON.stringify({
      host: '',
      port: '',
      user: '',
      password: ''
    }), 'Configuração de SMTP para envio de emails');
  }

  // Criar usuário admin inicial se não existir
  const adminExists = database.prepare('SELECT * FROM users WHERE email = ?').get('admin');
  if (!adminExists) {
    const hashedPassword = bcrypt.hashSync('a123456', 10);
    database.prepare(`
      INSERT INTO users (name, username, email, password, role)
      VALUES (?, ?, ?, ?, ?)
    `).run('Administrador', 'admin', 'admin', hashedPassword, 'admin');
  } else {
    // Atualizar username do admin se não tiver
    const admin = database.prepare('SELECT username FROM users WHERE email = ?').get('admin') as any;
    if (!admin || !admin.username) {
      database.prepare('UPDATE users SET username = ? WHERE email = ?').run('admin', 'admin');
    }
  }
}

