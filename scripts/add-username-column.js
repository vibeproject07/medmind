// Script para adicionar coluna username ao banco existente
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(process.cwd(), 'medmind.db');

console.log('Adicionando coluna username...');

const db = new Database(dbPath);

// Verificar se a coluna já existe
const tableInfo = db.prepare("PRAGMA table_info(users)").all();
const hasUsername = tableInfo.some(col => col.name === 'username');

if (!hasUsername) {
  // Criar nova tabela com username
  db.exec(`
    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'regular' CHECK(role IN ('admin', 'manager', 'regular')),
      company_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Copiar dados existentes
  db.exec(`
    INSERT INTO users_new (id, name, email, password, role, company_id, created_at, updated_at)
    SELECT id, name, email, password, role, company_id, created_at, updated_at
    FROM users
  `);

  // Atualizar username do admin
  db.prepare('UPDATE users_new SET username = ? WHERE email = ?').run('admin', 'admin');

  // Remover tabela antiga e renomear nova
  db.exec('DROP TABLE users');
  db.exec('ALTER TABLE users_new RENAME TO users');

  console.log('✅ Coluna username adicionada com sucesso!');
  console.log('✅ Username do admin definido como "admin"');
} else {
  console.log('ℹ️  Coluna username já existe.');
  // Garantir que o admin tem username
  const admin = db.prepare('SELECT username FROM users WHERE email = ?').get('admin');
  if (!admin || !admin.username) {
    db.prepare('UPDATE users SET username = ? WHERE email = ?').run('admin', 'admin');
    console.log('✅ Username do admin atualizado para "admin"');
  }
}

db.close();
console.log('✅ Migration concluída!');

