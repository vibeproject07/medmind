import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { triggerEnrichment } from '@/lib/enrichment';

export const runtime = 'nodejs';

const WELCOME_TITLE = 'Bem-vindo ao sistema de notas';
const WELCOME_DESCRIPTION = `Esta é sua primeira nota no MedMind. Use este espaço para organizar seus estudos de medicina de forma prática e eficiente.

Como usar as notas:
- Crie notas para cada tema, caso clínico ou assunto de estudo
- Classifique por área de conhecimento e especialidade para encontrar tudo facilmente
- Vincule questões do banco às suas notas para consolidar o aprendizado
- Use a busca para localizar qualquer nota pelo conteúdo, título ou especialidade
- Favorite as notas mais importantes — elas ficam fixadas no topo da página

Dica: clique em qualquer card para abrir a nota completa, ou use o menu (três pontos) para editar ou excluir.`;

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    if (token) token = token.trim().replace(/^["']|["']$/g, '');
    if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const user = verifyToken(token);
    if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const filterRole      = searchParams.get('role');
    const filterCompanyId = searchParams.get('company_id');
    const page  = Math.max(1, parseInt(searchParams.get('page')  || '1',  10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const isAdmin = user.role === 'admin';

    const rawQ  = searchParams.get('q')?.trim() || '';
    const tokens = rawQ
      ? rawQ.split(/\s+/).filter(t => t.length >= 1).slice(0, 10)
      : [];

    // ── Base SQL ──────────────────────────────────────────────────────────
    const params: any[] = [];
    let paramIdx = 1;
    let baseSelect: string;
    let baseWhere: string;

    if (isAdmin) {
      baseSelect = `
        SELECT n.id, n.title, n.description, n.tags, n.images,
               n.areas_conhecimento, n.assuntos, n.is_favorited, n.is_system,
               n.created_at, n.updated_at, n.user_id,
               u.name  AS user_name,  u.email AS user_email,
               u.role  AS user_role,  u.company_id,
               c.name  AS company_name
        FROM notes n
        LEFT JOIN users     u ON n.user_id    = u.id
        LEFT JOIN companies c ON u.company_id = c.id
        WHERE 1=1
      `;
      baseWhere = '';
      if (filterRole)      { baseWhere += ` AND u.role = $${paramIdx++}`;            params.push(filterRole); }
      if (filterCompanyId) { baseWhere += ` AND u.company_id = $${paramIdx++}`;      params.push(parseInt(filterCompanyId)); }
    } else {
      baseSelect = `
        SELECT n.id, n.title, n.description, n.tags, n.images,
               n.areas_conhecimento, n.assuntos, n.is_favorited, n.is_system,
               n.created_at, n.updated_at, n.user_id,
               u.name  AS user_name,  u.email AS user_email,
               u.role  AS user_role,  u.company_id,
               c.name  AS company_name
        FROM notes n
        LEFT JOIN users     u ON n.user_id    = u.id
        LEFT JOIN companies c ON u.company_id = c.id
        WHERE n.user_id = $${paramIdx++}
      `;
      baseWhere = '';
      params.push(user.id);
    }

    // ── Token search ──────────────────────────────────────────────────────
    let tokenWhere = '';
    let scoreExpr  = '0';

    if (tokens.length > 0) {
      const tokenClauses:    string[] = [];
      const scoreComponents: string[] = [];

      for (const tok of tokens) {
        const p = paramIdx++;
        params.push(`%${tok.toLowerCase()}%`);

        tokenClauses.push(`(
          LOWER(n.title)                            LIKE $${p} OR
          LOWER(n.description)                      LIKE $${p} OR
          LOWER(COALESCE(n.tags,              ''))  LIKE $${p} OR
          LOWER(COALESCE(n.areas_conhecimento,''))  LIKE $${p} OR
          LOWER(COALESCE(n.assuntos,          ''))  LIKE $${p}
        )`);

        scoreComponents.push(`
          CASE WHEN LOWER(n.title)                            LIKE $${p} THEN 4 ELSE 0 END +
          CASE WHEN LOWER(COALESCE(n.tags,             ''))  LIKE $${p} THEN 3 ELSE 0 END +
          CASE WHEN LOWER(COALESCE(n.areas_conhecimento,'')) LIKE $${p} THEN 3 ELSE 0 END +
          CASE WHEN LOWER(COALESCE(n.assuntos,         ''))  LIKE $${p} THEN 3 ELSE 0 END +
          CASE WHEN LOWER(n.description)                      LIKE $${p} THEN 1 ELSE 0 END
        `);
      }
      tokenWhere = ` AND (${tokenClauses.join(' OR ')})`;
      scoreExpr  = scoreComponents.join(' + ');
    }

    const orderBy = tokens.length > 0
      ? `ORDER BY (${scoreExpr}) DESC, n.is_favorited DESC, n.created_at DESC`
      : `ORDER BY n.is_favorited DESC, n.created_at DESC`;

    const sql  = `${baseSelect}${baseWhere}${tokenWhere} ${orderBy}`;
    const rows = (await query(sql, params)).rows;

    const notes = rows.map((note: any) => ({
      id:                 note.id,
      title:              note.title,
      description:        note.description,
      tags:               note.tags               ? JSON.parse(note.tags)               : [],
      images:             note.images             ? JSON.parse(note.images)             : [],
      areas_conhecimento: note.areas_conhecimento ? JSON.parse(note.areas_conhecimento) : [],
      assuntos:           note.assuntos           ? JSON.parse(note.assuntos)           : [],
      is_favorited:       note.is_favorited       ?? false,
      is_system:          note.is_system          ?? false,
      created_at:         note.created_at,
      updated_at:         note.updated_at,
      user_id:            note.user_id,
      user_name:          note.user_name,
      user_email:         note.user_email,
      user_role:          note.user_role,
      company_id:         note.company_id,
      company_name:       note.company_name,
    }));

    // ── Auto-seed welcome note for new (non-admin) users ─────────────────
    if (!isAdmin && notes.length === 0 && !rawQ && !filterRole && !filterCompanyId) {
      const ins = await query(
        `INSERT INTO notes (user_id, title, description, tags, is_system)
         VALUES ($1, $2, $3, $4, true) RETURNING *`,
        [user.id, WELCOME_TITLE, WELCOME_DESCRIPTION, JSON.stringify(['Tutorial'])],
      );
      const w = ins.rows[0];
      return NextResponse.json({
        notes: [{
          id: w.id, title: w.title, description: w.description,
          tags: ['Tutorial'], images: [], areas_conhecimento: [], assuntos: [],
          is_favorited: false, is_system: true,
          created_at: w.created_at, updated_at: w.updated_at, user_id: w.user_id,
          user_name: null, user_email: null, user_role: null, company_id: null, company_name: null,
        }],
        total: 1,
      });
    }

    const total          = notes.length;
    const offset         = (page - 1) * limit;
    const paginatedNotes = notes.slice(offset, offset + limit);

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
    if (token) token = token.trim().replace(/^["']|["']$/g, '');
    if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const user = verifyToken(token);
    if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });

    const body = await request.json();
    const { title, description, tags, images, areas_conhecimento, assuntos,
            question_ids, fontes_resumo_melhorado, fontes_resumo_original, fontes_arquivos } = body;

    if (!title || !description)
      return NextResponse.json({ error: 'Título e descrição são obrigatórios' }, { status: 400 });

    const tagsJson              = tags               && Array.isArray(tags)               ? JSON.stringify(tags)               : null;
    const imagesJson            = images             && Array.isArray(images)             ? JSON.stringify(images)             : null;
    const areasConhecimentoJson = areas_conhecimento && Array.isArray(areas_conhecimento) ? JSON.stringify(areas_conhecimento) : null;
    const assuntosJson          = assuntos           && Array.isArray(assuntos)           ? JSON.stringify(assuntos)           : null;
    const fontesArquivosJson    = fontes_arquivos    && Array.isArray(fontes_arquivos)    ? JSON.stringify(fontes_arquivos)    : null;

    const result = await query(
      `INSERT INTO notes (user_id, title, description, tags, images, areas_conhecimento, assuntos,
                          fontes_resumo_melhorado, fontes_resumo_original, fontes_arquivos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [user.id, title, description, tagsJson, imagesJson, areasConhecimentoJson, assuntosJson,
       fontes_resumo_melhorado ?? null, fontes_resumo_original ?? null, fontesArquivosJson],
    );

    const noteId = result.rows[0].id;
    triggerEnrichment('note', noteId);

    if (question_ids && Array.isArray(question_ids) && question_ids.length > 0) {
      for (const questionId of question_ids) {
        const exists = (await query('SELECT id FROM questions WHERE id = $1', [questionId])).rows[0];
        if (exists) {
          try { await query('INSERT INTO note_questions (note_id, question_id) VALUES ($1,$2)', [noteId, questionId]); }
          catch { /* ignore duplicates */ }
        }
      }
    }

    const newNote = (await query('SELECT * FROM notes WHERE id = $1', [noteId])).rows[0];
    return NextResponse.json(newNote, { status: 201 });
  } catch (error) {
    console.error('Erro ao criar nota:', error);
    return NextResponse.json({ error: 'Erro ao criar nota' }, { status: 500 });
  }
}
