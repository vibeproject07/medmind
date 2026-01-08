// Teste completo do fluxo de login e criação de usuário
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const dbPath = path.join(process.cwd(), 'medmind.db');

console.log('🧪 Teste completo do fluxo de autenticação\n');

// 1. Buscar usuário admin
const db = new Database(dbPath);
const admin = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get('admin', 'admin');

if (!admin) {
  console.error('❌ Admin não encontrado!');
  process.exit(1);
}

console.log('✅ Admin encontrado:', {
  id: admin.id,
  email: admin.email,
  username: admin.username,
  role: admin.role
});

// 2. Simular login (verificar senha)
const testPassword = 'a123456';
const isValidPassword = bcrypt.compareSync(testPassword, admin.password);
console.log('🔐 Senha válida:', isValidPassword);

if (!isValidPassword) {
  console.error('❌ Senha inválida!');
  process.exit(1);
}

// 3. Gerar token (como no login)
const user = {
  id: admin.id,
  name: admin.name,
  username: admin.username,
  email: admin.email,
  role: admin.role,
  company_id: admin.company_id
};

const token = jwt.sign(
  { 
    id: user.id,
    name: user.name || '',
    username: user.username || null,
    email: user.email, 
    role: user.role,
    company_id: user.company_id || null
  },
  JWT_SECRET,
  { expiresIn: '7d' }
);

console.log('🔑 Token gerado:', {
  length: token.length,
  start: token.substring(0, 30) + '...',
  secret: JWT_SECRET.substring(0, 10) + '...'
});

// 4. Verificar token (como na API)
try {
  const cleanToken = token.trim();
  const decoded = jwt.verify(cleanToken, JWT_SECRET);
  
  console.log('✅ Token verificado:', {
    id: decoded.id,
    email: decoded.email,
    role: decoded.role
  });
  
  // 5. Simular criação de usuário
  console.log('\n📝 Simulando criação de usuário...');
  console.log('Token sendo enviado:', cleanToken.substring(0, 30) + '...');
  
  // Verificar novamente (como na API /api/users POST)
  const userFromToken = jwt.verify(cleanToken, JWT_SECRET);
  
  if (userFromToken && userFromToken.id && userFromToken.email) {
    console.log('✅ Token válido para criar usuário!');
    console.log('👤 Usuário autenticado:', {
      id: userFromToken.id,
      email: userFromToken.email,
      role: userFromToken.role
    });
  } else {
    console.error('❌ Token inválido para criar usuário');
  }
  
} catch (error) {
  console.error('❌ Erro ao verificar token:', {
    name: error.name,
    message: error.message
  });
}

db.close();
console.log('\n✅ Teste completo!');

