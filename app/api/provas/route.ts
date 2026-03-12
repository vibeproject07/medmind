import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { verifyToken } from '@/lib/jwt';

export const runtime = 'nodejs';

type Alternativa = { letra?: string; descricao?: string; texto?: string };

/** Categorias extraídas do nome da prova (ordem: banca, regiao, ano, tipo). */
const CATEGORIAS_NOME_PROVA = ['banca', 'regiao', 'ano', 'tipo'] as const;

/**
 * Faz o split do nome da prova pelos travessões "-" e designa cada parte às categorias
 * (banca, regiao, ano, tipo) na ordem. Partes vazias após trim são ignoradas.
 * Ex: "ABC-SP-2021-R1" -> { banca: "ABC", regiao: "SP", ano: "2021", tipo: "R1" }
 */
function parseNomeProva(nome: string): { banca: string | null; regiao: string | null; ano: string | null; tipo: string | null } {
  const parts = nome
    .split('-')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const result: { banca: string | null; regiao: string | null; ano: string | null; tipo: string | null } = {
    banca: null,
    regiao: null,
    ano: null,
    tipo: null,
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
      numero: typeof q.numero === 'number' ? q.numero : parseInt(String(q.numero), 10) || 0,
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

/** Formato antigo: lista de páginas com questao dentro (ex.: saída do crawler). */
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

/**
 * Normaliza o payload de importação: aceita formato novo { provas } ou formato antigo { paginas }.
 * No formato antigo, agrupa por questao.prova e monta provas com nome (trim) e questoes.
 * O nome é sempre trimado; as categorias (banca, regiao, ano, tipo) serão preenchidas depois por parseNomeProva quando não vierem no objeto.
 */
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

/**
 * GET /api/provas
 * Lista todas as provas com suas questões (para exibir na página Provas na Íntegra).
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    let token = authHeader?.replace('Bearer ', '') || request.cookies.get('token')?.value;
    if (token) token = token.trim().replace(/^["']|["']$/g, '');
    if (!token) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const user = verifyToken(token);
    if (!user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 });

    const db = getDatabase();
    const provasRows = db.prepare('SELECT id, nome, banca, regiao, ano, tipo, created_at FROM provas ORDER BY created_at DESC').all() as { id: number; nome: string; banca: string | null; regiao: string | null; ano: string | null; tipo: string | null; created_at: string }[];
    const questionsRows = db.prepare(`
      SELECT id, statement, option_a, option_b, option_c, option_d, option_e, correct_answer, images, exam_board, exam_region, exam_year, exam_type, prova_id, numero_na_prova
      FROM questions WHERE prova_id IS NOT NULL ORDER BY prova_id, numero_na_prova
    `).all() as any[];

    const questionsByProvaId: Record<number, any[]> = {};
    questionsRows.forEach((q) => {
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

    const provas = provasRows.map((p) => ({
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

/**
 * POST /api/provas/import
 * Importa JSON de provas e questões; cria registros em provas e questions.
 * Body: { provas: [ { nome, banca?, regiao?, ano?, tipo?, questoes: [ { numero, titulo|enunciado, alternativas, alternativa_correta, imagens? } ] } ] }
 */
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

    const db = getDatabase();
    const insertProva = db.prepare('INSERT INTO provas (nome, banca, regiao, ano, tipo) VALUES (?, ?, ?, ?, ?)');
    const insertQuestion = db.prepare(`
      INSERT INTO questions (statement, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, tags, images, exam_year, exam_board, exam_institution, exam_region, exam_type, prova_id, numero_na_prova)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result: { id: number; nome: string; banca: string | null; regiao: string | null; ano: string | null; tipo: string | null; questions: { id: number; numero_na_prova: number }[] }[] = [];

    for (const p of rawProvas) {
      const nome = String((p as { nome: string }).nome || 'Prova sem nome').trim();
      const parsed = parseNomeProva(nome);
      const pAny = p as Record<string, unknown>;
      const banca = (pAny.banca != null && pAny.banca !== '') ? String(pAny.banca).trim() : (parsed.banca ?? null);
      const regiao = (pAny.regiao != null && pAny.regiao !== '') ? String(pAny.regiao).trim() : (parsed.regiao ?? null);
      const ano = (pAny.ano != null && pAny.ano !== '') ? String(pAny.ano).trim() : ((pAny.exam_year != null && pAny.exam_year !== '') ? String(pAny.exam_year).trim() : (parsed.ano ?? null));
      const tipo = (pAny.tipo != null && pAny.tipo !== '') ? String(pAny.tipo).trim() : (pAny.exam_type != null && pAny.exam_type !== '' ? String(pAny.exam_type).trim() : (parsed.tipo ?? null));
      const provasRun = insertProva.run(nome, banca, regiao, ano, tipo);
      const provaId = Number((provasRun as { lastInsertRowid: number }).lastInsertRowid);

      const questoes = Array.isArray((p as { questoes?: unknown[] }).questoes) ? (p as { questoes: unknown[] }).questoes : (Array.isArray((p as { questions?: unknown[] }).questions) ? (p as { questions: unknown[] }).questions : []);
      const normalized = mapQuestaoToOptions(questoes);
      const questionIds: { id: number; numero_na_prova: number }[] = [];

      for (const q of normalized) {
        const optA = q.option_a || 'Alternativa A';
        const optB = q.option_b || 'Alternativa B';
        const imagesJson = q.images?.length ? JSON.stringify(q.images) : null;
        const qRun = insertQuestion.run(
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
          ano ? parseInt(ano, 10) : null,
          banca,
          null,
          regiao,
          tipo,
          provaId,
          q.numero
        );
        const qId = Number((qRun as { lastInsertRowid: number }).lastInsertRowid);
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
