import { NextRequest, NextResponse } from 'next/server';
import { getPool, query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';
import { computeProvaContentFingerprint } from '@/lib/prova-fingerprint';
import { ensureProvaFingerprintColumn } from '@/lib/prova-fingerprint-schema';

export const runtime = 'nodejs';

type Alternativa = { letra?: string; descricao?: string; texto?: string };

/** PostgreSQL rejeita U+0000 em campos text/utf8. */
function stripNullBytes(value: string): string {
  return value.replace(/\u0000/g, '');
}

/** Remove \\u0000 de todas as strings de um payload JSON (recursivo). */
function sanitizeJsonNullBytes<T>(value: T): T {
  if (typeof value === 'string') {
    return stripNullBytes(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonNullBytes(item)) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeJsonNullBytes(v);
    }
    return out as T;
  }
  return value;
}

const CATEGORIAS_NOME_PROVA = ['banca', 'regiao', 'ano', 'tipo'] as const;

function parseNomeProva(nome: string): { banca: string | null; regiao: string | null; ano: string | null; tipo: string | null } {
  const parts = nome.split('-').map((s) => s.trim()).filter((s) => s.length > 0);
  const result: { banca: string | null; regiao: string | null; ano: string | null; tipo: string | null } = {
    banca: null, regiao: null, ano: null, tipo: null,
  };
  CATEGORIAS_NOME_PROVA.forEach((cat, idx) => {
    if (parts[idx]) (result as Record<string, string | null>)[cat] = parts[idx];
  });
  return result;
}

function mapQuestaoToOptions(questoes: {
  numero?: number;
  titulo?: string;
  enunciado?: string;
  imagens?: unknown[];
  alternativas?: Alternativa[];
  alternativa_correta?: string | { letra?: string };
  letra_correta?: string;
  estado?: boolean;
  anulada?: boolean;
}[]) {
  return questoes.map((q) => {
    const alternativas = q.alternativas || [];
    const byLetter: Record<string, string> = {};
    alternativas.forEach((alt) => {
      const letra = stripNullBytes(alt.letra || '').toUpperCase().trim();
      const texto = stripNullBytes(String(alt.descricao ?? alt.texto ?? '')).trim();
      if (letra && letra >= 'A' && letra <= 'E') byLetter[letra] = texto;
    });
    const rawCorrect = q.alternativa_correta ?? q.letra_correta;
    const correctStr = typeof rawCorrect === 'object' && rawCorrect !== null && 'letra' in rawCorrect
      ? String((rawCorrect as { letra?: string }).letra || 'A')
      : String(rawCorrect || 'A');
    const correct = stripNullBytes(correctStr).toUpperCase().trim()[0] || 'A';
    const finalCorrect = ['A', 'B', 'C', 'D', 'E'].includes(correct) ? correct : 'A';
    if (!byLetter['A']) byLetter['A'] = 'Alternativa A';
    if (!byLetter['B']) byLetter['B'] = 'Alternativa B';
    // Apenas A/B são NOT NULL; C/D/E podem ser null se ausentes no JSON

    const rawImagens = Array.isArray(q.imagens) ? q.imagens : [];
    const hasMetadata = rawImagens.length > 0 && typeof rawImagens[0] === 'object' && rawImagens[0] !== null;
    const imagesMeta: unknown[] = hasMetadata
      ? (sanitizeJsonNullBytes(rawImagens) as unknown[])
      : [];
    const imagesBase64: string[] = hasMetadata
      ? []
      : (rawImagens.filter((i) => typeof i === 'string') as string[]).map(stripNullBytes);

    return {
      numero: (() => {
        const num = typeof q.numero === 'number' ? q.numero : parseInt(String(q.numero ?? ''), 10);
        return isNaN(num) ? 0 : num;
      })(),
      statement:
        stripNullBytes(String(q.titulo ?? q.enunciado ?? '')).trim() ||
        '(Sem enunciado)',
      option_a: byLetter['A'] || 'Alternativa A',
      option_b: byLetter['B'] || 'Alternativa B',
      option_c: byLetter['C']?.trim() ? byLetter['C'] : null,
      option_d: byLetter['D']?.trim() ? byLetter['D'] : null,
      option_e: byLetter['E']?.trim() ? byLetter['E'] : null,
      correct_answer: finalCorrect,
      images: imagesBase64,
      images_meta: imagesMeta,
      anulada: Boolean(q.estado ?? q.anulada ?? false),
    };
  });
}

