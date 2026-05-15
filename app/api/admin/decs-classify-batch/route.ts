/**
 * POST /api/admin/decs-classify-batch
 *
 * Dispara scripts/batch-decs-classify.mjs como processo em background (detached).
 * Salva ai_decs_descriptors em todas as questões não classificadas.
 *
 * Body (todos opcionais):
 *   limit        — processar apenas N questões (0 = todas)
 *   includeClassified — se true, reclassifica também as já classificadas
 */

import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { verifyToken } from '@/lib/jwt';

export const runtime = 'nodejs';

function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  if (!token) return null;
  return verifyToken(token);
}

export async function POST(req: NextRequest) {
  const user = getUser(req);
  if (!user || user.role !== 'admin')
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    limit?: number;
    includeClassified?: boolean;
  };

  const limit = Math.max(0, parseInt(String(body.limit ?? '0')));
  const includeClassified = body.includeClassified === true;

  const scriptPath = path.join(process.cwd(), 'scripts/batch-decs-classify.mjs');
  const envFile = path.join(process.cwd(), '.env.local');

  const args: string[] = [
    `--env-file=${envFile}`,
    scriptPath,
  ];
  if (limit > 0) args.push('--limit', String(limit));
  if (includeClassified) args.push('--include-classified');

  const child = spawn('node', args, {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env },
  });
  child.unref();

  return NextResponse.json({
    started: true,
    pid: child.pid,
    options: { limit, includeClassified },
    message: `Processo de classificação DeCS iniciado (PID ${child.pid}). As questões serão atualizadas em background.`,
  });
}
