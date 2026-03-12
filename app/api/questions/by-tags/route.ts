import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

export const runtime = 'nodejs';

// GET /api/questions/by-tags?tags=tag1,tag2,tag3
// Busca questões que possuem TODAS as tags especificadas (busca booleana AND)
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

    const { searchParams } = new URL(request.url);
    const tagsParam = searchParams.get('tags');
    
    if (!tagsParam) {
      return NextResponse.json({ error: 'Parâmetro tags é obrigatório' }, { status: 400 });
    }

    // Parse tags (pode vir como string separada por vírgula ou como array JSON)
    let tags: string[] = [];
    try {
      tags = JSON.parse(tagsParam);
    } catch {
      // Se não for JSON, tratar como string separada por vírgula
      tags = tagsParam.split(',').map(t => t.trim()).filter(t => t.length > 0);
    }

    if (tags.length === 0) {
      return NextResponse.json({ error: 'Nenhuma tag fornecida' }, { status: 400 });
    }

    // Obter filtros de informações da prova (opcionais)
    const examYear = searchParams.get('exam_year');
    const examBoard = searchParams.get('exam_board');
    const examInstitution = searchParams.get('exam_institution');
    const examRegion = searchParams.get('exam_region');

    const db = getDatabase();
    
    // Buscar todas as questões
    const allQuestions = db.prepare('SELECT * FROM questions ORDER BY created_at DESC').all() as any[];
    
    // Filtrar questões que possuem TODAS as tags especificadas (busca booleana AND)
    // e também aplicar filtros de informações da prova
    const filteredQuestions = allQuestions.filter((question: any) => {
      // Filtro de tags
      if (!question.tags) return false;
      
      try {
        const questionTags = JSON.parse(question.tags);
        if (!Array.isArray(questionTags)) return false;
        
        // Verificar se a questão possui TODAS as tags solicitadas
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

      // Filtros de informações da prova
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

    // Converter tags JSON string para array
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
