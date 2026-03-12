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

    const db = getDatabase();
    
    // Obter parâmetros de filtro e paginação da query string
    const { searchParams } = new URL(request.url);
    const filterRole = searchParams.get('role');
    const filterCompanyId = searchParams.get('company_id');
    const filterTags = searchParams.get('tags'); // Tags separadas por vírgula
    const filterAreasConhecimento = searchParams.get('areas_conhecimento');
    const filterAssuntos = searchParams.get('assuntos');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '15', 10)));
    const isAdmin = user.role === 'admin';

    let query = '';
    let params: any[] = [];

    if (isAdmin) {
      // Admin pode ver todas as notas com filtros opcionais
      query = `
        SELECT 
          n.id, 
          n.title, 
          n.description, 
          n.tags,
          n.images,
          n.areas_conhecimento,
          n.assuntos,
          n.created_at, 
          n.updated_at,
          n.user_id,
          u.name as user_name,
          u.email as user_email,
          u.role as user_role,
          u.company_id,
          c.name as company_name
        FROM notes n
        LEFT JOIN users u ON n.user_id = u.id
        LEFT JOIN companies c ON u.company_id = c.id
        WHERE 1=1
      `;

      if (filterRole) {
        query += ' AND u.role = ?';
        params.push(filterRole);
      }

      if (filterCompanyId) {
        query += ' AND u.company_id = ?';
        params.push(parseInt(filterCompanyId));
      }

      query += ' ORDER BY n.created_at DESC';
    } else {
      // Usuários regulares e managers veem apenas suas próprias notas
      query = `
        SELECT 
          n.id, 
          n.title, 
          n.description, 
          n.tags,
          n.images,
          n.areas_conhecimento,
          n.assuntos,
          n.created_at, 
          n.updated_at,
          n.user_id,
          u.name as user_name,
          u.email as user_email,
          u.role as user_role,
          u.company_id,
          c.name as company_name
        FROM notes n
        LEFT JOIN users u ON n.user_id = u.id
        LEFT JOIN companies c ON u.company_id = c.id
        WHERE n.user_id = ?
        ORDER BY n.created_at DESC
      `;
      params.push(user.id);
    }

    const notes = db.prepare(query).all(...params);

    // Converter tags, images, areas_conhecimento e assuntos JSON string para array
    let notesWithTags = notes.map((note: any) => ({
      id: note.id,
      title: note.title,
      description: note.description,
      tags: note.tags ? JSON.parse(note.tags) : [],
      images: note.images ? JSON.parse(note.images) : [],
      areas_conhecimento: note.areas_conhecimento ? JSON.parse(note.areas_conhecimento) : [],
      assuntos: note.assuntos ? JSON.parse(note.assuntos) : [],
      created_at: note.created_at,
      updated_at: note.updated_at,
      user_id: note.user_id,
      user_name: note.user_name,
      user_email: note.user_email,
      user_role: note.user_role,
      company_id: note.company_id,
      company_name: note.company_name,
    }));

    // Aplicar filtro de tags se fornecido
    if (filterTags) {
      const filterTagsArray = filterTags.split(',').map(tag => tag.trim()).filter(tag => tag);
      if (filterTagsArray.length > 0) {
        notesWithTags = notesWithTags.filter((note: any) => {
          return filterTagsArray.some(filterTag => 
            note.tags.some((noteTag: string) => 
              noteTag.toLowerCase().includes(filterTag.toLowerCase()) ||
              filterTag.toLowerCase().includes(noteTag.toLowerCase())
            )
          );
        });
      }
    }

    // Aplicar filtro de áreas do conhecimento se fornecido
    if (filterAreasConhecimento) {
      const filterArray = filterAreasConhecimento.split(',').map(tag => tag.trim()).filter(tag => tag);
      if (filterArray.length > 0) {
        notesWithTags = notesWithTags.filter((note: any) => {
          const areas = note.areas_conhecimento || [];
          return filterArray.some(filterTag => 
            areas.some((area: string) => 
              area.toLowerCase().includes(filterTag.toLowerCase()) ||
              filterTag.toLowerCase().includes(area.toLowerCase())
            )
          );
        });
      }
    }

    // Aplicar filtro de assuntos se fornecido
    if (filterAssuntos) {
      const filterArray = filterAssuntos.split(',').map(tag => tag.trim()).filter(tag => tag);
      if (filterArray.length > 0) {
        notesWithTags = notesWithTags.filter((note: any) => {
          const assuntos = note.assuntos || [];
          return filterArray.some(filterTag => 
            assuntos.some((assunto: string) => 
              assunto.toLowerCase().includes(filterTag.toLowerCase()) ||
              filterTag.toLowerCase().includes(assunto.toLowerCase())
            )
          );
        });
      }
    }

    const total = notesWithTags.length;
    const offset = (page - 1) * limit;
    const paginatedNotes = notesWithTags.slice(offset, offset + limit);

    return NextResponse.json({ notes: paginatedNotes, total });
  } catch (error) {
    console.error('Erro ao buscar notas:', error);
    return NextResponse.json({ error: 'Erro ao buscar notas' }, { status: 500 });
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

    const body = await request.json();
    const { title, description, tags, images, areas_conhecimento, assuntos, question_ids, fontes_resumo_melhorado, fontes_resumo_original, fontes_arquivos } = body;

    if (!title || !description) {
      return NextResponse.json({ error: 'Título e descrição são obrigatórios' }, { status: 400 });
    }

    // Converter tags array para JSON string
    const tagsJson = tags && Array.isArray(tags) ? JSON.stringify(tags) : null;
    // Converter images array para JSON string
    const imagesJson = images && Array.isArray(images) ? JSON.stringify(images) : null;
    const areasConhecimentoJson = areas_conhecimento && Array.isArray(areas_conhecimento) ? JSON.stringify(areas_conhecimento) : null;
    const assuntosJson = assuntos && Array.isArray(assuntos) ? JSON.stringify(assuntos) : null;
    const fontesArquivosJson = fontes_arquivos && Array.isArray(fontes_arquivos) ? JSON.stringify(fontes_arquivos) : null;

    const db = getDatabase();
    const result = db.prepare(`
      INSERT INTO notes (user_id, title, description, tags, images, areas_conhecimento, assuntos, fontes_resumo_melhorado, fontes_resumo_original, fontes_arquivos)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, title, description, tagsJson, imagesJson, areasConhecimentoJson, assuntosJson, fontes_resumo_melhorado ?? null, fontes_resumo_original ?? null, fontesArquivosJson);

    const noteId = result.lastInsertRowid;

    // Associar questões à nota se fornecidas
    if (question_ids && Array.isArray(question_ids) && question_ids.length > 0) {
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
    }

    const newNote = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);

    return NextResponse.json(newNote, { status: 201 });
  } catch (error) {
    console.error('Erro ao criar nota:', error);
    return NextResponse.json({ error: 'Erro ao criar nota' }, { status: 500 });
  }
}
