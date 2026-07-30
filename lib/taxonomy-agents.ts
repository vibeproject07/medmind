import { GoogleGenAI } from '@google/genai';
import { getRuntimeAgent } from '@/lib/ai-agent-runtime';
import { buildDeCSQuestionText } from '@/lib/decs-pipeline';
import { query } from '@/lib/db';
import { buildGeminiSdkUserParts } from '@/lib/gemini-question-images';
import {
  buildAgentTokenUsage,
  type AgentTokenUsage,
} from '@/lib/gemini-token-usage';
import {
  ensureTaxonomyTables,
  normalizeTaxonomyLabel,
} from '@/lib/taxonomy-schema';

export interface CompetenciaGroup {
  competencia: string;
  conteudos: string[];
  id?: string;
  justificativa?: string;
  principal?: boolean;
}

export interface NovaCompetencia {
  id?: string;
  nome: string;
  descricao?: string;
  categoria?: string;
  justificativa_criacao?: string;
}

export interface HabilitiesResult {
  competencias: CompetenciaGroup[];
  novas_competencias?: NovaCompetencia[];
}

export interface TemaGroup {
  tema: string;
  subtemas: string[];
  principal?: boolean;
}

export interface ThemesAssignResult {
  temas: TemaGroup[];
  tema_principal?: string;
}

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function safeParseJsonObject(rawText: string): Record<string, unknown> {
  const cleaned = stripJsonFences(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      'O agente retornou JSON inválido ou incompleto. Tente novamente.',
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Resposta do agente não é um objeto JSON');
  }
  return parsed as Record<string, unknown>;
}

export function parseHabilitiesResult(rawText: string): HabilitiesResult {
  const parsed = safeParseJsonObject(rawText);
  const competencias: CompetenciaGroup[] = [];
  const novas: NovaCompetencia[] = [];

  // Formato aninhado (defaults): { competencias: [{ competencia, conteudos }] }
  const groups = Array.isArray(parsed.competencias) ? parsed.competencias : [];
  for (const g of groups as Array<Record<string, unknown>>) {
    const nestedName = normalizeTaxonomyLabel(String(g?.competencia ?? ''));
    const nome = nestedName || normalizeTaxonomyLabel(String(g?.nome ?? ''));
    if (!nome) continue;

    const conteudosNested = Array.isArray(g?.conteudos)
      ? (g.conteudos as unknown[])
          .map((c) => normalizeTaxonomyLabel(String(c ?? '')))
          .filter(Boolean)
      : [];

    // Formato do agente em produção: sem conteudos; usa categoria se houver
    const categoria = normalizeTaxonomyLabel(String(g?.categoria ?? ''));
    const conteudos =
      conteudosNested.length > 0
        ? [...new Set(conteudosNested)]
        : categoria
          ? [categoria]
          : [];

    competencias.push({
      competencia: nome,
      conteudos,
      id: g?.id != null ? String(g.id) : undefined,
      justificativa:
        g?.justificativa != null ? String(g.justificativa) : undefined,
      principal: g?.principal === true,
    });
  }

  const novasRaw = Array.isArray(parsed.novas_competencias)
    ? parsed.novas_competencias
    : [];
  for (const n of novasRaw as Array<Record<string, unknown>>) {
    const nome = normalizeTaxonomyLabel(String(n?.nome ?? ''));
    if (!nome) continue;
    novas.push({
      id: n?.id != null ? String(n.id) : undefined,
      nome,
      descricao: n?.descricao != null ? String(n.descricao) : undefined,
      categoria: n?.categoria != null ? String(n.categoria) : undefined,
      justificativa_criacao:
        n?.justificativa_criacao != null
          ? String(n.justificativa_criacao)
          : undefined,
    });
  }

  return {
    competencias,
    novas_competencias: novas,
  };
}

