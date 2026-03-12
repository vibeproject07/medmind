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

  // Adicionar coluna academic_status se não existir (migration)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN academic_status TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar coluna academic_period se não existir (migration)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN academic_period INTEGER`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar coluna institution se não existir (migration)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN institution TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar coluna teaching_methodology se não existir (migration)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN teaching_methodology TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar coluna residency_status se não existir (migration)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN residency_status TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar coluna interests_tags se não existir (migration)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN interests_tags TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar coluna residency_name se não existir (migration)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN residency_name TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar coluna residency_year se não existir (migration)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN residency_year TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar coluna wants_new_residency_exam se não existir (migration)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN wants_new_residency_exam TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar coluna next_residency_interests se não existir (migration)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN next_residency_interests TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar coluna specialty_area se não existir (migration)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN specialty_area TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar coluna wants_another_residency se não existir (migration)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN wants_another_residency TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar coluna intended_residency se não existir (migration)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN intended_residency TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar coluna wants_residency se não existir (migration)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN wants_residency TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar coluna intended_residency_generalist se não existir (migration)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN intended_residency_generalist TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar coluna has_residency se não existir (migration)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN has_residency TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar coluna images na tabela notes se não existir (migration)
  try {
    database.exec(`ALTER TABLE notes ADD COLUMN images TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar coluna images na tabela questions se não existir (migration)
  try {
    database.exec(`ALTER TABLE questions ADD COLUMN images TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar colunas de informações da prova se não existirem (migration)
  try {
    database.exec(`ALTER TABLE questions ADD COLUMN exam_year INTEGER`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  try {
    database.exec(`ALTER TABLE questions ADD COLUMN exam_board TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  try {
    database.exec(`ALTER TABLE questions ADD COLUMN exam_institution TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  try {
    database.exec(`ALTER TABLE questions ADD COLUMN exam_region TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  try {
    database.exec(`ALTER TABLE questions ADD COLUMN exam_type TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }
  try {
    database.exec(`ALTER TABLE questions ADD COLUMN prova_id INTEGER REFERENCES provas(id)`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }
  try {
    database.exec(`ALTER TABLE questions ADD COLUMN numero_na_prova INTEGER`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Adicionar colunas areas_conhecimento e assuntos na tabela notes (migration)
  try {
    database.exec(`ALTER TABLE notes ADD COLUMN areas_conhecimento TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }
  try {
    database.exec(`ALTER TABLE notes ADD COLUMN assuntos TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Colunas para fontes (arquivos carregados e transformação por IA)
  try {
    database.exec(`ALTER TABLE notes ADD COLUMN fontes_resumo_melhorado TEXT`);
  } catch (error) {
    /* coluna já existe */
  }
  try {
    database.exec(`ALTER TABLE notes ADD COLUMN fontes_resumo_original TEXT`);
  } catch (error) {
    /* coluna já existe */
  }
  try {
    database.exec(`ALTER TABLE notes ADD COLUMN fontes_arquivos TEXT`);
  } catch (error) {
    /* coluna já existe */
  }

  // Adicionar colunas areas_conhecimento e assuntos na tabela questions (migration)
  try {
    database.exec(`ALTER TABLE questions ADD COLUMN areas_conhecimento TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }
  try {
    database.exec(`ALTER TABLE questions ADD COLUMN assuntos TEXT`);
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

  // Tabela de notas
  database.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      tags TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Adicionar coluna tags se não existir (migration)
  try {
    database.exec(`ALTER TABLE notes ADD COLUMN tags TEXT`);
  } catch (error) {
    // Coluna já existe, ignorar erro
  }

  // Criar índice para busca rápida por user_id
  try {
    database.exec(`CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at)`);
  } catch (error) {
    // Índices já existem, ignorar erro
  }

  // Tabela de provas (exames na íntegra)
  database.exec(`
    CREATE TABLE IF NOT EXISTS provas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      banca TEXT,
      regiao TEXT,
      ano TEXT,
      tipo TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try {
    database.exec(`CREATE INDEX IF NOT EXISTS idx_provas_created_at ON provas(created_at)`);
  } catch (error) {
    // Índice já existe
  }

  // Tabela de questões
  database.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      statement TEXT NOT NULL,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      option_d TEXT NOT NULL,
      option_e TEXT,
      correct_answer TEXT NOT NULL CHECK(correct_answer IN ('A', 'B', 'C', 'D', 'E')),
      explanation TEXT,
      tags TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Criar índice para busca rápida
  try {
    database.exec(`CREATE INDEX IF NOT EXISTS idx_questions_created_at ON questions(created_at)`);
  } catch (error) {
    // Índice já existe, ignorar erro
  }

  // Tabela de associação entre notas e questões
  database.exec(`
    CREATE TABLE IF NOT EXISTS note_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
      UNIQUE(note_id, question_id)
    )
  `);

  // Criar índices para busca rápida
  try {
    database.exec(`CREATE INDEX IF NOT EXISTS idx_note_questions_note_id ON note_questions(note_id)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_note_questions_question_id ON note_questions(question_id)`);
  } catch (error) {
    // Índices já existem, ignorar erro
  }

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

