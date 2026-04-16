import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { isPineconeEnabled, getPineconeIndexStats, getIndexName } from '@/lib/pinecone';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

function getAdminUser(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { role?: string };
    return payload.role === 'admin' ? payload : null;
  } catch {
    return null;
  }
}

// GET /api/pinecone/status — returns Pinecone index stats (admin only)
export async function GET(req: NextRequest) {
  const admin = getAdminUser(req);
  if (!admin) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  if (!isPineconeEnabled()) {
    return NextResponse.json({
      enabled: false,
      message: 'PINECONE_API_KEY não configurada. Adicione a chave ao .env.local.',
    });
  }

  try {
    const stats = await getPineconeIndexStats();
    return NextResponse.json({
      enabled: true,
      indexName: getIndexName(),
      totalVectorCount: stats.totalVectorCount,
      dimension: stats.dimension,
      indexFullness: stats.indexFullness,
    });
  } catch (err) {
    console.error('[pinecone/status]', err);
    return NextResponse.json(
      { enabled: true, error: 'Erro ao consultar Pinecone', detail: String(err) },
      { status: 500 }
    );
  }
}
