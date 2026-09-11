import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import {
  normalizeYouTubeUrl,
  processYouTubeSource,
} from '@/lib/youtube-source-processing';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;

    if (token) {
      token = token.trim().replace(/^["']|["']$/g, '');
    }

    if (!token) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!url) {
      return NextResponse.json(
        { error: 'Envie a URL do vídeo no corpo: { "url": "https://www.youtube.com/watch?v=..." }' },
        { status: 400 }
      );
    }

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeYouTubeUrl(url);
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error
            ? error.message
            : 'URL inválida. Use um link HTTPS do YouTube.',
        },
        { status: 400 },
      );
    }
    return NextResponse.json(await processYouTubeSource(normalizedUrl));
  } catch (error: unknown) {
    let message = 'Erro ao transcrever o vídeo do YouTube.';
    if (error instanceof Error) {
      message = error.message;
    }
    const err = error as { error?: { code?: number; status?: string; message?: string }; message?: string };
    if (err?.error?.message && typeof err.error.message === 'string') {
      message = err.error.message;
    } else if (typeof err?.message === 'string' && err.message) {
      message = err.message;
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
