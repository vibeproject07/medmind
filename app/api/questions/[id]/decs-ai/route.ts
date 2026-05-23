import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { getRuntimeAgent } from '@/lib/ai-agent-runtime';
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

    const [classifierAgent, validatorAgent] = await Promise.all([
      getRuntimeAgent('decs_classifier'),
      getRuntimeAgent('decs_validator'),
    ]);

    const ai = new GoogleGenAI({ apiKey: geminiKey, apiVersion: 'v1beta' });

    const nossoPrompt = `
Você é um especialista em classificação médica e no vocabulário controlado DeCS (Descritores em Ciências da Saúde) / MeSH.

Analise o enunciado e as alternativas da questão médica abaixo. Compreenda o contexto clínico completo.

Identifique:
- TEMAS PRINCIPAIS (1 a 3): os conceitos médicos CENTRAIS da questão — diagnóstico principal, condição tratada, fármaco central ou procedimento chave.
- TEMAS SECUNDÁRIOS (0 a 6, se aplicável): conceitos médicos relevantes mas não centrais — fisiopatologia …sem explicação):

{"primary":["tema principal 1","tema principal 2"],"secondary":["tema secundário 1","tema secundário 2"]}


====================
DEFINIÇÃO DE PRIORIDADE (PRIMARY vs SECONDARY):
====================

DECS_PRIMARY deve representar o núcleo semântico da questão.

Critério: Se o descritor for removido, a questão perde seu significado principal ?.

DECS_SECONDARY representa contexto ou detalhamento.

Critério: Se removido, a questão permanece compreensível ?.

====================
USO DAS ALTERNATIVAS
====================

A análise das alternativas para extração de conceitos depende do COMANDO da questão:

CENÁRIO A: Questões de INCLUSÃO (pedem a afirmação verdadeira/conduta correta)
- O GABARITO (alternativa-alvo) geralmente aponta o foco operacional e a tomada de decisão. Avalie seus termos para DECS_PRIMARY.
- Os DISTRATORES (alternativas erradas) mapeiam o contexto e armadilhas comuns. Avalie para DECS_SECONDARY.

CENÁRIO B: Questões de EXCLUSÃO (pedem a incorreta, a falsa, a contraindicação ou "exceto")
- ATENÇÃO REDOBRADA: O GABARITO aqui é uma afirmação falsa ou um erro clínico. Ele NÃO deve definir o núcleo da questão. Se contiver termos válidos, classifique no máximo como SECONDARY. Se descrever uma conduta/doença inexistente, ignore.
- Os DISTRATORES (neste caso, as afirmações que são VERDADEIRAS na prática médica) representam o consenso clínico sobre o tema. O conjunto dessas alternativas verdadeiras é que define o NÚCLEO SEMÂNTICO (DECS_PRIMARY) e o contexto (DECS_SECONDARY).

IMPORTANTE (Regra Geral):
O conteúdo de uma alternativa só deve ser PRIMARY se ele definir o tema central exigido pela questão. Se for um elemento específico, dependente de outro conceito, ou uma exceção isolada, classifique como SECONDARY.

IMPORTANTE: O conteúdo da alternativa correta NÃO deve ser automaticamente classificado como PRIMARY.

IMPORTANTE: Se for um elemento específico, operacional ou dependente de outro conceito:
→ classificar como SECONDARY

====================
HEURÍSTICA DE DECISÃO
====================

PRIMARY responde:
"Do que se trata essa questão?"

SECONDARY responde:
"Como isso está sendo abordado?"

====================
CLASSIFICAÇÃO FINAL
====================

DECS_PRIMARY:
- 1 a 3 descritores centrais

DECS_SECONDARY:
- 2 a 6 descritores contextuais relevantes

REGRAS:
- NÃO repetir termos
- Priorizar coerência clínica

====================
USO DE TERMOS GENÉRICOS
====================

Termos genéricos são aceitáveis quando:

- representam corretamente o nível de abstração do conceito
- não existe descritor mais específico adequado

Especialmente em áreas como:

- Saúde pública
- Epidemiologia
- Organização de sistemas de saúde

Exemplos válidos:
- Primary Health Care
- Community Health Services
- Health Services Accessibility
- Delivery of Health Care

REGRA:

Evitar termos genéricos apenas quando houver alternativa mais específica claramente aplicável.

====================
REGRA DE COBERTURA SEMÂNTICA
====================

A classificação deve cobrir:

1. O núcleo da questão (PRIMARY)
2. O contexto clínico ou organizacional (SECONDARY)

Se a lista de descritores estiver muito curta:

- Verifique se há conceitos relevantes não representados
- Adicione descritores secundários coerentes

META:

- 1 a 3 PRIMARY
- 3 a 6 SECONDARY (sempre que possível)

Evitar respostas com poucos descritores quando a questão contém múltiplos conceitos relevantes.

====================
SAÍDA EM FORMATO JSON
====================
{"primary":["tema principal 1","tema principal 2"],"secondary":["tema secundário 1","tema secundário 2"]}`
    
    const response = await ai.models.generateContent({
      model: classifierAgent.model,
      contents: [{ role: 'user', parts: [{ text: questionText }] }],
      config: {
        systemInstruction: nossoPrompt,
        temperature: classifierAgent.temperature,
        maxOutputTokens: classifierAgent.max_output_tokens,
        responseMimeType: 'application/json',
      },
    });


console.log(nossoPrompt)
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

    const { descriptors, dropped_by_filter, dropped_by_gemini } = await runDeCSPipeline(
      themes,
      questionText,
      decsKey,
      geminiKey,
      classifierAgent.model,
      'decs_validator',
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