type PaginaAntiga = {
  questao?: {
    prova?: string;
    numero?: string | number;
    enunciado?: string;
    alternativas?: { letra?: string; texto?: string; descricao?: string }[];
    alternativa_correta?: string | { letra?: string };
    imagem_enunciado?: string;
  };
  imagens?: { src?: string }[];
};

function normalizeImportPayload(body: Record<string, unknown>): { nome: string; questoes: unknown[] }[] {
  const provas = body.provas;
  if (Array.isArray(provas) && provas.length > 0) {
    return provas.map((p: Record<string, unknown>) => ({
      nome: String(p.nome ?? 'Prova sem nome').trim(),
      banca: p.banca,
      regiao: p.regiao,
      ano: p.ano,
      tipo: p.tipo,
      exam_board: p.exam_board,
      exam_region: p.exam_region,
      exam_year: p.exam_year,
      exam_type: p.exam_type,
      questoes: Array.isArray(p.questoes) ? p.questoes : (Array.isArray(p.questions) ? p.questions : []),
    }));
  }
  const paginas = body.paginas;
  if (Array.isArray(paginas) && paginas.length > 0) {
    const questoesPorProva: Record<string, {
      numero: number;
      titulo: string;
      enunciado: string;
      imagens: string[];
      alternativas: { letra: string; descricao: string; texto?: string }[];
      alternativa_correta: string | { letra?: string };
    }[]> = {};
    for (const pagina of paginas as PaginaAntiga[]) {
      const questao = pagina?.questao;
      if (!questao) continue;
      const provaNome = String(questao.prova ?? 'Prova sem nome').trim();
      if (!questoesPorProva[provaNome]) questoesPorProva[provaNome] = [];
      let numero = 0;
      if (questao.numero != null) {
        const n = typeof questao.numero === 'number' ? questao.numero : parseInt(String(questao.numero).replace(/\D/g, ''), 10);
        if (!Number.isNaN(n)) numero = n;
      }
      const imagens: string[] = [];
      if (questao.imagem_enunciado) imagens.push(questao.imagem_enunciado);
      for (const img of pagina.imagens ?? []) {
        if (img?.src && !imagens.includes(img.src)) imagens.push(img.src);
      }
      const alternativas = (questao.alternativas ?? []).map((alt) => ({
        letra: String(alt.letra ?? '').trim(),
        descricao: String(alt.descricao ?? alt.texto ?? '').trim(),
        texto: String(alt.texto ?? alt.descricao ?? '').trim(),
      }));
      const altCorreta = questao.alternativa_correta;
      questoesPorProva[provaNome].push({
        numero,
        titulo: String(questao.enunciado ?? '').trim(),
        enunciado: String(questao.enunciado ?? '').trim(),
        imagens,
        alternativas,
        alternativa_correta: typeof altCorreta === 'object' && altCorreta !== null && 'letra' in altCorreta
          ? (altCorreta as { letra?: string }).letra ?? 'A'
          : String(altCorreta ?? 'A'),
      });
    }
    return Object.keys(questoesPorProva)
      .sort()
      .map((nome) => ({
        nome,
        questoes: (questoesPorProva[nome] ?? []).sort((a, b) => a.numero - b.numero),
      }));
  }
  return [];
}

