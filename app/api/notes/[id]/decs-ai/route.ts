import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import {
  classifyNoteDeCS,
  ensureNoteDeCsColumn,
  parseNoteAiDeCsDescriptors,
} from '@/lib/note-decs';

export const runtime = 'nodejs';

async function assertNoteAccess(noteId: number, user: { id: number; role: string }) {
  const noteCheck = await query(`SELECT user_id FROM notes WHERE id = $1`, [noteId]);
  if (noteCheck.rows.length === 0) return { error: 'Nota não encontrada', status: 404 as const };
  const ownerId = noteCheck.rows[0].user_id as number;
  if (user.role !== 'admin' && ownerId !== user.id) {
    return { error: 'Acesso negado', status: 403 as const };
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authHeader = req.headers.get('authorization');
  let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const user = verifyToken(token);
  if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });

  const { id } = await params;
  const noteId = parseInt(id, 10);
  if (Number.isNaN(noteId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

  const access = await assertNoteAccess(noteId, user);
  if (access) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    const descriptors = await classifyNoteDeCS(noteId);
    return NextResponse.json({ descriptors });
  } catch (err: unknown) {
    console.error('[notes decs-ai] POST error:', err);
    const message = err instanceof Error ? err.message : 'Erro interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authHeader = req.headers.get('authorization');
  let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const user = verifyToken(token);
  if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });

  const { id } = await params;
  const noteId = parseInt(id, 10);
  if (Number.isNaN(noteId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

  const access = await assertNoteAccess(noteId, user);
  if (access) return NextResponse.json({ error: access.error }, { status: access.status });

  try {
    await ensureNoteDeCsColumn();
    const res = await query(`SELECT ai_decs_descriptors FROM notes WHERE id = $1`, [noteId]);
    const raw = res.rows[0]?.ai_decs_descriptors as string | null;
    const descriptors = parseNoteAiDeCsDescriptors(raw);
    return NextResponse.json({ descriptors });
  } catch (err: unknown) {
    console.error('[notes decs-ai] GET error:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
