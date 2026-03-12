// Script interativo para configurar SMTP
const readline = require('readline');
const Database = require('better-sqlite3');
const db = new Database('medmind.db');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('           CONFIGURAÇÃO DE SMTP - MEDMIND');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Este script irá configurar o SMTP para envio de emails.\n');
  console.log('Exemplos de configuração:');
  console.log('  Gmail:     smtp.gmail.com:587');
  console.log('  Outlook:   smtp-mail.outlook.com:587');
  console.log('  Yahoo:     smtp.mail.yahoo.com:587\n');

  const host = await question('Host SMTP (ex: smtp.gmail.com): ');
  const port = await question('Porta (ex: 587): ');
  const user = await question('Email/Usuário: ');
  const password = await question('Senha (ou Senha de App para Gmail): ');

  if (!host || !port || !user || !password) {
    console.log('\n❌ Todos os campos são obrigatórios!');
    rl.close();
    return;
  }

  const config = {
    host: host.trim(),
    port: port.trim(),
    user: user.trim(),
    password: password.trim()
  };

  // Verificar se já existe
  const existing = db.prepare('SELECT id FROM settings WHERE key = ?').get('email_smtp');
  
  if (existing) {
    db.prepare('UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?')
      .run(JSON.stringify(config), 'email_smtp');
    console.log('\n✅ Configuração SMTP atualizada!');
  } else {
    db.prepare(`
      INSERT INTO settings (key, value, description)
      VALUES (?, ?, ?)
    `).run('email_smtp', JSON.stringify(config), 'Configuração de SMTP para envio de emails');
    console.log('\n✅ Configuração SMTP criada!');
  }

  console.log('\n📧 Configuração salva:');
  console.log(`   Host: ${config.host}`);
  console.log(`   Porta: ${config.port}`);
  console.log(`   Usuário: ${config.user}`);
  console.log(`   Senha: ***\n`);

  console.log('💡 Próximos passos:');
  console.log('   1. Acesse: http://localhost:3000/dashboard/settings');
  console.log('   2. Clique em "Testar Email" para verificar');
  console.log('   3. Tente se cadastrar novamente\n');

  rl.close();
}

main().catch(console.error);