// ── GET /api/provas — paginated listing (no question content) ───────────────
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    if (token) token = token.trim().replace(/^["']|["']$/g, '');
    if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const user = verifyToken(token);
    if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });

    const url = request.nextUrl;
    const page  = Math.max(1, parseInt(url.searchParams.get('page')  ?? '1',  10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));
    const offset = (page - 1) * limit;

    const filterBanca  = url.searchParams.get('banca')  ?? '';
    const filterRegiao = url.searchParams.get('regiao') ?? '';
    const filterAno    = url.searchParams.get('ano')    ?? '';
    const filterTipo   = url.searchParams.get('tipo')   ?? '';
    const filterSearch = (url.searchParams.get('q') ?? url.searchParams.get('search') ?? '').trim();

    // Build WHERE clause
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filterSearch) {
      params.push(`%${filterSearch}%`);
      conditions.push(`LOWER(nome) LIKE LOWER($${params.length})`);
    }
    if (filterBanca)  { params.push(filterBanca);  conditions.push(`LOWER(banca)  = LOWER($${params.length})`); }
    if (filterRegiao) { params.push(filterRegiao); conditions.push(`regiao = $${params.length}`); }
    if (filterAno)    { params.push(filterAno);    conditions.push(`ano = $${params.length}`); }
    if (filterTipo)   { params.push(filterTipo);   conditions.push(`LOWER(tipo) = LOWER($${params.length})`); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count
    const countRes = await query(
      `SELECT COUNT(*) AS total FROM provas ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].total, 10);

    // Paginated provas with question count (no question content)
    const listParams = [...params, limit, offset];
    const listRes = await query(
      `SELECT p.id, p.nome, p.banca, p.regiao, p.ano, p.tipo, p.created_at,
              COUNT(q.id)::int AS question_count
       FROM provas p
       LEFT JOIN questions q ON q.prova_id = p.id
       ${where}
       GROUP BY p.id
       ORDER BY p.created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    // Available filter options (distinct values, unfiltered)
    const [bancasRes, tiposRes] = await Promise.all([
      query(`SELECT DISTINCT banca FROM provas WHERE banca IS NOT NULL AND banca <> '' ORDER BY banca`),
      query(`SELECT DISTINCT tipo  FROM provas WHERE tipo  IS NOT NULL AND tipo  <> '' ORDER BY tipo`),
    ]);

    return NextResponse.json({
      provas: listRes.rows.map((p: Record<string, unknown>) => ({
        id:             p.id,
        nome:           p.nome,
        banca:          p.banca,
        regiao:         p.regiao,
        ano:            p.ano,
        tipo:           p.tipo,
        created_at:     p.created_at,
        question_count: p.question_count ?? 0,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
      bancas: bancasRes.rows.map((r: Record<string, unknown>) => r.banca as string),
      tipos:  tiposRes.rows.map((r: Record<string, unknown>) => r.tipo  as string),
    });
  } catch (error) {
    console.error('Erro ao listar provas:', error);
    return NextResponse.json({ error: 'Erro ao listar provas' }, { status: 500 });
  }
}

// ── POST /api/provas — import idempotente + retomável ───────────────────────
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    if (token) token = token.trim().replace(/^["']|["']$/g, '');
    if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const user = verifyToken(token);
    if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });

    const body = sanitizeJsonNullBytes(
      (await request.json()) as Record<string, unknown>,
    );
    const updateExisting = body.update_existing !== false;

    await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS images_meta TEXT`);
    // Só A/B são obrigatórias; C/D podem ser nulas (questões com 2 alternativas)
    await query(`ALTER TABLE questions ALTER COLUMN option_c DROP NOT NULL`);
    await query(`ALTER TABLE questions ALTER COLUMN option_d DROP NOT NULL`);
    await ensureProvaFingerprintColumn();

    const rawProvas = normalizeImportPayload(body);
    if (rawProvas.length === 0) {
      return NextResponse.json({
        error: 'Formato não reconhecido. Envie um objeto com array "provas" ou array "paginas" (formato antigo do crawler).',
      }, { status: 400 });
    }

    type ProvaImportRow = {
      id: number;
      nome: string;
      banca: string | null;
      regiao: string | null;
      ano: string | null;
      tipo: string | null;
      created: boolean;
      expected: number;
      actual: number;
      inserted: number;
      already_existed: number;
      updated: number;
      missing_numbers: number[];
      complete: boolean;
      questions: { id: number; numero_na_prova: number }[];
    };

    const result: ProvaImportRow[] = [];
    const provaErrors: { nome: string; reason: string }[] = [];
    let provasCriadas = 0;
    let provasJaExistentes = 0;
    let questoesInseridas = 0;
    let questoesJaExistentes = 0;
    let questoesAtualizadas = 0;
    let questoesEsperadas = 0;

    const pool = getPool();

    for (const p of rawProvas) {
      const nome = String((p as { nome: string }).nome || 'Prova sem nome').trim();
      const client = await pool.connect();
      try {
        const parsed = parseNomeProva(nome);
        const pAny = p as Record<string, unknown>;
        const banca =
          pAny.banca != null && pAny.banca !== ''
            ? String(pAny.banca).trim()
            : pAny.exam_board != null && pAny.exam_board !== ''
              ? String(pAny.exam_board).trim()
              : (parsed.banca ?? null);
        const regiao =
          pAny.regiao != null && pAny.regiao !== ''
            ? String(pAny.regiao).trim()
            : pAny.exam_region != null && pAny.exam_region !== ''
              ? String(pAny.exam_region).trim()
              : (parsed.regiao ?? null);
        const ano =
          pAny.ano != null && pAny.ano !== ''
            ? String(pAny.ano).trim()
            : pAny.exam_year != null && pAny.exam_year !== ''
              ? String(pAny.exam_year).trim()
              : (parsed.ano ?? null);
        const tipo =
          pAny.tipo != null && pAny.tipo !== ''
            ? String(pAny.tipo).trim()
            : pAny.exam_type != null && pAny.exam_type !== ''
              ? String(pAny.exam_type).trim()
              : (parsed.tipo ?? null);

        const questoesRaw = Array.isArray((p as { questoes?: unknown[] }).questoes)
          ? (p as { questoes: unknown[] }).questoes
          : Array.isArray((p as Record<string, unknown>).questions)
            ? ((p as Record<string, unknown>).questions as unknown[])
            : [];
        const normalized = mapQuestaoToOptions(
          questoesRaw as Parameters<typeof mapQuestaoToOptions>[0],
        );

        // Deduplicar por numero_na_prova (última ocorrência vence)
        const byNumero = new Map<number, (typeof normalized)[number]>();
        for (const q of normalized) {
          const n = isNaN(q.numero) ? 0 : q.numero;
          byNumero.set(n, { ...q, numero: n });
        }
        const uniqueQuestions = Array.from(byNumero.values()).sort(
          (a, b) => a.numero - b.numero,
        );
        const expected = uniqueQuestions.length;
        questoesEsperadas += expected;

        const contentFingerprint = computeProvaContentFingerprint(
          uniqueQuestions.map((q) => ({
            numero: q.numero,
            statement: q.statement,
            option_a: q.option_a,
            option_b: q.option_b,
            correct_answer: q.correct_answer,
          })),
        );

        await client.query('BEGIN');

        // Match: 1) nome  2) metadados  3) fingerprint da sequência de questões
        // (mesmas questões na mesma ordem = mesma prova, mesmo com nome diferente)
        let provaId: number | null = null;
        let created = false;
        let matchedBy: 'nome' | 'meta' | 'conteudo' | 'nova' = 'nova';

        const byNome = await client.query(
          `SELECT id FROM provas WHERE lower(trim(nome)) = lower(trim($1)) LIMIT 1`,
          [nome],
        );
        if (byNome.rows[0]) {
          provaId = Number(byNome.rows[0].id);
          matchedBy = 'nome';
        } else if (banca || ano) {
          const byMeta = await client.query(
            `SELECT id FROM provas
             WHERE lower(trim(coalesce(banca, ''))) = lower(trim(coalesce($1, '')))
               AND trim(coalesce(ano, '')) = trim(coalesce($2, ''))
               AND lower(trim(coalesce(regiao, ''))) = lower(trim(coalesce($3, '')))
               AND lower(trim(coalesce(tipo, ''))) = lower(trim(coalesce($4, '')))
             LIMIT 1`,
            [banca, ano, regiao, tipo],
          );
          if (byMeta.rows[0]) {
            provaId = Number(byMeta.rows[0].id);
            matchedBy = 'meta';
          }
        }

        if (provaId == null && contentFingerprint && expected > 0) {
          const byContent = await client.query(
            `SELECT id FROM provas WHERE content_fingerprint = $1 LIMIT 1`,
            [contentFingerprint],
          );
          if (byContent.rows[0]) {
            provaId = Number(byContent.rows[0].id);
            matchedBy = 'conteudo';
          } else {
            // Fallback: provas sem fingerprint ainda — compara sequência pelo mesmo tamanho
            const candidates = await client.query(
              `SELECT p.id
               FROM provas p
               JOIN questions q ON q.prova_id = p.id AND q.numero_na_prova IS NOT NULL
               GROUP BY p.id
               HAVING COUNT(*) = $1`,
              [expected],
            );
            for (const row of candidates.rows as Array<{ id: number }>) {
              const qsRes = await client.query(
                `SELECT numero_na_prova AS numero, statement, option_a, option_b, correct_answer
                 FROM questions
                 WHERE prova_id = $1 AND numero_na_prova IS NOT NULL
                 ORDER BY numero_na_prova`,
                [row.id],
              );
              const fp = computeProvaContentFingerprint(
                (qsRes.rows as Array<{
                  numero: number;
                  statement: string;
                  option_a: string;
                  option_b: string;
                  correct_answer: string;
                }>).map((q) => ({
                  numero: Number(q.numero),
                  statement: String(q.statement ?? ''),
                  option_a: String(q.option_a ?? ''),
                  option_b: String(q.option_b ?? ''),
                  correct_answer: String(q.correct_answer ?? 'A'),
                })),
              );
              if (fp === contentFingerprint) {
                provaId = Number(row.id);
                matchedBy = 'conteudo';
                break;
              }
            }
          }
        }

        if (provaId == null) {
          const inserted = await client.query(
            `INSERT INTO provas (nome, banca, regiao, ano, tipo, content_fingerprint)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [nome, banca, regiao, ano, tipo, contentFingerprint || null],
          );
          provaId = Number(inserted.rows[0].id);
          created = true;
          matchedBy = 'nova';
          provasCriadas += 1;
        } else {
          provasJaExistentes += 1;
          await client.query(
            `UPDATE provas
             SET content_fingerprint = COALESCE(content_fingerprint, $1),
                 banca = COALESCE(banca, $2),
                 regiao = COALESCE(regiao, $3),
                 ano = COALESCE(ano, $4),
                 tipo = COALESCE(tipo, $5)
             WHERE id = $6`,
            [contentFingerprint || null, banca, regiao, ano, tipo, provaId],
          );
        }

        const existingRes = await client.query(
          `SELECT id, numero_na_prova FROM questions
           WHERE prova_id = $1 AND numero_na_prova IS NOT NULL`,
          [provaId],
        );
        const existingByNumero = new Map<number, number>();
        for (const row of existingRes.rows as Array<{ id: number; numero_na_prova: number }>) {
          existingByNumero.set(Number(row.numero_na_prova), Number(row.id));
        }

        let examYear: number | null = null;
        if (ano) {
          const parsedYear = parseInt(ano, 10);
          examYear = Number.isNaN(parsedYear) ? null : parsedYear;
        }

        const questionIds: { id: number; numero_na_prova: number }[] = [];
        let inserted = 0;
        let already = 0;
        let updated = 0;

        for (const q of uniqueQuestions) {
          const optA = q.option_a || 'Alternativa A';
          const optB = q.option_b || 'Alternativa B';
          const optC = q.option_c?.trim() ? q.option_c : null;
          const optD = q.option_d?.trim() ? q.option_d : null;
          const optE = q.option_e?.trim() ? q.option_e : null;
          const imagesJson = q.images?.length ? JSON.stringify(q.images) : null;
          const imagesMetaJson = q.images_meta?.length
            ? JSON.stringify(q.images_meta)
            : null;
          const questionNumber = q.numero;
          const existingId = existingByNumero.get(questionNumber);

          if (existingId != null) {
            already += 1;
            if (updateExisting) {
              await client.query(
                `UPDATE questions SET
                   statement = $1,
                   option_a = $2,
                   option_b = $3,
                   option_c = $4,
                   option_d = $5,
                   option_e = $6,
                   correct_answer = $7,
                   images = COALESCE($8, images),
                   images_meta = COALESCE($9, images_meta),
                   anulada = $10,
                   exam_year = COALESCE($11, exam_year),
                   exam_board = COALESCE($12, exam_board),
                   exam_region = COALESCE($13, exam_region),
                   exam_type = COALESCE($14, exam_type),
                   updated_at = NOW()
                 WHERE id = $15`,
                [
                  q.statement || '(Sem enunciado)',
                  optA,
                  optB,
                  optC,
                  optD,
                  optE,
                  q.correct_answer,
                  imagesJson,
                  imagesMetaJson,
                  q.anulada ?? false,
                  examYear,
                  banca,
                  regiao,
                  tipo,
                  existingId,
                ],
              );
              updated += 1;
            }
            questionIds.push({ id: existingId, numero_na_prova: questionNumber });
            continue;
          }

          const qResult = await client.query(
            `INSERT INTO questions (
               statement, option_a, option_b, option_c, option_d, option_e,
               correct_answer, explanation, tags, images, exam_year, exam_board,
               exam_institution, exam_region, exam_type, prova_id, numero_na_prova,
               anulada, images_meta
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
             ) RETURNING id`,
            [
              q.statement || '(Sem enunciado)',
              optA,
              optB,
              optC,
              optD,
              optE,
              q.correct_answer,
              null,
              null,
              imagesJson,
              examYear,
              banca,
              null,
              regiao,
              tipo,
              provaId,
              questionNumber,
              q.anulada ?? false,
              imagesMetaJson,
            ],
          );
          const newId = Number(qResult.rows[0].id);
          existingByNumero.set(questionNumber, newId);
          questionIds.push({ id: newId, numero_na_prova: questionNumber });
          inserted += 1;
        }

        // Sempre grava/atualiza fingerprint após a sequência estar no banco
        await client.query(
          `UPDATE provas SET content_fingerprint = $1 WHERE id = $2`,
          [contentFingerprint || null, provaId],
        );

        await client.query('COMMIT');

        const countRes = await query(
          `SELECT COUNT(*)::int AS n FROM questions WHERE prova_id = $1`,
          [provaId],
        );
        const actual = Number(countRes.rows[0]?.n ?? 0);
        const dbNumsRes = await query(
          `SELECT numero_na_prova FROM questions
           WHERE prova_id = $1 AND numero_na_prova IS NOT NULL`,
          [provaId],
        );
        const dbNums = new Set(
          (dbNumsRes.rows as Array<{ numero_na_prova: number }>).map((r) =>
            Number(r.numero_na_prova),
          ),
        );
        const missingAfter = uniqueQuestions
          .map((q) => q.numero)
          .filter((n) => !dbNums.has(n));
        const complete = missingAfter.length === 0 && actual >= expected;

        questoesInseridas += inserted;
        questoesJaExistentes += already;
        questoesAtualizadas += updated;

        result.push({
          id: provaId,
          nome,
          banca,
          regiao,
          ano,
          tipo,
          created,
          matched_by: matchedBy,
          expected,
          actual,
          inserted,
          already_existed: already,
          updated,
          missing_numbers: missingAfter,
          complete,
          questions: questionIds,
        });
      } catch (provaError) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
        console.error(`Erro ao importar prova "${nome}":`, provaError);
        provaErrors.push({
          nome,
          reason:
            provaError instanceof Error ? provaError.message : String(provaError),
        });
      } finally {
        client.release();
      }
    }

    const incompletas = result.filter((p) => !p.complete);
    const questoesFaltando = incompletas.reduce(
      (s, p) => s + p.missing_numbers.length,
      0,
    );
    const allComplete =
      incompletas.length === 0 && provaErrors.length === 0 && result.length > 0;

    const summary = {
      // Nomes canônicos (ideia 1)
      provas_criadas: provasCriadas,
      provas_ja_existentes: provasJaExistentes,
      provas_incompletas: incompletas.length,
      provas_completas: result.filter((p) => p.complete).length,
      provas_com_erro: provaErrors.length,
      questoes_inseridas: questoesInseridas,
      questoes_ja_existentes: questoesJaExistentes,
      questoes_atualizadas: questoesAtualizadas,
      questoes_faltando: questoesFaltando,
      questoes_esperadas: questoesEsperadas,
      // Aliases legados (UI antiga)
      provasImportadas: provasCriadas,
      provasIgnoradas: provasJaExistentes,
      questoesImportadas: questoesInseridas,
      provasComErro: provaErrors.length,
    };

    return NextResponse.json({
      success: allComplete,
      partial: !allComplete && (result.length > 0 || provaErrors.length > 0),
      provas: result,
      provas_incompletas: incompletas.map((p) => ({
        id: p.id,
        nome: p.nome,
        esperado: p.expected,
        atual: p.actual,
        faltando: p.missing_numbers.length,
        faltando_numeros: p.missing_numbers,
      })),
      errors: provaErrors,
      summary,
    });
  } catch (error) {
    console.error('Erro ao importar provas:', error);
    return NextResponse.json({ error: 'Erro ao importar provas' }, { status: 500 });
  }
}

