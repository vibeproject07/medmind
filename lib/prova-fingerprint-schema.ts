import { query } from '@/lib/db';

let ensured = false;
let ensurePromise: Promise<void> | null = null;

/** Coluna de fingerprint de conteúdo (sequência de questões) em provas. */
export async function ensureProvaFingerprintColumn(): Promise<void> {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    await query(`
      ALTER TABLE provas
      ADD COLUMN IF NOT EXISTS content_fingerprint TEXT
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_provas_content_fingerprint
      ON provas(content_fingerprint)
      WHERE content_fingerprint IS NOT NULL
    `);
    ensured = true;
  })();

  try {
    await ensurePromise;
  } finally {
    ensurePromise = null;
  }
}
