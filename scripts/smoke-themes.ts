import { Pool } from 'pg';
import { AI_AGENT_DEFAULTS } from '../lib/ai-agents-defaults';
import { classifyQuestionThemes } from '../lib/taxonomy-agents';
import { ensureTaxonomyTables } from '../lib/taxonomy-schema';

async function main() {
  await ensureTaxonomyTables();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const def = AI_AGENT_DEFAULTS.find((a) => a.key === 'question_themes_assigner');
  if (!def) throw new Error('default question_themes_assigner missing');

  await pool.query(
    `UPDATE ai_agents
     SET name = $1,
         description = $2,
         system_prompt = $3,
         model = $4,
         temperature = $5,
         max_output_tokens = $6,
         updated_at = NOW()
     WHERE key = 'question_themes_assigner'`,
    [
      def.name,
      def.description,
      def.system_prompt,
      def.model,
      def.temperature,
      def.max_output_tokens,
    ],
  );
  console.log('synced question_themes_assigner prompt (placeholders + nested JSON)');

  const stats = await pool.query(`
    SELECT count(*)::int AS pairs,
           count(DISTINCT tema)::int AS temas
    FROM themes_catalog
  `);
  console.log('catalog', stats.rows[0]);

  const qid = 26696;
  const qRes = await pool.query(`SELECT * FROM questions WHERE id = $1`, [qid]);
  if (!qRes.rows[0]) throw new Error(`question ${qid} not found`);

  console.log('running classifyQuestionThemes on', qid, '...');
  const out = await classifyQuestionThemes(qRes.rows[0]);
  console.log(
    JSON.stringify(
      {
        pendingInserted: out.pendingInserted,
        temas: out.result.temas,
        tema_principal: out.result.tema_principal,
      },
      null,
      2,
    ),
  );

  const saved = await pool.query(
    `SELECT ai_question_themes IS NOT NULL AND btrim(ai_question_themes) <> '' AS ok,
            left(ai_question_themes, 500) AS preview
     FROM questions WHERE id = $1`,
    [qid],
  );
  console.log('persisted', saved.rows[0]);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
