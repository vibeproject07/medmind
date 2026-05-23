import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { findSimilarNotes } from '@/lib/embeddings';
import { findSimilarByTerms } from '@/lib/term-similarity';

export const runtime = 'nodejs';

type NoteRow = {
  id: number;
  title: string;
  description: string;
  tags: string[];
  areas_conhecimento: string[];
  similarity: number;
  score?: number;
  primary_matches?: number;
  secondary_matches?: number;
};

type QuestionRow = {
  id: number;
  statement: string;
  tags: string[];
  areas_conhecimento: string[];
  exam_year: number | null;
  exam_board: string | null;
  exam_institution: string | null;
  similarity: number;
  score?: number;
  primary_matches?: number;
  secondary_matches?: number;
};

function mapNoteRows(rows: { id: number; title: string; description: string; tags: string | null; areas_conhecimento: string | null; similarity: number }[]): NoteRow[] {
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    tags: r.tags ? JSON.parse(r.tags) : [],
    areas_conhecimento: r.areas_conhecimento ? JSON.parse(r.areas_conhecimento) : [],
    similarity: parseFloat(String(r.similarity)),
  }));
}

function mapQuestionRows(rows: {
  id: number;
  statement: string;
  tags: string | null;
  areas_conhecimento: string | null;
  exam_year: number | null;
  exam_board: string | null;
  exam_institution: string | null;
  similarity: number;
}[]): QuestionRow[] {
  return rows.map((r) => ({
    id: r.id,
    statement: r.statement,
    tags: r.tags ? JSON.parse(r.tags) : [],
    areas_conhecimento: r.areas_conhecimento ? JSON.parse(r.areas_conhecimento) : [],
    exam_year: r.exam_year,
    exam_board: r.exam_board,
    exam_institution: r.exam_institution,
    similarity: parseFloat(String(r.similarity)),
  }));
}

async function fetchNotesByVector(noteId: number, limit: number): Promise<{ items: NoteRow[]; backend: string }> {
  const similarNotes = await query(
    `SELECT
       cl.target_id AS id,
       cl.similarity,
       n.title,
       n.description,
       n.tags,
       n.areas_conhecimento
     FROM content_links cl
     JOIN notes n ON n.id = cl.target_id
     WHERE cl.source_type = 'note'
       AND cl.source_id = $1
       AND cl.target_type = 'note'
       AND cl.similarity >= 0.70
     ORDER BY cl.similarity DESC
     LIMIT $2`,
    [noteId, limit],
  );

  if (similarNotes.rows.length > 0) {
    return { items: mapNoteRows(similarNotes.rows as Parameters<typeof mapNoteRows>[0]), backend: 'content_links' };
  }

  const live = await findSimilarNotes(noteId, limit);
  if (live.length > 0) {
    return { items: live, backend: 'pgvector' };
  }

  return { items: [], backend: 'none' };
}

async function fetchQuestionsByVector(noteId: number, limit: number): Promise<{ items: QuestionRow[]; backend: string }> {
  const similarQuestions = await query(
    `SELECT
       cl.target_id AS id,
       cl.similarity,
       q.statement,
       q.tags,
       q.areas_conhecimento,
       q.exam_year,
       q.exam_board,
       q.exam_institution
     FROM content_links cl
     JOIN questions q ON q.id = cl.target_id
     WHERE cl.source_type = 'note'
       AND cl.source_id = $1
       AND cl.target_type = 'question'
       AND cl.similarity >= 0.70
     ORDER BY cl.similarity DESC
     LIMIT $2`,
    [noteId, limit],
  );

  if (similarQuestions.rows.length > 0) {
    return {
      items: mapQuestionRows(similarQuestions.rows as Parameters<typeof mapQuestionRows>[0]),
      backend: 'content_links',
    };
  }

  return { items: [], backend: 'none' };
}

