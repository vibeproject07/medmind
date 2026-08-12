import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { getRuntimeAgent } from '@/lib/ai-agent-runtime';
import { GoogleGenAI } from '@google/genai';

export const runtime = 'nodejs';

async function ensureColumn() {
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS competencias TEXT`);
}

export interface CompetenciasResult {
  competencias: string[];
  habilidades: string[];
  nivel_cognitivo: string;
  dominio: string;
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

    const agent = await getRuntimeAgent('habilities_agent');

    const ai = new GoogleGenAI({ apiKey: geminiKey, apiVersion: 'v1beta' });
    const response = await ai.models.generateContent({
      model: agent.model,
      contents: [{ role: 'user', parts: [{ text: questionText }] }],
      config: {
        systemInstruction: agent.system_instruction,
        temperature: agent.temperature,
        maxOutputTokens: agent.max_output_tokens,
        responseMimeType: 'application/json',
      },
    });

    const resp = response as any;
    const rawText: string =
      (typeof resp?.text === 'string' ? resp.text : '') ||
      (resp?.candidates?.[0]?.content?.parts
        ?.map((p: Record<string, unknown>) => p?.text)
        .filter(Boolean)
        .join('') ?? '');

    let result: CompetenciasResult = {
      competencias: [],
      habilidades: [],
      nivel_cognitivo: '',
      dominio: '',
    };

    try {
      const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      result = {
        competencias: Array.isArray(parsed.competencias)
          ? parsed.competencias.filter((c: unknown) => typeof c === 'string')
          : [],
        habilidades: Array.isArray(parsed.habilidades)
          ? parsed.habilidades.filter((h: unknown) => typeof h === 'string')
          : [],
        nivel_cognitivo: typeof parsed.nivel_cognitivo === 'string' ? parsed.nivel_cognitivo : '',
        dominio: typeof parsed.dominio === 'string' ? parsed.dominio : '',
      };
    } catch {
      return NextResponse.json(
        { error: 'Resposta do agente não pôde ser interpretada como JSON.' },
        { status: 422 }
      );
    }

    await query(
      'UPDATE questions SET competencias = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(result), params.id]
    );

    return NextResponse.json({ result });
  } catch (err: unknown) {
    console.error('[habilities] error:', err);
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
    const qRes = await query('SELECT competencias FROM questions WHERE id = $1', [params.id]);
    if (qRes.rows.length === 0) {
      return NextResponse.json({ error: 'Questão não encontrada' }, { status: 404 });
    }
    const raw = qRes.rows[0].competencias as string | null;
    const result: CompetenciasResult | null = raw ? JSON.parse(raw) : null;
    return NextResponse.json({ result });
  } catch (err: unknown) {
    console.error('[habilities] GET error:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
