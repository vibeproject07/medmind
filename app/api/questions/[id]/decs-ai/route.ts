import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { getAgentPrompt } from '@/lib/ai-agents';
import { GoogleGenAI } from '@google/genai';

export const runtime = 'nodejs';

const DECS_BASE = 'https://api.bvsalud.org/decs/v2';

interface DeCSRecord {
  term: string;
  code: string;
  tree_ids: string[];
  hierarchy_path: string;
}

const DECS_CATEGORY_LABELS: Record<string, string> = {
  A: 'Anatomia',
  B: 'Organismos',
  C: 'Doenças',
  D: 'Compostos Químicos e Drogas',
  E: 'Técnicas e Equipamentos Analíticos',
  F: 'Psiquiatria e Psicologia',
  G: 'Fenômenos Biológicos',
  H: 'Disciplinas e Ocupações',
  I: 'Antropologia, Educação, Sociologia',
  J: 'Tecnologia, Indústria, Agricultura',
  K: 'Humanidades',
  L: 'Ciência da Informação',
  M: 'Grupos Identificados',
  N: 'Saúde',
  SP: 'Saúde Pública',
  VS: 'Vigilância Sanitária',
};

function buildHierarchyPath(treeId: string): string {
  if (!treeId) return '';
  const topCode = treeId.split('.')[0].replace(/[0-9]/g, '');
  const label = DECS_CATEGORY_LABELS[topCode] ?? topCode;
  const depth = treeId.split('.').length;
  if (depth <= 1) return label;
  return `${label} › ${treeId}`;
}

function toArray<T>(v: T | T[]): T[] {
  if (Array.isArray(v)) return v;
  if (v != null) return [v];
  return [];
}

async function searchDeCS(term: string, apiKey: string): Promise<DeCSRecord | null> {
  try {
    const url = `${DECS_BASE}/search-by-words?words=${encodeURIComponent(term)}&lang=pt&format=json`;
    const res = await fetch(url, {
      headers: { apikey: apiKey },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const obj = data as Record<string, unknown>;
    const objects = obj?.objects as unknown[];
    if (!Array.isArray(objects) || objects.length === 0) return null;

    const first = objects[0] as Record<string, unknown>;
    const resp = first?.decsws_response as Record<string, unknown>;
    const recordList = resp?.record_list as Record<string, unknown>;
    if (!recordList) return null;

    const rawRecords = toArray(recordList?.record as unknown);
    if (rawRecords.length === 0) return null;

    const rec = rawRecords[0] as Record<string, unknown>;
    const attrObj = rec.attr as Record<string, string> | undefined;
    const code = attrObj?.mfn ?? '';

    const descriptors = toArray(rec.descriptor_list as unknown).flatMap((d) =>
      toArray(d as unknown)
    ) as Record<string, unknown>[];

    const ptLangs = ['pt-br', 'pt'];
    let recordTerm = '';
    for (const pl of ptLangs) {
      const found = descriptors.find((d) => {
        const da = d?.attr as Record<string, string> | undefined;
        return da?.lang === pl;
      });
      if (found && typeof found.descriptor === 'string' && found.descriptor.trim()) {
        recordTerm = found.descriptor.trim();
        break;
      }
    }
    if (!recordTerm) return null;

    const treeList = toArray(rec.tree_id_list as unknown).flatMap((t) =>
      toArray(t as unknown)
    ) as Record<string, unknown>[];
    const tree_ids: string[] = treeList
      .map((t) => (t?.tree_id as string | undefined)?.trim() ?? '')
      .filter(Boolean);

    const hierarchy_path = buildHierarchyPath(tree_ids[0] ?? '');

    return { term: recordTerm, code, tree_ids, hierarchy_path };
  } catch {
    return null;
  }
}

async function ensureColumn() {
  await query(
    `ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_decs_descriptors TEXT`
  );
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
  if (user.role !== 'admin') return NextResponse.json({ error: 'Apenas administradores podem executar este agente' }, { status: 403 });

  const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!geminiKey) return NextResponse.json({ error: 'GEMINI_API_KEY não configurada' }, { status: 500 });

  const decsKey = process.env.DECS_API_KEY;
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

    const systemPrompt = await getAgentPrompt('decs_classifier');

    const ai = new GoogleGenAI({ apiKey: geminiKey, apiVersion: 'v1beta' });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: questionText }] }],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.1,
        maxOutputTokens: 512,
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

    let searchTerms: string[] = [];
    try {
      const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        searchTerms = parsed.filter((t) => typeof t === 'string' && t.trim()).slice(0, 5);
      }
    } catch {
      const matches = rawText.match(/"([^"]+)"/g);
      if (matches) {
        searchTerms = matches.map((m) => m.replace(/"/g, '').trim()).filter(Boolean).slice(0, 5);
      }
    }

    if (searchTerms.length === 0) {
      return NextResponse.json({ error: 'O agente não conseguiu identificar termos para busca. Tente novamente.' }, { status: 422 });
    }

    const seenCodes = new Set<string>();
    const descriptors: DeCSRecord[] = [];

    await Promise.allSettled(
      searchTerms.map(async (term) => {
        const record = await searchDeCS(term, decsKey);
        if (record && !seenCodes.has(record.code)) {
          seenCodes.add(record.code);
          descriptors.push(record);
        }
      })
    );

    const json = JSON.stringify(descriptors);
    await query(
      'UPDATE questions SET ai_decs_descriptors = $1, updated_at = NOW() WHERE id = $2',
      [json, params.id]
    );

    return NextResponse.json({
      descriptors,
      search_terms_used: searchTerms,
    });
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
    const qRes = await query(
      'SELECT ai_decs_descriptors FROM questions WHERE id = $1',
      [params.id]
    );
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
