import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import type { DeCSRecord, DeCSThemes } from '@/lib/decs-pipeline';
import { runQuestionTermsValidation } from '@/lib/decs-question-terms-validation';
import { buildDeCSValidationMeta } from '@/lib/decs-primary';

export const runtime = 'nodejs';

function buildQuestionText(question: Record<string, unknown>): string {
  const letter = String(question.correct_answer ?? '').trim().toUpperCase();
  return [
    'Enunciado:',
    question.statement as string,
    '',
    'Alternativa A: ' + (question.option_a as string),
    'Alternativa B: ' + (question.option_b as string),
    question.option_c ? 'Alternativa C: ' + (question.option_c as string) : null,
    question.option_d ? 'Alternativa D: ' + (question.option_d as string) : null,
    question.option_e ? 'Alternativa E: ' + (question.option_e as string) : null,
    letter ? `Gabarito: ${letter}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

async function loadV1Themes(questionId: string): Promise<DeCSThemes | null> {
  try {
    const res = await query(
      `SELECT payload FROM decs_classification_runs
       WHERE question_id = $1 AND pipeline = 'v1'
       ORDER BY created_at DESC
       LIMIT 1`,
      [questionId],
    );
    if (res.rows.length === 0) return null;
    const payload = res.rows[0].payload;
    const obj =
      typeof payload === 'string' ? JSON.parse(payload) : (payload as Record<string, unknown>);
    const themes = obj?.themes_identified as DeCSThemes | undefined;
    if (themes && (themes.primary?.length || themes.secondary?.length)) {
      return {
        primary: Array.isArray(themes.primary) ? themes.primary : [],
        secondary: Array.isArray(themes.secondary) ? themes.secondary : [],
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const authHeader = req.headers.get('authorization');
  let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const user = verifyToken(token);
  if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Apenas administradores podem executar a validação' },
      { status: 403 },
    );
  }

  const geminiKey = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)?.trim();
  if (!geminiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 });
  }

  try {
    await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_decs_descriptors TEXT`);

    const qRes = await query('SELECT * FROM questions WHERE id = $1', [params.id]);
    if (qRes.rows.length === 0) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }
    const question = qRes.rows[0] as Record<string, unknown>;

    const rawDescriptors = question.ai_decs_descriptors as string | null;
    let descriptors: DeCSRecord[] = [];
    try {
      descriptors = rawDescriptors ? JSON.parse(rawDescriptors) : [];
    } catch {
      descriptors = [];
    }

    if (!Array.isArray(descriptors) || descriptors.length === 0) {
      return NextResponse.json(
        {
          error:
            'Nenhum resultado do Gerar V1 encontrado. Execute "Gerar v1" antes da validação.',
        },
        { status: 422 },
      );
    }

    let bodyThemes: DeCSThemes | null = null;
    try {
      const body = await req.json().catch(() => ({}));
      if (body?.themes && typeof body.themes === 'object') {
        bodyThemes = {
          primary: Array.isArray(body.themes.primary) ? body.themes.primary : [],
          secondary: Array.isArray(body.themes.secondary)
            ? body.themes.secondary
            : [],
        };
      }
    } catch {
      /* no body */
    }

    const storedThemes = await loadV1Themes(params.id);
    const themes: DeCSThemes = bodyThemes?.primary?.length || bodyThemes?.secondary?.length
      ? bodyThemes!
      : storedThemes ?? { primary: [], secondary: [] };

    const questionText = buildQuestionText(question);
    const result = await runQuestionTermsValidation({
      questionText,
      correctAnswer: question.correct_answer as string | null,
      themes,
      descriptors,
      geminiKey,
      images: question.images,
    });

    // Remove reprovados do resultado final V1 (mantém textuais + aprovados).
    const rejectedCodes = new Set(result.rejected.map((d) => d.code));
    const descriptorsKept = descriptors.filter((d) => !rejectedCodes.has(d.code));

    const validationMeta = buildDeCSValidationMeta({
      descriptorsKept,
      agentNeedsManualReview: result.needs_manual_review === true,
      agentMissingPrimaryHint: result.missing_primary_terms === true,
      agentReviewReason: result.review_reason,
      coerencia_geral: result.coerencia_geral,
      removed_count: rejectedCodes.size,
      dismissed_at: null,
    });

    const missingPrimary = validationMeta.missing_primary_terms === true;
    const needsManualReview = validationMeta.needs_manual_review === true;
    const reviewReason =
      typeof validationMeta.review_reason === 'string'
        ? validationMeta.review_reason
        : undefined;

    await query(
      `ALTER TABLE questions ADD COLUMN IF NOT EXISTS decs_validation_meta JSONB`,
    );

    await query(
      `UPDATE questions
       SET ai_decs_descriptors = $1,
           decs_validation_meta = $2::jsonb,
           updated_at = NOW()
       WHERE id = $3`,
      [JSON.stringify(descriptorsKept), JSON.stringify(validationMeta), params.id],
    );

    return NextResponse.json({
      result: {
        ...result,
        needs_manual_review: needsManualReview,
        review_reason: reviewReason,
        missing_primary_terms: missingPrimary,
      },
      coerencia_geral: result.coerencia_geral,
      approved: result.approved,
      rejected: result.rejected,
      items: result.items,
      ai_decs_descriptors: descriptorsKept,
      removed_count: rejectedCodes.size,
      decs_validation_meta: validationMeta,
    });
  } catch (err: unknown) {
    console.error('[decs-validate] error:', err);
    const message = err instanceof Error ? err.message : 'Erro interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