async function fetchNotesByTerms(noteId: number, limit: number): Promise<NoteRow[]> {
  const termHits = await findSimilarByTerms('note', noteId, 'note', limit);
  if (termHits.length === 0) return [];

  const ids = termHits.map((h) => h.target_id);
  const dbRes = await query(
    `SELECT id, title, description, tags, areas_conhecimento FROM notes WHERE id = ANY($1)`,
    [ids],
  );
  const byId = new Map(dbRes.rows.map((r) => [r.id as number, r]));

  return termHits
    .map((h) => {
      const row = byId.get(h.target_id);
      if (!row) return null;
      return {
        id: h.target_id,
        title: row.title as string,
        description: row.description as string,
        tags: row.tags ? JSON.parse(row.tags as string) : [],
        areas_conhecimento: row.areas_conhecimento ? JSON.parse(row.areas_conhecimento as string) : [],
        similarity: h.score / 100,
        score: h.score,
        primary_matches: h.primary_matches,
        secondary_matches: h.secondary_matches,
      };
    })
    .filter(Boolean) as NoteRow[];
}

async function fetchQuestionsByTerms(noteId: number, limit: number): Promise<QuestionRow[]> {
  const termHits = await findSimilarByTerms('note', noteId, 'question', limit);
  if (termHits.length === 0) return [];

  const ids = termHits.map((h) => h.target_id);
  const dbRes = await query(
    `SELECT id, statement, tags, areas_conhecimento, exam_year, exam_board, exam_institution
     FROM questions WHERE id = ANY($1)`,
    [ids],
  );
  const byId = new Map(dbRes.rows.map((r) => [r.id as number, r]));

  return termHits
    .map((h) => {
      const row = byId.get(h.target_id);
      if (!row) return null;
      return {
        id: h.target_id,
        statement: row.statement as string,
        tags: row.tags ? JSON.parse(row.tags as string) : [],
        areas_conhecimento: row.areas_conhecimento ? JSON.parse(row.areas_conhecimento as string) : [],
        exam_year: row.exam_year as number | null,
        exam_board: row.exam_board as string | null,
        exam_institution: row.exam_institution as string | null,
        similarity: h.score / 100,
        score: h.score,
        primary_matches: h.primary_matches,
        secondary_matches: h.secondary_matches,
      };
    })
    .filter(Boolean) as QuestionRow[];
}

// GET /api/notes/[id]/similar?limit=5
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authHeader = req.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
    if (token) token = token.trim().replace(/^["']|["']$/g, '');
    if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const user = verifyToken(token);
    if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });

    const { id } = await params;
    const noteId = parseInt(id);
    if (isNaN(noteId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

    const noteCheck = await query(`SELECT user_id FROM notes WHERE id = $1`, [noteId]);
    if (noteCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });
    }
    const noteOwnerId = noteCheck.rows[0].user_id;
    if (user.role !== 'admin' && noteOwnerId !== user.id) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '5'), 20);

    const [notesVector, notesTerms, questionsVector, questionsTerms] = await Promise.all([
      fetchNotesByVector(noteId, limit),
      fetchNotesByTerms(noteId, limit),
      fetchQuestionsByVector(noteId, limit),
      fetchQuestionsByTerms(noteId, limit),
    ]);

    return NextResponse.json({
      notesByVector: notesVector.items,
      notesByTerms: notesTerms,
      questionsByVector: questionsVector.items,
      questionsByTerms: questionsTerms,
      // Retrocompatibilidade
      notes: notesVector.items,
      questions: [...questionsVector.items, ...questionsTerms],
      backend: {
        notesVector: notesVector.backend,
        notesTerms: notesTerms.length > 0 ? 'term_similarity' : 'none',
        questionsVector: questionsVector.backend,
        questionsTerms: questionsTerms.length > 0 ? 'term_similarity' : 'none',
      },
    });
  } catch (err) {
    console.error('[notes/similar GET]', err);
    return NextResponse.json({ error: 'Erro ao buscar conteúdo similar' }, { status: 500 });
  }
}
