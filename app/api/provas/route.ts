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
  imagens?: string[];
  alternativas?: Alternativa[];
  alternativa_correta?: string | { letra?: string };
}[]) {
  return questoes.map((q) => {
    const alternativas = q.alternativas || [];
    const byLetter: Record<string, string> = {};
    alternativas.forEach((alt) => {
      const letra = (alt.letra || '').toUpperCase().trim();
      const texto = String(alt.descricao ?? alt.texto ?? '').trim();
      if (letra && letra >= 'A' && letra <= 'E') byLetter[letra] = texto;
    });
    const rawCorrect = q.alternativa_correta;
    const correctStr = typeof rawCorrect === 'object' && rawCorrect !== null && 'letra' in rawCorrect
      ? String((rawCorrect as { letra?: string }).letra || 'A')
      : String(rawCorrect || 'A');
    const correct = correctStr.toUpperCase().trim()[0] || 'A';
    const finalCorrect = ['A', 'B', 'C', 'D', 'E'].includes(correct) ? correct : 'A';
    if (!byLetter['A']) byLetter['A'] = 'Alternativa A';
    if (!byLetter['B']) byLetter['B'] = 'Alternativa B';
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
      images: Array.isArray(q.imagens) ? q.imagens : [],
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

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    if (token) token = token.trim().replace(/^["']|["']$/g, '');
    if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const user = verifyToken(token);
    if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });

    const provasRows = (await query('SELECT id, nome, banca, regiao, ano, tipo, created_at FROM provas ORDER BY created_at DESC')).rows;
    const questionsRows = (await query(`
      SELECT id, statement, option_a, option_b, option_c, option_d, option_e, correct_answer, images, exam_board, exam_region, exam_year, exam_type, prova_id, numero_na_prova
      FROM questions WHERE prova_id IS NOT NULL ORDER BY prova_id, numero_na_prova
    `)).rows;

    const questionsByProvaId: Record<number, any[]> = {};
    questionsRows.forEach((q: any) => {
      const pid = q.prova_id;
      if (pid == null) return;
      if (!questionsByProvaId[pid]) questionsByProvaId[pid] = [];
      questionsByProvaId[pid].push({
        id: q.id,
        numero_na_prova: q.numero_na_prova,
        statement: q.statement,
        option_a: q.option_a,
        option_b: q.option_b,
        option_c: q.option_c,
        option_d: q.option_d,
        option_e: q.option_e,
        correct_answer: q.correct_answer,
        images: q.images ? (typeof q.images === 'string' ? JSON.parse(q.images) : q.images) : [],
        exam_board: q.exam_board,
        exam_region: q.exam_region,
        exam_year: q.exam_year,
        exam_type: q.exam_type,
      });
    });

    const provas = provasRows.map((p: any) => ({
      id: p.id,
      nome: p.nome,
      banca: p.banca,
      regiao: p.regiao,
      ano: p.ano,
      tipo: p.tipo,
      created_at: p.created_at,
      questions: questionsByProvaId[p.id] || [],
    }));

    return NextResponse.json(provas);
  } catch (error) {
    console.error('Erro ao listar provas:', error);
    return NextResponse.json({ error: 'Erro ao listar provas' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    if (token) token = token.trim().replace(/^["']|["']$/g, '');
    if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const user = verifyToken(token);
    if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });

    const body = await request.json() as Record<string, unknown>;
    const rawProvas = normalizeImportPayload(body);
    if (rawProvas.length === 0) {
      return NextResponse.json({
        error: 'Formato não reconhecido. Envie um objeto com array "provas" ou array "paginas" (formato antigo do crawler).',
      }, { status: 400 });
    }

    const result: { id: number; nome: string; banca: string | null; regiao: string | null; ano: string | null; tipo: string | null; questions: { id: number; numero_na_prova: number }[] }[] = [];

    for (const p of rawProvas) {
      const nome = String((p as { nome: string }).nome || 'Prova sem nome').trim();
      const parsed = parseNomeProva(nome);
      const pAny = p as Record<string, unknown>;
      const banca = (pAny.banca != null && pAny.banca !== '') ? String(pAny.banca).trim() : (parsed.banca ?? null);
      const regiao = (pAny.regiao != null && pAny.regiao !== '') ? String(pAny.regiao).trim() : (parsed.regiao ?? null);
      const ano = (pAny.ano != null && pAny.ano !== '') ? String(pAny.ano).trim() : ((pAny.exam_year != null && pAny.exam_year !== '') ? String(pAny.exam_year).trim() : (parsed.ano ?? null));
      const tipo = (pAny.tipo != null && pAny.tipo !== '') ? String(pAny.tipo).trim() : (pAny.exam_type != null && pAny.exam_type !== '' ? String(pAny.exam_type).trim() : (parsed.tipo ?? null));

      const provaResult = await query(
        'INSERT INTO provas (nome, banca, regiao, ano, tipo) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [nome, banca, regiao, ano, tipo]
      );
      const provaId = provaResult.rows[0].id;

      const questoes = Array.isArray((p as { questoes?: unknown[] }).questoes) ? (p as { questoes: unknown[] }).questoes : (Array.isArray((p as any).questions) ? (p as any).questions : []);
      const normalized = mapQuestaoToOptions(questoes);
      const questionIds: { id: number; numero_na_prova: number }[] = [];

      for (const q of normalized) {
        const optA = q.option_a || 'Alternativa A';
        const optB = q.option_b || 'Alternativa B';
        const imagesJson = q.images?.length ? JSON.stringify(q.images) : null;
        const examYear = ano ? parseInt(ano, 10) : null;
        const questionNumber = isNaN(q.numero) ? 0 : q.numero;
        const safeProvaId = isNaN(provaId) ? null : provaId;
        
        const qResult = await query(
          `INSERT INTO questions (statement, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, tags, images, exam_year, exam_board, exam_institution, exam_region, exam_type, prova_id, numero_na_prova)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
          [
            q.statement || '(Sem enunciado)',
            optA,
            optB,
            q.option_c,
            q.option_d,
            q.option_e,
            q.correct_answer,
            null,
            null,
            imagesJson,
            examYear,
            banca,
            null,
            regiao,
            tipo,
            safeProvaId,
            questionNumber
          ]
        );
        const qId = qResult.rows[0].id;
        questionIds.push({ id: qId, numero_na_prova: q.numero });
      }

      result.push({ id: provaId, nome, banca, regiao, ano, tipo, questions: questionIds });
    }

    return NextResponse.json({ success: true, provas: result });
  } catch (error) {
    console.error('Erro ao importar provas:', error);
    return NextResponse.json({ error: 'Erro ao importar provas' }, { status: 500 });
  }
}
