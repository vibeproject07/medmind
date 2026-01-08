// Script de diagnóstico completo do problema de token
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

console.log('🔍 DIAGNÓSTICO COMPLETO DO PROBLEMA DE TOKEN\n');
console.log('='.repeat(60));

// 1. Verificar JWT_SECRET
console.log('\n1️⃣ Verificando JWT_SECRET:');
console.log('   Comprimento:', JWT_SECRET.length);
console.log('   Início:', JWT_SECRET.substring(0, 20) + '...');
console.log('   É padrão?', JWT_SECRET === 'your-secret-key-change-in-production');

// 2. Gerar token de teste
console.log('\n2️⃣ Gerando token de teste:');
const testUser = {
  id: 1,
  name: 'Administrador',
  username: 'admin',
  email: 'admin',
  role: 'admin',
  company_id: null
};

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

console.log('   Token gerado:', token.substring(0, 50) + '...');
console.log('   Comprimento:', token.length);
console.log('   Partes:', token.split('.').length);

// 3. Verificar token imediatamente
console.log('\n3️⃣ Verificando token imediatamente:');
try {
  const decoded = jwt.verify(token, JWT_SECRET);
  console.log('   ✅ Token VÁLIDO');
  console.log('   Payload:', JSON.stringify(decoded, null, 2));
} catch (error) {
  console.log('   ❌ Token INVÁLIDO:', error.message);
}

// 4. Testar com token "limpo" (simulando o que pode acontecer)
console.log('\n4️⃣ Testando variações do token:');

const variations = [
  { name: 'Token original', token },
  { name: 'Token com espaços', token: ' ' + token + ' ' },
  { name: 'Token com aspas', token: '"' + token + '"' },
  { name: 'Token trim()', token: token.trim() },
];

variations.forEach(({ name, token: testToken }) => {
  try {
    const cleanToken = testToken.trim().replace(/^["']|["']$/g, '');
    const decoded = jwt.verify(cleanToken, JWT_SECRET);
    console.log(`   ✅ ${name}: VÁLIDO`);
  } catch (error) {
    console.log(`   ❌ ${name}: INVÁLIDO - ${error.message}`);
  }
});

// 5. Verificar se há problema com o formato
console.log('\n5️⃣ Verificando formato do token:');
const parts = token.split('.');
console.log('   Partes do token:', parts.length);
console.log('   Parte 1 (header):', parts[0]?.substring(0, 20) + '...');
console.log('   Parte 2 (payload):', parts[1]?.substring(0, 20) + '...');
console.log('   Parte 3 (signature):', parts[2]?.substring(0, 20) + '...');

// 6. Decodificar sem verificar (para ver o payload)
console.log('\n6️⃣ Decodificando token (sem verificar):');
const decodedWithoutVerify = jwt.decode(token);
console.log('   Payload:', JSON.stringify(decodedWithoutVerify, null, 2));

console.log('\n' + '='.repeat(60));
console.log('✅ Diagnóstico completo!\n');

