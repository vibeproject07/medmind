import fs from 'fs';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  const limit = Math.max(1, Math.min(80, Number(process.argv[2] || 80)));
  const outputPath = process.argv[3] || 'recent_questions_80.csv';

  const { rows } = await pool.query(
    `
      SELECT id, statement, option_a, option_b, option_c, option_d, option_e,
             correct_answer, explanation, tags, images, exam_year, exam_board,
             exam_institution, exam_region, areas_conhecimento, assuntos, decs_terms,
             created_at, updated_at
      FROM questions
      ORDER BY created_at DESC NULLS LAST, id DESC
      LIMIT $1
    `,
    [limit]
  );

  const headers = [
    'id',
    'statement',
    'option_a',
    'option_b',
    'option_c',
    'option_d',
    'option_e',
    'correct_answer',
    'explanation',
    'tags',
    'images',
    'exam_year',
    'exam_board',
    'exam_institution',
    'exam_region',
    'areas_conhecimento',
    'assuntos',
    'decs_terms',
    'created_at',
    'updated_at',
  ];

  const lines = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((key) => csvEscape(row[key] ?? ''))
        .join(',')
    ),
  ];

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
  await pool.end();
  console.log(`CSV gerado: ${outputPath} (${rows.length} questões)`);
}

main().catch(async (error) => {
  console.error(error);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});