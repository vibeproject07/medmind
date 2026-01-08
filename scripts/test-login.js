// Script para testar o login
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(process.cwd(), 'medmind.db');
const db = new Database(dbPath);

console.log('Testando login do admin...\n');

// Buscar usuário admin
const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get('admin', 'admin');
if (!user) {
  console.log('❌ Usuário admin não encontrado!');
  process.exit(1);
}

console.log('✅ Usuário encontrado:');
console.log(`   ID: ${user.id}`);
console.log(`   Nome: ${user.name}`);
console.log(`   Username: ${user.username}`);
console.log(`   Email: ${user.email}`);
console.log(`   Role: ${user.role}\n`);

// Testar senhas
const passwords = ['123456', 'a123456'];

passwords.forEach(pwd => {
  const isValid = bcrypt.compareSync(pwd, user.password);
  console.log(`Testando senha "${pwd}": ${isValid ? '✅ VÁLIDA' : '❌ INVÁLIDA'}`);
});

db.close();

