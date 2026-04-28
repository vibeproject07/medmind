import { promises as fs } from 'fs';
import path from 'path';
import { query } from '@/lib/db';

const OUTPUT_DIR = path.join(process.cwd(), 'data', 'decs-classification');

export async function ensureClassificationTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS decs_classification_runs (
      id BIGSERIAL PRIMARY KEY,
      question_id INTEGER NOT NULL,
      pipeline VARCHAR(10) NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function saveClassificationArtifact(questionId: string | number, pipeline: 'v1' | 'v2', payload: unknown) {
  await ensureClassificationTable();
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const filePath = path.join(OUTPUT_DIR, `question-${questionId}-${pipeline}.json`);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
  await query(
    'INSERT INTO decs_classification_runs (question_id, pipeline, payload) VALUES ($1, $2, $3)',
    [questionId, pipeline, JSON.stringify(payload)]
  );
  return filePath;
}