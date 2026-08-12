/**
 * Quantifica tokens e PERSISTE classificação completa nas mesmas 1000 questões
 * do lote anterior (scripts/exports/quant-tokens-1000-ids.json).
 *
 * Por questão:
 *   1. decs_classifier (+ imagens) → temas
 *   2. runDeCSPipeline → descritores V1
 *   3. question_terms_validator → remove rejeitados + decs_validation_meta
 *   4. question_themes_assigner → ai_question_themes
 *   5. habilities_agent → ai_habilities
 *   6. Grava input_tokens / output_tokens + ai_token_usage
 *
 * Uso:
 *   node scripts/run-quant-tokens-1000-persist.mjs
 *   node scripts/run-quant-tokens-1000-persist.mjs --delay-ms 400 --limit 1000
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { query } from '@/lib/db';
import { getRuntimeAgent } from '@/lib/ai-agent-runtime';
import {
  buildDeCSQuestionText,
  runDeCSPipeline,
  buildPipelineFrontendExposure,
  type DeCSRecord,
  type DeCSThemes,
} from '@/lib/decs-pipeline';
import { saveClassificationArtifact } from '@/lib/decs-classification-storage';
import { runQuestionTermsValidation } from '@/lib/decs-question-terms-validation';
import { buildDeCSValidationMeta } from '@/lib/decs-primary';
import {
  classifyQuestionHabilities,
  classifyQuestionThemes,
} from '@/lib/taxonomy-agents';
import {
  buildGeminiSdkUserParts,
  parseQuestionImages,
} from '@/lib/gemini-question-images';
import {
  addTokenUsage,
  buildAgentTokenUsage,
  emptyTokenTotals,
  estimateUsdCost,
  type AgentTokenUsage,
  type TokenUsageTotals,
} from '@/lib/gemini-token-usage';
import { ensureQuestionTokenColumns } from '@/lib/question-token-columns';

// ── Env / CLI ─────────────────────────────────────────────────────────────────

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  try {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* opcional */
  }
}

interface CliArgs {
  limit: number;
  offset: number;
  delayMs: number;
  checkpointEvery: number;
  out: string | null;
  idsFile: string;
  /** JSON de corrida anterior: mescla resultados e pula IDs já ok/partial. */
  resume: string | null;
  /** Denominador no progresso (ex.: 1000 ao retomar um lote). */
  progressTotal: number | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    limit: 1000,
    offset: 0,
    delayMs: 400,
    checkpointEvery: 10,
    out: null,
    idsFile: path.join(
      process.cwd(),
      'scripts',
      'exports',
      'quant-tokens-1000-ids.json',
    ),
    resume: null,
    progressTotal: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--offset') args.offset = parseInt(argv[++i], 10);
    else if (a === '--delay-ms') args.delayMs = parseInt(argv[++i], 10);
    else if (a === '--checkpoint-every')
      args.checkpointEvery = parseInt(argv[++i], 10);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--ids-file') args.idsFile = argv[++i];
    else if (a === '--resume') args.resume = argv[++i];
    else if (a === '--progress-total')
      args.progressTotal = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') {
      console.log(`Uso: node scripts/run-quant-tokens-1000-persist.mjs [opções]
  --limit <n>  --offset <n>  --delay-ms <n>  --checkpoint-every <n>
  --ids-file <json>  --out <json>
  --resume <json>  --progress-total <n>`);
      process.exit(0);
    }
  }
  return args;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function loadQuestionIds(idsFile: string, limit: number, offset: number): number[] {
  if (!existsSync(idsFile)) {
    throw new Error(
      `Arquivo de IDs não encontrado: ${idsFile}. Gere a partir do log do lote anterior.`,
    );
  }
  const raw = JSON.parse(readFileSync(idsFile, 'utf8')) as
    | number[]
    | { question_ids: number[] };
  const ids = Array.isArray(raw) ? raw : raw.question_ids;
  return ids.slice(offset, offset + limit).map(Number).filter((n) => n > 0);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface QuestionRow {
  id: number;
  statement: string | null;
  option_a: string | null;
  option_b: string | null;
  option_c: string | null;
  option_d: string | null;
  option_e: string | null;
  correct_answer: string | null;
  images: unknown;
}

interface QuestionPersistReport {
  question_id: number;
  has_images: boolean;
  image_count: number;
  status: 'ok' | 'partial' | 'error';
  errors: string[];
  persisted: {
    ai_decs_descriptors: number;
    validation: boolean;
    themes: boolean;
    habilities: boolean;
  };
  operations: AgentTokenUsage[];
  question_totals: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost_usd: ReturnType<typeof estimateUsdCost>;
  };
  elapsed_ms: number;
}

