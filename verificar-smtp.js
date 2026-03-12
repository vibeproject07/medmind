// Script para verificar configuração SMTP
const Database = require('better-sqlite3');
const db = new Database('medmind.db');

console.log('\n═══════════════════════════════════════════════════════════');
console.log('           VERIFICAÇÃO DA CONFIGURAÇÃO SMTP');
console.log('═══════════════════════════════════════════════════════════\n');

const smtp = db.prepare('SELECT value FROM settings WHERE key = ?').get('email_smtp');

if (smtp) {
  const config = JSON.parse(smtp.value);
  console.log('📧 Configuração SMTP atual:');
  console.log('   Host:', config.host || '(vazio) ❌');
  console.log('   Port:', config.port || '(vazio) ❌');
  console.log('   User:', config.user || '(vazio) ❌');
  console.log('   Password:', config.password ? '***' : '(vazio) ❌');
  console.log('');
  
  const isComplete = config.host && config.port && config.user && config.password;
  
  if (!isComplete) {
    console.log('❌ PROBLEMA: Configuração SMTP incompleta!');
    console.log('');
    console.log('Para resolver:');
    console.log('1. Acesse: http://localhost:3000/dashboard/settings');
    console.log('2. Configure o Email SMTP com suas credenciais');
    console.log('3. Teste o envio de email');
    console.log('');
    console.log('Ou use o script: node configurar-smtp.js');
  } else {
    console.log('✅ Configuração SMTP completa!');
  }
} else {
  console.log('❌ Configuração SMTP não encontrada no banco!');
}

db.close();
