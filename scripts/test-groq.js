/**
 * Script de terminal para testar a conexão com a API Groq.
 *
 * Uso:
 *   1. Crie .env.local na raiz do projeto com: GROQ_API_KEY=sua_chave_aqui
 *   2. No Windows (PowerShell): $env:GROQ_API_KEY="sua_chave"; node scripts/test-groq.js
 *      Ou carregue .env.local manualmente e execute: node scripts/test-groq.js
 *   3. No Linux/Mac: GROQ_API_KEY=sua_chave node scripts/test-groq.js
 *
 * Chave: https://console.groq.com/keys
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

async function main() {
  let apiKey = process.env.GROQ_API_KEY;

  if (!apiKey && typeof require !== 'undefined') {
    try {
      const fs = require('fs');
      const path = require('path');
      const envPath = path.join(process.cwd(), '.env.local');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/GROQ_API_KEY\s*=\s*["']?([^"'\s\n]+)/);
        if (match) apiKey = match[1].trim();
      }
    } catch (e) {
      // ignore
    }
  }

  if (!apiKey) {
    console.error('Erro: GROQ_API_KEY não definida.');
    console.error('Defina a variável de ambiente ou adicione GROQ_API_KEY=sua_chave em .env.local');
    console.error('Obtenha uma chave em: https://console.groq.com/keys');
    process.exit(1);
  }

  console.log('Conectando à API Groq...\n');

  const body = {
    model: 'openai/gpt-oss-20b',
    messages: [{ role: 'user', content: 'Responda em uma frase: o que é a API Groq?' }],
    max_tokens: 150,
  };

  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API retornou ${res.status}: ${text}`);
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) throw new Error('Resposta sem conteúdo');

    console.log('Resposta da Groq:');
    console.log('---');
    console.log(reply);
    console.log('---');
    if (data.usage) {
      console.log('\nUso:', data.usage.prompt_tokens, 'tokens (prompt) +', data.usage.completion_tokens, '(resposta)');
    }
    console.log('\nConexão com a API Groq OK.');
  } catch (err) {
    console.error('Erro:', err.message);
    process.exit(1);
  }
}

main();
