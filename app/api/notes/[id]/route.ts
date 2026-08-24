import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { triggerEnrichment } from '@/lib/enrichment';
import { ensureNoteDeCsColumn, parseNoteAiDeCsDescriptors } from '@/lib/note-decs';

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

    let noteResult;
    if (user.role === 'admin') {
      noteResult = await query(`
        SELECT n.*, u.name as user_name, u.email as user_email, u.role as user_role, c.name as company_name
        FROM notes n
        LEFT JOIN users u ON n.user_id = u.id
        LEFT JOIN companies c ON u.company_id = c.id
        WHERE n.id = $1
      `, [params.id]);
    } else {
      noteResult = await query(`
        SELECT n.*, u.name as user_name, u.email as user_email, u.role as user_role, c.name as company_name
        FROM notes n
        LEFT JOIN users u ON n.user_id = u.id
        LEFT JOIN companies c ON u.company_id = c.id
        WHERE n.id = $1 AND n.user_id = $2
      `, [params.id, user.id]);
    }

    const note = noteResult.rows[0];
    if (!note) {
      return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });
    }

    await ensureNoteDeCsColumn();

    return NextResponse.json({
      ...note,
      tags: note.tags ? JSON.parse(note.tags) : [],
      images: note.images ? JSON.parse(note.images) : [],
      areas_conhecimento: note.areas_conhecimento ? JSON.parse(note.areas_conhecimento) : [],
      assuntos: note.assuntos ? JSON.parse(note.assuntos) : [],
      fontes_arquivos: note.fontes_arquivos ? JSON.parse(note.fontes_arquivos) : [],
      decs_terms: note.decs_terms ?? [],
      ai_decs_descriptors: parseNoteAiDeCsDescriptors(note.ai_decs_descriptors as string | null),
    });
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
    const {
      title,
      description,
      tags,
      images,
      areas_conhecimento,
      assuntos,
      fontes_resumo_melhorado,
      fontes_resumo_original,
      fontes_arquivos,
    } = body;

    if (!title || !description) {
      return NextResponse.json({ error: 'Título e descrição são obrigatórios' }, { status: 400 });
    }

    let noteCheck;
    if (user.role === 'admin') {
      noteCheck = (
        await query(
          `SELECT id, tags, images, areas_conhecimento, assuntos,
                  fontes_resumo_melhorado, fontes_resumo_original, fontes_arquivos
           FROM notes WHERE id = $1`,
          [params.id],
        )
      ).rows[0];
    } else {
      noteCheck = (
        await query(
          `SELECT id, tags, images, areas_conhecimento, assuntos,
                  fontes_resumo_melhorado, fontes_resumo_original, fontes_arquivos
           FROM notes WHERE id = $1 AND user_id = $2`,
          [params.id, user.id],
        )
      ).rows[0];
    }

    if (!noteCheck) {
      return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });
    }

    const hasField = (field: string) => Object.prototype.hasOwnProperty.call(body, field);
    const arrayFields = ['tags', 'images', 'areas_conhecimento', 'assuntos', 'fontes_arquivos'];
    const invalidArrayField = arrayFields.find((field) => hasField(field) && !Array.isArray(body[field]));
    if (invalidArrayField) {
      return NextResponse.json({ error: `O campo "${invalidArrayField}" deve ser uma lista.` }, { status: 400 });
    }

    const arrayJson = (field: string, previousValue: string | null) =>
      hasField(field) ? JSON.stringify(body[field]) : previousValue;
    const tagsJson = arrayJson('tags', noteCheck.tags);
    const imagesJson = arrayJson('images', noteCheck.images);
    const areasConhecimentoJson = arrayJson('areas_conhecimento', noteCheck.areas_conhecimento);
    const assuntosJson = arrayJson('assuntos', noteCheck.assuntos);
    const fontesArquivosJson = arrayJson('fontes_arquivos', noteCheck.fontes_arquivos);
    const fontesResumoMelhorado = hasField('fontes_resumo_melhorado')
      ? fontes_resumo_melhorado ?? null
      : noteCheck.fontes_resumo_melhorado;
    const fontesResumoOriginal = hasField('fontes_resumo_original')
      ? fontes_resumo_original ?? null
      : noteCheck.fontes_resumo_original;

    if (user.role === 'admin') {
      await query(`
        UPDATE notes
        SET title = $1, description = $2, tags = $3, images = $4, areas_conhecimento = $5, assuntos = $6,
            fontes_resumo_melhorado = $7, fontes_resumo_original = $8, fontes_arquivos = $9, updated_at = NOW()
        WHERE id = $10
      `, [title, description, tagsJson, imagesJson, areasConhecimentoJson, assuntosJson, fontesResumoMelhorado, fontesResumoOriginal, fontesArquivosJson, params.id]);
    } else {
      await query(`
        UPDATE notes
        SET title = $1, description = $2, tags = $3, images = $4, areas_conhecimento = $5, assuntos = $6,
            fontes_resumo_melhorado = $7, fontes_resumo_original = $8, fontes_arquivos = $9, updated_at = NOW()
        WHERE id = $10 AND user_id = $11
      `, [title, description, tagsJson, imagesJson, areasConhecimentoJson, assuntosJson, fontesResumoMelhorado, fontesResumoOriginal, fontesArquivosJson, params.id, user.id]);
    }

    triggerEnrichment('note', parseInt(params.id));

    const updatedRow = (await query('SELECT * FROM notes WHERE id = $1', [params.id])).rows[0];
    await ensureNoteDeCsColumn();
    return NextResponse.json({
      ...updatedRow,
      tags: updatedRow.tags ? JSON.parse(updatedRow.tags) : [],
      images: updatedRow.images ? JSON.parse(updatedRow.images) : [],
      areas_conhecimento: updatedRow.areas_conhecimento
        ? JSON.parse(updatedRow.areas_conhecimento)
        : [],
      assuntos: updatedRow.assuntos ? JSON.parse(updatedRow.assuntos) : [],
      fontes_arquivos: updatedRow.fontes_arquivos ? JSON.parse(updatedRow.fontes_arquivos) : [],
      decs_terms: updatedRow.decs_terms ?? [],
      ai_decs_descriptors: parseNoteAiDeCsDescriptors(
        updatedRow.ai_decs_descriptors as string | null,
      ),
    });
  } catch (error) {
    console.error('Erro ao atualizar nota:', error);
    return NextResponse.json({ error: 'Erro ao atualizar nota' }, { status: 500 });
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

    const body = await request.json();
    const { is_favorited } = body;

    if (typeof is_favorited !== 'boolean')
      return NextResponse.json({ error: 'Campo is_favorited deve ser boolean' }, { status: 400 });

    const check = (await query(
      'SELECT id FROM notes WHERE id = $1 AND user_id = $2',
      [params.id, user.id]
    )).rows[0];
    if (!check) return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });

    await query(
      'UPDATE notes SET is_favorited = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
      [is_favorited, params.id, user.id]
    );

    return NextResponse.json({ success: true, is_favorited });
  } catch (error) {
    console.error('Erro ao atualizar favorito:', error);
    return NextResponse.json({ error: 'Erro ao atualizar favorito' }, { status: 500 });
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

    const note = (await query('SELECT id FROM notes WHERE id = $1 AND user_id = $2', [params.id, user.id])).rows[0];
    if (!note) {
      return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });
    }

    await query('DELETE FROM notes WHERE id = $1 AND user_id = $2', [params.id, user.id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar nota:', error);
    return NextResponse.json({ error: 'Erro ao deletar nota' }, { status: 500 });
  }
}
