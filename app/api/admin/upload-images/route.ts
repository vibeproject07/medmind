import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { uploadBufferToS3, isS3Configured } from '@/lib/s3';

export const runtime = 'nodejs';

function getToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim().replace(/^["']|["']$/g, '');
  return req.cookies.get('token')?.value?.trim().replace(/^["']|["']$/g, '') ?? null;
}

async function ensureImagesMeta() {
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS images_meta TEXT`);
}

async function findQuestionByXref(xref: number): Promise<number | null> {
  const target = xref;

  const rows = await query(
    `SELECT id, images_meta, images FROM questions
     WHERE (images_meta IS NOT NULL AND images_meta LIKE $1)
        OR (images_meta IS NULL AND images IS NOT NULL AND images LIKE $1)
     LIMIT 20`,
    [`%"xref":${target}%`]
  );

  for (const row of rows.rows as Record<string, unknown>[]) {
    const metaStr = (row.images_meta ?? row.images) as string | null;
    if (!metaStr) continue;
    try {
      const arr = JSON.parse(metaStr) as unknown[];
      for (const item of arr) {
        if (typeof item === 'object' && item !== null && (item as Record<string, unknown>).xref === target) {
          return row.id as number;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  const token = getToken(req);
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const user = verifyToken(token);
  if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Apenas administradores podem fazer upload de imagens' }, { status: 403 });

  await ensureImagesMeta();

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Erro ao processar o formulário multipart' }, { status: 400 });
  }

  const files = formData.getAll('files') as File[];
  if (!files || files.length === 0) {
    return NextResponse.json({ error: 'Nenhum arquivo enviado. Use o campo "files".' }, { status: 400 });
  }

  const results: {
    file: string;
    xref?: number;
    questionId?: number;
    status: 'linked' | 'not_found' | 'no_xref' | 'error';
    reason?: string;
  }[] = [];

  let linked = 0;
  let notFound = 0;
  let skipped = 0;

  for (const file of files) {
    const name = file.name;

    const xrefMatch = name.match(/xref(\d+)/i);
    if (!xrefMatch) {
      results.push({ file: name, status: 'no_xref', reason: 'xref não encontrado no nome do arquivo' });
      skipped++;
      continue;
    }

    const xref = parseInt(xrefMatch[1], 10);

    try {
      const questionId = await findQuestionByXref(xref);

      if (!questionId) {
        results.push({ file: name, xref, status: 'not_found', reason: `Nenhuma questão com xref=${xref}` });
        notFound++;
        continue;
      }

      const rawBuffer = Buffer.from(await file.arrayBuffer());
      const mimeType = file.type || 'image/png';

      // Upload to S3 if configured; otherwise fall back to base64
      let imageValue: string;
      if (isS3Configured()) {
        try {
          imageValue = await uploadBufferToS3(rawBuffer, mimeType);
        } catch (uploadErr) {
          console.error('[upload-images] S3 upload falhou, usando base64:', uploadErr);
          imageValue = `data:${mimeType};base64,${rawBuffer.toString('base64')}`;
        }
      } else {
        imageValue = `data:${mimeType};base64,${rawBuffer.toString('base64')}`;
      }

      const existing = await query('SELECT images FROM questions WHERE id = $1', [questionId]);
      let currentImages: string[] = [];
      try {
        const raw = (existing.rows[0] as Record<string, unknown>).images as string | null;
        if (raw) {
          const parsed = JSON.parse(raw) as unknown[];
          currentImages = parsed.filter((item) => typeof item === 'string') as string[];
        }
      } catch {
        currentImages = [];
      }

      const newImages = [...currentImages, imageValue];
      await query('UPDATE questions SET images = $1, updated_at = NOW() WHERE id = $2', [
        JSON.stringify(newImages),
        questionId,
      ]);

      results.push({ file: name, xref, questionId, status: 'linked' });
      linked++;
    } catch (err) {
      results.push({ file: name, xref, status: 'error', reason: String(err) });
      skipped++;
    }
  }

  return NextResponse.json({
    summary: { total: files.length, linked, not_found: notFound, skipped },
    results,
  });
}
