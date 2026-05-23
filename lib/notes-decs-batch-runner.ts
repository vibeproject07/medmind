import { query } from '@/lib/db';
import { classifyNoteDeCS } from '@/lib/note-decs';
import {
  createBatchJob,
  finishBatchJob,
  updateBatchItem,
  type NoteDecsBatchJob,
} from '@/lib/notes-decs-batch-tracker';

async function fetchNotesForBatch(limit: number, includeClassified: boolean) {
  await query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_decs_descriptors TEXT`);

  const conditions: string[] = [];
  if (!includeClassified) {
    conditions.push(
      `(ai_decs_descriptors IS NULL OR btrim(ai_decs_descriptors) = '' OR ai_decs_descriptors = '[]')`,
    );
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = limit > 0 ? `LIMIT ${limit}` : '';

  const res = await query(
    `SELECT id, title FROM notes ${where} ORDER BY updated_at DESC, id DESC ${limitClause}`,
  );
  return res.rows.map((r) => ({
    id: r.id as number,
    title: String(r.title ?? `Nota #${r.id}`),
  }));
}

export async function startNotesDecsBatchJob(options: {
  limit: number;
  includeClassified: boolean;
}): Promise<NoteDecsBatchJob> {
  const notes = await fetchNotesForBatch(options.limit, options.includeClassified);
  if (notes.length === 0) {
    throw new Error('Nenhuma nota pendente para classificar.');
  }

  const job = await createBatchJob(notes);

  setImmediate(() => {
    runNotesDecsBatchJob(job.id).catch((err) => {
      console.error('[notes-decs-batch]', err);
      finishBatchJob(job.id, 'failed').catch(() => {});
    });
  });

  return job;
}

async function runNotesDecsBatchJob(jobId: string): Promise<void> {
  const job = await import('@/lib/notes-decs-batch-tracker').then((m) => m.getBatchJob(jobId));
  if (!job) return;

  for (const item of job.items) {
    await updateBatchItem(jobId, item.noteId, { status: 'processing', error: undefined });
    try {
      const descriptors = await classifyNoteDeCS(item.noteId);
      await updateBatchItem(jobId, item.noteId, {
        status: 'done',
        descriptorCount: descriptors.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      await updateBatchItem(jobId, item.noteId, { status: 'error', error: message });
    }
    await delay(600);
  }

  await finishBatchJob(jobId, 'completed');
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
