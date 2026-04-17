/**
 * /api/admin/embed-batch
 *
 * GET  — live progress from both backends (pgvector + Pinecone)
 * POST — starts scripts/batch-embed-questions.mjs as a detached background process
 *
 * pgvector functions used  → lib/embeddings.ts:
 *   ensureEmbeddingColumn, saveQuestionEmbedding, findSimilarQuestions,
 *   semanticSearchQuestions, generateEmbedding, buildQuestionText
 *
 * Pinecone functions used  → lib/pinecone.ts:
 *   upsertQuestionEmbedding, queryPineconeSimilar, getPineconeIndexStats,
 *   getPineconeIndex, isPineconeEnabled
 */

import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { spawn } from 'child_process';
import path from 'path';
import { query } from '@/lib/db';
import {
  isPineconeEnabled,
  getPineconeIndexStats,
  getIndexName,
} from '@/lib/pinecone';

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

// ── GET /api/admin/embed-batch ─────────────────────────────────────────────────
// Returns live progress for pgvector (from DB) and Pinecone (from index stats)
export async function GET(req: NextRequest) {
  const admin = getAdminUser(req);
  if (!admin) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    // pgvector progress — read directly from questions table
    // (uses the `embedding` column added by lib/embeddings.ts:ensureEmbeddingColumn)
    const pgRes = await query(`
      SELECT
        COUNT(*)              AS total,
        COUNT(embedding)      AS with_embedding
      FROM questions
    `);
    const total         = parseInt(pgRes.rows[0].total);
    const withEmbedding = parseInt(pgRes.rows[0].with_embedding);

    // Pinecone stats — via lib/pinecone.ts:getPineconeIndexStats
    type PineconeStatus =
      | { enabled: false }
      | { enabled: true; indexName: string; vectorCount: number; indexFullness: number }
      | { enabled: true; error: string };

    let pinecone: PineconeStatus = { enabled: false };

    if (isPineconeEnabled()) {
      try {
        const stats = await getPineconeIndexStats();
        pinecone = {
          enabled: true,
          indexName: getIndexName(),
          vectorCount: stats.totalVectorCount,
          indexFullness: stats.indexFullness,
        };
      } catch (e) {
        pinecone = { enabled: true, error: String(e) };
      }
    }

    // DeCS stats — decs_descriptors table (may not exist yet)
    let decs = { total: 0, withEmbedding: 0, pending: 0, percent: 0, available: false };
    try {
      const decsRes = await query(`
        SELECT
          COUNT(*)           AS total,
          COUNT(embedding)   AS with_embedding
        FROM decs_descriptors
      `);
      const decsTotal = parseInt(decsRes.rows[0].total);
      const decsEmb   = parseInt(decsRes.rows[0].with_embedding);
      decs = {
        total: decsTotal,
        withEmbedding: decsEmb,
        pending: decsTotal - decsEmb,
        percent: decsTotal > 0 ? Math.round((decsEmb / decsTotal) * 100 * 10) / 10 : 0,
        available: decsTotal > 0,
      };
    } catch {
      // table does not exist yet — silently return zeroes
    }

    return NextResponse.json({
      pgvector: {
        total,
        withEmbedding,
        pending: total - withEmbedding,
        percent: total > 0 ? Math.round((withEmbedding / total) * 100 * 10) / 10 : 0,
      },
      pinecone,
      decs,
    });
  } catch (err) {
    console.error('[embed-batch GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── POST /api/admin/embed-batch ────────────────────────────────────────────────
// Spawns scripts/batch-embed-questions.mjs as a detached background process.
// The script writes to both pgvector and Pinecone (when PINECONE_API_KEY is set).
//
// Body (all optional):
//   concurrency  — parallel Gemini requests (default 3, max 10)
//   delay        — ms between batches (default 350)
//   limit        — process only N questions (0 = all)
//   noResume     — if true, re-embed even questions that already have embeddings
//   pinecone     — if false, skip Pinecone even when key is set (not yet exposed in script)
export async function POST(req: NextRequest) {
  const admin = getAdminUser(req);
  if (!admin) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const concurrency = Math.min(parseInt(body.concurrency ?? '3'), 10);
    const delay       = Math.max(100, parseInt(body.delay ?? '350'));
    const noResume    = body.noResume === true;
    const limit       = Math.max(0, parseInt(body.limit ?? '0'));

    const scriptPath = path.join(process.cwd(), 'scripts/batch-embed-questions.mjs');

    const envFile = path.join(process.cwd(), '.env.local');
    const args: string[] = [
      `--env-file=${envFile}`,   // load .env.local (Node 20+)
      scriptPath,
      '--concurrency', String(concurrency),
      '--delay',       String(delay),
    ];
    if (limit > 0)  args.push('--limit', String(limit));
    if (noResume)   args.push('--no-resume');

    // Spawn detached so it survives the HTTP request lifecycle
    const child = spawn('node', args, {
      detached: true,
      stdio:    ['ignore', 'ignore', 'ignore'],
      env:      { ...process.env },
    });
    child.unref();

    return NextResponse.json({
      started: true,
      pid: child.pid,
      options: { concurrency, delay, limit, noResume },
      backends: isPineconeEnabled() ? ['pgvector', 'pinecone'] : ['pgvector'],
    });
  } catch (err) {
    console.error('[embed-batch POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
