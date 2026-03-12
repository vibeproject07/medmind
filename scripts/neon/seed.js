/**
 * Script para Replit + Neon (PostgreSQL):
 * 1. Recria o banco (executa schema.sql)
 * 2. Insere dados iniciais: usuário admin e configuração de email SMTP
 *
 * Uso: DATABASE_URL="postgresql://..." node scripts/neon/seed.js
 * No Replit, defina DATABASE_URL nos Secrets e rode: node scripts/neon/seed.js
 */

const { Client } = require('pg');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ Defina DATABASE_URL (ex.: variável de ambiente ou Replit Secrets).');
  process.exit(1);
}

const schemaPath = path.join(__dirname, 'schema.sql');
const schemaSql = fs.readFileSync(schemaPath, 'utf8');

async function run() {
  const client = new Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    console.log('✅ Conectado ao Neon/PostgreSQL.\n');

    // 1. Recriar schema (DROP + CREATE)
    console.log('📋 Executando schema.sql (recriando tabelas)...');
    await client.query(schemaSql);
    console.log('✅ Schema aplicado.\n');

    // 2. Inserir configuração padrão de email
    const emailConfig = await client.query(
      "SELECT id FROM settings WHERE key = 'email_smtp'"
    );
    if (emailConfig.rows.length === 0) {
      await client.query(
        `INSERT INTO settings (key, value, description)
         VALUES ($1, $2, $3)`,
        [
          'email_smtp',
          JSON.stringify({ host: '', port: '', user: '', password: '' }),
          'Configuração de SMTP para envio de emails',
        ]
      );
      console.log('✅ Configuração email_smtp inserida.');
    } else {
      console.log('ℹ️  Configuração email_smtp já existe.');
    }

    // 3. Inserir usuário admin
    const adminExists = await client.query(
      "SELECT id FROM users WHERE email = 'admin'"
    );
    if (adminExists.rows.length === 0) {
      const hashedPassword = bcrypt.hashSync('a123456', 10);
      await client.query(
        `INSERT INTO users (name, username, email, password, role, email_verified)
         VALUES ($1, $2, $3, $4, $5, 1)`,
        ['Administrador', 'admin', 'admin', hashedPassword, 'admin']
      );
      console.log('✅ Usuário admin criado.');
      console.log('   Email/Username: admin');
      console.log('   Senha: a123456');
    } else {
      // Garantir email_verified e username
      await client.query(
        `UPDATE users SET email_verified = 1, username = 'admin' WHERE email = 'admin'`
      );
      console.log('ℹ️  Usuário admin já existe (atualizado se necessário).');
    }

    console.log('\n✅ Banco recriado e dados iniciais inseridos.');
  } catch (err) {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
