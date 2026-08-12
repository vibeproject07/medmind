/**
 * Admin: DeCS Pipeline A/B Test — Batch processing and stats
 *
 * GET  /api/admin/decs-batch-test          — progress + comparison stats
 * POST /api/admin/decs-batch-test          — run next batch {batch_size}
 * DELETE /api/admin/decs-batch-test        — reset all test results
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { runDeCSPipeline, buildDeCSQuestionText, type DeCSThemes } from '@/lib/decs-pipeline';
import { runDeCSPipelineV2 } from '@/lib/decs-pipeline-v2';

export const runtime = 'nodejs';
export const maxDuration = 120;

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TEST_LIMIT = 100;

// ── Table setup ────────────────────────────────────────────────────────────────

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS decs_test_runs (
      question_id   INTEGER PRIMARY KEY,
      v1_status     TEXT    NOT NULL DEFAULT 'pending',
      v1_primary    INTEGER NOT NULL DEFAULT 0,
      v1_secondary  INTEGER NOT NULL DEFAULT 0,
      v1_time_ms    INTEGER,
      v1_error      TEXT,
      v2_status     TEXT    NOT NULL DEFAULT 'pending',
      v2_primary    INTEGER NOT NULL DEFAULT 0,
      v2_secondary  INTEGER NOT NULL DEFAULT 0,
      v2_time_ms    INTEGER,
      v2_error      TEXT,
      overlap_count INTEGER NOT NULL DEFAULT 0,
      tested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_decs_v2 TEXT`);
}

// ── Auth helper ────────────────────────────────────────────────────────────────

function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  if (!token) return null;
  return verifyToken(token);
}

// ── Question text builder ──────────────────────────────────────────────────────

function buildQuestionText(q: Record<string, unknown>): string {
  return buildDeCSQuestionText({
    statement: q.statement as string,
    option_a: q.option_a as string,
    option_b: q.option_b as string,
    option_c: q.option_c as string | null,
    option_d: q.option_d as string | null,
    option_e: q.option_e as string | null,
    correct_answer: q.correct_answer as string | null,
  });
}

// ── V1 full pipeline (theme extraction + runDeCSPipeline) ─────────────────────

async function runV1Full(
  questionText: string,
  decsKey: string,
  geminiKey: string,
  images?: unknown,
) {
  const { getRuntimeAgent } = await import('@/lib/ai-agent-runtime');
  const { buildGeminiRestUserParts } = await import('@/lib/gemini-question-images');
  const classifierAgent = await getRuntimeAgent('decs_classifier');
  const url = `${GEMINI_BASE}/${classifierAgent.model}:generateContent?key=${geminiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: classifierAgent.system_instruction }] },
      contents: [
        {
          role: 'user',
          parts: buildGeminiRestUserParts(questionText, images),
        },
      ],
      generationConfig: {
        temperature: classifierAgent.temperature,
        maxOutputTokens: classifierAgent.max_output_tokens,
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini V1 step1 failed: ${res.status}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as any;
  const rawText: string =
    data?.candidates?.[0]?.content?.parts
      ?.filter((p: Record<string, unknown>) => !p?.thought)
      ?.map((p: Record<string, unknown>) => p?.text).filter(Boolean).join('') ?? '';
  const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(cleaned);

  let themes: DeCSThemes = { primary: [], secondary: [] };
  if (Array.isArray(parsed)) {
    themes.primary = parsed.filter((t) => typeof t === 'string').slice(0, 3);
  } else if (parsed && typeof parsed === 'object') {
    themes.primary = (Array.isArray(parsed.primary) ? parsed.primary : [])
      .filter((t: unknown) => typeof t === 'string').slice(0, 3) as string[];
    themes.secondary = (Array.isArray(parsed.secondary) ? parsed.secondary : [])
      .filter((t: unknown) => typeof t === 'string').slice(0, 6) as string[];
  }

  if (themes.primary.length === 0) throw new Error('V1: nenhum tema extraído');
  const { descriptors } = await runDeCSPipeline(
    themes,
    questionText,
    decsKey,
    geminiKey,
    classifierAgent.model,
  );
  return descriptors;
}

// ── Delay ─────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── GET — status and stats ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const user = getUser(req);
  if (!user || user.role !== 'admin')
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  await ensureTable();

  const testQuestionsRes = await query(
    `SELECT id FROM questions ORDER BY created_at DESC LIMIT $1`,
    [TEST_LIMIT]
  );
  const testIds = testQuestionsRes.rows.map((r) => r.id as number);
  if (testIds.length === 0) return NextResponse.json({ total: 0, done: 0, runs: [] });

  const runsRes = await query(
    `SELECT * FROM decs_test_runs WHERE question_id = ANY($1) ORDER BY tested_at DESC`,
    [testIds]
  );
  const runs = runsRes.rows;

  const doneV1 = runs.filter((r) => r.v1_status === 'ok').length;
  const doneV2 = runs.filter((r) => r.v2_status === 'ok').length;
  const errV1 = runs.filter((r) => r.v1_status === 'error').length;
  const errV2 = runs.filter((r) => r.v2_status === 'error').length;
  const totalDone = runs.length;

  const v1ok = runs.filter((r) => r.v1_status === 'ok');
  const v2ok = runs.filter((r) => r.v2_status === 'ok');
  const bothOk = runs.filter((r) => r.v1_status === 'ok' && r.v2_status === 'ok');

  const avgV1 = v1ok.length > 0
    ? (v1ok.reduce((s, r) => s + Number(r.v1_primary) + Number(r.v1_secondary), 0) / v1ok.length).toFixed(1)
    : '—';
  const avgV2 = v2ok.length > 0
    ? (v2ok.reduce((s, r) => s + Number(r.v2_primary) + Number(r.v2_secondary), 0) / v2ok.length).toFixed(1)
    : '—';
  const avgOverlap = bothOk.length > 0
    ? (bothOk.reduce((s, r) => s + Number(r.overlap_count), 0) / bothOk.length).toFixed(1)
    : '—';
  const avgV1ms = v1ok.filter((r) => r.v1_time_ms).length > 0
    ? Math.round(v1ok.reduce((s, r) => s + Number(r.v1_time_ms ?? 0), 0) / v1ok.filter((r) => r.v1_time_ms).length)
    : null;
  const avgV2ms = v2ok.filter((r) => r.v2_time_ms).length > 0
    ? Math.round(v2ok.reduce((s, r) => s + Number(r.v2_time_ms ?? 0), 0) / v2ok.filter((r) => r.v2_time_ms).length)
    : null;

  const pending = testIds.length - totalDone;

  return NextResponse.json({
    total: testIds.length,
    done: totalDone,
    pending,
    v1: { ok: doneV1, error: errV1 },
    v2: { ok: doneV2, error: errV2 },
    stats: { avgV1, avgV2, avgOverlap, avgV1ms, avgV2ms },
    runs: runs.slice(0, 100).map((r) => ({
      question_id: r.question_id,
      v1_status: r.v1_status,
      v1_primary: r.v1_primary,
      v1_secondary: r.v1_secondary,
      v1_time_ms: r.v1_time_ms,
      v1_error: r.v1_error,
      v2_status: r.v2_status,
      v2_primary: r.v2_primary,
      v2_secondary: r.v2_secondary,
      v2_time_ms: r.v2_time_ms,
      v2_error: r.v2_error,
      overlap_count: r.overlap_count,
      tested_at: r.tested_at,
    })),
  });
}

// ── POST — run next batch ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = getUser(req);
  if (!user || user.role !== 'admin')
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const geminiKey = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)?.trim();
  if (!geminiKey) return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 });
  const decsKey = process.env.DECS_API_KEY?.trim();
  if (!decsKey) return NextResponse.json({ error: 'DECS_API_KEY não configurada' }, { status: 500 });

  await ensureTable();

  const body = await req.json().catch(() => ({})) as { batch_size?: number };
  const batchSize = Math.min(Math.max(body.batch_size ?? 3, 1), 10);

  // Get test question IDs (100 most recent)
  const testQuestionsRes = await query(
    `SELECT id FROM questions ORDER BY created_at DESC LIMIT $1`,
    [TEST_LIMIT]
  );
  const testIds = testQuestionsRes.rows.map((r) => r.id as number);

  // Already processed question IDs
  const doneRes = await query(
    `SELECT question_id FROM decs_test_runs WHERE question_id = ANY($1)`,
    [testIds]
  );
  const doneIds = new Set(doneRes.rows.map((r) => r.question_id as number));

  // Pending question IDs (not yet processed)
  const pendingIds = testIds.filter((id) => !doneIds.has(id)).slice(0, batchSize);

  if (pendingIds.length === 0) {
    return NextResponse.json({ message: 'Todas as questões já foram testadas.', processed: [] });
  }

  // Fetch question data
  const qRes = await query(
    `SELECT * FROM questions WHERE id = ANY($1) ORDER BY created_at DESC`,
    [pendingIds]
  );

  const processed: Array<{
    question_id: number;
    v1_status: string; v1_primary: number; v1_secondary: number; v1_time_ms: number | null; v1_error?: string;
    v2_status: string; v2_primary: number; v2_secondary: number; v2_time_ms: number | null; v2_error?: string;
    overlap_count: number;
  }> = [];

  for (const q of qRes.rows) {
    const questionId = q.id as number;
    const questionText = buildQuestionText(q as Record<string, unknown>);
    const questionImages = (q as Record<string, unknown>).images;
    const result = {
      question_id: questionId,
      v1_status: 'pending', v1_primary: 0, v1_secondary: 0, v1_time_ms: null as number | null,
      v2_status: 'pending', v2_primary: 0, v2_secondary: 0, v2_time_ms: null as number | null,
      overlap_count: 0,
    };

    // ── V1 ────────────────────────────────────────────────────────────────────
    try {
      const t0 = Date.now();
      const v1Descriptors = await runV1Full(
        questionText,
        decsKey,
        geminiKey,
        questionImages,
      );
      result.v1_time_ms = Date.now() - t0;
      result.v1_primary = v1Descriptors.filter((d) => d.role === 'primary').length;
      result.v1_secondary = v1Descriptors.filter((d) => d.role !== 'primary').length;
      result.v1_status = 'ok';

      // Save to questions table
      await query(
        'UPDATE questions SET ai_decs_descriptors = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(v1Descriptors), questionId]
      );
    } catch (e) {
      result.v1_status = 'error';
      (result as Record<string, unknown>).v1_error = e instanceof Error ? e.message.substring(0, 200) : 'Erro';
    }

    await sleep(2000);

    // ── V2 ────────────────────────────────────────────────────────────────────
    try {
      const t0 = Date.now();
      const { result: v2Result } = await runDeCSPipelineV2(
        questionText,
        decsKey,
        geminiKey,
        undefined,
        questionImages,
      );
      result.v2_time_ms = Date.now() - t0;
      result.v2_primary = v2Result.decs_primary.length;
      result.v2_secondary = v2Result.decs_secondary.length;
      result.v2_status = 'ok';

      // Save to questions table
      await query(
        'UPDATE questions SET ai_decs_v2 = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(v2Result), questionId]
      );

      // Calculate overlap (codes in common between V1 and V2)
      if (result.v1_status === 'ok') {
        const v1Res = await query('SELECT ai_decs_descriptors FROM questions WHERE id = $1', [questionId]);
        const v1Raw = v1Res.rows[0]?.ai_decs_descriptors as string | null;
        if (v1Raw) {
          const v1Codes = new Set(
            (JSON.parse(v1Raw) as Array<{ code: string }>).map((d) => d.code)
          );
          const v2Codes = [
            ...v2Result.decs_primary,
            ...v2Result.decs_secondary,
          ].map((d) => d.id);
          result.overlap_count = v2Codes.filter((c) => v1Codes.has(c)).length;
        }
      }
    } catch (e) {
      result.v2_status = 'error';
      (result as Record<string, unknown>).v2_error = e instanceof Error ? e.message.substring(0, 200) : 'Erro';
    }

    // Persist to decs_test_runs
    await query(
      `INSERT INTO decs_test_runs
         (question_id, v1_status, v1_primary, v1_secondary, v1_time_ms, v1_error,
          v2_status, v2_primary, v2_secondary, v2_time_ms, v2_error, overlap_count, tested_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       ON CONFLICT (question_id) DO UPDATE SET
         v1_status = EXCLUDED.v1_status, v1_primary = EXCLUDED.v1_primary,
         v1_secondary = EXCLUDED.v1_secondary, v1_time_ms = EXCLUDED.v1_time_ms,
         v1_error = EXCLUDED.v1_error, v2_status = EXCLUDED.v2_status,
         v2_primary = EXCLUDED.v2_primary, v2_secondary = EXCLUDED.v2_secondary,
         v2_time_ms = EXCLUDED.v2_time_ms, v2_error = EXCLUDED.v2_error,
         overlap_count = EXCLUDED.overlap_count, tested_at = NOW()`,
      [
        questionId,
        result.v1_status, result.v1_primary, result.v1_secondary, result.v1_time_ms,
        (result as Record<string, unknown>).v1_error ?? null,
        result.v2_status, result.v2_primary, result.v2_secondary, result.v2_time_ms,
        (result as Record<string, unknown>).v2_error ?? null,
        result.overlap_count,
      ]
    );

    processed.push(result);

    // Delay between questions to respect rate limits
    if (processed.length < pendingIds.length) {
      await sleep(2500);
    }
  }

  return NextResponse.json({
    processed,
    remaining: testIds.filter((id) => !doneIds.has(id)).length - processed.length,
  });
}

// ── DELETE — reset test results ────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const user = getUser(req);
  if (!user || user.role !== 'admin')
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  await ensureTable();
  const testQuestionsRes = await query(
    `SELECT id FROM questions ORDER BY created_at DESC LIMIT $1`,
    [TEST_LIMIT]
  );
  const testIds = testQuestionsRes.rows.map((r) => r.id as number);
  await query(`DELETE FROM decs_test_runs WHERE question_id = ANY($1)`, [testIds]);
  return NextResponse.json({ message: 'Resultados de teste resetados.' });
}
