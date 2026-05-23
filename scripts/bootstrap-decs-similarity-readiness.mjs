/**
 * Prepara o banco para similaridade por termos (primary/secondary):
 * 1. Garante colunas (notes.ai_decs_descriptors, questions.ai_decs_descriptors)
 * 2. Backfill notes.decs_terms → ai_decs_descriptors (+ promove 1º termo a primary se necessário)
 * 3. Cria view classification_terms + função find_similar_by_terms
 * 4. Recomputa content_links para notas/questões com embedding (vetorial)
 * 5. Relatório final de prontidão
 *
 * Run: node --env-file=.env.local scripts/bootstrap-decs-similarity-readiness.mjs
 *      node --env-file=.env.local scripts/bootstrap-decs-similarity-readiness.mjs --skip-links
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

const args = process.argv.slice(2);
const SKIP_LINKS = args.includes('--skip-links');
const LINKS_LIMIT = (() => {
  const i = args.indexOf('--links-limit');
  return i !== -1 && args[i + 1] ? parseInt(args[i + 1], 10) : 0;
})();

function loadEnv(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* optional */
  }
}
loadEnv(resolve(process.cwd(), '.env.local'));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não configurada (.env.local)');
  process.exit(1);
}

function legacyToDescriptors(legacy) {
  const items = Array.isArray(legacy) ? legacy : [];
  const descriptors = items
    .map((item) => {
      if (typeof item === 'string') {
        const term = item.trim();
        return term ? { term, code: '', role: 'secondary' } : null;
      }
      if (item && typeof item === 'object') {
        const term = String(item.name_pt || item.term || item.name_en || '').trim();
        if (!term) return null;
        const code = String(item.ui || item.code || '').trim();
        const role = item.role === 'primary' ? 'primary' : 'secondary';
        return { term, code, name_en: item.name_en, role };
      }
      return null;
    })
    .filter(Boolean);

  if (descriptors.length > 0 && !descriptors.some((d) => d.role === 'primary')) {
    descriptors[0].role = 'primary';
  }
  return descriptors;
}

