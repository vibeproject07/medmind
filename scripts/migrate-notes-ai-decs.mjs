/**
 * Backfill notes.ai_decs_descriptors a partir de notes.decs_terms (legado).
 * Termos legados sem role explícito viram secondary.
 *
 * Run: node --env-file=.env.local scripts/migrate-notes-ai-decs.mjs
 */

import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');

async function main() {
  await pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_decs_descriptors TEXT`);

  const { rows } = await pool.query(`
    SELECT id, decs_terms, ai_decs_descriptors
    FROM notes
    WHERE (ai_decs_descriptors IS NULL OR btrim(ai_decs_descriptors) = '' OR ai_decs_descriptors = '[]')
      AND decs_terms IS NOT NULL
      AND decs_terms::text <> '[]'
  `);

  let updated = 0;
  for (const row of rows) {
    const legacy = Array.isArray(row.decs_terms) ? row.decs_terms : [];
    const descriptors = legacy
      .map((item) => {
        if (typeof item === 'string') {
          return { term: item, code: '', role: 'secondary' };
        }
        if (item && typeof item === 'object') {
          const term = item.name_pt || item.term || item.name_en || '';
          const code = item.ui || item.code || '';
          const role = item.role === 'primary' ? 'primary' : 'secondary';
          return { term, code, name_en: item.name_en, role };
        }
        return null;
      })
      .filter((d) => d && d.term);

    if (descriptors.length > 0 && !descriptors.some((d) => d.role === 'primary')) {
      descriptors[0].role = 'primary';
    }

    if (descriptors.length === 0) continue;

    const legacyTerms = descriptors.map((d) => ({
      ui: d.code,
      name_pt: d.term,
      name_en: d.name_en ?? d.term,
      role: d.role,
    }));

    await pool.query(
      `UPDATE notes SET ai_decs_descriptors = $1, decs_terms = $2::jsonb, updated_at = NOW() WHERE id = $3`,
      [JSON.stringify(descriptors), JSON.stringify(legacyTerms), row.id],
    );
    updated++;
  }

  console.log(`Migradas ${updated} notas (decs_terms → ai_decs_descriptors).`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
