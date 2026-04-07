import { NextRequest, NextResponse } from 'next/server';

const DECS_BASE = 'https://api.bvsalud.org/decs/v2';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')?.trim();
  const lang = req.nextUrl.searchParams.get('lang') ?? 'pt';

  if (!code) {
    return NextResponse.json({ error: 'Parâmetro "code" obrigatório' }, { status: 400 });
  }

  const apiKey = process.env.DECS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'DECS_API_KEY não configurada' }, { status: 500 });
  }

  const url = `${DECS_BASE}/get-tree?mfn=${encodeURIComponent(code)}&lang=${lang}&format=json`;

  try {
    const res = await fetch(url, {
      headers: { apikey: apiKey },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Erro na API DeCS: ${res.status}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