function loadResumeResults(resumePath: string): QuestionPersistReport[] {
  if (!existsSync(resumePath)) {
    throw new Error(`Arquivo --resume não encontrado: ${resumePath}`);
  }
  const raw = JSON.parse(readFileSync(resumePath, 'utf8')) as {
    questions?: QuestionPersistReport[];
  };
  return Array.isArray(raw.questions) ? raw.questions : [];
}

function parseThemes(rawText: string): DeCSThemes {
  const themes: DeCSThemes = { primary: [], secondary: [] };
  try {
    const cleaned = rawText
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      themes.primary = parsed
        .filter((t: unknown) => typeof t === 'string' && t.trim())
        .slice(0, 3);
    } else if (parsed && typeof parsed === 'object') {
      themes.primary = (Array.isArray(parsed.primary) ? parsed.primary : [])
        .filter((t: unknown) => typeof t === 'string' && t.trim())
        .slice(0, 3);
      themes.secondary = (Array.isArray(parsed.secondary) ? parsed.secondary : [])
        .filter((t: unknown) => typeof t === 'string' && t.trim())
        .slice(0, 6);
    }
  } catch {
    /* ignore */
  }
  return themes;
}

async function runClassifier(
  questionText: string,
  images: unknown,
): Promise<{ themes: DeCSThemes; token_usage: AgentTokenUsage; raw: string }> {
  const agent = await getRuntimeAgent('decs_classifier');
  const geminiKey = (
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
  )!.trim();
  const parts = buildGeminiSdkUserParts(questionText, images);
  const ai = new GoogleGenAI({ apiKey: geminiKey, apiVersion: 'v1beta' });
  const response = await ai.models.generateContent({
    model: agent.model,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: agent.system_instruction,
      temperature: agent.temperature,
      maxOutputTokens: agent.max_output_tokens,
      responseMimeType: 'application/json',
    },
  });
  const resp = response as {
    text?: string;
    usageMetadata?: Record<string, number>;
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const raw =
    (typeof resp.text === 'string' ? resp.text : '') ||
    (resp.candidates?.[0]?.content?.parts?.map((p) => p?.text).filter(Boolean).join('') ??
      '');
  return {
    themes: parseThemes(raw),
    token_usage: buildAgentTokenUsage('decs_classifier', agent.model, resp),
    raw,
  };
}

async function persistTokens(
  questionId: number,
  usages: AgentTokenUsage[],
  classificationRunId?: number | null,
): Promise<TokenUsageTotals> {
  const totals = emptyTokenTotals();
  for (const u of usages) addTokenUsage(totals, u);

  await query(
    `UPDATE questions
     SET input_tokens = $1,
         output_tokens = $2,
         ai_token_usage = $3::jsonb,
         updated_at = NOW()
     WHERE id = $4`,
    [
      totals.input_tokens,
      totals.output_tokens,
      JSON.stringify({
        updated_at: new Date().toISOString(),
        totals,
        operations: usages,
        estimated_cost_usd: estimateUsdCost(
          totals.input_tokens,
          totals.output_tokens,
        ),
      }),
      questionId,
    ],
  );

  if (classificationRunId) {
    await query(
      `UPDATE decs_classification_runs
       SET input_tokens = $1, output_tokens = $2
       WHERE id = $3`,
      [totals.input_tokens, totals.output_tokens, classificationRunId],
    );
  }

  return totals;
}

