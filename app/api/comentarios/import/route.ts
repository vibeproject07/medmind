import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import jwt from 'jsonwebtoken';

function getTokenPayload(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'secret') as { role?: string };
  } catch {
    return null;
  }
}

type QuestaoInput = { questao_id: number | string; comentario: string };

function parseJsonBody(raw: unknown): QuestaoInput[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;

  // Formato simples: { "questoes": [...] }
  if (Array.isArray(obj.questoes)) {
    return obj.questoes as QuestaoInput[];
  }

  // Formato saída do script: { "comentarios": [{ "questoes": [...] }] }
  if (Array.isArray(obj.comentarios)) {
    const result: QuestaoInput[] = [];
    for (const prova of obj.comentarios as Record<string, unknown>[]) {
      if (Array.isArray(prova.questoes)) {
        for (const q of prova.questoes as QuestaoInput[]) {
          result.push(q);
        }
      }
    }
    return result;
  }

  return [];
}

function parseCsvBody(text: string): QuestaoInput[] {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const idxId = headers.indexOf('questao_id');
  const idxComentario = headers.indexOf('comentario');

  if (idxId === -1 || idxComentario === -1) return [];

  const result: QuestaoInput[] = [];
  let i = 1;
  while (i < lines.length) {
    const row = parseCsvRow(lines, i);
    i = row.nextLine;
    const cells = row.cells;
    if (cells.length <= Math.max(idxId, idxComentario)) continue;
    const qid = cells[idxId].trim();
    const comentario = cells[idxComentario].trim();
    if (qid && comentario) {
      result.push({ questao_id: qid, comentario });
    }
  }
  return result;
}

function parseCsvRow(lines: string[], startLine: number): { cells: string[]; nextLine: number } {
  const cells: string[] = [];
  let line = startLine;
  let remaining = lines[line] ?? '';
  let pos = 0;

  while (pos <= remaining.length) {
    if (remaining[pos] === '"') {
      let field = '';
      pos++;
      while (true) {
        if (pos >= remaining.length) {
          if (line + 1 < lines.length) {
            field += '\n';
            line++;
            remaining = lines[line];
            pos = 0;
          } else {
            break;
          }
        }
        if (remaining[pos] === '"') {
          if (remaining[pos + 1] === '"') {
            field += '"';
            pos += 2;
          } else {
            pos++;
            break;
          }
        } else {
          field += remaining[pos];
          pos++;
        }
      }
      cells.push(field);
      if (remaining[pos] === ',') pos++;
    } else {
      const end = remaining.indexOf(',', pos);
      if (end === -1) {
        cells.push(remaining.slice(pos));
        pos = remaining.length + 1;
      } else {
        cells.push(remaining.slice(pos, end));
        pos = end + 1;
      }
    }
  }
  return { cells, nextLine: line + 1 };
}

async function upsertQuestoes(questoes: QuestaoInput[]) {
  let inseridos = 0;
  let atualizados = 0;
  const erros: string[] = [];

  for (const q of questoes) {
    const qid = Number(q.questao_id);
    if (Number.isNaN(qid) || !q.comentario?.trim()) {
      erros.push(`questao_id=${q.questao_id}: dados inválidos`);
      continue;
    }
    try {
      const existing = await query('SELECT id FROM comentarios WHERE questao_id = $1', [qid]);
      if (existing.rows.length > 0) {
        await query('UPDATE comentarios SET comentario = $1 WHERE questao_id = $2', [q.comentario, qid]);
        atualizados++;
      } else {
        await query('INSERT INTO comentarios (questao_id, comentario) VALUES ($1, $2)', [qid, q.comentario]);
        inseridos++;
      }
    } catch (e: any) {
      erros.push(`questao_id=${qid}: ${e.message}`);
    }
  }
  return { inseridos, atualizados, erros };
}

export async function POST(req: NextRequest) {
  const payload = getTokenPayload(req);
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 });
  }

  const contentType = req.headers.get('content-type') ?? '';

  let questoes: QuestaoInput[] = [];

  if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
    const text = await req.text();
    questoes = parseCsvBody(text);
  } else {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body inválido — envie JSON ou CSV' }, { status: 400 });
    }
    questoes = parseJsonBody(body);
  }

  if (questoes.length === 0) {
    return NextResponse.json(
      { error: 'Nenhuma questão encontrada. Verifique o formato do arquivo.' },
      { status: 400 }
    );
  }

  const { inseridos, atualizados, erros } = await upsertQuestoes(questoes);

  return NextResponse.json({
    inseridos,
    atualizados,
    erros,
    message: `${inseridos} inserido(s), ${atualizados} atualizado(s)${erros.length ? `, ${erros.length} erro(s)` : ''}.`,
  });
}
