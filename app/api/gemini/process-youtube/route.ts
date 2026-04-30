import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import { geminiProcessYouTube } from '@/lib/gemini';

export const runtime = 'nodejs';

function isYouTubeUrl(url: string): boolean {
  const trimmed = url.trim();
  return (
    trimmed.includes('youtube.com/watch') ||
    trimmed.includes('youtu.be/') ||
    trimmed.startsWith('https://www.youtube.com/') ||
    trimmed.startsWith('http://www.youtube.com/') ||
    trimmed.startsWith('https://youtube.com/') ||
    trimmed.startsWith('http://youtube.com/') ||
    trimmed.startsWith('https://youtu.be/') ||
    trimmed.startsWith('http://youtu.be/')
  );
}

function normalizeYouTubeUrl(url: string): string {
  const trimmed = url.trim();
  // youtu.be/ID -> https://www.youtube.com/watch?v=ID
  const youtuBeMatch = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  if (youtuBeMatch) {
    return `https://www.youtube.com/watch?v=${youtuBeMatch[1]}`;
  }
  if (!trimmed.startsWith('http')) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

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

    if (!isYouTubeUrl(url)) {
      return NextResponse.json(
        { error: 'URL inválida. Use um link do YouTube (ex.: https://www.youtube.com/watch?v=... ou https://youtu.be/...).' },
        { status: 400 }
      );
    }

    const normalizedUrl = normalizeYouTubeUrl(url);
    const result = await geminiProcessYouTube({ url: normalizedUrl, agentKey: 'youtube_transcript' });

    return NextResponse.json({ text: result });
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