async function ensureSchemaAndSql() {
  await pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_decs_descriptors TEXT`);
  await pool.query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_decs_descriptors TEXT`);

  await pool.query(`
    CREATE OR REPLACE FUNCTION try_parse_jsonb(p_text text)
    RETURNS jsonb
    LANGUAGE plpgsql
    IMMUTABLE
    AS $$
    BEGIN
      IF p_text IS NULL OR btrim(p_text) = '' THEN
        RETURN '[]'::jsonb;
      END IF;
      RETURN p_text::jsonb;
    EXCEPTION WHEN others THEN
      RETURN '[]'::jsonb;
    END;
    $$;
  `);

  await pool.query(`
    CREATE OR REPLACE VIEW classification_terms AS
    WITH q AS (
      SELECT
        'question'::text AS entity_type,
        q.id::int        AS entity_id,
        lower(trim(x->>'term')) AS term,
        COALESCE(NULLIF(lower(trim(x->>'role')), ''), 'secondary') AS role
      FROM questions q
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(try_parse_jsonb(q.ai_decs_descriptors), '[]'::jsonb)
      ) AS x
    ),
    n AS (
      SELECT
        'note'::text AS entity_type,
        n.id::int    AS entity_id,
        lower(trim(x->>'term')) AS term,
        COALESCE(NULLIF(lower(trim(x->>'role')), ''), 'secondary') AS role
      FROM notes n
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(try_parse_jsonb(n.ai_decs_descriptors), '[]'::jsonb)
      ) AS x
      WHERE COALESCE(try_parse_jsonb(n.ai_decs_descriptors), '[]'::jsonb) <> '[]'::jsonb
    ),
    n_legacy AS (
      SELECT
        'note'::text AS entity_type,
        n.id::int    AS entity_id,
        lower(trim(
          CASE
            WHEN jsonb_typeof(x) = 'object'
              THEN COALESCE(x->>'name_pt', x->>'term', x->>'name_en', '')
            ELSE x::text
          END
        )) AS term,
        COALESCE(NULLIF(lower(trim(x->>'role')), ''), 'secondary') AS role
      FROM notes n
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(n.decs_terms, '[]'::jsonb)) AS x
      WHERE COALESCE(try_parse_jsonb(n.ai_decs_descriptors), '[]'::jsonb) = '[]'::jsonb
    )
    SELECT entity_type, entity_id, term, role FROM q WHERE term <> ''
    UNION ALL
    SELECT entity_type, entity_id, term, role FROM n WHERE term <> ''
    UNION ALL
    SELECT entity_type, entity_id, term, role FROM n_legacy WHERE term <> '';
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION find_similar_by_terms(
      p_source_type text,
      p_source_id   int,
      p_target_type text,
      p_limit       int DEFAULT 10
    )
    RETURNS TABLE (
      target_id int,
      score numeric,
      primary_matches int,
      secondary_matches int
    )
    LANGUAGE sql
    STABLE
    AS $$
    WITH source_terms AS (
      SELECT term, role
      FROM classification_terms
      WHERE entity_type = p_source_type AND entity_id = p_source_id
    ),
    source_primary AS (
      SELECT term FROM source_terms WHERE role = 'primary'
    ),
    source_secondary AS (
      SELECT term FROM source_terms WHERE role <> 'primary'
    ),
    candidates AS (
      SELECT DISTINCT ct.entity_id AS target_id
      FROM classification_terms ct
      JOIN source_primary sp ON sp.term = ct.term
      WHERE ct.entity_type = p_target_type AND ct.entity_id <> p_source_id
    ),
    target_terms AS (
      SELECT ct.entity_id AS target_id, ct.term
      FROM classification_terms ct
      JOIN candidates c ON c.target_id = ct.entity_id
      WHERE ct.entity_type = p_target_type
    ),
    matches AS (
      SELECT
        t.target_id,
        COUNT(*) FILTER (WHERE sp.term IS NOT NULL) AS primary_matches,
        COUNT(*) FILTER (WHERE ss.term IS NOT NULL) AS secondary_matches
      FROM target_terms t
      LEFT JOIN source_primary sp ON sp.term = t.term
      LEFT JOIN source_secondary ss ON ss.term = t.term
      GROUP BY t.target_id
    ),
    sizes AS (
      SELECT
        (SELECT COUNT(DISTINCT term) FROM source_terms) AS source_size,
        m.target_id,
        (SELECT COUNT(DISTINCT term) FROM classification_terms ct
          WHERE ct.entity_type = p_target_type AND ct.entity_id = m.target_id) AS target_size
      FROM matches m
    ),
    scored AS (
      SELECT
        m.target_id,
        m.primary_matches,
        m.secondary_matches,
        (3*m.primary_matches + 1*m.secondary_matches) AS raw_score,
        s.source_size,
        s.target_size
      FROM matches m
      JOIN sizes s ON s.target_id = m.target_id
    )
    SELECT
      target_id,
      ROUND((raw_score::numeric / GREATEST(1, (source_size + target_size))) * 100, 4) AS score,
      primary_matches,
      secondary_matches
    FROM scored
    ORDER BY score DESC, primary_matches DESC, secondary_matches DESC, target_id DESC
    LIMIT p_limit;
    $$;
  `);
}

async function backfillNotesFromLegacy() {
  const { rows } = await pool.query(`
    SELECT id, decs_terms, ai_decs_descriptors
    FROM notes
    WHERE (ai_decs_descriptors IS NULL OR btrim(ai_decs_descriptors) = '' OR ai_decs_descriptors = '[]')
      AND decs_terms IS NOT NULL
      AND decs_terms::text <> '[]'
  `);

  let updated = 0;
  for (const row of rows) {
    const descriptors = legacyToDescriptors(row.decs_terms);
    if (descriptors.length === 0) continue;

    const legacyTerms = descriptors.map((d) => ({
      ui: d.code,
      name_pt: d.term,
      name_en: d.name_en ?? d.term,
      role: d.role,
    }));

    await pool.query(
      `UPDATE notes
       SET ai_decs_descriptors = $1,
           decs_terms = $2::jsonb,
           updated_at = NOW()
       WHERE id = $3`,
      [JSON.stringify(descriptors), JSON.stringify(legacyTerms), row.id],
    );
    updated++;
  }
  return updated;
}

