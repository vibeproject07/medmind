/**
 * /api/admin/embed-notes
 *
 * POST — spawn scripts/embed-notes.mjs as a detached background process
 *
 * Body (all optional):
 *   concurrency  — parallel Gemini requests (default 3, max 10)
 *   delay        — ms between batches (default 350)
 *   limit        — process only N notes (0 = all pending)
 *   noResume     — if true, re-embed even notes that already have embeddings
 */

import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { spawn } from 'child_process';
import path from 'path';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

function getAdminUser(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { role?: string };
    return payload.role === 'admin' ? payload : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const admin = getAdminUser(req);
  if (!admin) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const concurrency = Math.min(parseInt(body.concurrency ?? '3'), 10);
    const delay       = Math.max(100, parseInt(body.delay ?? '350'));
    const noResume    = body.noResume === true;
    const limit       = Math.max(0, parseInt(body.limit ?? '0'));

    const scriptPath = path.join(process.cwd(), 'scripts/embed-notes.mjs');
    const envFile    = path.join(process.cwd(), '.env.local');

    const args: string[] = [
      `--env-file=${envFile}`,
      scriptPath,
      '--concurrency', String(concurrency),
      '--delay',       String(delay),
    ];
    if (limit > 0) args.push('--limit', String(limit));
    if (noResume)  args.push('--no-resume');

    const child = spawn('node', args, {
      detached: true,
      stdio:    ['ignore', 'ignore', 'ignore'],
      env:      { ...process.env },
    });
    child.unref();

    return NextResponse.json({
      started: true,
      pid: child.pid,
      options: { concurrency, delay, limit, noResume },
    });
  } catch (err) {
    console.error('[embed-notes POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
