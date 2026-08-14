import { query } from '@/lib/db';

let ensured = false;
let ensurePromise: Promise<void> | null = null;

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
