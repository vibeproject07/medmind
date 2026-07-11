/**
 * Classifica até 100 questões usando lib/decs-pipeline.ts (runDeCSPipeline).
 *
 * Execução sequencial: uma questão por vez, sem batch/concorrência,
 * sem estado compartilhado entre questões (cada chamada Gemini é independente).
 *
 * Uso (na raiz do repositório):
 *   node arthur/run-classify-decs-100.mjs
 *   node arthur/run-classify-decs-100.mjs --limit 100 --save
 *   node arthur/run-classify-decs-100.mjs --delay-ms 800 --out arthur/exports/run.json
 */

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { query } from '@/lib/db';
import { getRuntimeAgent } from '@/lib/ai-agent-runtime';
import {
  runDeCSPipeline,
  buildPipelineFrontendExposure,
  type DeCSRecord,
  type DeCSThemes,
} from '@/lib/decs-pipeline';
import { saveClassificationArtifact } from '@/lib/decs-classification-storage';

// ── Env ───────────────────────────────────────────────────────────────────────

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  try {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env.local opcional se variáveis já estiverem no ambiente
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

interface CliArgs {
  limit: number;
  offset: number;
  skipClassified: boolean;
  save: boolean;
  delayMs: number;
  out: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    limit: 100,
    offset: 0,
    skipClassified: true,
    save: false,
    delayMs: 600,
    out: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--offset') args.offset = parseInt(argv[++i], 10);
    else if (a === '--include-classified') args.skipClassified = false;
    else if (a === '--save') args.save = true;
    else if (a === '--delay-ms') args.delayMs = parseInt(argv[++i], 10);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(`
Uso: node arthur/run-classify-decs-100.mjs [opções]

  --limit <n>              Quantidade de questões (padrão: 100)
  --offset <n>             Deslocamento na ordenação por id (padrão: 0)
  --include-classified     Incluir questões que já têm ai_decs_descriptors
  --save                   Gravar resultado no banco + artifact v1
  --delay-ms <n>           Pausa entre questões em ms (padrão: 600)
  --out <arquivo.json>     Caminho do relatório exportado
`);
      process.exit(0);
    }
  }

  return args;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Token tracking ────────────────────────────────────────────────────────────

export interface QuestionTokenUsage {
  classifier_prompt_tokens: number;
  classifier_output_tokens: number;
  classifier_total_tokens: number;
  embedding_calls: number;
  embedding_billable_characters: number;
  pipeline_other_prompt_tokens: number;
  pipeline_other_output_tokens: number;
  pipeline_other_total_tokens: number;
  grand_total_tokens: number;
}

function emptyTokenUsage(): QuestionTokenUsage {
  return {
    classifier_prompt_tokens: 0,
    classifier_output_tokens: 0,
    classifier_total_tokens: 0,
    embedding_calls: 0,
    embedding_billable_characters: 0,
    pipeline_other_prompt_tokens: 0,
    pipeline_other_output_tokens: 0,
    pipeline_other_total_tokens: 0,
    grand_total_tokens: 0,
  };
}

function addUsageMetadata(
  target: QuestionTokenUsage,
  meta: Record<string, number | undefined> | undefined,
  bucket: 'classifier' | 'pipeline_other',
): void {
  if (!meta) return;
  const prompt = meta.promptTokenCount ?? meta.prompt_token_count ?? 0;
  const output =
    meta.candidatesTokenCount ??
    meta.candidates_token_count ??
    meta.outputTokenCount ??
    0;
  const total = meta.totalTokenCount ?? meta.total_token_count ?? prompt + output;

  if (bucket === 'classifier') {
    target.classifier_prompt_tokens += prompt;
    target.classifier_output_tokens += output;
    target.classifier_total_tokens += total;
  } else {
    target.pipeline_other_prompt_tokens += prompt;
    target.pipeline_other_output_tokens += output;
    target.pipeline_other_total_tokens += total;
  }
}

