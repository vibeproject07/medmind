import { query } from '@/lib/db';

export type TaxonomyOrigin = 'original' | 'gerado';
export type PendingStatus = 'pending' | 'approved' | 'rejected';

export async function ensureTaxonomyTables(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS competencies_catalog (
      id SERIAL PRIMARY KEY,
      competencia TEXT NOT NULL,
      conteudo TEXT NOT NULL,
      origin VARCHAR(20) NOT NULL DEFAULT 'original'
        CHECK (origin IN ('original', 'gerado')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (competencia, conteudo)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS competencies_pending (
      id SERIAL PRIMARY KEY,
      competencia TEXT NOT NULL,
      conteudo TEXT NOT NULL,
      question_id INTEGER,
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
      raw_payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS themes_catalog (
      id SERIAL PRIMARY KEY,
      tema TEXT NOT NULL,
      subtema TEXT NOT NULL,
      origin VARCHAR(20) NOT NULL DEFAULT 'original'
        CHECK (origin IN ('original', 'gerado')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tema, subtema)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS themes_pending (
      id SERIAL PRIMARY KEY,
      tema TEXT NOT NULL,
      subtema TEXT NOT NULL,
      question_id INTEGER,
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
      raw_payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_habilities TEXT`);
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_question_themes TEXT`);
}

export function normalizeTaxonomyLabel(s: string): string {
  return String(s ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ');
}