export function parseThemesAssignResult(rawText: string): ThemesAssignResult {
  const parsed = safeParseJsonObject(rawText);

  // Formato aninhado: { temas: [{ tema, subtemas }] }
  if (
    Array.isArray(parsed.temas) &&
    parsed.temas.length > 0 &&
    typeof (parsed.temas as unknown[])[0] === 'object' &&
    (parsed.temas as unknown[])[0] != null
  ) {
    const temas: TemaGroup[] = [];
    for (const g of parsed.temas as Array<Record<string, unknown>>) {
      const tema = normalizeTaxonomyLabel(String(g?.tema ?? ''));
      if (!tema) continue;
      const subtemasRaw = (Array.isArray(g?.subtemas) ? g.subtemas : [])
        .map((s: unknown) => normalizeTaxonomyLabel(String(s ?? '')))
        .filter(Boolean);
      const subtemas =
        subtemasRaw.length > 0 ? [...new Set(subtemasRaw)] : [tema];
      temas.push({
        tema,
        subtemas,
        principal: g?.principal === true,
      });
    }
    const principalName =
      normalizeTaxonomyLabel(String(parsed.tema_principal ?? '')) ||
      temas.find((t) => t.principal)?.tema ||
      temas[0]?.tema;
    if (principalName) {
      for (const t of temas) {
        t.principal = t.tema === principalName;
      }
    }
    return {
      temas,
      tema_principal: principalName || undefined,
    };
  }

  // Formato flat legado:
  // { temas: string[], subtemas: string[], tema_principal: string }
  const temaNames = (Array.isArray(parsed.temas) ? parsed.temas : [])
    .map((t) => normalizeTaxonomyLabel(String(t ?? '')))
    .filter(Boolean);
  const subtemas = (Array.isArray(parsed.subtemas) ? parsed.subtemas : [])
    .map((s) => normalizeTaxonomyLabel(String(s ?? '')))
    .filter(Boolean);
  const temaPrincipal =
    normalizeTaxonomyLabel(String(parsed.tema_principal ?? '')) ||
    temaNames[0] ||
    '';

  const temas: TemaGroup[] = [];
  if (temaPrincipal) {
    temas.push({
      tema: temaPrincipal,
      subtemas: subtemas.length > 0 ? [...new Set(subtemas)] : [temaPrincipal],
      principal: true,
    });
  }
  for (const t of temaNames) {
    if (t === temaPrincipal) continue;
    temas.push({ tema: t, subtemas: [t], principal: false });
  }

  return {
    temas,
    tema_principal: temaPrincipal || undefined,
  };
}

/** Agrupa themes_catalog em [{ tema, subtemas[] }] para injeção eficiente. */
export function groupThemesCatalog(
  rows: Array<{ tema: string; subtema: string }>,
): Array<{ tema: string; subtemas: string[] }> {
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const tema = normalizeTaxonomyLabel(String(r.tema ?? ''));
    const subtema = normalizeTaxonomyLabel(String(r.subtema ?? ''));
    if (!tema) continue;
    if (!map.has(tema)) map.set(tema, []);
    if (subtema) {
      const list = map.get(tema)!;
      if (!list.some((s) => s.toLowerCase() === subtema.toLowerCase())) {
        list.push(subtema);
      }
    }
  }
  return [...map.entries()].map(([tema, subtemas]) => ({ tema, subtemas }));
}

async function callTaxonomyAgent(
  agentKey: string,
  userMessage: string,
  systemInstructionOverride?: string,
  imagesRaw?: unknown,
): Promise<{ text: string; token_usage: AgentTokenUsage }> {
  const geminiKey = (
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
  )?.trim();
  if (!geminiKey) throw new Error('GEMINI_API_KEY não configurada');

  const agent = await getRuntimeAgent(agentKey);
  const systemInstruction =
    systemInstructionOverride?.trim() || agent.system_instruction;

  const parts = buildGeminiSdkUserParts(userMessage, imagesRaw);

  const ai = new GoogleGenAI({ apiKey: geminiKey, apiVersion: 'v1beta' });
  const response = await ai.models.generateContent({
    model: agent.model,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction,
      temperature: agent.temperature,
      maxOutputTokens: agent.max_output_tokens,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
    } as Record<string, unknown>,
  });

  const resp = response as {
    text?: string;
    usageMetadata?: Record<string, number>;
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    }>;
  };
  const fromParts =
    resp?.candidates?.[0]?.content?.parts
      ?.filter((p) => !p?.thought)
      ?.map((p) => p?.text)
      .filter(Boolean)
      .join('') ?? '';
  const text = (typeof resp?.text === 'string' ? resp.text : '') || fromParts;
  return {
    text,
    token_usage: buildAgentTokenUsage(agentKey, agent.model, resp),
  };
}

