import { query } from '@/lib/db';

type EntityType = 'note' | 'question';

export interface TermSimilarityHit {
  target_id: number;
  score: number;
  primary_matches: number;
  secondary_matches: number;
}

let ensured = false;
let ensurePromise: Promise<void> | null = null;

async function ensureTermSimilarityObjects(): Promise<void> {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    await query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_decs_descriptors TEXT`);

    // Safe parser to avoid crashing when legacy TEXT JSON is malformed.
    await query(`
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

    // Unified term source for notes + questions.
    await query(`
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
      SELECT entity_type, entity_id, term, role
      FROM q
      WHERE term <> ''
      UNION ALL
      SELECT entity_type, entity_id, term, role FROM n WHERE term <> ''
      UNION ALL
      SELECT entity_type, entity_id, term, role FROM n_legacy WHERE term <> '';
    `);

    // Main term-similarity function:
    // - requires at least one source primary-term match in candidate
    // - weighted score favoring primary matches
    await query(`
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
        WHERE entity_type = p_source_type
          AND entity_id   = p_source_id
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
        WHERE ct.entity_type = p_target_type
          AND ct.entity_id <> p_source_id
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
        LEFT JOIN source_primary sp   ON sp.term = t.term
        LEFT JOIN source_secondary ss ON ss.term = t.term
        GROUP BY t.target_id
      ),
      sizes AS (
        SELECT
          (SELECT COUNT(DISTINCT term) FROM source_terms) AS source_size,
          m.target_id,
          (SELECT COUNT(DISTINCT term)
             FROM classification_terms ct
            WHERE ct.entity_type = p_target_type
              AND ct.entity_id = m.target_id
          ) AS target_size
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

    ensured = true;
  })().finally(() => {
    ensurePromise = null;
  });

  return ensurePromise;
}

export async function findSimilarByTerms(
  sourceType: EntityType,
  sourceId: number,
  targetType: EntityType,
  limit = 10,
): Promise<TermSimilarityHit[]> {
  await ensureTermSimilarityObjects();
  const res = await query(
    `
      SELECT target_id, score, primary_matches, secondary_matches
      FROM find_similar_by_terms($1, $2, $3, $4)
    `,
    [sourceType, sourceId, targetType, limit],
  );
  return res.rows.map((r) => ({
    target_id: parseInt(String(r.target_id), 10),
    score: parseFloat(String(r.score ?? 0)),
    primary_matches: parseInt(String(r.primary_matches ?? 0), 10),
    secondary_matches: parseInt(String(r.secondary_matches ?? 0), 10),
  }));
}