async function ensurePrimaryOnTable(table, hasLegacyDecsTerms) {
  const { rows } = await pool.query(`
    SELECT id, ai_decs_descriptors
    FROM ${table}
    WHERE ai_decs_descriptors IS NOT NULL
      AND btrim(ai_decs_descriptors) <> ''
      AND ai_decs_descriptors <> '[]'
  `);

  let fixed = 0;
  for (const row of rows) {
    let list;
    try {
      list = JSON.parse(row.ai_decs_descriptors);
    } catch {
      continue;
    }
    if (!Array.isArray(list) || list.length === 0) continue;
    if (list.some((d) => d?.role === 'primary')) continue;

    list[0] = { ...list[0], role: 'primary' };
    const params = [JSON.stringify(list), row.id];

    if (hasLegacyDecsTerms) {
      const legacyTerms = list.map((d) => ({
        ui: d.code ?? '',
        name_pt: d.term ?? '',
        name_en: d.name_en ?? d.term ?? '',
        role: d.role ?? 'secondary',
      }));
      await pool.query(
        `UPDATE notes SET ai_decs_descriptors = $1, decs_terms = $2::jsonb, updated_at = NOW() WHERE id = $3`,
        [JSON.stringify(list), JSON.stringify(legacyTerms), row.id],
      );
    } else {
      await pool.query(
        `UPDATE questions SET ai_decs_descriptors = $1, updated_at = NOW() WHERE id = $2`,
        params,
      );
    }
    fixed++;
  }
  return fixed;
}

async function printReport() {
  const stats = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM notes) AS notes_total,
      (SELECT COUNT(*) FROM notes WHERE ai_decs_descriptors IS NOT NULL AND btrim(ai_decs_descriptors) NOT IN ('', '[]')) AS notes_with_ai_decs,
      (SELECT COUNT(*) FROM notes n WHERE EXISTS (
        SELECT 1 FROM classification_terms ct
        WHERE ct.entity_type = 'note' AND ct.entity_id = n.id AND ct.role = 'primary'
      )) AS notes_with_primary,
      (SELECT COUNT(*) FROM questions) AS questions_total,
      (SELECT COUNT(*) FROM questions WHERE ai_decs_descriptors IS NOT NULL AND btrim(ai_decs_descriptors) NOT IN ('', '[]')) AS questions_with_ai_decs,
      (SELECT COUNT(*) FROM questions q WHERE EXISTS (
        SELECT 1 FROM classification_terms ct
        WHERE ct.entity_type = 'question' AND ct.entity_id = q.id AND ct.role = 'primary'
      )) AS questions_with_primary,
      (SELECT COUNT(*) FROM content_links) AS content_links_total
  `);

  const s = stats.rows[0];
  console.log('\n── Relatório de prontidão ──');
  console.log(`Notas: ${s.notes_with_ai_decs}/${s.notes_total} com ai_decs_descriptors`);
  console.log(`Notas com termo primary: ${s.notes_with_primary}`);
  console.log(`Questões: ${s.questions_with_ai_decs}/${s.questions_total} com ai_decs_descriptors`);
  console.log(`Questões com termo primary: ${s.questions_with_primary}`);
  console.log(`content_links: ${s.content_links_total}`);

  const pending = await pool.query(`
    SELECT id, title
    FROM notes
    WHERE (ai_decs_descriptors IS NULL OR btrim(ai_decs_descriptors) IN ('', '[]'))
      AND (decs_terms IS NULL OR decs_terms::text = '[]')
    ORDER BY id
    LIMIT 15
  `);
  if (pending.rows.length > 0) {
    console.log('\nNotas ainda sem classificação DeCS (amostra):');
    for (const r of pending.rows) {
      console.log(`  #${r.id} ${String(r.title).slice(0, 50)}`);
    }
    console.log('  → Rode: node --env-file=.env.local scripts/batch-decs-classify-notes.mjs --limit 50');
  }
}

