// Script para atualizar dados no banco e testar visualização no DBeaver
const Database = require('better-sqlite3');
const db = new Database('medmind.db');

console.log('\n═══════════════════════════════════════════════════════════');
console.log('        ATUALIZAÇÃO DE DADOS PARA TESTE NO DBEAVER');
console.log('═══════════════════════════════════════════════════════════\n');

// Adicionar um novo usuário de teste
console.log('👤 Adicionando novo usuário de teste...');
try {
  const bcrypt = require('bcryptjs');
  const hashedPassword = bcrypt.hashSync('teste123', 10);
  const result = db.prepare(`
    INSERT INTO users (name, username, email, password, role, email_verified)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run('Dr. Teste Atualização', 'teste.atualizacao', 'teste@medmind.com', hashedPassword, 'regular');
  console.log(`   ✅ Usuário criado (ID: ${result.lastInsertRowid})`);
} catch (error) {
  if (error.message.includes('UNIQUE constraint')) {
    console.log('   ⏭️  Usuário já existe, atualizando...');
    db.prepare('UPDATE users SET name = ? WHERE email = ?').run('Dr. Teste Atualizado', 'teste@medmind.com');
    console.log('   ✅ Nome atualizado');
  } else {
    console.log(`   ❌ Erro: ${error.message}`);
  }
}

// Atualizar configuração SMTP com dados de teste
console.log('\n⚙️  Atualizando configuração SMTP...');
const smtpConfig = {
  host: 'smtp.gmail.com',
  port: '587',
  user: 'teste@example.com',
  password: '***'
};
db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify(smtpConfig), 'email_smtp');
console.log('   ✅ Configuração SMTP atualizada');

// Adicionar nova empresa
console.log('\n🏢 Adicionando nova empresa...');
try {
  const result = db.prepare('INSERT INTO companies (name) VALUES (?)').run('Clínica Teste');
  console.log(`   ✅ Empresa criada (ID: ${result.lastInsertRowid})`);
} catch (error) {
  if (error.message.includes('UNIQUE constraint')) {
    console.log('   ⏭️  Empresa já existe');
  } else {
    console.log(`   ❌ Erro: ${error.message}`);
  }
}

// Mostrar estatísticas atuais
console.log('\n═══════════════════════════════════════════════════════════');
console.log('                    ESTATÍSTICAS ATUAIS');
console.log('═══════════════════════════════════════════════════════════\n');

const stats = {
  users: db.prepare('SELECT COUNT(*) as total FROM users').get().total,
  companies: db.prepare('SELECT COUNT(*) as total FROM companies').get().total,
  settings: db.prepare('SELECT COUNT(*) as total FROM settings').get().total,
  tokens: db.prepare('SELECT COUNT(*) as total FROM email_tokens').get().total
};

console.log(`👥 Usuários: ${stats.users}`);
console.log(`🏢 Empresas: ${stats.companies}`);
console.log(`⚙️  Configurações: ${stats.settings}`);
console.log(`📧 Tokens: ${stats.tokens}`);

console.log('\n✅ Atualização concluída!');
console.log('📊 No DBeaver:');
console.log('   1. Dê F5 na tabela para ver as mudanças');
console.log('   2. Ou configure auto-refresh (veja GUIA-DBEAVER.md)');
console.log('   3. Execute: SELECT * FROM users; para ver todos os usuários\n');

db.close();