async function processOne(
  row: QuestionRow,
  geminiKey: string,
  decsKey: string,
): Promise<QuestionPersistReport> {
  const t0 = Date.now();
  const images = parseQuestionImages(row.images);
  const errors: string[] = [];
  const operations: AgentTokenUsage[] = [];
  const persisted = {
    ai_decs_descriptors: 0,
    validation: false,
    themes: false,
    habilities: false,
  };

  const questionText = buildDeCSQuestionText({
    statement: row.statement,
    option_a: row.option_a,
    option_b: row.option_b,
    option_c: row.option_c,
    option_d: row.option_d,
    option_e: row.option_e,
    correct_answer: row.correct_answer,
  });

  let themes: DeCSThemes = { primary: [], secondary: [] };
  let descriptors: DeCSRecord[] = [];
  let lastRunId: number | null = null;

  // 1+2 Classifier + pipeline
  try {
    const classified = await runClassifier(questionText, row.images);
    operations.push(classified.token_usage);
    themes = classified.themes;

    if (themes.primary.length === 0 && themes.secondary.length === 0) {
      errors.push('classifier: nenhum tema extraído');
    } else {
      const pipeline = await runDeCSPipeline(
        themes,
        questionText,
        decsKey,
        geminiKey,
      );
      descriptors = pipeline.descriptors;
      const pipeline_exposure = buildPipelineFrontendExposure(
        themes,
        pipeline.term_trace,
      );
      const artifact = {
        result: descriptors,
        themes_identified: themes,
        pipeline_exposure,
        pipeline_stats: {
          primary_terms: themes.primary.length,
          secondary_terms: themes.secondary.length,
          dropped_by_category_filter: pipeline.dropped_by_filter,
          dropped_by_gemini_validation: pipeline.dropped_by_gemini,
          final_count: descriptors.length,
          source: 'scripts/quant-tokens-1000-persist.ts',
        },
        token_usage: [classified.token_usage],
      };

      await query(
        `UPDATE questions SET ai_decs_descriptors = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(descriptors), row.id],
      );
      await saveClassificationArtifact(row.id, 'v1', artifact);
      const runRes = await query(
        `SELECT id FROM decs_classification_runs
         WHERE question_id = $1 AND pipeline = 'v1'
         ORDER BY created_at DESC LIMIT 1`,
        [row.id],
      );
      lastRunId = runRes.rows[0]?.id != null ? Number(runRes.rows[0].id) : null;
      persisted.ai_decs_descriptors = descriptors.length;
    }
  } catch (e) {
    errors.push(`decs: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3 Validation
  if (descriptors.length > 0) {
    try {
      const validation = await runQuestionTermsValidation({
        questionText,
        correctAnswer: row.correct_answer,
        themes,
        descriptors,
        geminiKey,
        images: row.images,
      });
      if (validation.token_usage) operations.push(validation.token_usage);

      const rejectedCodes = new Set(validation.rejected.map((d) => d.code));
      const descriptorsKept = descriptors.filter((d) => !rejectedCodes.has(d.code));

      const validationMeta = buildDeCSValidationMeta({
        descriptorsKept,
        agentNeedsManualReview: validation.needs_manual_review === true,
        agentMissingPrimaryHint: validation.missing_primary_terms === true,
        agentReviewReason: validation.review_reason,
        coerencia_geral: validation.coerencia_geral,
        removed_count: rejectedCodes.size,
        dismissed_at: null,
        source: 'quant-tokens-1000-persist',
      });

      await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS decs_validation_meta JSONB`);
      await query(
        `UPDATE questions
         SET ai_decs_descriptors = $1,
             decs_validation_meta = $2::jsonb,
             updated_at = NOW()
         WHERE id = $3`,
        [JSON.stringify(descriptorsKept), JSON.stringify(validationMeta), row.id],
      );
      descriptors = descriptorsKept;
      persisted.ai_decs_descriptors = descriptorsKept.length;
      persisted.validation = true;
    } catch (e) {
      errors.push(`validation: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 4 Themes
  try {
    const { token_usage } = await classifyQuestionThemes(
      row as unknown as Record<string, unknown>,
    );
    if (token_usage) operations.push(token_usage);
    persisted.themes = true;
  } catch (e) {
    errors.push(`themes: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 5 Habilities
  try {
    const { token_usage } = await classifyQuestionHabilities(
      row as unknown as Record<string, unknown>,
    );
    if (token_usage) operations.push(token_usage);
    persisted.habilities = true;
  } catch (e) {
    errors.push(`habilities: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 6 Persist token columns
  const totals = await persistTokens(row.id, operations, lastRunId);

  const okOps =
    persisted.ai_decs_descriptors > 0 &&
    persisted.validation &&
    persisted.themes &&
    persisted.habilities;
  const status: QuestionPersistReport['status'] =
    errors.length === 0 && okOps
      ? 'ok'
      : operations.length > 0
        ? 'partial'
        : 'error';

  return {
    question_id: row.id,
    has_images: images.length > 0,
    image_count: images.length,
    status,
    errors,
    persisted,
    operations,
    question_totals: {
      input_tokens: totals.input_tokens,
      output_tokens: totals.output_tokens,
      total_tokens: totals.total_tokens,
      estimated_cost_usd: estimateUsdCost(
        totals.input_tokens,
        totals.output_tokens,
      ),
    },
    elapsed_ms: Date.now() - t0,
  };
}

function buildReport(
  args: CliArgs,
  results: QuestionPersistReport[],
  startedAt: string,
  ids: number[],
) {
  const totals = emptyTokenTotals();
  for (const r of results) {
    if (r.operations.length > 0) {
      for (const op of r.operations) addTokenUsage(totals, op);
    } else {
      totals.input_tokens += r.question_totals.input_tokens;
      totals.output_tokens += r.question_totals.output_tokens;
      totals.total_tokens += r.question_totals.total_tokens;
    }
  }
  const withImg = results.filter((r) => r.has_images);
  const withoutImg = results.filter((r) => !r.has_images);
  const avg = (rows: QuestionPersistReport[], field: 'input_tokens' | 'output_tokens') => {
    if (!rows.length) return 0;
    return Math.round(
      rows.reduce((s, r) => s + r.question_totals[field], 0) / rows.length,
    );
  };

  return {
    generated_at: new Date().toISOString(),
    started_at: startedAt,
    config: { ...args, persist_to_db: true, question_ids: ids },
    summary: {
      total_questions: results.length,
      ok: results.filter((r) => r.status === 'ok').length,
      partial: results.filter((r) => r.status === 'partial').length,
      error: results.filter((r) => r.status === 'error').length,
      questions_with_images: withImg.length,
      questions_without_images: withoutImg.length,
      token_totals: totals,
      estimated_cost_usd_total: estimateUsdCost(
        totals.input_tokens,
        totals.output_tokens,
      ),
      image_cost_impact: {
        avg_input_with_images: avg(withImg, 'input_tokens'),
        avg_input_without_images: avg(withoutImg, 'input_tokens'),
        avg_output_with_images: avg(withImg, 'output_tokens'),
        avg_output_without_images: avg(withoutImg, 'output_tokens'),
        input_delta: avg(withImg, 'input_tokens') - avg(withoutImg, 'input_tokens'),
      },
      persisted_counts: {
        with_decs: results.filter((r) => r.persisted.ai_decs_descriptors > 0).length,
        with_validation: results.filter((r) => r.persisted.validation).length,
        with_themes: results.filter((r) => r.persisted.themes).length,
        with_habilities: results.filter((r) => r.persisted.habilities).length,
      },
    },
    questions: results,
  };
}

async function main(): Promise<void> {
  loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();

  const geminiKey = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)?.trim();
  if (!geminiKey) throw new Error('GEMINI_API_KEY não definida');
  const decsKey = process.env.DECS_API_KEY?.trim();
  if (!decsKey) throw new Error('DECS_API_KEY não definida');

  await ensureQuestionTokenColumns();
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_decs_descriptors TEXT`);
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_habilities TEXT`);
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_question_themes TEXT`);
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS decs_validation_meta JSONB`);

  const allIds = loadQuestionIds(args.idsFile, args.limit, args.offset);
  if (allIds.length === 0) throw new Error('Nenhum ID de questão para processar');

  const outPath =
    args.out ??
    args.resume ??
    path.join(
      process.cwd(),
      'scripts',
      'exports',
      `quant-tokens-1000-persist-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
  mkdirSync(path.dirname(outPath), { recursive: true });

  const priorResults: QuestionPersistReport[] = args.resume
    ? loadResumeResults(args.resume)
    : existsSync(outPath)
      ? loadResumeResults(outPath)
      : [];
  const byPrior = new Map<number, QuestionPersistReport>();
  for (const r of priorResults) {
    if (r.status === 'ok' || r.status === 'partial') {
      byPrior.set(Number(r.question_id), r);
    }
  }
  // IDs concluídos no log após o último checkpoint — stubs mínimos p/ o relatório.
  const logPath = path.join(
    process.cwd(),
    'scripts',
    'exports',
    'quant-tokens-1000-persist-run.log',
  );
  if (existsSync(logPath)) {
    const logText = readFileSync(logPath, 'utf8');
    for (const m of logText.matchAll(
      /\[\d+\/\d+\] id=(\d+) imgs=(\d+)[^\n]*\b(ok|partial|error)\b[^\n]*in=(\d+)\s+out=(\d+)[^\n]*\|\s+\$([0-9.]+)\s+\|\s+(\d+)ms/g,
    )) {
      const qid = Number(m[1]);
      if (byPrior.has(qid)) continue;
      const input = Number(m[4]);
      const output = Number(m[5]);
      byPrior.set(qid, {
        question_id: qid,
        has_images: Number(m[2]) > 0,
        image_count: Number(m[2]),
        status: m[3] as 'ok' | 'partial' | 'error',
        errors: [],
        persisted: {
          ai_decs_descriptors: 1,
          validation: true,
          themes: true,
          habilities: true,
        },
        operations: [],
        question_totals: {
          input_tokens: input,
          output_tokens: output,
          total_tokens: input + output,
          estimated_cost_usd: estimateUsdCost(input, output),
        },
        elapsed_ms: Number(m[7]),
      });
    }
  }

  const results: QuestionPersistReport[] = [...byPrior.values()];
  const doneIds = new Set<number>(byPrior.keys());
  const ids = allIds.filter((id) => !doneIds.has(id));
  const displayTotal = args.progressTotal ?? allIds.length;

  if (ids.length === 0) {
    const report = buildReport(args, results, startedAt, allIds);
    writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`\n▶ Nada a processar — ${results.length} já concluídas. JSON: ${outPath}\n`);
    return;
  }

  const qRes = await query(
    `SELECT id, statement, option_a, option_b, option_c, option_d, option_e,
            correct_answer, images
     FROM questions
     WHERE id = ANY($1::int[])`,
    [ids],
  );
  const byId = new Map(
    (qRes.rows as QuestionRow[]).map((r) => [Number(r.id), r]),
  );
  const questions = ids.map((id) => byId.get(id)).filter(Boolean) as QuestionRow[];

  console.log(
    `\n▶ Persistência + tokens — retomando ${questions.length} restante(s) (já ok: ${results.length}/${displayTotal})`,
  );
  console.log(`  Persistência DB: SIM (DeCS + validação + temas + competências + tokens)`);
  console.log(`  Delay: ${args.delayMs}ms\n`);

  const reportIds = [
    ...new Set([
      ...results.map((r) => Number(r.question_id)),
      ...allIds,
    ]),
  ];

  for (let i = 0; i < questions.length; i++) {
    const row = questions[i]!;
    const imgN = parseQuestionImages(row.images).length;
    const idx = results.length + 1;
    process.stdout.write(`[${idx}/${displayTotal}] id=${row.id} imgs=${imgN} … `);

    const result = await processOne(row, geminiKey, decsKey);
    results.push(result);

    console.log(
      `${result.status} | decs=${result.persisted.ai_decs_descriptors} val=${result.persisted.validation} themes=${result.persisted.themes} hab=${result.persisted.habilities} | in=${result.question_totals.input_tokens} out=${result.question_totals.output_tokens} | $${result.question_totals.estimated_cost_usd.total_usd} | ${result.elapsed_ms}ms` +
        (result.errors.length ? ` | errs=${result.errors.length}` : ''),
    );

    if (args.checkpointEvery > 0 && (i + 1) % args.checkpointEvery === 0) {
      writeFileSync(
        outPath,
        JSON.stringify(buildReport(args, results, startedAt, reportIds), null, 2) +
          '\n',
      );
      console.log(`  ↳ checkpoint (${results.length}) → ${outPath}`);
    }

    if (i < questions.length - 1 && args.delayMs > 0) await sleep(args.delayMs);
  }

  const report = buildReport(args, results, startedAt, reportIds);
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

  const s = report.summary;
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('RESUMO — persistência + tokens');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`Questões: ${s.total_questions} (ok=${s.ok}, partial=${s.partial}, error=${s.error})`);
  console.log(
    `Persistidos: decs=${s.persisted_counts.with_decs} val=${s.persisted_counts.with_validation} themes=${s.persisted_counts.with_themes} hab=${s.persisted_counts.with_habilities}`,
  );
  console.log(
    `Tokens: in=${s.token_totals.input_tokens} out=${s.token_totals.output_tokens} tot=${s.token_totals.total_tokens}`,
  );
  console.log(`Custo estimado: $${s.estimated_cost_usd_total.total_usd}`);
  console.log(`\n📄 JSON: ${outPath}\n`);
}

main().catch((err) => {
  console.error('\n💥 Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
