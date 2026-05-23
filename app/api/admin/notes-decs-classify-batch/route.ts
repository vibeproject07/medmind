/**
 * GET  /api/admin/notes-decs-classify-batch — estatísticas e job ativo (?jobId=)
 * POST /api/admin/notes-decs-classify-batch — inicia classificação com tracker
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { query } from '@/lib/db';
import { getBatchJob, getActiveBatchJob } from '@/lib/notes-decs-batch-tracker';
import { startNotesDecsBatchJob } from '@/lib/notes-decs-batch-runner';

export const runtime = 'nodejs';

function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  if (!token) return null;
  return verifyToken(token);
}

export async function GET(req: NextRequest) {
  const user = getUser(req);
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  await query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_decs_descriptors TEXT`);

  const jobId = req.nextUrl.searchParams.get('jobId');

  const [totalRes, pendingRes, classifiedRes, job, activeJob] = await Promise.all([
    query(`SELECT COUNT(*)::int AS c FROM notes`),
    query(`
      SELECT COUNT(*)::int AS c FROM notes
      WHERE ai_decs_descriptors IS NULL
         OR btrim(ai_decs_descriptors) = ''
         OR ai_decs_descriptors = '[]'
    `),
    query(`
      SELECT COUNT(*)::int AS c FROM notes
      WHERE ai_decs_descriptors IS NOT NULL
        AND btrim(ai_decs_descriptors) NOT IN ('', '[]')
    `),
    jobId ? getBatchJob(jobId) : Promise.resolve(null),
    getActiveBatchJob(),
  ]);

  return NextResponse.json({
    total: totalRes.rows[0]?.c ?? 0,
    pending: pendingRes.rows[0]?.c ?? 0,
    classified: classifiedRes.rows[0]?.c ?? 0,
    agents: ['discover_notes_terms', 'validate_notes_decs_terms'],
    job: job ?? null,
    activeJob: activeJob ?? null,
  });
}

export async function POST(req: NextRequest) {
  const user = getUser(req);
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as {
    limit?: number;
    includeClassified?: boolean;
  };

  const limit = Math.max(0, parseInt(String(body.limit ?? 0), 10));
  const includeClassified = body.includeClassified === true;

  try {
    const job = await startNotesDecsBatchJob({ limit, includeClassified });
    return NextResponse.json({
      started: true,
      jobId: job.id,
      total: job.items.length,
      options: { limit, includeClassified },
      message: `Classificação DeCS iniciada para ${job.items.length} nota(s).`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao iniciar classificação';
    const status = message.includes('em andamento') ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
