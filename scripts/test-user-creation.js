// Script para testar criação de usuário
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const path = require('path');

const dbPath = path.join(process.cwd(), 'medmind.db');
const db = new Database(dbPath);

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

console.log('Testando criação de usuário...\n');

// Buscar usuário admin
const admin = db.prepare('SELECT * FROM users WHERE email = ?').get('admin');
console.log('Admin encontrado:', admin);

// Gerar token como seria gerado no login
const userForToken = {
  id: admin.id,
  name: admin.name,
  username: admin.username,
  email: admin.email,
  role: admin.role,
  company_id: admin.company_id
};

const token = jwt.sign(
  { 
    id: userForToken.id,
    name: userForToken.name || '',
    username: userForToken.username || null,
    email: userForToken.email, 
    role: userForToken.role,
    company_id: userForToken.company_id || null
  },
  JWT_SECRET,
  { expiresIn: '7d' }
);

console.log('\n✅ Token gerado:', token.substring(0, 50) + '...\n');

// Verificar token
try {
  const decoded = jwt.verify(token, JWT_SECRET);
  console.log('✅ Token verificado com sucesso!');
  console.log('Dados decodificados:', decoded);
} catch (error) {
  console.error('❌ Erro ao verificar token:', error.message);
}

db.close();