function fillPromptPlaceholders(
  template: string,
  vars: Record<string, string>,
): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

export async function classifyQuestionHabilities(
  question: Record<string, unknown>,
) {
  await ensureTaxonomyTables();

  const catalog = await query(
    `SELECT id, competencia, conteudo, origin
     FROM competencies_catalog
     ORDER BY competencia ASC, conteudo ASC`,
  );

  const listaCompetencias = catalog.rows.map((r) => ({
    id: String(r.id),
    nome: r.competencia,
    conteudo: r.conteudo,
    origin: r.origin,
  }));

  const questionText = buildDeCSQuestionText({
    statement: question.statement as string,
    option_a: question.option_a as string,
    option_b: question.option_b as string,
    option_c: question.option_c as string | null,
    option_d: question.option_d as string | null,
    option_e: question.option_e as string | null,
    correct_answer: question.correct_answer as string | null,
  });

  const agent = await getRuntimeAgent('habilities_agent');
  const hasPlaceholders =
    agent.system_instruction.includes('{{QUESTAO}}') ||
    agent.system_instruction.includes('{{LISTA_COMPETENCIAS}}');

  let systemInstruction = agent.system_instruction;
  let userMessage = questionText;

  if (hasPlaceholders) {
    systemInstruction = fillPromptPlaceholders(agent.system_instruction, {
      QUESTAO: questionText,
      RESPOSTA_CORRETA: String(question.correct_answer ?? ''),
      LISTA_COMPETENCIAS: JSON.stringify(listaCompetencias, null, 2),
    });
    userMessage =
      'Classifique as competências desta questão conforme as instruções do sistema. Retorne apenas o JSON.';
  } else {
    userMessage = [
      questionText,
      '',
      'Lista de competências do catálogo (use prioritariamente):',
      JSON.stringify(listaCompetencias, null, 2),
    ].join('\n');
  }

  const { text: rawText, token_usage } = await callTaxonomyAgent(
    'habilities_agent',
    userMessage,
    systemInstruction,
    question.images,
  );
  const result = parseHabilitiesResult(rawText);
  if (
    result.competencias.length === 0 &&
    !(result.novas_competencias && result.novas_competencias.length > 0)
  ) {
    throw new Error('O agente não identificou competências/conteúdos.');
  }

  const questionId = Number(question.id);
  await query(
    `UPDATE questions SET ai_habilities = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(result), questionId],
  );

  let pendingInserted = 0;

  // Novas competências propostas pela IA → fila de validação
  for (const nova of result.novas_competencias ?? []) {
    const competencia = nova.nome;
    const conteudo =
      normalizeTaxonomyLabel(nova.categoria || '') ||
      normalizeTaxonomyLabel(nova.descricao || '') ||
      '—';

    const exists = await query(
      `SELECT 1 FROM competencies_catalog
       WHERE lower(competencia) = lower($1) AND lower(conteudo) = lower($2)
       LIMIT 1`,
      [competencia, conteudo],
    );
    if (exists.rows.length > 0) continue;

    const alreadyPending = await query(
      `SELECT 1 FROM competencies_pending
       WHERE lower(competencia) = lower($1) AND lower(conteudo) = lower($2)
         AND status = 'pending'
       LIMIT 1`,
      [competencia, conteudo],
    );
    if (alreadyPending.rows.length > 0) continue;

    await query(
      `INSERT INTO competencies_pending
         (competencia, conteudo, question_id, status, raw_payload)
       VALUES ($1, $2, $3, 'pending', $4::jsonb)`,
      [competencia, conteudo, questionId, JSON.stringify(nova)],
    );
    pendingInserted += 1;
  }

  // Pares competência+conteúdo do formato aninhado ainda não catalogados
  for (const group of result.competencias) {
    for (const conteudo of group.conteudos) {
      const exists = await query(
        `SELECT 1 FROM competencies_catalog
         WHERE lower(competencia) = lower($1) AND lower(conteudo) = lower($2)
         LIMIT 1`,
        [group.competencia, conteudo],
      );
      if (exists.rows.length > 0) continue;

      const alreadyPending = await query(
        `SELECT 1 FROM competencies_pending
         WHERE lower(competencia) = lower($1) AND lower(conteudo) = lower($2)
           AND status = 'pending'
         LIMIT 1`,
        [group.competencia, conteudo],
      );
      if (alreadyPending.rows.length > 0) continue;

      await query(
        `INSERT INTO competencies_pending
           (competencia, conteudo, question_id, status, raw_payload)
         VALUES ($1, $2, $3, 'pending', $4::jsonb)`,
        [
          group.competencia,
          conteudo,
          questionId,
          JSON.stringify({
            competencia: group.competencia,
            conteudo,
          }),
        ],
      );
      pendingInserted += 1;
    }
  }

  return { result, pendingInserted, token_usage };
}

export async function classifyQuestionThemes(
  question: Record<string, unknown>,
) {
  await ensureTaxonomyTables();
  const questionText = buildDeCSQuestionText({
    statement: question.statement as string,
    option_a: question.option_a as string,
    option_b: question.option_b as string,
    option_c: question.option_c as string | null,
    option_d: question.option_d as string | null,
    option_e: question.option_e as string | null,
    correct_answer: question.correct_answer as string | null,
  });

  const catalog = await query(
    `SELECT tema, subtema FROM themes_catalog ORDER BY tema ASC, subtema ASC`,
  );
  const listaTemas = groupThemesCatalog(
    catalog.rows as Array<{ tema: string; subtema: string }>,
  );

  const agent = await getRuntimeAgent('question_themes_assigner');
  const hasPlaceholders =
    agent.system_instruction.includes('{{QUESTAO}}') ||
    agent.system_instruction.includes('{{LISTA_TEMAS}}');

  let systemInstruction = agent.system_instruction;
  let userMessage = questionText;

  if (hasPlaceholders) {
    systemInstruction = fillPromptPlaceholders(agent.system_instruction, {
      QUESTAO: questionText,
      RESPOSTA_CORRETA: String(question.correct_answer ?? ''),
      LISTA_TEMAS: JSON.stringify(listaTemas, null, 2),
    });
    userMessage =
      'Classifique os temas e subtemas desta questão conforme as instruções do sistema. Retorne apenas o JSON.';
  } else {
    userMessage = [
      questionText,
      '',
      'Catálogo de temas/subtemas existentes (prefira estes rótulos quando cabíveis):',
      JSON.stringify(listaTemas, null, 2),
    ].join('\n');
  }

  const { text: rawText, token_usage } = await callTaxonomyAgent(
    'question_themes_assigner',
    userMessage,
    systemInstruction,
    question.images,
  );
  const result = parseThemesAssignResult(rawText);
  if (result.temas.length === 0) {
    throw new Error('O agente não identificou temas/subtemas.');
  }

  const questionId = Number(question.id);
  await query(
    `UPDATE questions SET ai_question_themes = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(result), questionId],
  );

  let pendingInserted = 0;
  for (const group of result.temas) {
    const pairs =
      group.subtemas.length > 0
        ? group.subtemas.map((s) => ({ tema: group.tema, subtema: s }))
        : [{ tema: group.tema, subtema: group.tema }];

    for (const pair of pairs) {
      const exists = await query(
        `SELECT 1 FROM themes_catalog
         WHERE lower(tema) = lower($1) AND lower(subtema) = lower($2)
         LIMIT 1`,
        [pair.tema, pair.subtema],
      );
      if (exists.rows.length > 0) continue;

      const temaExists = await query(
        `SELECT 1 FROM themes_catalog WHERE lower(tema) = lower($1) LIMIT 1`,
        [pair.tema],
      );
      if (
        temaExists.rows.length > 0 &&
        pair.subtema.toLowerCase() === pair.tema.toLowerCase()
      ) {
        continue;
      }

      const alreadyPending = await query(
        `SELECT 1 FROM themes_pending
         WHERE lower(tema) = lower($1) AND lower(subtema) = lower($2)
           AND status = 'pending'
         LIMIT 1`,
        [pair.tema, pair.subtema],
      );
      if (alreadyPending.rows.length > 0) continue;

      await query(
        `INSERT INTO themes_pending
           (tema, subtema, question_id, status, raw_payload)
         VALUES ($1, $2, $3, 'pending', $4::jsonb)`,
        [pair.tema, pair.subtema, questionId, JSON.stringify(pair)],
      );
      pendingInserted += 1;
    }
  }

  return { result, pendingInserted, token_usage };
}

