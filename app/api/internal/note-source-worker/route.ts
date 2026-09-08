import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { processNextQueuedSource } from '@/lib/note-source-processing';

export const runtime = 'nodejs';

function isAuthorizedWorker(request: NextRequest): boolean {
  const expected = process.env.SESSION_SECRET;
  const received = request.headers.get('x-note-source-worker-secret');
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedWorker(request)) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  const processed = await processNextQueuedSource();
  return NextResponse.json({ processed });
}