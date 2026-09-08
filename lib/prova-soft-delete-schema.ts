import { query } from '@/lib/db';

let ensured = false;
let ensurePromise: Promise<void> | null = null;

/**
 * Dado um array de question IDs, retorna apenas os que pertencem a provas
 * não excluídas (ou que não têm prova associada).
 * Seguro para uso em rotas de estudante — exclui silenciosamente questões
 * de provas soft-deleted.
 */
export async function filterActiveQuestionIds(questionIds: number[]): Promise<number[]> {
  if (questionIds.length === 0) return [];
  await ensureProvaDeletedAtColumn();
  const res = await query(
    `SELECT q.id
     FROM questions q
     LEFT JOIN provas p ON p.id = q.prova_id
     WHERE q.id = ANY($1)
       AND (q.prova_id IS NULL OR p.deleted_at IS NULL)`,
    [questionIds],
  );
  const activeSet = new Set(res.rows.map((r: Record<string, unknown>) => r.id as number));
  return questionIds.filter((id) => activeSet.has(id));
}

/**
 * Retorna true se a questão pertence a uma prova soft-deleted.
 * Devem ser usadas apenas em contexto de não-admin.
 */
export async function isQuestionInDeletedProva(questionId: number, provaId: number | null): Promise<boolean> {
  if (!provaId) return false;
  await ensureProvaDeletedAtColumn();
  const res = await query(
    'SELECT deleted_at FROM provas WHERE id = $1 LIMIT 1',
    [provaId],
  );
  return !!res.rows[0]?.deleted_at;
}

/**
 * Garante que a coluna `deleted_at` existe na tabela `provas`.
 * Executado lazily na primeira chamada de qualquer endpoint que precise dela.
 */
export async function ensureProvaDeletedAtColumn(): Promise<void> {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    await query(
      `ALTER TABLE provas ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL`,
    );
    await query(
      `CREATE INDEX IF NOT EXISTS idx_provas_deleted
       ON provas(deleted_at) WHERE deleted_at IS NOT NULL`,
    );
    ensured = true;
  })();

  try {
    await ensurePromise;
  } finally {
    ensurePromise = null;
  }
}
