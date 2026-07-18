import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { getRuntimeAgent } from '@/lib/ai-agent-runtime';
import { buildDeCSQuestionText } from '@/lib/decs-pipeline';
import { runDeCSPipelineV2, type DeCSV2Result, type DeCSV2CandidateGroup } from '@/lib/decs-pipeline-v2';
import { saveClassificationArtifact } from '@/lib/decs-classification-storage';

export const runtime = 'nodejs';

async function ensureColumn() {
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_decs_v2 TEXT`);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authHeader = req.headers.get('authorization');
  let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const user = verifyToken(token);
  if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  if (user.role !== 'admin')
    return NextResponse.json({ error: 'Apenas administradores podem executar este agente' }, { status: 403 });

  const geminiKey = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)?.trim();
  if (!geminiKey) return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 });

  const decsKey = process.env.DECS_API_KEY?.trim();
  if (!decsKey) return NextResponse.json({ error: 'DECS_API_KEY não configurada' }, { status: 500 });

  try {
    await ensureColumn();

    const qRes = await query('SELECT * FROM questions WHERE id = $1', [params.id]);
    if (qRes.rows.length === 0) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }
    const question = qRes.rows[0] as Record<string, unknown>;

    const questionText = buildDeCSQuestionText({
      statement: question.statement as string,
      option_a: question.option_a as string,
      option_b: question.option_b as string,
      option_c: question.option_c as string | null,
      option_d: question.option_d as string | null,
      option_e: question.option_e as string | null,
      correct_answer: question.correct_answer as string | null,
    });

    const indexerAgent = await getRuntimeAgent('decs_indexer_v2');
    await getRuntimeAgent('decs_selector_v2');
    const v2Model = indexerAgent.model;

    const { result, themes_identified, candidate_groups, debug_trace, stats } = await runDeCSPipelineV2(
      questionText,
      decsKey,
      geminiKey,
      v2Model
    );

    await query(
      'UPDATE questions SET ai_decs_v2 = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify({ result, themes_identified, candidate_groups, debug_trace, stats }), params.id]
    );
    await saveClassificationArtifact(params.id, 'v2', { result, themes_identified, candidate_groups, debug_trace, stats });

    return NextResponse.json({
      result,
      themes_identified,
      candidate_groups,
      debug_trace,
      pipeline_stats: stats,
    });
  } catch (err: unknown) {
    console.error('[decs-ai-v2] error:', err);
    const message = err instanceof Error ? err.message : 'Erro interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authHeader = req.headers.get('authorization');
  let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const user = verifyToken(token);
  if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });

  try {
    await ensureColumn();
    const qRes = await query('SELECT ai_decs_v2 FROM questions WHERE id = $1', [params.id]);
    if (qRes.rows.length === 0) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }
    const raw = qRes.rows[0].ai_decs_v2 as string | null;
    let parsed: Record<string, unknown> = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = {};
      }
    }
    const result = parsed.result ?? {
      decs_primary: parsed.decs_primary ?? [],
      decs_secondary: parsed.decs_secondary ?? [],
    };
    return NextResponse.json({
      result,
      themes_identified: parsed.themes_identified ?? { primary: [], secondary: [] },
      candidate_groups: parsed.candidate_groups ?? [],
      debug_trace: parsed.debug_trace ?? null,
      pipeline_stats: parsed.stats ?? null,
    });
  } catch (err: unknown) {
    console.error('[decs-ai-v2] GET error:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
