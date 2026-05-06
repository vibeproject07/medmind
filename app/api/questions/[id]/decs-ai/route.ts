import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { getAgent } from '@/lib/ai-agents';
import { GoogleGenAI } from '@google/genai';
import { runDeCSPipeline, type DeCSRecord, type DeCSThemes } from '@/lib/decs-pipeline';
import { saveClassificationArtifact } from '@/lib/decs-classification-storage';

export const runtime = 'nodejs';

async function ensureColumn() {
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_decs_descriptors TEXT`);
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

    const questionText = [
      'Enunciado:',
      question.statement as string,
      '',
      'Alternativa A: ' + (question.option_a as string),
      'Alternativa B: ' + (question.option_b as string),
      question.option_c ? 'Alternativa C: ' + (question.option_c as string) : null,
      question.option_d ? 'Alternativa D: ' + (question.option_d as string) : null,
      question.option_e ? 'Alternativa E: ' + (question.option_e as string) : null,
    ]
      .filter(Boolean)
      .join('\n');

    // ── Pre-flight: verify all agent prompts are configured ──────────────────
    const [classifierAgent, validatorAgent] = await Promise.all([
      getAgent('decs_classifier'),
      getAgent('decs_validator'),
    ]);
    if (!classifierAgent?.system_prompt) {
      return NextResponse.json(
        { error: 'Agente decs_classifier não configurado. Verifique o painel de agentes.' },
        { status: 500 }
      );
    }
    if (!validatorAgent?.system_prompt) {
      return NextResponse.json(
        { error: 'Agente decs_validator não configurado. Verifique o painel de agentes.' },
        { status: 500 }
      );
    }

    // ── Step 1: Gemini identifies primary + secondary themes ─────────────────
    const systemPrompt = classifierAgent.system_prompt;
    const classifierModel = classifierAgent.model ?? 'gemini-2.5-flash';

    const ai = new GoogleGenAI({ apiKey: geminiKey, apiVersion: 'v1beta' });
    const response = await ai.models.generateContent({
      model: classifierModel,
      contents: [{ role: 'user', parts: [{ text: questionText }] }],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.1,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = response as any;
    const rawText: string =
      (typeof resp?.text === 'string' ? resp.text : '') ||
      (resp?.candidates?.[0]?.content?.parts
        ?.map((p: Record<string, unknown>) => p?.text)
        .filter(Boolean)
        .join('') ?? '');

    let themes: DeCSThemes = { primary: [], secondary: [] };
    try {
      const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        // Legacy format — treat all as primary
        themes.primary = parsed.filter((t) => typeof t === 'string' && t.trim()).slice(0, 3);
      } else if (parsed && typeof parsed === 'object') {
        themes.primary = (Array.isArray(parsed.primary) ? parsed.primary : [])
          .filter((t: unknown) => typeof t === 'string' && t.trim())
          .slice(0, 3);
        themes.secondary = (Array.isArray(parsed.secondary) ? parsed.secondary : [])
          .filter((t: unknown) => typeof t === 'string' && t.trim())
          .slice(0, 6);
      }
    } catch {
      const matches = rawText.match(/"([^"]+)"/g);
      if (matches) {
        themes.primary = matches.map((m) => m.replace(/"/g, '').trim()).filter(Boolean).slice(0, 3);
      }
    }

    if (themes.primary.length === 0 && themes.secondary.length === 0) {
      return NextResponse.json(
        { error: 'O agente não conseguiu identificar temas para busca. Tente novamente.' },
        { status: 422 }
      );
    }

    // ── Steps 2+3: Multi-candidate search + category filter + Gemini validation
    const { descriptors, dropped_by_filter, dropped_by_gemini } = await runDeCSPipeline(
      themes,
      questionText,
      decsKey,
      geminiKey,
      classifierModel
    );

    const artifact = {
      result: descriptors,
      themes_identified: themes,
      pipeline_stats: {
        primary_terms: themes.primary.length,
        secondary_terms: themes.secondary.length,
        dropped_by_category_filter: dropped_by_filter,
        dropped_by_gemini_validation: dropped_by_gemini,
        final_count: descriptors.length,
      },
    };

    await query(
      'UPDATE questions SET ai_decs_descriptors = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(descriptors), params.id]
    );
    await saveClassificationArtifact(params.id, 'v1', artifact);

    return NextResponse.json(artifact);
  } catch (err: unknown) {
    console.error('[decs-ai] error:', err);
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
    const qRes = await query('SELECT ai_decs_descriptors FROM questions WHERE id = $1', [params.id]);
    if (qRes.rows.length === 0) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }
    const raw = qRes.rows[0].ai_decs_descriptors as string | null;
    const descriptors: DeCSRecord[] = raw ? JSON.parse(raw) : [];
    return NextResponse.json({ descriptors });
  } catch (err: unknown) {
    console.error('[decs-ai] GET error:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
