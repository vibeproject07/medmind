import { NextRequest, NextResponse } from 'next/server';

const DECS_BASE = 'https://api.bvsalud.org/decs/v2';

export interface DeCSRecord {
  term: string;
  code: string;
  hierarchicalCode?: string;
  synonyms?: string[];
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
      const hierarchicalCode = (treeList[0]?.tree_id as string | undefined)?.trim();

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
        hierarchicalCode: hierarchicalCode || undefined,
        synonyms: synonyms.length > 0 ? synonyms : undefined,
      });
    }

    return results;
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim();
  const lang = req.nextUrl.searchParams.get('lang') ?? 'pt';

  if (!q || q.length < 2) {
    return NextResponse.json({ records: [] });
  }

  const apiKey = process.env.DECS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'DECS_API_KEY não configurada' }, { status: 500 });
  }

  const url = `${DECS_BASE}/search-by-words?words=${encodeURIComponent(q)}&lang=${lang}&format=json`;

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
