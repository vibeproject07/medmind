import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';

export const runtime = 'nodejs';

const DECS_BASE = 'https://api.bvsalud.org/decs/v2';

export interface DeCSRecord {
  term: string;
  code: string;
  tree_ids: string[];
  hierarchy_path: string;
  synonyms?: string[];
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

function extractRecords(data: unknown, lang: string): DeCSRecord[] {
  try {
    const obj = data as Record<string, unknown>;
    const objects = obj?.objects as unknown[];
    if (!Array.isArray(objects) || objects.length === 0) return [];

    const first = objects[0] as Record<string, unknown>;
    const resp = first?.decsws_response as Record<string, unknown>;
    const recordList = resp?.record_list as Record<string, unknown>;
    if (!recordList) return [];

    const rawRecords = toArray(recordList?.record as unknown);
    const results: DeCSRecord[] = [];

    for (const rec of rawRecords as Record<string, unknown>[]) {
      const attrObj = rec.attr as Record<string, string> | undefined;
      const code = attrObj?.mfn ?? '';

      const descriptors = toArray(rec.descriptor_list as unknown).flatMap((d) =>
        toArray(d as unknown)
      ) as Record<string, unknown>[];

      const ptLangs = [`${lang}-br`, lang, 'pt', 'pt-br'];
      let term = '';
      for (const pl of ptLangs) {
        const found = descriptors.find((d) => {
          const da = d?.attr as Record<string, string> | undefined;
          return da?.lang === pl;
        });
        if (found && typeof found.descriptor === 'string' && found.descriptor.trim()) {
          term = found.descriptor.trim();
          break;
        }
      }
      if (!term) continue;

      const treeList = toArray(rec.tree_id_list as unknown).flatMap((t) =>
        toArray(t as unknown)
      ) as Record<string, unknown>[];
      const tree_ids: string[] = treeList
        .map((t) => (t?.tree_id as string | undefined)?.trim() ?? '')
        .filter(Boolean);

      const hierarchy_path = buildHierarchyPath(tree_ids[0] ?? '');

      const synonymList = toArray(rec.synonym_list as unknown).flatMap((s) =>
        toArray(s as unknown)
      ) as Record<string, unknown>[];
      const synonyms: string[] = [];
      for (const s of synonymList) {
        const ts = s?.term_string;
        if (typeof ts === 'string' && ts.trim()) synonyms.push(ts.trim());
      }

      results.push({
        term,
        code,
        tree_ids,
        hierarchy_path,
        synonyms: synonyms.length > 0 ? synonyms : undefined,
      });
    }

    return results;
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  let token = authHeader?.replace('Bearer ', '') || req.cookies.get('token')?.value;
  if (token) token = token.trim().replace(/^["']|["']$/g, '');
  if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const user = verifyToken(token);
  if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id')?.trim();
  const lang = req.nextUrl.searchParams.get('lang') ?? 'pt';

  if (!id) {
    return NextResponse.json({ error: 'Parâmetro "id" (mfn) obrigatório' }, { status: 400 });
  }

  const apiKey = process.env.DECS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'DECS_API_KEY não configurada' }, { status: 500 });
  }

  const url = `${DECS_BASE}/get-tree?tree_id=${encodeURIComponent(id)}&lang=${lang}&format=json`;

  try {
    const res = await fetch(url, {
      headers: { apikey: apiKey },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Erro na API DeCS: ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    const records = extractRecords(data, lang);

    return NextResponse.json({ records });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
