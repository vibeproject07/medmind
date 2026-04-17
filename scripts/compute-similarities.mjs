/**
 * Batch similarity computation for MedMind content_links table.
 *
 * Usage:
 *   node --env-file=.env.local scripts/compute-similarities.mjs [options]
 *
 * Options:
 *   --type questions|notes|all   Which type to process (default: all)
 *   --limit <n>                  Max items to process (default: unlimited)
 *   --top-k <n>                  Links to store per item (default: 10)
 *   --threshold <f>              Min similarity score (default: 0.70)
 */

import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};

const TYPE      = getArg('--type', 'all');          // questions | notes | all
const LIMIT     = parseInt(getArg('--limit', '0')); // 0 = no limit
const TOP_K     = parseInt(getArg('--top-k', '10'));
const THRESHOLD = parseFloat(getArg('--threshold', '0.70'));

// ── Helpers ───────────────────────────────────────────────────────────────────
function vecStr(arr) {
  return `[${arr.join(',')}]`;
}

async function upsertLinks(sourceType, sourceId, targetType, rows) {
  for (const row of rows) {
    const sim = parseFloat(row.similarity);
    if (isNaN(sim) || sim < THRESHOLD) continue;
    await pool.query(
      `INSERT INTO content_links (source_type, source_id, target_type, target_id, similarity, computed_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (source_type, source_id, target_type, target_id)
       DO UPDATE SET similarity = EXCLUDED.similarity, computed_at = NOW()`,
      [sourceType, sourceId, targetType, row.id, sim]
    );
  }
}

// ── Process a single question ─────────────────────────────────────────────────
async function processQuestion(id, embText) {
  const [simQs, simNs] = await Promise.all([
    pool.query(
      `SELECT q.id, 1 - (q.embedding <=> $1::vector) AS similarity
       FROM questions q
       WHERE q.id != $2
         AND q.embedding IS NOT NULL
         AND (1 - (q.embedding <=> $1::vector)) >= $3
       ORDER BY q.embedding <=> $1::vector
       LIMIT $4`,
      [embText, id, THRESHOLD, TOP_K]
    ),
    pool.query(
      `SELECT n.id, 1 - (n.embedding <=> $1::vector) AS similarity
       FROM notes n
       WHERE n.embedding IS NOT NULL
         AND (1 - (n.embedding <=> $1::vector)) >= $2
       ORDER BY n.embedding <=> $1::vector
       LIMIT $3`,
      [embText, THRESHOLD, TOP_K]
    ),
  ]);

  await pool.query(
    `DELETE FROM content_links WHERE source_type = 'question' AND source_id = $1`,
    [id]
  );
  await upsertLinks('question', id, 'question', simQs.rows);
  await upsertLinks('question', id, 'note', simNs.rows);

  return { questions: simQs.rows.length, notes: simNs.rows.length };
}

// ── Process a single note ─────────────────────────────────────────────────────
async function processNote(id, embText) {
  const [simQs, simNs] = await Promise.all([
    pool.query(
      `SELECT q.id, 1 - (q.embedding <=> $1::vector) AS similarity
       FROM questions q
       WHERE q.embedding IS NOT NULL
         AND (1 - (q.embedding <=> $1::vector)) >= $2
       ORDER BY q.embedding <=> $1::vector
       LIMIT $3`,
      [embText, THRESHOLD, TOP_K]
    ),
    pool.query(
      `SELECT n.id, 1 - (n.embedding <=> $1::vector) AS similarity
       FROM notes n
       WHERE n.id != $2
         AND n.embedding IS NOT NULL
         AND (1 - (n.embedding <=> $1::vector)) >= $3
       ORDER BY n.embedding <=> $1::vector
       LIMIT $4`,
      [embText, id, THRESHOLD, TOP_K]
    ),
  ]);

  await pool.query(
    `DELETE FROM content_links WHERE source_type = 'note' AND source_id = $1`,
    [id]
  );
  await upsertLinks('note', id, 'question', simQs.rows);
  await upsertLinks('note', id, 'note', simNs.rows);

  return { questions: simQs.rows.length, notes: simNs.rows.length };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`[compute-similarities] type=${TYPE} limit=${LIMIT || 'all'} top-k=${TOP_K} threshold=${THRESHOLD}`);

  let totalLinks = 0;
  let totalItems = 0;

  if (TYPE === 'questions' || TYPE === 'all') {
    const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
    const qs = await pool.query(
      `SELECT id, embedding::text AS emb FROM questions WHERE embedding IS NOT NULL ${limitClause}`
    );
    console.log(`[compute-similarities] Processing ${qs.rows.length} questions…`);
    for (let i = 0; i < qs.rows.length; i++) {
      const { id, emb } = qs.rows[i];
      try {
        const { questions, notes } = await processQuestion(id, emb);
        totalLinks += questions + notes;
        totalItems++;
        if ((i + 1) % 100 === 0) {
          process.stdout.write(`  ${i + 1}/${qs.rows.length} questions processed\r`);
        }
      } catch (err) {
        console.error(`  [WARN] question ${id} failed:`, err.message);
      }
    }
    console.log(`\n[compute-similarities] Questions done (${qs.rows.length} items).`);
  }

  if (TYPE === 'notes' || TYPE === 'all') {
    const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';
    const ns = await pool.query(
      `SELECT id, embedding::text AS emb FROM notes WHERE embedding IS NOT NULL ${limitClause}`
    );
    console.log(`[compute-similarities] Processing ${ns.rows.length} notes…`);
    for (let i = 0; i < ns.rows.length; i++) {
      const { id, emb } = ns.rows[i];
      try {
        const { questions, notes } = await processNote(id, emb);
        totalLinks += questions + notes;
        totalItems++;
        if ((i + 1) % 10 === 0) {
          process.stdout.write(`  ${i + 1}/${ns.rows.length} notes processed\r`);
        }
      } catch (err) {
        console.error(`  [WARN] note ${id} failed:`, err.message);
      }
    }
    console.log(`\n[compute-similarities] Notes done (${ns.rows.length} items).`);
  }

  const countRes = await pool.query(`SELECT COUNT(*) FROM content_links`);
  console.log(
    `[compute-similarities] Complete. ${totalItems} items processed, ` +
    `${totalLinks} links written. Total in DB: ${countRes.rows[0].count}`
  );
  await pool.end();
}

run().catch((err) => {
  console.error('[compute-similarities] Fatal error:', err);
  pool.end();
  process.exit(1);
});
