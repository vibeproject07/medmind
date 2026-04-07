import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';

export const runtime = 'nodejs';

const DECS_BASE = 'https://api.bvsalud.org/decs/v2';

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

  const url = `${DECS_BASE}/get-tree?mfn=${encodeURIComponent(id)}&lang=${lang}&format=json`;

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
