import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/jwt';
import {
  SpacyTokenizerError,
  tokenizeText,
  type SpacySourceSegment,
} from '@/lib/spacy-tokenizer';

export const runtime = 'nodejs';

type ResponseView =
  | 'totals'
  | 'tokens'
  | 'sentences_text_order'
  | 'sentences_token_order'
  | 'mixed';

const MAX_REQUEST_BYTES = 8_500_000;

async function readBoundedJson(request: NextRequest) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_REQUEST_BYTES) {
    throw new Error('PAYLOAD_TOO_LARGE');
  }

  if (!request.body) return {};
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let body = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error('PAYLOAD_TOO_LARGE');
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return body ? JSON.parse(body) : {};
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  const bearerToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : null;
  const token = bearerToken || request.cookies.get('token')?.value || '';
  if (!verifyToken(token)) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  try {
    const body = await readBoundedJson(request);
    const text = typeof body?.text === 'string' ? body.text : '';
    if (!text.trim()) {
      return NextResponse.json(
        { error: 'Envie o conteúdo em { "text": "..." }.' },
        { status: 400 },
      );
    }

    const supportedViews = new Set<ResponseView>([
      'totals',
      'tokens',
      'sentences_text_order',
      'sentences_token_order',
      'mixed',
    ]);
    const requestedView = body?.view as ResponseView;
    const view = supportedViews.has(requestedView)
      ? requestedView
      : 'sentences_text_order';
    const segments = Array.isArray(body?.segments)
      ? (body.segments as SpacySourceSegment[])
      : [];

    const result = await tokenizeText({
      text,
      sourceType: typeof body?.sourceType === 'string' ? body.sourceType : 'text',
      segments,
      contentFormat: body?.contentFormat === 'plain' ? 'plain' : 'auto',
      view,
      page:
        Number.isInteger(body?.page) && body.page > 0
          ? body.page
          : 1,
      pageSize:
        Number.isInteger(body?.pageSize) && body.pageSize > 0
          ? Math.min(body.pageSize, 1000)
          : 250,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json(
        { error: 'O corpo da requisição excede 8,5 MB.' },
        { status: 413 },
      );
    }
    if (error instanceof SpacyTokenizerError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao tokenizar conteúdo.' },
      { status: 500 },
    );
  }
}