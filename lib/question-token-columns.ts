import { query } from '@/lib/db';

/**
 * Garante colunas de tokens nas tabelas usadas pela classificação de questões.
 * - questions.input_tokens / questions.output_tokens: totais da última execução completa
 * - questions.ai_token_usage: detalhe por agente (JSONB)
 * - decs_classification_runs.input_tokens / output_tokens: totais do artefato salvo
 */
export async function ensureQuestionTokenColumns(): Promise<void> {
  await query(
    `ALTER TABLE questions ADD COLUMN IF NOT EXISTS input_tokens INTEGER NOT NULL DEFAULT 0`,
  );
  await query(
    `ALTER TABLE questions ADD COLUMN IF NOT EXISTS output_tokens INTEGER NOT NULL DEFAULT 0`,
  );
  await query(
    `ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_token_usage JSONB`,
  );

  await query(`
    CREATE TABLE IF NOT EXISTS decs_classification_runs (
      id BIGSERIAL PRIMARY KEY,
      question_id INTEGER NOT NULL,
      pipeline VARCHAR(10) NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    `ALTER TABLE decs_classification_runs ADD COLUMN IF NOT EXISTS input_tokens INTEGER NOT NULL DEFAULT 0`,
  );
  await query(
    `ALTER TABLE decs_classification_runs ADD COLUMN IF NOT EXISTS output_tokens INTEGER NOT NULL DEFAULT 0`,
  );
}
