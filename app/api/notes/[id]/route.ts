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

    const db = getDatabase();
    
    // Buscar a nota
    let note;
    if (user.role === 'admin') {
      // Admin pode ver qualquer nota
      note = db.prepare(`
        SELECT n.*, u.name as user_name, u.email as user_email, u.role as user_role, 
               c.name as company_name
        FROM notes n
        LEFT JOIN users u ON n.user_id = u.id
        LEFT JOIN companies c ON u.company_id = c.id
        WHERE n.id = ?
      `).get(params.id);
    } else {
      // Usuários regulares só podem ver suas próprias notas
      note = db.prepare(`
        SELECT n.*, u.name as user_name, u.email as user_email, u.role as user_role, 
               c.name as company_name
        FROM notes n
        LEFT JOIN users u ON n.user_id = u.id
        LEFT JOIN companies c ON u.company_id = c.id
        WHERE n.id = ? AND n.user_id = ?
      `).get(params.id, user.id);
    }

    if (!note) {
      return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });
    }

    // Converter tags, images, areas_conhecimento, assuntos e fontes_arquivos JSON string para array
    const noteWithTags = {
      ...note,
      tags: (note as any).tags ? JSON.parse((note as any).tags) : [],
      images: (note as any).images ? JSON.parse((note as any).images) : [],
      areas_conhecimento: (note as any).areas_conhecimento ? JSON.parse((note as any).areas_conhecimento) : [],
      assuntos: (note as any).assuntos ? JSON.parse((note as any).assuntos) : [],
      fontes_arquivos: (note as any).fontes_arquivos ? JSON.parse((note as any).fontes_arquivos) : [],
    };

    return NextResponse.json(noteWithTags);
  } catch (error) {
    console.error('Erro ao buscar nota:', error);
    return NextResponse.json({ error: 'Erro ao buscar nota' }, { status: 500 });
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

    const body = await request.json();
    const { title, description, tags, images, areas_conhecimento, assuntos, fontes_resumo_melhorado, fontes_resumo_original, fontes_arquivos } = body;

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
    
    // Verificar se a nota existe e pertence ao usuário (ou se é admin)
    let note;
    if (user.role === 'admin') {
      note = db.prepare('SELECT * FROM notes WHERE id = ?').get(params.id);
    } else {
      note = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(params.id, user.id);
    }
    
    if (!note) {
      return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });
    }

    // Atualizar a nota
    if (user.role === 'admin') {
      db.prepare(`
        UPDATE notes
        SET title = ?, description = ?, tags = ?, images = ?, areas_conhecimento = ?, assuntos = ?,
            fontes_resumo_melhorado = ?, fontes_resumo_original = ?, fontes_arquivos = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(title, description, tagsJson, imagesJson, areasConhecimentoJson, assuntosJson, fontes_resumo_melhorado ?? null, fontes_resumo_original ?? null, fontesArquivosJson, params.id);
    } else {
      db.prepare(`
        UPDATE notes
        SET title = ?, description = ?, tags = ?, images = ?, areas_conhecimento = ?, assuntos = ?,
            fontes_resumo_melhorado = ?, fontes_resumo_original = ?, fontes_arquivos = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `).run(title, description, tagsJson, imagesJson, areasConhecimentoJson, assuntosJson, fontes_resumo_melhorado ?? null, fontes_resumo_original ?? null, fontesArquivosJson, params.id, user.id);
    }

    const updatedRow = db.prepare('SELECT * FROM notes WHERE id = ?').get(params.id) as any;
    const updatedNote = {
      ...updatedRow,
      tags: updatedRow.tags ? JSON.parse(updatedRow.tags) : [],
      images: updatedRow.images ? JSON.parse(updatedRow.images) : [],
      areas_conhecimento: updatedRow.areas_conhecimento ? JSON.parse(updatedRow.areas_conhecimento) : [],
      assuntos: updatedRow.assuntos ? JSON.parse(updatedRow.assuntos) : [],
      fontes_arquivos: updatedRow.fontes_arquivos ? JSON.parse(updatedRow.fontes_arquivos) : [],
    };

    return NextResponse.json(updatedNote);
  } catch (error) {
    console.error('Erro ao atualizar nota:', error);
    return NextResponse.json({ error: 'Erro ao atualizar nota' }, { status: 500 });
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

    const db = getDatabase();
    
    // Verificar se a nota existe e pertence ao usuário
    const note = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(params.id, user.id);
    if (!note) {
      return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });
    }

    // Deletar a nota
    db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(params.id, user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar nota:', error);
    return NextResponse.json({ error: 'Erro ao deletar nota' }, { status: 500 });
  }
}
