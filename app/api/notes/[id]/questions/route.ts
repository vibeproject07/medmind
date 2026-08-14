import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { filterActiveQuestionIds } from '@/lib/prova-soft-delete-schema';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;

    if (token) {
      token = token.trim().replace(/^["']|["']$/g, '');
    }

    if (!token) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

    const noteId = parseInt(params.id);
    if (isNaN(noteId)) {
      return NextResponse.json({ error: 'ID da nota inválido' }, { status: 400 });
    }

    const body = await request.json();
    const { question_ids } = body;

    if (!Array.isArray(question_ids)) {
      return NextResponse.json({ error: 'question_ids deve ser um array' }, { status: 400 });
    }

    const note = (await query('SELECT * FROM notes WHERE id = $1', [noteId])).rows[0];
    if (!note) {
      return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });
    }

    if (note.user_id !== user.id && user.role !== 'admin' && user.role !== 'manager') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const isAdmin = user.role === 'admin' || user.role === 'manager';

    // Non-admins cannot link questions from soft-deleted provas
    const numericIds: number[] = question_ids
      .filter((id: unknown) => typeof id === 'number' || (typeof id === 'string' && !isNaN(parseInt(id))))
      .map((id: unknown) => typeof id === 'number' ? id : parseInt(id as string));
    const allowedIds = isAdmin ? numericIds : await filterActiveQuestionIds(numericIds);
    const allowedSet = new Set(allowedIds);

    await query('DELETE FROM note_questions WHERE note_id = $1', [noteId]);

    for (const questionId of numericIds) {
      if (!allowedSet.has(questionId)) continue; // silently skip questions from deleted provas
      const questionExists = (await query('SELECT id FROM questions WHERE id = $1', [questionId])).rows[0];
      if (questionExists) {
        try {
          await query('INSERT INTO note_questions (note_id, question_id) VALUES ($1, $2)', [noteId, questionId]);
        } catch {
          // Ignorar erros de duplicação
        }
      }
    }

    return NextResponse.json({
      message: 'Questões associadas com sucesso',
      count: question_ids.length
    });
  } catch (error) {
    console.error('Erro ao associar questões à nota:', error);
    return NextResponse.json({ error: 'Erro ao associar questões' }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;

    if (token) {
      token = token.trim().replace(/^["']|["']$/g, '');
    }

    if (!token) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

    const noteId = parseInt(params.id);
    if (isNaN(noteId)) {
      return NextResponse.json({ error: 'ID da nota inválido' }, { status: 400 });
    }

    const note = (await query('SELECT * FROM notes WHERE id = $1', [noteId])).rows[0];
    if (!note) {
      return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });
    }

    if (note.user_id !== user.id && user.role !== 'admin' && user.role !== 'manager') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const isAdmin = user.role === 'admin' || user.role === 'manager';

    // Non-admins do not see questions from soft-deleted provas
    const questions = (await query(
      isAdmin
        ? `SELECT q.*
           FROM questions q
           INNER JOIN note_questions nq ON q.id = nq.question_id
           WHERE nq.note_id = $1
           ORDER BY nq.created_at DESC`
        : `SELECT q.*
           FROM questions q
           INNER JOIN note_questions nq ON q.id = nq.question_id
           LEFT JOIN provas p ON p.id = q.prova_id
           WHERE nq.note_id = $1
             AND (q.prova_id IS NULL OR p.deleted_at IS NULL)
           ORDER BY nq.created_at DESC`,
      [noteId],
    )).rows;

    const questionsWithTags = questions.map((question: any) => ({
      id: question.id,
      statement: question.statement,
      option_a: question.option_a,
      option_b: question.option_b,
      option_c: question.option_c,
      option_d: question.option_d,
      option_e: question.option_e,
      correct_answer: question.correct_answer,
      explanation: question.explanation,
      tags: question.tags ? JSON.parse(question.tags) : [],
      images: question.images ? JSON.parse(question.images) : [],
      created_at: question.created_at,
      updated_at: question.updated_at,
    }));

    return NextResponse.json(questionsWithTags);
  } catch (error) {
    console.error('Erro ao buscar questões da nota:', error);
    return NextResponse.json({ error: 'Erro ao buscar questões' }, { status: 500 });
  }
}
