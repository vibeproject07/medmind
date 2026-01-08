// Script para inicializar o banco de dados
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbPath = path.join(process.cwd(), 'medmind.db');

console.log('Inicializando banco de dados...');

// Criar banco de dados
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Criar tabelas
db.exec(`
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

db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
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
const emailConfig = db.prepare('SELECT * FROM settings WHERE key = ?').get('email_smtp');
if (!emailConfig) {
  db.prepare(`
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
const adminExists = db.prepare('SELECT * FROM users WHERE email = ?').get('admin');
if (!adminExists) {
  const hashedPassword = bcrypt.hashSync('a123456', 10);
  db.prepare(`
    INSERT INTO users (name, username, email, password, role)
    VALUES (?, ?, ?, ?, ?)
  `).run('Administrador', 'admin', 'admin', hashedPassword, 'admin');
  console.log('✅ Usuário admin criado com sucesso!');
  console.log('   Username: admin');
  console.log('   Email: admin');
  console.log('   Senha: a123456');
} else {
  console.log('ℹ️  Usuário admin já existe no banco de dados.');
  // Garantir que o admin tem username
  const admin = db.prepare('SELECT username FROM users WHERE email = ?').get('admin');
  if (!admin || !admin.username) {
    db.prepare('UPDATE users SET username = ? WHERE email = ?').run('admin', 'admin');
    console.log('✅ Username do admin atualizado para "admin"');
  }
}

db.close();

console.log('✅ Banco de dados inicializado com sucesso!');
console.log(`📁 Arquivo criado em: ${dbPath}`);

