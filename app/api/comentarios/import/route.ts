import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

type QuestaoInput = {
  questao_id: number | string | null;
  comentario: string;
  prova_nome?: string;
};

function parseJsonBody(raw: unknown): QuestaoInput[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;

  // Formato simples: { "questoes": [...] }
  if (Array.isArray(obj.questoes)) {
    return (obj.questoes as QuestaoInput[]).map((q) => ({ ...q }));
  }

  // Formato saída do script: { "comentarios": [{ "prova_id", "nome", "questoes": [...] }] }
  if (Array.isArray(obj.comentarios)) {
    const result: QuestaoInput[] = [];
    for (const prova of obj.comentarios as Record<string, unknown>[]) {
      const prova_nome = prova.nome as string | undefined;
      if (Array.isArray(prova.questoes)) {
        for (const q of prova.questoes as QuestaoInput[]) {
          result.push({ ...q, prova_nome });
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

/**
 * Resolve questao_id to the real DB question ID.
 * Strategy:
 *   1. Try direct lookup: questions.id = questao_id
 *   2. Fallback: questions.numero_na_prova = questao_id (optionally filtered by prova nome)
 * Returns null if no match found.
 */
async function resolveQuestaoDbId(
  questaoId: number,
  provaNome?: string
): Promise<number | null> {
  // 1) Direct ID match
  const direct = await query('SELECT id FROM questions WHERE id = $1 LIMIT 1', [questaoId]);
  if (direct.rows.length > 0) return direct.rows[0].id as number;

  // 2) Match by numero_na_prova, optionally scoped to prova by nome
  if (provaNome) {
    const byNome = await query(
      `SELECT q.id FROM questions q
       JOIN provas p ON p.id = q.prova_id
       WHERE q.numero_na_prova = $1 AND p.nome = $2
       LIMIT 1`,
      [questaoId, provaNome]
    );
    if (byNome.rows.length > 0) return byNome.rows[0].id as number;
  }

  // 3) Match by numero_na_prova globally (last resort — may be ambiguous)
  const byNumero = await query(
    'SELECT id FROM questions WHERE numero_na_prova = $1 LIMIT 1',
    [questaoId]
  );
  if (byNumero.rows.length > 0) return byNumero.rows[0].id as number;

  return null;
}

async function upsertQuestoes(questoes: QuestaoInput[]) {
  let inseridos = 0;
  let atualizados = 0;
  const erros: string[] = [];

  for (const q of questoes) {
    const qidRaw = Number(q.questao_id);
    if (Number.isNaN(qidRaw) || !q.comentario?.trim()) {
      erros.push(`questao_id=${q.questao_id}: dados inválidos`);
      continue;
    }

    const dbId = await resolveQuestaoDbId(qidRaw, q.prova_nome);

    if (dbId === null) {
      erros.push(`questao_id=${qidRaw}: questão não encontrada no banco`);
      continue;
    }

    try {
      const existing = await query('SELECT id FROM comentarios WHERE questao_id = $1', [dbId]);
      if (existing.rows.length > 0) {
        await query('UPDATE comentarios SET comentario = $1 WHERE questao_id = $2', [
          q.comentario,
          dbId,
        ]);
        atualizados++;
      } else {
        await query('INSERT INTO comentarios (questao_id, comentario) VALUES ($1, $2)', [
          dbId,
          q.comentario,
        ]);
        inseridos++;
      }
    } catch (e: any) {
      erros.push(`questao_id=${dbId}: ${e.message}`);
    }
  }
  return { inseridos, atualizados, erros };
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  const payload = verifyToken(token);

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