function finalizeGrandTotal(u: QuestionTokenUsage): void {
  u.grand_total_tokens =
    u.classifier_total_tokens +
    u.pipeline_other_total_tokens +
    // embeddings: API reporta caracteres faturáveis, não tokens — incluímos como proxy
    Math.ceil(u.embedding_billable_characters / 4);
}

/** Intercepta fetch do Gemini (embedContent) para esta questão — evita duplicar tokens do classifier (SDK). */
function installGeminiFetchTracker(onUsage: (patch: Partial<QuestionTokenUsage>) => void): () => void {
  const original = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    if (url.includes('generativelanguage.googleapis.com') && url.includes('embedContent')) {
      try {
        const clone = res.clone();
        const data = (await clone.json()) as Record<string, unknown>;

        const billable =
          (data.metadata as Record<string, number> | undefined)?.billableCharacterCount ??
          (data.embedding as Record<string, unknown> | undefined)?.billableCharacterCount;
        if (typeof billable === 'number' && billable > 0) {
          onUsage({
            embedding_calls: 1,
            embedding_billable_characters: billable,
          });
        }
      } catch {
        // resposta não-JSON — ignorar
      }
    }

    return res;
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

// ── Question helpers ──────────────────────────────────────────────────────────

interface QuestionRow {
  id: number;
  statement: string;
  option_a: string;
  option_b: string;
  option_c: string | null;
  option_d: string | null;
  option_e: string | null;
}

function buildQuestionText(q: QuestionRow): string {
  return [
    'Enunciado:',
    q.statement,
    '',
    'Alternativa A: ' + q.option_a,
    'Alternativa B: ' + q.option_b,
    q.option_c ? 'Alternativa C: ' + q.option_c : null,
    q.option_d ? 'Alternativa D: ' + q.option_d : null,
    q.option_e ? 'Alternativa E: ' + q.option_e : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function parseThemesFromGemini(rawText: string): DeCSThemes {
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
    const matches = rawText.match(/"([^"]+)"/g);
    if (matches) {
      themes.primary = matches
        .map((m) => m.replace(/"/g, '').trim())
        .filter(Boolean)
        .slice(0, 3);
    }
  }
  return themes;
}

async function fetchQuestions(limit: number, offset: number, skipClassified: boolean): Promise<QuestionRow[]> {
  await query(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_decs_descriptors TEXT`);

  const conditions: string[] = [];
  if (skipClassified) conditions.push('ai_decs_descriptors IS NULL');

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const res = await query(
    `SELECT id, statement, option_a, option_b, option_c, option_d, option_e
     FROM questions
     ${where}
     ORDER BY id ASC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  return res.rows as QuestionRow[];
}

// ── Single question (fully isolated) ──────────────────────────────────────────

export interface QuestionRunResult {
  question_id: number;
  statement_preview: string;
  status: 'classified' | 'skipped_no_themes' | 'error';
  themes: DeCSThemes | null;
  descriptors: DeCSRecord[];
  descriptor_count: number;
  descriptor_terms: string[];
  tokens: QuestionTokenUsage;
  pipeline_stats?: { dropped_by_filter: number; dropped_by_gemini: number };
  error?: string;
  elapsed_ms: number;
}

async function classifyOneQuestion(
  row: QuestionRow,
  geminiKey: string,
  decsKey: string,
): Promise<QuestionRunResult> {
  const t0 = Date.now();
  const tokens = emptyTokenUsage();
  const statementPreview = (row.statement ?? '').slice(0, 120).replace(/\s+/g, ' ');

  const restoreFetch = installGeminiFetchTracker((patch) => {
    if (patch.embedding_calls) {
      tokens.embedding_calls += patch.embedding_calls;
      tokens.embedding_billable_characters += patch.embedding_billable_characters ?? 0;
    }
  });

  try {
    const questionText = buildQuestionText(row);
    const classifierAgent = await getRuntimeAgent('decs_classifier');

    // Nova instância por questão — sem histórico de conversa
    const ai = new GoogleGenAI({ apiKey: geminiKey, apiVersion: 'v1beta' });
    const response = await ai.models.generateContent({
      model: classifierAgent.model,
      contents: [{ role: 'user', parts: [{ text: questionText }] }],
      config: {
        systemInstruction: String(classifierAgent.system_instruction),
        temperature: classifierAgent.temperature,
        maxOutputTokens: classifierAgent.max_output_tokens,
        responseMimeType: 'application/json',
      },
    });

    const resp = response as Record<string, unknown>;
    addUsageMetadata(tokens, resp.usageMetadata as Record<string, number> | undefined, 'classifier');

    const rawText: string =
      (typeof resp.text === 'string' ? resp.text : '') ||
      ((resp.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }>)?.[0]?.content?.parts
        ?.map((p) => p?.text)
        .filter(Boolean)
        .join('') ?? '');

    const themes = parseThemesFromGemini(rawText);

    if (themes.primary.length === 0 && themes.secondary.length === 0) {
      finalizeGrandTotal(tokens);
      return {
        question_id: row.id,
        statement_preview: statementPreview,
        status: 'skipped_no_themes',
        themes: null,
        descriptors: [],
        descriptor_count: 0,
        descriptor_terms: [],
        tokens,
        elapsed_ms: Date.now() - t0,
      };
    }

    const { descriptors, dropped_by_filter, dropped_by_gemini, term_trace } = await runDeCSPipeline(
      themes,
      questionText,
      decsKey,
      geminiKey,
      classifierAgent.model,
    );

    const pipeline_exposure = buildPipelineFrontendExposure(themes, term_trace);

    finalizeGrandTotal(tokens);

    return {
      question_id: row.id,
      statement_preview: statementPreview,
      status: 'classified',
      themes,
      descriptors,
      descriptor_count: descriptors.length,
      descriptor_terms: descriptors.map((d) => d.term),
      tokens,
      pipeline_stats: { dropped_by_filter, dropped_by_gemini },
      pipeline_exposure,
      term_trace,
      elapsed_ms: Date.now() - t0,
    };
  } catch (err: unknown) {
    finalizeGrandTotal(tokens);
    return {
      question_id: row.id,
      statement_preview: statementPreview,
      status: 'error',
      themes: null,
      descriptors: [],
      descriptor_count: 0,
      descriptor_terms: [],
      tokens,
      error: err instanceof Error ? err.message : String(err),
      elapsed_ms: Date.now() - t0,
    };
  } finally {
    restoreFetch();
  }
}

async function persistResult(row: QuestionRunResult): Promise<void> {
  if (row.status !== 'classified' || !row.themes) return;

  const artifact = {
    result: row.descriptors,
    themes_identified: row.themes,
    pipeline_stats: {
      primary_terms: row.themes.primary.length,
      secondary_terms: row.themes.secondary.length,
      dropped_by_category_filter: row.pipeline_stats?.dropped_by_filter ?? 0,
      dropped_by_gemini_validation: 0,
      final_count: row.descriptor_count,
      source: 'arthur/classify-decs-100.ts',
    },
    token_usage: row.tokens,
  };

  await query(
    'UPDATE questions SET ai_decs_descriptors = $1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(row.descriptors), row.question_id],
  );
  await saveClassificationArtifact(row.question_id, 'v1', artifact);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));

  const geminiKey = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)?.trim();
  if (!geminiKey) throw new Error('GEMINI_API_KEY não definida.');

  const decsKey = process.env.DECS_API_KEY?.trim();
  if (!decsKey) throw new Error('DECS_API_KEY não definida.');

  const questions = await fetchQuestions(args.limit, args.offset, args.skipClassified);

  if (questions.length === 0) {
    console.log('Nenhuma questão encontrada com os filtros atuais.');
    process.exit(0);
  }

  console.log(`\n▶ Classificação DeCS — ${questions.length} questão(ões), sequencial (1 por vez)`);
  console.log(`  Pipeline: lib/decs-pipeline.ts (runDeCSPipeline)`);
  console.log(`  Delay entre questões: ${args.delayMs}ms\n`);

  const results: QuestionRunResult[] = [];
  const totals = emptyTokenUsage();

  for (let i = 0; i < questions.length; i++) {
    const row = questions[i];
    const label = `[${i + 1}/${questions.length}] id=${row.id}`;

    process.stdout.write(`${label} … `);

    const result = await classifyOneQuestion(row, geminiKey, decsKey);
    results.push(result);

    if (args.save && result.status === 'classified') {
      await persistResult(result);
    }

    totals.classifier_prompt_tokens += result.tokens.classifier_prompt_tokens;
    totals.classifier_output_tokens += result.tokens.classifier_output_tokens;
    totals.classifier_total_tokens += result.tokens.classifier_total_tokens;
    totals.embedding_calls += result.tokens.embedding_calls;
    totals.embedding_billable_characters += result.tokens.embedding_billable_characters;
    totals.pipeline_other_prompt_tokens += result.tokens.pipeline_other_prompt_tokens;
    totals.pipeline_other_output_tokens += result.tokens.pipeline_other_output_tokens;
    totals.pipeline_other_total_tokens += result.tokens.pipeline_other_total_tokens;
    totals.grand_total_tokens += result.tokens.grand_total_tokens;

    if (result.status === 'classified') {
      console.log(
        `✓ ${result.descriptor_count} descritor(es) | tokens≈${result.tokens.grand_total_tokens} | ${result.elapsed_ms}ms`,
      );
    } else if (result.status === 'skipped_no_themes') {
      console.log(`⚠ sem temas | tokens≈${result.tokens.grand_total_tokens}`);
    } else {
      console.log(`✗ erro: ${result.error}`);
    }

    if (i < questions.length - 1 && args.delayMs > 0) {
      await sleep(args.delayMs);
    }
  }

  finalizeGrandTotal(totals);

  const classified = results.filter((r) => r.status === 'classified');

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('Questões classificadas com sucesso:');
  console.log('══════════════════════════════════════════════════════════');
  for (const r of classified) {
    console.log(
      `  id=${r.question_id} | ${r.descriptor_count} termos | tokens≈${r.tokens.grand_total_tokens} | ${r.descriptor_terms.join('; ') || '(vazio)'}`,
    );
  }

  console.log('\n──────────────────────────────────────────────────────────');
  console.log(`Total processadas : ${results.length}`);
  console.log(`Classificadas     : ${classified.length}`);
  console.log(`Sem temas         : ${results.filter((r) => r.status === 'skipped_no_themes').length}`);
  console.log(`Erros             : ${results.filter((r) => r.status === 'error').length}`);
  console.log('Tokens (soma):');
  console.log(`  Classifier (Gemini generateContent): ${totals.classifier_total_tokens}`);
  console.log(`  Embeddings (chamadas): ${totals.embedding_calls}`);
  console.log(`  Embeddings (caracteres faturáveis): ${totals.embedding_billable_characters}`);
  console.log(`  Outros (REST Gemini no pipeline): ${totals.pipeline_other_total_tokens}`);
  console.log(`  Total estimado (tokens + chars/4): ${totals.grand_total_tokens}`);

  const report = {
    generated_at: new Date().toISOString(),
    config: args,
    summary: {
      total_processed: results.length,
      classified: classified.length,
      skipped_no_themes: results.filter((r) => r.status === 'skipped_no_themes').length,
      errors: results.filter((r) => r.status === 'error').length,
      token_totals: totals,
    },
    classified_questions: classified.map((r) => ({
      question_id: r.question_id,
      statement_preview: r.statement_preview,
      descriptor_count: r.descriptor_count,
      descriptor_terms: r.descriptor_terms,
      descriptors: r.descriptors,
      themes: r.themes,
      tokens: r.tokens,
      elapsed_ms: r.elapsed_ms,
    })),
    all_results: results,
  };

  const outPath =
    args.out ??
    path.join(
      process.cwd(),
      'arthur',
      'exports',
      `classify-decs-100-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  console.log(`\n📄 Relatório: ${outPath}\n`);
}

main().catch((err) => {
  console.error('\n💥 Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
