import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

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

    // Todos os usuários autenticados podem ver questões (leitura)

    const db = getDatabase();
    const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(params.id);

    if (!question) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }

    // Converter tags, images, areas_conhecimento e assuntos JSON string para array
    const questionWithTags = {
      ...question,
      tags: (question as any).tags ? JSON.parse((question as any).tags) : [],
      images: (question as any).images ? JSON.parse((question as any).images) : [],
      areas_conhecimento: (question as any).areas_conhecimento ? JSON.parse((question as any).areas_conhecimento) : [],
      assuntos: (question as any).assuntos ? JSON.parse((question as any).assuntos) : [],
    };

    return NextResponse.json(questionWithTags);
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

    // Apenas admin pode editar questões
    if (user.role !== 'admin') {
      return NextResponse.json({ 
        error: 'Acesso negado. Apenas administradores podem editar questões.' 
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
    
    // Verificar se a questão existe
    const existingQuestion = db.prepare('SELECT id FROM questions WHERE id = ?').get(params.id);
    if (!existingQuestion) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }

    // Atualizar a questão
    db.prepare(`
      UPDATE questions
      SET statement = ?, option_a = ?, option_b = ?, option_c = ?, option_d = ?, 
          option_e = ?, correct_answer = ?, explanation = ?, tags = ?, images = ?, 
          exam_year = ?, exam_board = ?, exam_institution = ?, exam_region = ?, 
          areas_conhecimento = ?, assuntos = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
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
      assuntosJson,
      params.id
    );

    const updatedQuestion = db.prepare('SELECT * FROM questions WHERE id = ?').get(params.id) as any;

    // Converter tags, images, areas_conhecimento e assuntos JSON string para array
    const questionWithTags = {
      ...updatedQuestion,
      tags: updatedQuestion.tags ? JSON.parse(updatedQuestion.tags) : [],
      images: updatedQuestion.images ? JSON.parse(updatedQuestion.images) : [],
      areas_conhecimento: updatedQuestion.areas_conhecimento ? JSON.parse(updatedQuestion.areas_conhecimento) : [],
      assuntos: updatedQuestion.assuntos ? JSON.parse(updatedQuestion.assuntos) : [],
    };

    return NextResponse.json(questionWithTags);
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

    // Apenas admin pode excluir questões
    if (user.role !== 'admin') {
      return NextResponse.json({ 
        error: 'Acesso negado. Apenas administradores podem excluir questões.' 
      }, { status: 403 });
    }

    const db = getDatabase();
    
    // Verificar se a questão existe
    const existingQuestion = db.prepare('SELECT id FROM questions WHERE id = ?').get(params.id);
    if (!existingQuestion) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }

    // Deletar a questão
    db.prepare('DELETE FROM questions WHERE id = ?').run(params.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Erro ao excluir questão:', error);
    return NextResponse.json({ error: 'Erro ao excluir questão' }, { status: 500 });
  }
}
