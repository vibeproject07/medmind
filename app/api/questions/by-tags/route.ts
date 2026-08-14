import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { ensureProvaDeletedAtColumn } from '@/lib/prova-soft-delete-schema';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
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

    const isAdmin = user.role === 'admin' || user.role === 'manager';

    const { searchParams } = new URL(request.url);
    const tagsParam = searchParams.get('tags');

    if (!tagsParam) {
      return NextResponse.json({ error: 'Parâmetro tags é obrigatório' }, { status: 400 });
    }

    let tags: string[] = [];
    try {
      tags = JSON.parse(tagsParam);
    } catch {
      tags = tagsParam.split(',').map(t => t.trim()).filter(t => t.length > 0);
    }

    if (tags.length === 0) {
      return NextResponse.json({ error: 'Nenhuma tag fornecida' }, { status: 400 });
    }

    const examYear = searchParams.get('exam_year');
    const examBoard = searchParams.get('exam_board');
    const examInstitution = searchParams.get('exam_institution');
    const examRegion = searchParams.get('exam_region');

    // Non-admins must not see questions from soft-deleted provas
    await ensureProvaDeletedAtColumn();
    const allQuestions = isAdmin
      ? (await query('SELECT * FROM questions ORDER BY created_at DESC')).rows
      : (await query(
          `SELECT q.* FROM questions q
           LEFT JOIN provas p ON p.id = q.prova_id
           WHERE (q.prova_id IS NULL OR p.deleted_at IS NULL)
           ORDER BY q.created_at DESC`,
        )).rows;

    const filteredQuestions = allQuestions.filter((question: any) => {
      // Questões anuladas não entram em simulados
      if (question.anulada) return false;
      if (!question.tags) return false;

      try {
        const questionTags = JSON.parse(question.tags);
        if (!Array.isArray(questionTags)) return false;

        const hasAllTags = tags.every(tag =>
          questionTags.some((qt: string) =>
            qt.toLowerCase() === tag.toLowerCase() ||
            qt.toLowerCase().includes(tag.toLowerCase()) ||
            tag.toLowerCase().includes(qt.toLowerCase())
          )
        );

        if (!hasAllTags) return false;
      } catch {
        return false;
      }

      if (examYear && question.exam_year !== parseInt(examYear)) return false;
      if (examBoard && question.exam_board) {
        const boardMatch = question.exam_board.toLowerCase().includes(examBoard.toLowerCase()) ||
                          examBoard.toLowerCase().includes(question.exam_board.toLowerCase());
        if (!boardMatch) return false;
      } else if (examBoard && !question.exam_board) return false;
      if (examInstitution && question.exam_institution) {
        const institutionMatch = question.exam_institution.toLowerCase().includes(examInstitution.toLowerCase()) ||
                                 examInstitution.toLowerCase().includes(question.exam_institution.toLowerCase());
        if (!institutionMatch) return false;
      } else if (examInstitution && !question.exam_institution) return false;
      if (examRegion && question.exam_region) {
        const regionMatch = question.exam_region.toLowerCase().includes(examRegion.toLowerCase()) ||
                           examRegion.toLowerCase().includes(question.exam_region.toLowerCase());
        if (!regionMatch) return false;
      } else if (examRegion && !question.exam_region) return false;

      return true;
    });

    const questionsWithTags = filteredQuestions.map((question: any) => ({
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
      exam_year: question.exam_year,
      exam_board: question.exam_board,
      exam_institution: question.exam_institution,
      exam_region: question.exam_region,
      created_at: question.created_at,
      updated_at: question.updated_at,
    }));

    return NextResponse.json(questionsWithTags);
  } catch (error) {
    console.error('Erro ao buscar questões por tags:', error);
    return NextResponse.json({ error: 'Erro ao buscar questões' }, { status: 500 });
  }
}
