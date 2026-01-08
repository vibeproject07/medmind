// Script para debugar problema de token
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Simular um token que pode estar sendo gerado
const testUser = {
  id: 1,
  name: 'Administrador',
  username: 'admin',
  email: 'admin',
  role: 'admin',
  company_id: null
};

console.log('Testando geração e verificação de token...\n');

// Gerar token como no código
const token = jwt.sign(
  { 
    id: testUser.id,
    name: testUser.name || '',
    username: testUser.username || null,
    email: testUser.email, 
    role: testUser.role,
    company_id: testUser.company_id || null
  },
  JWT_SECRET,
  { expiresIn: '7d' }
);

console.log('Token gerado:', token.substring(0, 50) + '...\n');

// Verificar token
try {
  const decoded = jwt.verify(token, JWT_SECRET);
  console.log('✅ Token válido!');
  console.log('Dados:', {
    id: decoded.id,
    name: decoded.name,
    username: decoded.username,
    email: decoded.email,
    role: decoded.role,
    company_id: decoded.company_id
  });
} catch (error) {
  console.error('❌ Erro:', error.message);
}

// Testar com token inválido
console.log('\n--- Testando token inválido ---');
try {
  const invalid = jwt.verify('token.invalido.aqui', JWT_SECRET);
  console.log('Token inválido aceito (ERRO!)');
} catch (error) {
  console.log('✅ Token inválido rejeitado corretamente:', error.message);
}

