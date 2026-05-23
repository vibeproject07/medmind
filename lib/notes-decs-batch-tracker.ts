import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export type NoteDecsBatchItemStatus = 'pending' | 'processing' | 'done' | 'error';

export interface NoteDecsBatchItem {
  noteId: number;
  title: string;
  status: NoteDecsBatchItemStatus;
  error?: string;
  descriptorCount?: number;
  updatedAt: string;
}

export interface NoteDecsBatchJob {
  id: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  items: NoteDecsBatchItem[];
}

const JOB_DIR = path.join(process.cwd(), 'data');
const JOB_FILE = path.join(JOB_DIR, 'notes-decs-batch-job.json');

async function ensureDir() {
  await mkdir(JOB_DIR, { recursive: true });
}

async function readJobFile(): Promise<NoteDecsBatchJob | null> {
  try {
    const raw = await readFile(JOB_FILE, 'utf8');
    return JSON.parse(raw) as NoteDecsBatchJob;
  } catch {
    return null;
  }
}

async function writeJobFile(job: NoteDecsBatchJob): Promise<void> {
  await ensureDir();
  await writeFile(JOB_FILE, JSON.stringify(job, null, 2), 'utf8');
}

export async function getBatchJob(jobId?: string): Promise<NoteDecsBatchJob | null> {
  const job = await readJobFile();
  if (!job) return null;
  if (jobId && job.id !== jobId) return null;
  return job;
}

export async function getActiveBatchJob(): Promise<NoteDecsBatchJob | null> {
  const job = await readJobFile();
  if (!job || job.status !== 'running') return null;
  return job;
}

export async function createBatchJob(
  notes: { id: number; title: string }[],
): Promise<NoteDecsBatchJob> {
  const existing = await getActiveBatchJob();
  if (existing) {
    throw new Error('Já existe uma classificação DeCS em andamento.');
  }

  const now = new Date().toISOString();
  const job: NoteDecsBatchJob = {
    id: randomUUID(),
    status: 'running',
    startedAt: now,
    items: notes.map((n) => ({
      noteId: n.id,
      title: n.title,
      status: 'pending',
      updatedAt: now,
    })),
  };
  await writeJobFile(job);
  return job;
}

export async function updateBatchItem(
  jobId: string,
  noteId: number,
  patch: Partial<Pick<NoteDecsBatchItem, 'status' | 'error' | 'descriptorCount'>>,
): Promise<void> {
  const job = await readJobFile();
  if (!job || job.id !== jobId) return;

  job.items = job.items.map((item) =>
    item.noteId === noteId
      ? { ...item, ...patch, updatedAt: new Date().toISOString() }
      : item,
  );
  await writeJobFile(job);
}

export async function finishBatchJob(
  jobId: string,
  status: 'completed' | 'failed',
): Promise<void> {
  const job = await readJobFile();
  if (!job || job.id !== jobId) return;
  job.status = status;
  job.completedAt = new Date().toISOString();
  await writeJobFile(job);
}
