import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { triggerEnrichment } from '@/lib/enrichment';
import { isQuestionInDeletedProva } from '@/lib/prova-soft-delete-schema';

export const runtime = 'nodejs';

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

    const isAdmin = user.role === 'admin' || user.role === 'manager';

    await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_decs_descriptors TEXT`);
    await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_habilities TEXT`);
    await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_question_themes TEXT`);

    const question = (await query('SELECT * FROM questions WHERE id = $1', [params.id])).rows[0];

    if (!question) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }

    // Non-admins cannot access questions from soft-deleted provas
    if (!isAdmin && question.prova_id) {
      const inDeleted = await isQuestionInDeletedProva(question.id, question.prova_id);
      if (inDeleted) {
        return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
      }
    }

    const parseJsonField = (raw: unknown, fallback: unknown) => {
      if (raw == null || raw === '') return fallback;
      try {
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        return fallback;
      }
    };

    return NextResponse.json({
      ...question,
      tags: question.tags ? JSON.parse(question.tags) : [],
      images: question.images ? JSON.parse(question.images) : [],
      areas_conhecimento: question.areas_conhecimento ? JSON.parse(question.areas_conhecimento) : [],
      assuntos: question.assuntos ? JSON.parse(question.assuntos) : [],
      decs_terms: question.decs_terms ? JSON.parse(question.decs_terms) : [],
      ai_decs_descriptors: parseJsonField(question.ai_decs_descriptors, []),
      ai_habilities: parseJsonField(question.ai_habilities, null),
      ai_question_themes: parseJsonField(question.ai_question_themes, null),
    });
  } catch (error) {
    console.error('Erro ao buscar questão:', error);
    return NextResponse.json({ error: 'Erro ao buscar questão' }, { status: 500 });
  }
}

export async function PUT(
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

    if (user.role !== 'admin') {
      return NextResponse.json({
        error: 'Acesso negado. Apenas administradores podem editar questões.'
      }, { status: 403 });
    }

    const body = await request.json();
    const { statement, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, tags, images, exam_year, exam_board, exam_institution, exam_region, areas_conhecimento, assuntos, decs_terms } = body;

    if (!statement || !option_a || !option_b || !correct_answer) {
      return NextResponse.json({
        error: 'Enunciado, alternativas A e B, e resposta correta são obrigatórios'
      }, { status: 400 });
    }

    const availableOptions = ['A', 'B'];
    if (option_c) availableOptions.push('C');
    if (option_d) availableOptions.push('D');
    if (option_e) availableOptions.push('E');

    if (!availableOptions.includes(correct_answer)) {
      return NextResponse.json({
        error: `Resposta correta deve ser uma das alternativas preenchidas: ${availableOptions.join(', ')}`
      }, { status: 400 });
    }

    const tagsJson = tags && Array.isArray(tags) ? JSON.stringify(tags) : null;
    const imagesJson = images && Array.isArray(images) ? JSON.stringify(images) : null;
    const areasConhecimentoJson = areas_conhecimento && Array.isArray(areas_conhecimento) ? JSON.stringify(areas_conhecimento) : null;
    const assuntosJson = assuntos && Array.isArray(assuntos) ? JSON.stringify(assuntos) : null;
    const decsTermsJson = decs_terms && Array.isArray(decs_terms) ? JSON.stringify(decs_terms) : null;

    const existingQuestion = (await query('SELECT id FROM questions WHERE id = $1', [params.id])).rows[0];
    if (!existingQuestion) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }

    await query(`
      UPDATE questions
      SET statement = $1, option_a = $2, option_b = $3, option_c = $4, option_d = $5,
          option_e = $6, correct_answer = $7, explanation = $8, tags = $9, images = $10,
          exam_year = $11, exam_board = $12, exam_institution = $13, exam_region = $14,
          areas_conhecimento = $15, assuntos = $16, decs_terms = $17, updated_at = NOW()
      WHERE id = $18
    `, [statement, option_a, option_b, option_c, option_d, option_e || null, correct_answer, explanation || null, tagsJson, imagesJson, exam_year || null, exam_board || null, exam_institution || null, exam_region || null, areasConhecimentoJson, assuntosJson, decsTermsJson, params.id]);

    triggerEnrichment('question', parseInt(params.id));

    const updatedQuestion = (await query('SELECT * FROM questions WHERE id = $1', [params.id])).rows[0];

    return NextResponse.json({
      ...updatedQuestion,
      tags: updatedQuestion.tags ? JSON.parse(updatedQuestion.tags) : [],
      images: updatedQuestion.images ? JSON.parse(updatedQuestion.images) : [],
      areas_conhecimento: updatedQuestion.areas_conhecimento ? JSON.parse(updatedQuestion.areas_conhecimento) : [],
      assuntos: updatedQuestion.assuntos ? JSON.parse(updatedQuestion.assuntos) : [],
      decs_terms: updatedQuestion.decs_terms ? JSON.parse(updatedQuestion.decs_terms) : [],
      ai_decs_descriptors: updatedQuestion.ai_decs_descriptors ? JSON.parse(updatedQuestion.ai_decs_descriptors) : [],
    });
  } catch (error) {
    console.error('Erro ao atualizar questão:', error);
    return NextResponse.json({ error: 'Erro ao atualizar questão' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    if (token) token = token.trim().replace(/^["']|["']$/g, '');
    if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const user = verifyToken(token);
    if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Acesso negado. Apenas administradores podem anular questões.' }, { status: 403 });
    }

    const body = await request.json();

    // Atualização parcial de descritores DeCS gerados por IA (ex.: remoção pós-validação)
    if (Array.isArray(body.ai_decs_descriptors)) {
      const existing = (await query('SELECT id FROM questions WHERE id = $1', [params.id])).rows[0];
      if (!existing) return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });

      await query(
        `UPDATE questions
         SET ai_decs_descriptors = $1, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(body.ai_decs_descriptors), params.id],
      );

      const updated = (await query('SELECT * FROM questions WHERE id = $1', [params.id])).rows[0];
      return NextResponse.json({
        ...updated,
        tags: updated.tags ? JSON.parse(updated.tags) : [],
        images: updated.images ? JSON.parse(updated.images) : [],
        areas_conhecimento: updated.areas_conhecimento
          ? JSON.parse(updated.areas_conhecimento)
          : [],
        assuntos: updated.assuntos ? JSON.parse(updated.assuntos) : [],
        ai_decs_descriptors: body.ai_decs_descriptors,
      });
    }

    if (typeof body.anulada !== 'boolean') {
      return NextResponse.json({ error: 'Campo "anulada" (boolean) é obrigatório.' }, { status: 400 });
    }

    const existing = (await query('SELECT id FROM questions WHERE id = $1', [params.id])).rows[0];
    if (!existing) return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });

    await query('UPDATE questions SET anulada = $1, updated_at = NOW() WHERE id = $2', [body.anulada, params.id]);

    const updated = (await query('SELECT * FROM questions WHERE id = $1', [params.id])).rows[0];
    return NextResponse.json({
      ...updated,
      tags: updated.tags ? JSON.parse(updated.tags) : [],
      images: updated.images ? JSON.parse(updated.images) : [],
      areas_conhecimento: updated.areas_conhecimento ? JSON.parse(updated.areas_conhecimento) : [],
      assuntos: updated.assuntos ? JSON.parse(updated.assuntos) : [],
    });
  } catch (error) {
    console.error('Erro ao atualizar questão:', error);
    return NextResponse.json({ error: 'Erro ao atualizar questão' }, { status: 500 });
  }
}

export async function DELETE(
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

    if (user.role !== 'admin') {
      return NextResponse.json({
        error: 'Acesso negado. Apenas administradores podem excluir questões.'
      }, { status: 403 });
    }

    const existingQuestion = (await query('SELECT id FROM questions WHERE id = $1', [params.id])).rows[0];
    if (!existingQuestion) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }

    await query('DELETE FROM questions WHERE id = $1', [params.id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Erro ao excluir questão:', error);
    return NextResponse.json({ error: 'Erro ao excluir questão' }, { status: 500 });
  }
}