function flattenHabilities(result: HabilitiesResult | null): string[] {
  if (!result) return [];
  const out: string[] = [];
  for (const g of result.competencias ?? []) {
    out.push(normalizeTaxonomyLabel(g.competencia).toLowerCase());
    for (const c of g.conteudos ?? []) {
      out.push(normalizeTaxonomyLabel(c).toLowerCase());
    }
  }
  for (const n of result.novas_competencias ?? []) {
    out.push(normalizeTaxonomyLabel(n.nome).toLowerCase());
  }
  return [...new Set(out.filter(Boolean))];
}

function flattenThemes(result: ThemesAssignResult | null): string[] {
  if (!result?.temas?.length) return [];
  const out: string[] = [];
  for (const g of result.temas) {
    out.push(normalizeTaxonomyLabel(g.tema).toLowerCase());
    for (const s of g.subtemas) {
      out.push(normalizeTaxonomyLabel(s).toLowerCase());
    }
  }
  return [...new Set(out.filter(Boolean))];
}

function safeParseStored<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return null;
  }
}

export async function findQuestionsBySharedHabilities(
  questionId: number,
  limit = 10,
) {
  await ensureTaxonomyTables();
  const self = await query(`SELECT ai_habilities FROM questions WHERE id = $1`, [
    questionId,
  ]);
  const selfResult = safeParseStored<HabilitiesResult>(
    self.rows[0]?.ai_habilities,
  );
  const needles = flattenHabilities(selfResult);
  if (needles.length === 0) return [];

  const others = await query(
    `SELECT id, statement, tags, areas_conhecimento, exam_year, exam_board,
            exam_institution, ai_habilities
     FROM questions
     WHERE id <> $1 AND ai_habilities IS NOT NULL AND btrim(ai_habilities) <> ''
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 500`,
    [questionId],
  );

  return others.rows
    .map((row) => {
      const parsed = safeParseStored<HabilitiesResult>(row.ai_habilities);
      const hay = flattenHabilities(parsed);
      const overlap = needles.filter((n) => hay.includes(n));
      if (overlap.length === 0) return null;
      return {
        id: row.id as number,
        statement: row.statement as string,
        tags: row.tags ? JSON.parse(row.tags as string) : [],
        areas_conhecimento: row.areas_conhecimento
          ? JSON.parse(row.areas_conhecimento as string)
          : [],
        exam_year: row.exam_year as number | null,
        exam_board: row.exam_board as string | null,
        exam_institution: row.exam_institution as string | null,
        similarity: overlap.length / Math.max(needles.length, 1),
        matched_terms: overlap.slice(0, 8),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b!.similarity as number) - (a!.similarity as number))
    .slice(0, limit);
}

export async function findQuestionsBySharedThemes(
  questionId: number,
  limit = 10,
) {
  await ensureTaxonomyTables();
  const self = await query(
    `SELECT ai_question_themes FROM questions WHERE id = $1`,
    [questionId],
  );
  const selfResult = safeParseStored<ThemesAssignResult>(
    self.rows[0]?.ai_question_themes,
  );
  const needles = flattenThemes(selfResult);
  if (needles.length === 0) return [];

  const others = await query(
    `SELECT id, statement, tags, areas_conhecimento, exam_year, exam_board,
            exam_institution, ai_question_themes
     FROM questions
     WHERE id <> $1 AND ai_question_themes IS NOT NULL AND btrim(ai_question_themes) <> ''
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 500`,
    [questionId],
  );

  return others.rows
    .map((row) => {
      const parsed = safeParseStored<ThemesAssignResult>(row.ai_question_themes);
      const hay = flattenThemes(parsed);
      const overlap = needles.filter((n) => hay.includes(n));
      if (overlap.length === 0) return null;
      return {
        id: row.id as number,
        statement: row.statement as string,
        tags: row.tags ? JSON.parse(row.tags as string) : [],
        areas_conhecimento: row.areas_conhecimento
          ? JSON.parse(row.areas_conhecimento as string)
          : [],
        exam_year: row.exam_year as number | null,
        exam_board: row.exam_board as string | null,
        exam_institution: row.exam_institution as string | null,
        similarity: overlap.length / Math.max(needles.length, 1),
        matched_terms: overlap.slice(0, 8),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b!.similarity as number) - (a!.similarity as number))
    .slice(0, limit);
}
