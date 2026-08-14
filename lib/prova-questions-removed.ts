import { query } from '@/lib/db';

let ensured = false;
let ensurePromise: Promise<void> | null = null;

/**
 * Lista oculta de questões removidas de uma prova (não apagadas do banco).
 * A questão deixa de ter prova_id/numero_na_prova; o histórico fica nesta tabela.
 */
export async function ensureProvaQuestionsRemovedTable(): Promise<void> {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS prova_questions_removed (
        id SERIAL PRIMARY KEY,
        question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        prova_id INTEGER NOT NULL,
        prova_nome TEXT,
        banca TEXT,
        regiao TEXT,
        ano TEXT,
        tipo TEXT,
        numero_na_prova INTEGER,
        removed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        removed_by INTEGER
      )
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_prova_questions_removed_prova_id
      ON prova_questions_removed(prova_id)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_prova_questions_removed_question_id
      ON prova_questions_removed(question_id)
    `);
    ensured = true;
  })();

  try {
    await ensurePromise;
  } finally {
    ensurePromise = null;
  }
}
