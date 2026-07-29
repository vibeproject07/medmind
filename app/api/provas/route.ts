import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

export const runtime = 'nodejs';

type Alternativa = { letra?: string; descricao?: string; texto?: string };

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
      const letra = (alt.letra || '').toUpperCase().trim();
      const texto = String(alt.descricao ?? alt.texto ?? '').trim();
      if (letra && letra >= 'A' && letra <= 'E') byLetter[letra] = texto;
    });
    const rawCorrect = q.alternativa_correta ?? q.letra_correta;
    const correctStr = typeof rawCorrect === 'object' && rawCorrect !== null && 'letra' in rawCorrect
      ? String((rawCorrect as { letra?: string }).letra || 'A')
      : String(rawCorrect || 'A');
    const correct = correctStr.toUpperCase().trim()[0] || 'A';
    const finalCorrect = ['A', 'B', 'C', 'D', 'E'].includes(correct) ? correct : 'A';
    if (!byLetter['A']) byLetter['A'] = 'Alternativa A';
    if (!byLetter['B']) byLetter['B'] = 'Alternativa B';

    const rawImagens = Array.isArray(q.imagens) ? q.imagens : [];
    const hasMetadata = rawImagens.length > 0 && typeof rawImagens[0] === 'object' && rawImagens[0] !== null;
    const imagesMeta: unknown[] = hasMetadata ? rawImagens : [];
    const imagesBase64: string[] = hasMetadata ? [] : rawImagens.filter((i) => typeof i === 'string') as string[];

    return {
      numero: (() => {
        const num = typeof q.numero === 'number' ? q.numero : parseInt(String(q.numero ?? ''), 10);
        return isNaN(num) ? 0 : num;
      })(),
      statement: String(q.titulo ?? q.enunciado ?? '').trim() || '(Sem enunciado)',
      option_a: byLetter['A'] || '',
      option_b: byLetter['B'] || '',
      option_c: byLetter['C'] || null,
      option_d: byLetter['D'] || null,
      option_e: byLetter['E'] || null,
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

// ── POST /api/provas — import ───────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    if (token) token = token.trim().replace(/^["']|["']$/g, '');
    if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const user = verifyToken(token);
    if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });

    const body = await request.json() as Record<string, unknown>;
    await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS images_meta TEXT`);

    const rawProvas = normalizeImportPayload(body);
    if (rawProvas.length === 0) {
      return NextResponse.json({
        error: 'Formato não reconhecido. Envie um objeto com array "provas" ou array "paginas" (formato antigo do crawler).',
      }, { status: 400 });
    }

    const result: { id: number; nome: string; banca: string | null; regiao: string | null; ano: string | null; tipo: string | null; questions: { id: number; numero_na_prova: number }[]; skipped?: boolean }[] = [];
    const provaErrors: { nome: string; reason: string }[] = [];
    let totalQuestoesImportadas = 0;
    let totalProvasIgnoradas = 0;

    for (const p of rawProvas) {
      const nome = String((p as { nome: string }).nome || 'Prova sem nome').trim();
      try {
        const parsed = parseNomeProva(nome);
        const pAny = p as Record<string, unknown>;
        const banca = (pAny.banca != null && pAny.banca !== '') ? String(pAny.banca).trim() : (parsed.banca ?? null);
        const regiao = (pAny.regiao != null && pAny.regiao !== '') ? String(pAny.regiao).trim() : (parsed.regiao ?? null);
        const ano = (pAny.ano != null && pAny.ano !== '') ? String(pAny.ano).trim() : ((pAny.exam_year != null && pAny.exam_year !== '') ? String(pAny.exam_year).trim() : (parsed.ano ?? null));
        const tipo = (pAny.tipo != null && pAny.tipo !== '') ? String(pAny.tipo).trim() : (pAny.exam_type != null && pAny.exam_type !== '' ? String(pAny.exam_type).trim() : (parsed.tipo ?? null));

        const existingProva = await query('SELECT id FROM provas WHERE nome = $1 LIMIT 1', [nome]);
        if (existingProva.rows.length > 0) {
          totalProvasIgnoradas++;
          result.push({ id: existingProva.rows[0].id, nome, banca, regiao, ano, tipo, questions: [], skipped: true });
          continue;
        }

        const provaResult = await query(
          'INSERT INTO provas (nome, banca, regiao, ano, tipo) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [nome, banca, regiao, ano, tipo]
        );
        const provaId = provaResult.rows[0].id;

        const questoes = Array.isArray((p as { questoes?: unknown[] }).questoes) ? (p as { questoes: unknown[] }).questoes : (Array.isArray((p as Record<string, unknown>).questions) ? (p as Record<string, unknown>).questions as unknown[] : []);
        const normalized = mapQuestaoToOptions(questoes);
        const questionIds: { id: number; numero_na_prova: number }[] = [];

        for (const q of normalized) {
          const optA = q.option_a || 'Alternativa A';
          const optB = q.option_b || 'Alternativa B';
          const imagesJson = q.images?.length ? JSON.stringify(q.images) : null;
          const imagesMetaJson = q.images_meta?.length ? JSON.stringify(q.images_meta) : null;

          let examYear: number | null = null;
          if (ano) {
            const parsedYear = parseInt(ano, 10);
            examYear = isNaN(parsedYear) ? null : parsedYear;
          }

          const questionNumber = isNaN(q.numero) ? 0 : q.numero;
          const safeProvaId = isNaN(provaId) ? null : provaId;

          const qResult = await query(
            `INSERT INTO questions (statement, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, tags, images, exam_year, exam_board, exam_institution, exam_region, exam_type, prova_id, numero_na_prova, anulada, images_meta)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
            [
              q.statement || '(Sem enunciado)',
              optA, optB, q.option_c, q.option_d, q.option_e,
              q.correct_answer, null, null, imagesJson, examYear,
              banca, null, regiao, tipo, safeProvaId, questionNumber, q.anulada ?? false,
              imagesMetaJson,
            ]
          );
          questionIds.push({ id: qResult.rows[0].id, numero_na_prova: q.numero });
          totalQuestoesImportadas++;
        }

        result.push({ id: provaId, nome, banca, regiao, ano, tipo, questions: questionIds });
      } catch (provaError) {
        console.error(`Erro ao importar prova "${nome}":`, provaError);
        provaErrors.push({ nome, reason: provaError instanceof Error ? provaError.message : String(provaError) });
      }
    }

    const provasNovas = result.filter((p) => !p.skipped).length;
    return NextResponse.json({
      success: true,
      partial: provaErrors.length > 0,
      provas: result,
      errors: provaErrors,
      summary: {
        provasImportadas: provasNovas,
        provasIgnoradas: totalProvasIgnoradas,
        questoesImportadas: totalQuestoesImportadas,
        provasComErro: provaErrors.length,
      },
    });
  } catch (error) {
    console.error('Erro ao importar provas:', error);
    return NextResponse.json({ error: 'Erro ao importar provas' }, { status: 500 });
  }
}
