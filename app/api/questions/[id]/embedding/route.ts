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
import {
  isPineconeEnabled,
  upsertQuestionEmbedding,
} from '@/lib/pinecone';

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

// GET /api/questions/[id]/embedding
// Returns: { hasEmbedding: boolean, backend: 'pinecone' | 'pgvector' | 'none' }
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const questionId = parseInt(id);

    if (isPineconeEnabled()) {
      // Check pgvector column as a quick proxy (Pinecone doesn't have cheap "exists" checks)
      // We'll rely on the pgvector flag even when Pinecone is primary
      const embedding = await getQuestionEmbedding(questionId);
      return NextResponse.json({
        hasEmbedding: embedding !== null,
        backend: embedding !== null ? 'pinecone' : 'none',
      });
    }

    const embedding = await getQuestionEmbedding(questionId);
    return NextResponse.json({
      hasEmbedding: embedding !== null,
      backend: embedding !== null ? 'pgvector' : 'none',
    });
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

    // Ensure pgvector schema is ready (always — used as local cache)
    await ensureEmbeddingColumn();

    const res = await query(
      `SELECT statement, option_a, option_b, option_c, option_d, option_e,
              tags, areas_conhecimento, assuntos, decs_terms,
              exam_year, exam_board, exam_institution
       FROM questions WHERE id = $1`,
      [questionId]
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }

    const q = res.rows[0];
    const text = buildQuestionText(q);
    const embedding = await generateEmbedding(text);

    // Always save to pgvector (local cache + fallback)
    await saveQuestionEmbedding(questionId, embedding);
    try { await ensureEmbeddingIndex(); } catch {}

    // Also upsert to Pinecone if configured
    if (isPineconeEnabled()) {
      await upsertQuestionEmbedding(questionId, embedding, {
        statement: q.statement,
        exam_year: q.exam_year,
        exam_board: q.exam_board,
        exam_institution: q.exam_institution,
        tags: q.tags,
        areas_conhecimento: q.areas_conhecimento,
      });
    }

    return NextResponse.json({
      success: true,
      dimensions: embedding.length,
      backend: isPineconeEnabled() ? 'pinecone+pgvector' : 'pgvector',
    });
  } catch (err) {
    console.error('[embedding POST]', err);
    return NextResponse.json({ error: 'Erro ao gerar embedding' }, { status: 500 });
  }
}
