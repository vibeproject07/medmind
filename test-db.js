// Script para testar e popular o banco de dados com dados de exemplo
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const db = new Database('medmind.db');

console.log('\n═══════════════════════════════════════════════════════════');
console.log('           TESTE E POPULAÇÃO DO BANCO DE DADOS');
console.log('═══════════════════════════════════════════════════════════\n');

// Verificar se a tabela email_tokens existe, se não, criar
try {
  db.exec(`
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
  console.log('✅ Tabela email_tokens verificada/criada');
} catch (error) {
  console.log('ℹ️  Tabela email_tokens já existe');
}

// Adicionar coluna email_verified se não existir
try {
  db.exec(`ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0`);
  console.log('✅ Coluna email_verified adicionada à tabela users');
} catch (error) {
  console.log('ℹ️  Coluna email_verified já existe');
}

// Atualizar admin para ter email_verified = 1
db.prepare('UPDATE users SET email_verified = 1 WHERE email = ?').run('admin');
console.log('✅ Admin marcado como email verificado\n');

// Inserir usuários de teste
console.log('👥 Inserindo usuários de teste...');
const users = [
  {
    name: 'Dr. João Silva',
    username: 'joao.silva',
    email: 'joao.silva@medmind.com',
    password: 'senha123',
    role: 'regular'
  },
  {
    name: 'Dra. Maria Santos',
    username: 'maria.santos',
    email: 'maria.santos@medmind.com',
    password: 'senha123',
    role: 'regular'
  },
  {
    name: 'Gerente Teste',
    username: 'gerente',
    email: 'gerente@medmind.com',
    password: 'senha123',
    role: 'manager'
  }
];

users.forEach(user => {
  try {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(user.email);
    if (!existing) {
      const hashedPassword = bcrypt.hashSync(user.password, 10);
      const result = db.prepare(`
        INSERT INTO users (name, username, email, password, role, email_verified)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run(user.name, user.username, user.email, hashedPassword, user.role);
      console.log(`   ✅ ${user.name} (ID: ${result.lastInsertRowid})`);
    } else {
      console.log(`   ⏭️  ${user.name} já existe (ID: ${existing.id})`);
    }
  } catch (error) {
    console.log(`   ❌ Erro ao inserir ${user.name}: ${error.message}`);
  }
});

// Inserir empresa de teste
console.log('\n🏢 Inserindo empresa de teste...');
try {
  const existingCompany = db.prepare('SELECT id FROM companies WHERE name = ?').get('Hospital Teste');
  if (!existingCompany) {
    const result = db.prepare('INSERT INTO companies (name) VALUES (?)').run('Hospital Teste');
    console.log(`   ✅ Empresa criada (ID: ${result.lastInsertRowid})`);
    
    // Associar o gerente à empresa
    const gerente = db.prepare('SELECT id FROM users WHERE email = ?').get('gerente@medmind.com');
    if (gerente) {
      db.prepare('UPDATE users SET company_id = ? WHERE id = ?').run(result.lastInsertRowid, gerente.id);
      console.log(`   ✅ Gerente associado à empresa`);
    }
  } else {
    console.log(`   ⏭️  Empresa já existe (ID: ${existingCompany.id})`);
  }
} catch (error) {
  console.log(`   ❌ Erro: ${error.message}`);
}

// Inserir tokens de teste
console.log('\n📧 Inserindo tokens de teste...');
const gerente = db.prepare('SELECT id FROM users WHERE email = ?').get('gerente@medmind.com');
if (gerente) {
  const token1 = require('crypto').randomBytes(32).toString('hex');
  const token2 = require('crypto').randomBytes(32).toString('hex');
  const expiresAt1 = new Date();
  expiresAt1.setHours(expiresAt1.getHours() + 24);
  const expiresAt2 = new Date();
  expiresAt2.setHours(expiresAt2.getHours() + 1);
  
  try {
    db.prepare(`
      INSERT INTO email_tokens (user_id, token, type, expires_at, used)
      VALUES (?, ?, 'email_verification', ?, 0)
    `).run(gerente.id, token1, expiresAt1.toISOString());
    console.log(`   ✅ Token de verificação criado (ativo)`);
    
    db.prepare(`
      INSERT INTO email_tokens (user_id, token, type, expires_at, used)
      VALUES (?, ?, 'password_reset', ?, 1)
    `).run(gerente.id, token2, expiresAt2.toISOString());
    console.log(`   ✅ Token de recuperação criado (usado)`);
  } catch (error) {
    console.log(`   ⏭️  Tokens já podem existir`);
  }
}

// Mostrar resumo
console.log('\n═══════════════════════════════════════════════════════════');
console.log('                    RESUMO DO BANCO');
console.log('═══════════════════════════════════════════════════════════\n');

const userCount = db.prepare('SELECT COUNT(*) as total FROM users').get();
const companyCount = db.prepare('SELECT COUNT(*) as total FROM companies').get();
const settingCount = db.prepare('SELECT COUNT(*) as total FROM settings').get();
const tokenCount = db.prepare('SELECT COUNT(*) as total FROM email_tokens').get();

console.log(`👥 Usuários: ${userCount.total}`);
console.log(`🏢 Empresas: ${companyCount.total}`);
console.log(`⚙️  Configurações: ${settingCount.total}`);
console.log(`📧 Tokens: ${tokenCount.total}`);

console.log('\n✅ Teste concluído! Agora você pode visualizar no DBeaver.');
console.log('   Lembre-se de dar F5 ou Refresh para atualizar a visualização.\n');

db.close();
