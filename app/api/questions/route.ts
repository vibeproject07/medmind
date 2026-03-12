import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

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

    // Todos os usuários autenticados podem ver questões (leitura)
    // Obter filtros de informações da prova (opcionais)
    const { searchParams } = new URL(request.url);
    const examYear = searchParams.get('exam_year');
    const examBoard = searchParams.get('exam_board');
    const examInstitution = searchParams.get('exam_institution');
    const examRegion = searchParams.get('exam_region');
    const filterTags = searchParams.get('tags'); // Tags separadas por vírgula
    const filterAreasConhecimento = searchParams.get('areas_conhecimento');
    const filterAssuntos = searchParams.get('assuntos');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limitParam = searchParams.get('limit');
    const limit = limitParam
      ? Math.min(500, Math.max(1, parseInt(limitParam, 10)))
      : 15;

    const db = getDatabase();
    
    // Buscar todas as questões primeiro
    let questions = db.prepare(`
      SELECT id, statement, option_a, option_b, option_c, option_d, option_e, 
             correct_answer, explanation, tags, images, exam_year, exam_board, exam_institution, exam_region,
             areas_conhecimento, assuntos,
             created_at, updated_at
      FROM questions
      ORDER BY created_at DESC
    `).all() as any[];

    // Aplicar filtros de informações da prova se fornecidos
    if (examYear || examBoard || examInstitution || examRegion) {
      questions = questions.filter((question: any) => {
        if (examYear && question.exam_year !== parseInt(examYear)) {
          return false;
        }
        
        if (examBoard && question.exam_board) {
          const boardMatch = question.exam_board.toLowerCase().includes(examBoard.toLowerCase()) ||
                            examBoard.toLowerCase().includes(question.exam_board.toLowerCase());
          if (!boardMatch) return false;
        } else if (examBoard && !question.exam_board) {
          return false;
        }
        
        if (examInstitution && question.exam_institution) {
          const institutionMatch = question.exam_institution.toLowerCase().includes(examInstitution.toLowerCase()) ||
                                   examInstitution.toLowerCase().includes(question.exam_institution.toLowerCase());
          if (!institutionMatch) return false;
        } else if (examInstitution && !question.exam_institution) {
          return false;
        }
        
        if (examRegion && question.exam_region) {
          const regionMatch = question.exam_region.toLowerCase().includes(examRegion.toLowerCase()) ||
                             examRegion.toLowerCase().includes(question.exam_region.toLowerCase());
          if (!regionMatch) return false;
        } else if (examRegion && !question.exam_region) {
          return false;
        }

        return true;
      });
    }

    // Converter tags, images, areas_conhecimento e assuntos JSON string para array
    let questionsWithTags = questions.map((question: any) => ({
      ...question,
      tags: question.tags ? JSON.parse(question.tags) : [],
      images: question.images ? JSON.parse(question.images) : [],
      areas_conhecimento: question.areas_conhecimento ? JSON.parse(question.areas_conhecimento) : [],
      assuntos: question.assuntos ? JSON.parse(question.assuntos) : [],
    }));

    // Aplicar filtro de tags (Especialidade) se fornecido
    // Busca em tags, areas_conhecimento e assuntos - pois questões podem ter classificação em qualquer um desses campos
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
          return searchInField(question.tags) || 
                 searchInField(question.areas_conhecimento) || 
                 searchInField(question.assuntos);
        });
      }
    }

    // Aplicar filtro de áreas do conhecimento se fornecido (considera também tags, pois questões podem ter só tags)
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
          const areas = question.areas_conhecimento || [];
          const tags = question.tags || [];
          return matches(areas) || matches(tags);
        });
      }
    }

    // Aplicar filtro de assuntos se fornecido (considera também tags, pois questões podem ter só tags)
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
          const assuntos = question.assuntos || [];
          const tags = question.tags || [];
          return matches(assuntos) || matches(tags);
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

    // Apenas admin pode criar questões
    if (user.role !== 'admin') {
      return NextResponse.json({ 
        error: 'Acesso negado. Apenas administradores podem criar questões.' 
      }, { status: 403 });
    }

    const body = await request.json();
    const { statement, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, tags, images, exam_year, exam_board, exam_institution, exam_region, areas_conhecimento, assuntos } = body;

    // Apenas enunciado, alternativas A e B, e resposta correta são obrigatórios
    if (!statement || !option_a || !option_b || !correct_answer) {
      return NextResponse.json({ 
        error: 'Enunciado, alternativas A e B, e resposta correta são obrigatórios' 
      }, { status: 400 });
    }

    // Validar resposta correta baseado nas alternativas disponíveis
    const availableOptions = ['A', 'B'];
    if (option_c) availableOptions.push('C');
    if (option_d) availableOptions.push('D');
    if (option_e) availableOptions.push('E');

    if (!availableOptions.includes(correct_answer)) {
      return NextResponse.json({ 
        error: `Resposta correta deve ser uma das alternativas preenchidas: ${availableOptions.join(', ')}` 
      }, { status: 400 });
    }

    // Converter tags array para JSON string
    const tagsJson = tags && Array.isArray(tags) ? JSON.stringify(tags) : null;
    // Converter images array para JSON string
    const imagesJson = images && Array.isArray(images) ? JSON.stringify(images) : null;
    const areasConhecimentoJson = areas_conhecimento && Array.isArray(areas_conhecimento) ? JSON.stringify(areas_conhecimento) : null;
    const assuntosJson = assuntos && Array.isArray(assuntos) ? JSON.stringify(assuntos) : null;

    const db = getDatabase();
    const result = db.prepare(`
      INSERT INTO questions (statement, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, tags, images, exam_year, exam_board, exam_institution, exam_region, areas_conhecimento, assuntos)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      statement, 
      option_a, 
      option_b, 
      option_c, 
      option_d, 
      option_e || null, 
      correct_answer, 
      explanation || null, 
      tagsJson, 
      imagesJson,
      exam_year || null,
      exam_board || null,
      exam_institution || null,
      exam_region || null,
      areasConhecimentoJson,
      assuntosJson
    );

    const newQuestion = db.prepare('SELECT * FROM questions WHERE id = ?').get(result.lastInsertRowid);

    return NextResponse.json(newQuestion, { status: 201 });
  } catch (error) {
    console.error('Erro ao criar questão:', error);
    return NextResponse.json({ error: 'Erro ao criar questão' }, { status: 500 });
  }
}
