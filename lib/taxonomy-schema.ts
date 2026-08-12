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

/** Chave de comparação: minúsculas, sem acento, sem pontuação extra. */
export function taxonomyMatchKey(s: string): string {
  return normalizeTaxonomyLabel(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function taxonomyLabelsMatch(a: string, b: string): boolean {
  const ka = taxonomyMatchKey(a);
  const kb = taxonomyMatchKey(b);
  return ka.length > 0 && ka === kb;
}

export async function themePairExistsInCatalogOrPending(
  tema: string,
  subtema: string,
): Promise<boolean> {
  await ensureTaxonomyTables();
  const t = normalizeTaxonomyLabel(tema);
  const s = normalizeTaxonomyLabel(subtema);
  if (!t || !s) return true;

  const exact = await query(
    `SELECT 1 FROM themes_catalog
     WHERE lower(trim(tema)) = lower(trim($1))
       AND lower(trim(subtema)) = lower(trim($2))
     LIMIT 1`,
    [t, s],
  );
  if (exact.rows.length > 0) return true;

  const pendingExact = await query(
    `SELECT 1 FROM themes_pending
     WHERE lower(trim(tema)) = lower(trim($1))
       AND lower(trim(subtema)) = lower(trim($2))
       AND status IN ('pending', 'rejected', 'approved')
     LIMIT 1`,
    [t, s],
  );
  if (pendingExact.rows.length > 0) return true;

  // Match por chave normalizada (acentos/pontuação) no catálogo + pending
  const tKey = taxonomyMatchKey(t);
  const sKey = taxonomyMatchKey(s);
  const catalog = await query(`SELECT tema, subtema FROM themes_catalog`);
  for (const row of catalog.rows as Array<{ tema: string; subtema: string }>) {
    if (
      taxonomyMatchKey(row.tema) === tKey &&
      taxonomyMatchKey(row.subtema) === sKey
    ) {
      return true;
    }
  }
  const pending = await query(
    `SELECT tema, subtema FROM themes_pending
     WHERE status IN ('pending', 'rejected', 'approved')`,
  );
  for (const row of pending.rows as Array<{ tema: string; subtema: string }>) {
    if (
      taxonomyMatchKey(row.tema) === tKey &&
      taxonomyMatchKey(row.subtema) === sKey
    ) {
      return true;
    }
  }

  // Tema já catalogado e subtema == tema (placeholder) → não propor
  if (tKey === sKey) {
    const temaOnly = await query(
      `SELECT tema FROM themes_catalog`,
    );
    if (
      (temaOnly.rows as Array<{ tema: string }>).some(
        (r) => taxonomyMatchKey(r.tema) === tKey,
      )
    ) {
      return true;
    }
  }

  return false;
}

export async function competencyPairExistsInCatalogOrPending(
  competencia: string,
  conteudo: string,
): Promise<boolean> {
  await ensureTaxonomyTables();
  const c = normalizeTaxonomyLabel(competencia);
  const o = normalizeTaxonomyLabel(conteudo);
  if (!c || !o) return true;

  const exact = await query(
    `SELECT 1 FROM competencies_catalog
     WHERE lower(trim(competencia)) = lower(trim($1))
       AND lower(trim(conteudo)) = lower(trim($2))
     LIMIT 1`,
    [c, o],
  );
  if (exact.rows.length > 0) return true;

  const pendingExact = await query(
    `SELECT 1 FROM competencies_pending
     WHERE lower(trim(competencia)) = lower(trim($1))
       AND lower(trim(conteudo)) = lower(trim($2))
       AND status IN ('pending', 'rejected', 'approved')
     LIMIT 1`,
    [c, o],
  );
  if (pendingExact.rows.length > 0) return true;

  const cKey = taxonomyMatchKey(c);
  const oKey = taxonomyMatchKey(o);
  const catalog = await query(
    `SELECT competencia, conteudo FROM competencies_catalog`,
  );
  for (const row of catalog.rows as Array<{
    competencia: string;
    conteudo: string;
  }>) {
    if (
      taxonomyMatchKey(row.competencia) === cKey &&
      taxonomyMatchKey(row.conteudo) === oKey
    ) {
      return true;
    }
  }
  const pending = await query(
    `SELECT competencia, conteudo FROM competencies_pending
     WHERE status IN ('pending', 'rejected', 'approved')`,
  );
  for (const row of pending.rows as Array<{
    competencia: string;
    conteudo: string;
  }>) {
    if (
      taxonomyMatchKey(row.competencia) === cKey &&
      taxonomyMatchKey(row.conteudo) === oKey
    ) {
      return true;
    }
  }

  return false;
}