async function recomputeContentLinks() {
  const TOP_K = 10;
  const THRESHOLD = 0.7;

  async function upsertLinks(sourceType, sourceId, targetType, rows) {
    for (const row of rows) {
      const sim = parseFloat(row.similarity);
      if (Number.isNaN(sim) || sim < THRESHOLD) continue;
      await pool.query(
        `INSERT INTO content_links (source_type, source_id, target_type, target_id, similarity, computed_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (source_type, source_id, target_type, target_id)
         DO UPDATE SET similarity = EXCLUDED.similarity, computed_at = NOW()`,
        [sourceType, sourceId, targetType, row.id, sim],
      );
    }
  }

  const limitClause = LINKS_LIMIT > 0 ? `LIMIT ${LINKS_LIMIT}` : '';

  const notes = await pool.query(
    `SELECT id, embedding::text AS emb FROM notes WHERE embedding IS NOT NULL ORDER BY id ${limitClause}`,
  );
  console.log(`\nRecomputando content_links para ${notes.rows.length} notas com embedding…`);
  for (const { id, emb } of notes.rows) {
    const [simQs, simNs] = await Promise.all([
      pool.query(
        `SELECT q.id, 1 - (q.embedding <=> $1::vector) AS similarity
         FROM questions q WHERE q.embedding IS NOT NULL
           AND (1 - (q.embedding <=> $1::vector)) >= $2
         ORDER BY q.embedding <=> $1::vector LIMIT $3`,
        [emb, THRESHOLD, TOP_K],
      ),
      pool.query(
        `SELECT n.id, 1 - (n.embedding <=> $1::vector) AS similarity
         FROM notes n WHERE n.id != $2 AND n.embedding IS NOT NULL
           AND (1 - (n.embedding <=> $1::vector)) >= $3
         ORDER BY n.embedding <=> $1::vector LIMIT $4`,
        [emb, id, THRESHOLD, TOP_K],
      ),
    ]);
    await pool.query(`DELETE FROM content_links WHERE source_type = 'note' AND source_id = $1`, [id]);
    await upsertLinks('note', id, 'question', simQs.rows);
    await upsertLinks('note', id, 'note', simNs.rows);
  }

  const questions = await pool.query(
    `SELECT id, embedding::text AS emb FROM questions WHERE embedding IS NOT NULL ORDER BY id ${limitClause}`,
  );
  console.log(`Recomputando content_links para ${questions.rows.length} questões com embedding…`);
  for (const { id, emb } of questions.rows) {
    const [simQs, simNs] = await Promise.all([
      pool.query(
        `SELECT q.id, 1 - (q.embedding <=> $1::vector) AS similarity
         FROM questions q WHERE q.id != $2 AND q.embedding IS NOT NULL
           AND (1 - (q.embedding <=> $1::vector)) >= $3
         ORDER BY q.embedding <=> $1::vector LIMIT $4`,
        [emb, id, THRESHOLD, TOP_K],
      ),
      pool.query(
        `SELECT n.id, 1 - (n.embedding <=> $1::vector) AS similarity
         FROM notes n WHERE n.embedding IS NOT NULL
           AND (1 - (n.embedding <=> $1::vector)) >= $2
         ORDER BY n.embedding <=> $1::vector LIMIT $3`,
        [emb, THRESHOLD, TOP_K],
      ),
    ]);
    await pool.query(`DELETE FROM content_links WHERE source_type = 'question' AND source_id = $1`, [id]);
    await upsertLinks('question', id, 'question', simQs.rows);
    await upsertLinks('question', id, 'note', simNs.rows);
  }
}

async function main() {
  console.log('MedMind — bootstrap similaridade DeCS (termos primary/secondary)\n');

  console.log('1/4 Schema + SQL (view + função)…');
  await ensureSchemaAndSql();

  console.log('2/4 Backfill notes.decs_terms → ai_decs_descriptors…');
  const migrated = await backfillNotesFromLegacy();
  console.log(`   Migradas: ${migrated}`);

  console.log('3/4 Garantir ao menos 1 termo primary (notas + questões)…');
  const fixedNotes = await ensurePrimaryOnTable('notes', true);
  const fixedQuestions = await ensurePrimaryOnTable('questions', false);
  console.log(`   Notas ajustadas: ${fixedNotes}`);
  console.log(`   Questões ajustadas: ${fixedQuestions}`);

  if (!SKIP_LINKS) {
    console.log('4/4 content_links (vetorial pré-computado)…');
    await recomputeContentLinks();
  } else {
    console.log('4/4 Pulado (--skip-links)');
  }

  await printReport();
  await pool.end();
  console.log('\nBootstrap concluído.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
