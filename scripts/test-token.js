// Script para testar geração e verificação de token
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const user = {
  id: 1,
  name: 'Administrador',
  username: 'admin',
  email: 'admin',
  role: 'admin',
  company_id: null
};

console.log('Testando geração e verificação de token...\n');

try {
  const token = jwt.sign(
    { 
      id: user.id,
      username: user.username || null,
      email: user.email, 
      role: user.role,
      company_id: user.company_id || null
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  console.log('✅ Token gerado com sucesso!');
  console.log(`Token (primeiros 50 chars): ${token.substring(0, 50)}...\n`);

  const decoded = jwt.verify(token, JWT_SECRET);
  console.log('✅ Token verificado com sucesso!');
  console.log('Dados decodificados:', decoded);
} catch (error) {
  console.error('❌ Erro:', error.message);
}

