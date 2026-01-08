// Script para testar o fluxo completo de token
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Simular um usuário admin
const user = {
  id: 1,
  name: 'Administrador',
  username: 'admin',
  email: 'admin',
  role: 'admin',
  company_id: null
};

console.log('🔑 Gerando token...');
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

console.log('✅ Token gerado:', token.substring(0, 50) + '...');
console.log('📏 Tamanho do token:', token.length);

console.log('\n🔍 Verificando token...');
try {
  const decoded = jwt.verify(token, JWT_SECRET);
  console.log('✅ Token válido!');
  console.log('📋 Payload:', JSON.stringify(decoded, null, 2));
} catch (error) {
  console.error('❌ Erro ao verificar token:', error.message);
}

console.log('\n🧪 Testando com token do localStorage (se existir)...');
// Este script não pode acessar localStorage, mas podemos simular
console.log('💡 Para testar com token real, abra o console do navegador e execute:');
console.log('   localStorage.getItem("token")');

