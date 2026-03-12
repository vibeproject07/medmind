import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

export const runtime = 'nodejs';

// POST /api/notes/[id]/questions
// Associar questões a uma nota
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

    const db = getDatabase();

    // Verificar se a nota existe e se o usuário tem permissão
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId) as any;
    if (!note) {
      return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });
    }

    // Verificar se o usuário é o dono da nota ou admin
    if (note.user_id !== user.id && user.role !== 'admin') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    // Remover associações existentes
    db.prepare('DELETE FROM note_questions WHERE note_id = ?').run(noteId);

    // Adicionar novas associações
    const insertStmt = db.prepare('INSERT INTO note_questions (note_id, question_id) VALUES (?, ?)');
    const insertMany = db.transaction((questionIds: number[]) => {
      for (const questionId of questionIds) {
        // Verificar se a questão existe
        const question = db.prepare('SELECT id FROM questions WHERE id = ?').get(questionId) as any;
        if (question) {
          try {
            insertStmt.run(noteId, questionId);
          } catch (error) {
            // Ignorar erros de duplicação
          }
        }
      }
    });

    insertMany(question_ids);

    return NextResponse.json({ 
      message: 'Questões associadas com sucesso',
      count: question_ids.length 
    });
  } catch (error) {
    console.error('Erro ao associar questões à nota:', error);
    return NextResponse.json({ error: 'Erro ao associar questões' }, { status: 500 });
  }
}

// GET /api/notes/[id]/questions
// Buscar questões associadas a uma nota
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

    const db = getDatabase();

    // Verificar se a nota existe e se o usuário tem permissão
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId) as any;
    if (!note) {
      return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });
    }

    // Verificar se o usuário é o dono da nota ou admin
    if (note.user_id !== user.id && user.role !== 'admin') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    // Buscar questões associadas
    const questions = db.prepare(`
      SELECT q.*
      FROM questions q
      INNER JOIN note_questions nq ON q.id = nq.question_id
      WHERE nq.note_id = ?
      ORDER BY nq.created_at DESC
    `).all(noteId) as any[];

    // Converter tags e images JSON string para array
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
