import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { query } from '@/lib/db';
import {
  ensureEmbeddingColumn,
  ensureEmbeddingIndex,
  buildQuestionText,
  generateEmbedding,
  saveQuestionEmbedding,
  getQuestionEmbedding,
} from '@/lib/embeddings';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

function getAdminUser(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { role?: string };
    if (payload.role !== 'admin') return null;
    return payload;
  } catch {
    return null;
  }
}

// GET /api/questions/[id]/embedding — check if question has an embedding
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const embedding = await getQuestionEmbedding(parseInt(id));
    return NextResponse.json({ hasEmbedding: embedding !== null });
  } catch (err) {
    console.error('[embedding GET]', err);
    return NextResponse.json({ error: 'Erro ao verificar embedding' }, { status: 500 });
  }
}

// POST /api/questions/[id]/embedding — generate and save embedding (admin only)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = getAdminUser(req);
  if (!admin) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    const { id } = await params;
    const questionId = parseInt(id);

    // Ensure schema is ready
    await ensureEmbeddingColumn();

    const res = await query(
      `SELECT statement, option_a, option_b, option_c, option_d, option_e,
              tags, areas_conhecimento, assuntos, decs_terms
       FROM questions WHERE id = $1`,
      [questionId]
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }

    const q = res.rows[0];
    const text = buildQuestionText(q);
    const embedding = await generateEmbedding(text);
    await saveQuestionEmbedding(questionId, embedding);

    // Try to create index (idempotent)
    try { await ensureEmbeddingIndex(); } catch {}

    return NextResponse.json({ success: true, dimensions: embedding.length });
  } catch (err) {
    console.error('[embedding POST]', err);
    return NextResponse.json({ error: 'Erro ao gerar embedding' }, { status: 500 });
  }
}
