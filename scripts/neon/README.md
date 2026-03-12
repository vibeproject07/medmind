# Banco PostgreSQL (Neon) para Replit

Este diretório contém o que é necessário para usar o **Neon (PostgreSQL)** no Replit em vez do SQLite local.

## Arquivos

- **schema.sql** – Define todas as tabelas (companies, users, settings, email_tokens, provas, questions, notes, note_questions). Pode ser executado sozinho para apenas recriar o schema.
- **seed.js** – Script Node que:
  1. Aplica o `schema.sql` (recria as tabelas)
  2. Insere os dados iniciais: configuração SMTP e usuário admin (admin / a123456).

## Uso no Replit (Neon)

1. Crie um banco no [Neon](https://neon.tech) e copie a **connection string** (ex.: `postgresql://user:pass@host/db?sslmode=require`).
2. No Replit, em **Tools → Secrets**, adicione:
   - `DATABASE_URL` = connection string do Neon.
3. Instale dependências e rode o setup do banco:
   ```bash
   npm install
   npm run neon:setup
   ```
   Ou diretamente:
   ```bash
   node scripts/neon/seed.js
   ```
4. O app ainda usa SQLite por padrão; é preciso trocar `lib/db.ts` (e as rotas de API) para usar PostgreSQL quando `DATABASE_URL` estiver definido. Isso pode ser feito em uma próxima etapa (camada de acesso ao banco com `pg`).

## Apenas recriar o schema (sem seed)

Se você só quiser recriar as tabelas (por exemplo, via `psql`):

```bash
psql "$DATABASE_URL" -f scripts/neon/schema.sql
```

## Dados iniciais inseridos pelo seed

- **settings**: chave `email_smtp` com valor JSON `{ host, port, user, password }` vazios.
- **users**: usuário admin com email/username `admin`, senha `a123456`, role `admin`, `email_verified = 1`.
