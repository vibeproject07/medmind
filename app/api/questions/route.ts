import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { triggerEnrichment } from '@/lib/enrichment';
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

    await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_decs_descriptors TEXT`);
    await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_question_themes TEXT`);
    // Ensure deleted_at column exists so the LEFT JOIN filter below works
    await ensureProvaDeletedAtColumn();

    const { searchParams } = new URL(request.url);
    const examYear = searchParams.get('exam_year');
    const examBoard = searchParams.get('exam_board');
    const examInstitution = searchParams.get('exam_institution');
    const examRegion = searchParams.get('exam_region');
    const filterTags = searchParams.get('tags');
    const filterAreasConhecimento = searchParams.get('areas_conhecimento');
    const filterAssuntos = searchParams.get('assuntos');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(500, Math.max(1, parseInt(limitParam, 10))) : 15;

    // Non-admins must not see questions from soft-deleted provas
    const questionsQuery = isAdmin
      ? `SELECT id, statement, option_a, option_b, option_c, option_d, option_e,
                correct_answer, explanation, tags, images, exam_year, exam_board, exam_institution, exam_region,
                areas_conhecimento, assuntos, decs_terms, ai_decs_descriptors, ai_decs_v2, competencias, temas, ai_question_themes, anulada, created_at, updated_at
         FROM questions
         ORDER BY created_at DESC`
      : `SELECT q.id, q.statement, q.option_a, q.option_b, q.option_c, q.option_d, q.option_e,
                q.correct_answer, q.explanation, q.tags, q.images, q.exam_year, q.exam_board, q.exam_institution, q.exam_region,
                q.areas_conhecimento, q.assuntos, q.decs_terms, q.ai_decs_descriptors, q.ai_decs_v2, q.competencias, q.temas, q.ai_question_themes, q.anulada, q.created_at, q.updated_at
         FROM questions q
         LEFT JOIN provas p ON p.id = q.prova_id
         WHERE (q.prova_id IS NULL OR p.deleted_at IS NULL)
         ORDER BY q.created_at DESC`;

    let questions = (await query(questionsQuery)).rows;

    if (examYear || examBoard || examInstitution || examRegion) {
      questions = questions.filter((question: any) => {
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
    }

    let questionsWithTags = questions.map((question: any) => ({
      ...question,
      tags: question.tags ? JSON.parse(question.tags) : [],
      images: question.images ? JSON.parse(question.images) : [],
      areas_conhecimento: question.areas_conhecimento ? JSON.parse(question.areas_conhecimento) : [],
      assuntos: question.assuntos ? JSON.parse(question.assuntos) : [],
      decs_terms: question.decs_terms ? JSON.parse(question.decs_terms) : [],
      ai_decs_descriptors: question.ai_decs_descriptors ? JSON.parse(question.ai_decs_descriptors) : [],
      ai_decs_v2: question.ai_decs_v2 ? JSON.parse(question.ai_decs_v2) : null,
      competencias: question.competencias ? JSON.parse(question.competencias) : null,
      temas: question.temas ? JSON.parse(question.temas) : null,
      ai_question_themes: question.ai_question_themes
        ? JSON.parse(question.ai_question_themes)
        : null,
    }));

    if (filterTags) {
      const filterTagsArray = filterTags.split(',').map(tag => tag.trim()).filter(tag => tag);
      if (filterTagsArray.length > 0) {
        questionsWithTags = questionsWithTags.filter((question: any) => {
          const searchInField = (fieldValues: string[]) => {
            if (!fieldValues || !Array.isArray(fieldValues)) return false;
            return filterTagsArray.some(filterTag =>
              fieldValues.some((value: string) =>
                String(value).toLowerCase().includes(filterTag.toLowerCase()) ||
                filterTag.toLowerCase().includes(String(value).toLowerCase())
              )
            );
          };
          return searchInField(question.tags) || searchInField(question.areas_conhecimento) || searchInField(question.assuntos);
        });
      }
    }

    if (filterAreasConhecimento) {
      const filterArray = filterAreasConhecimento.split(',').map(tag => tag.trim()).filter(tag => tag);
      if (filterArray.length > 0) {
        questionsWithTags = questionsWithTags.filter((question: any) => {
          const matches = (fieldValues: string[]) => {
            if (!fieldValues || !Array.isArray(fieldValues)) return false;
            return filterArray.some(filterTag =>
              fieldValues.some((v: string) =>
                String(v).toLowerCase().includes(filterTag.toLowerCase()) ||
                filterTag.toLowerCase().includes(String(v).toLowerCase())
              )
            );
          };
          return matches(question.areas_conhecimento || []) || matches(question.tags || []);
        });
      }
    }

    if (filterAssuntos) {
      const filterArray = filterAssuntos.split(',').map(tag => tag.trim()).filter(tag => tag);
      if (filterArray.length > 0) {
        questionsWithTags = questionsWithTags.filter((question: any) => {
          const matches = (fieldValues: string[]) => {
            if (!fieldValues || !Array.isArray(fieldValues)) return false;
            return filterArray.some(filterTag =>
              fieldValues.some((v: string) =>
                String(v).toLowerCase().includes(filterTag.toLowerCase()) ||
                filterTag.toLowerCase().includes(String(v).toLowerCase())
              )
            );
          };
          return matches(question.assuntos || []) || matches(question.tags || []);
        });
      }
    }

    const total = questionsWithTags.length;
    const offset = (page - 1) * limit;
    const paginatedQuestions = questionsWithTags.slice(offset, offset + limit);

    return NextResponse.json({ questions: paginatedQuestions, total });
  } catch (error) {
    console.error('Erro ao buscar questões:', error);
    return NextResponse.json({ error: 'Erro ao buscar questões' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
        error: 'Acesso negado. Apenas administradores podem criar questões.'
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
    const processedImages = images && Array.isArray(images)
      ? await (await import('@/lib/s3')).processImagesForStorage(
          (images as unknown[]).filter((i) => typeof i === 'string') as string[],
        )
      : null;
    const imagesJson = processedImages?.length ? JSON.stringify(processedImages) : null;
    const areasConhecimentoJson = areas_conhecimento && Array.isArray(areas_conhecimento) ? JSON.stringify(areas_conhecimento) : null;
    const assuntosJson = assuntos && Array.isArray(assuntos) ? JSON.stringify(assuntos) : null;
    const decsTermsJson = decs_terms && Array.isArray(decs_terms) ? JSON.stringify(decs_terms) : null;

    const result = await query(
      `INSERT INTO questions (statement, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, tags, images, exam_year, exam_board, exam_institution, exam_region, areas_conhecimento, assuntos, decs_terms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
      [statement, option_a, option_b, option_c, option_d, option_e || null, correct_answer, explanation || null, tagsJson, imagesJson, exam_year || null, exam_board || null, exam_institution || null, exam_region || null, areasConhecimentoJson, assuntosJson, decsTermsJson]
    );

    const newQuestionId = result.rows[0].id;
    triggerEnrichment('question', newQuestionId);

    const newQuestion = (await query('SELECT * FROM questions WHERE id = $1', [newQuestionId])).rows[0];

    return NextResponse.json({
      ...newQuestion,
      tags: newQuestion.tags ? JSON.parse(newQuestion.tags) : [],
      images: newQuestion.images ? JSON.parse(newQuestion.images) : [],
      areas_conhecimento: newQuestion.areas_conhecimento ? JSON.parse(newQuestion.areas_conhecimento) : [],
      assuntos: newQuestion.assuntos ? JSON.parse(newQuestion.assuntos) : [],
      decs_terms: newQuestion.decs_terms ? JSON.parse(newQuestion.decs_terms) : [],
    }, { status: 201 });
  } catch (error) {
    console.error('Erro ao criar questão:', error);
    return NextResponse.json({ error: 'Erro ao criar questão' }, { status: 500 });
  }
}
