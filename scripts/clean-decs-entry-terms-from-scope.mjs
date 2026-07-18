/**
 * clean-decs-entry-terms-from-scope.mjs
 *
 * Remove de `decs_descriptors.entry_terms` elementos que são, na prática,
 * o texto (completo ou pedaço) de `scope_note` — contaminação por definição
 * colada como se fosse sinônimo/entry term.
 *
 * ── O QUE O SCRIPT FAZ (visão geral) ─────────────────────────────────────────
 *
 * 1. Conecta ao PostgreSQL via DATABASE_URL.
 * 2. Lê descritores em Lotes (batch): ui, name_pt, scope_note, entry_terms.
 * 3. Para cada linha:
 *      a) Normaliza `scope_note` (minúsculas, sem acento, sem pontuação excessiva).
 *      b) Percorre cada string do array JSONB `entry_terms`.
 *      c) Mantém o termo se for um entry term “legítimo” (sinônimo curto/médio).
 *      d) REMOVE o termo se parecer “texto corrido” do scope_note:
 *           - igual (após normalizar) ao scope_note inteiro;
 *           - muito similar ao scope_note (Jaccard de tokens ≥ limiar);
 *           - pedaço longo contido no scope (ou scope contido no termo)
 *             quando o elemento é longo o suficiente para ser prosa, não sinônimo.
 * 4. Em dry-run (padrão): só reporta o que seria alterado — NÃO grava no banco.
 * 5. Em --apply: faz UPDATE entry_terms com o array filtrado.
 * 6. Exibe progresso no console e pode salvar um relatório JSON em --out.
 *
 * Por padrão NÃO remove sinônimos curtos só porque aparecem como substring
 * dentro da definição (isso apagaria termos DeCS válidos mencionados no scope).
 * Use --aggressive-substring se quiser esse comportamento mais destrutivo.
 *
 * ── NÃO EXECUTADO AUTOMATICAMENTE ────────────────────────────────────────────
 * Este arquivo foi gerado para você rodar manualmente quando quiser.
 * Veja as instruções de execução no final do arquivo.
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--')
    ? args[i + 1]
    : def;
};
const hasFlag = (name) => args.includes(`--${name}`);

const LIMIT = parseInt(getArg('limit', '0'), 10);           // 0 = todos
const BATCH_SIZE = parseInt(getArg('batch-size', '500'), 10);
const OFFSET = parseInt(getArg('offset', '0'), 10);
const APPLY = hasFlag('apply');                             // sem --apply = dry-run
const AGGRESSIVE = hasFlag('aggressive-substring');         // também remove substrings curtas
const MIN_PROSE_CHARS = parseInt(getArg('min-prose-chars', '80'), 10);
const MIN_JACCARD = parseFloat(getArg('min-jaccard', '0.55'));
const MIN_CONTAINMENT = parseFloat(getArg('min-containment', '0.70'));
const OUT_FILE = getArg('out', 'exports/decs-entry-terms-scope-cleanup-report.json');

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL não definida. Use: node --env-file=.env.local scripts/...');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

// ── Normalização / similaridade ───────────────────────────────────────────────

/** Minúsculas, remove acentos, colapsa espaços, tira pontuação leve. */
function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokens com comprimento > 3 (evita ruído de artigos/preposições). */
function tokens(s) {
  return new Set(
    normalize(s)
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

/** Jaccard em conjunto de tokens. */
function jaccard(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Fração do texto mais curto que “cabe” no mais longo (após normalizar).
 * Útil quando entry_terms tem um pedaço do scope ou o scope inteiro colado
 * numa string maior.
 */
function containmentRatio(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (longer.includes(shorter)) return shorter.length / longer.length;
  return 0;
}

/** true se parece entry term DeCS típico: "Nome PT[Name EN]" (sem parágrafo). */
function looksLikeStructuredEntryTerm(term) {
  const t = String(term ?? '').trim();
  if (/^[^\[\]]{1,200}\[[^\[\]]{1,200}\]$/.test(t) && !/[.!?].*[.!?]/.test(t)) {
    return true;
  }
  if (t.length < MIN_PROSE_CHARS && !/[.!?]/.test(t)) return true;
  return false;
}

/**
 * Decide se um elemento de entry_terms deve ser removido por ser
 * (quase) o texto do scope_note.
 *
 * @returns {{ remove: boolean, reason: string | null }}
 */
function classifyEntryTerm(term, scopeNote) {
  const raw = String(term ?? '').trim();
  if (!raw) return { remove: true, reason: 'empty' };

  const scope = String(scopeNote ?? '').trim();
  if (!scope) return { remove: false, reason: null };

  const nTerm = normalize(raw);
  const nScope = normalize(scope);

  // 1) Igualdade total
  if (nTerm === nScope) {
    return { remove: true, reason: 'exact_scope_match' };
  }

  // 2) Scope quase inteiro embutido no elemento
  const cont = containmentRatio(raw, scope);
  if (
    scope.length >= MIN_PROSE_CHARS &&
    (nTerm.includes(nScope) || cont >= 0.85)
  ) {
    if (!looksLikeStructuredEntryTerm(raw) || raw.length >= scope.length * 0.9) {
      return { remove: true, reason: `scope_embedded_or_near_full:${cont.toFixed(3)}` };
    }
  }

  // 3) Prosa longa parecida com o scope (não é Nome[EN])
  if (!looksLikeStructuredEntryTerm(raw) && raw.length >= MIN_PROSE_CHARS) {
    const jac = jaccard(raw, scope);
    if (jac >= MIN_JACCARD) {
      return { remove: true, reason: `high_jaccard:${jac.toFixed(3)}` };
    }
    if (cont >= MIN_CONTAINMENT) {
      return { remove: true, reason: `containment:${cont.toFixed(3)}` };
    }
    if (nScope.includes(nTerm) && raw.length >= 120) {
      return { remove: true, reason: 'long_prose_substring_of_scope' };
    }
  }

  // 4) Texto muito longo (>=200) com alta sobreposição mesmo com colchetes
  if (raw.length >= 200) {
    const jac = jaccard(raw, scope);
    if (jac >= MIN_JACCARD) {
      return { remove: true, reason: `long_high_jaccard:${jac.toFixed(3)}` };
    }
  }

  // 5) Modo agressivo (opcional)
  if (AGGRESSIVE && nTerm.length >= 6 && nScope.includes(nTerm)) {
    return { remove: true, reason: 'aggressive_substring' };
  }

  return { remove: false, reason: null };
}

function parseEntryTerms(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw == null) return [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  // node-pg às vezes já entrega objeto JSONB
  if (typeof raw === 'object') {
    try {
      return Array.isArray(raw) ? raw.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ── Processamento de uma linha ────────────────────────────────────────────────

function cleanRow(row) {
  const terms = parseEntryTerms(row.entry_terms);
  const kept = [];
  const removed = [];

  for (const term of terms) {
    const { remove, reason } = classifyEntryTerm(term, row.scope_note);
    if (remove) {
      removed.push({ term, reason });
    } else {
      kept.push(term);
    }
  }

  const changed = removed.length > 0;
  return {
    ui: row.ui,
    name_pt: row.name_pt,
    scope_note_preview: String(row.scope_note ?? '').slice(0, 160),
    before_count: terms.length,
    after_count: kept.length,
    kept,
    removed,
    changed,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🧹 Limpeza de entry_terms contaminados por scope_note\n');
  console.log(`   mode:              ${APPLY ? 'APPLY (vai gravar no banco)' : 'DRY-RUN (não grava)'}`);
  console.log(`   aggressive:        ${AGGRESSIVE}`);
  console.log(`   min-prose-chars:   ${MIN_PROSE_CHARS}`);
  console.log(`   min-jaccard:       ${MIN_JACCARD}`);
  console.log(`   min-containment:   ${MIN_CONTAINMENT}`);
  console.log(`   batch-size:        ${BATCH_SIZE}`);
  console.log(`   limit:             ${LIMIT || 'all'}`);
  console.log(`   offset:            ${OFFSET}`);
  console.log(`   report:            ${OUT_FILE}\n`);

  // Contagem aproximada de candidatos (tem scope e entry_terms não vazio)
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM decs_descriptors
     WHERE scope_note IS NOT NULL
       AND btrim(scope_note) <> ''
       AND entry_terms IS NOT NULL
       AND jsonb_typeof(entry_terms) = 'array'
       AND jsonb_array_length(entry_terms) > 0`,
  );
  const totalCandidates = countRes.rows[0].n;
  console.log(`📊 Descritores com scope_note + entry_terms: ${totalCandidates}`);

  const report = {
    generated_at: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'dry-run',
    options: {
      LIMIT,
      BATCH_SIZE,
      OFFSET,
      AGGRESSIVE,
      MIN_PROSE_CHARS,
      MIN_JACCARD,
      MIN_CONTAINMENT,
    },
    total_candidates: totalCandidates,
    rows_scanned: 0,
    rows_changed: 0,
    terms_removed: 0,
    updates_applied: 0,
    samples: [],
    changes: [],
  };

  let offset = OFFSET;
  let scanned = 0;

  while (true) {
    if (LIMIT > 0 && scanned >= LIMIT) break;

    const take = LIMIT > 0 ? Math.min(BATCH_SIZE, LIMIT - scanned) : BATCH_SIZE;

    const { rows } = await pool.query(
      `SELECT ui, name_pt, scope_note, entry_terms
       FROM decs_descriptors
       WHERE scope_note IS NOT NULL
         AND btrim(scope_note) <> ''
         AND entry_terms IS NOT NULL
         AND jsonb_typeof(entry_terms) = 'array'
         AND jsonb_array_length(entry_terms) > 0
       ORDER BY ui
       LIMIT $1 OFFSET $2`,
      [take, offset],
    );

    if (rows.length === 0) break;

    for (const row of rows) {
      const result = cleanRow(row);
      scanned++;
      report.rows_scanned++;

      if (!result.changed) continue;

      report.rows_changed++;
      report.terms_removed += result.removed.length;
      report.changes.push({
        ui: result.ui,
        name_pt: result.name_pt,
        before_count: result.before_count,
        after_count: result.after_count,
        removed: result.removed,
      });

      if (report.samples.length < 25) {
        report.samples.push({
          ui: result.ui,
          name_pt: result.name_pt,
          scope_preview: result.scope_note_preview,
          removed: result.removed.map((r) => ({
            reason: r.reason,
            term_preview: String(r.term).slice(0, 200),
            term_length: String(r.term).length,
          })),
        });
      }

      if (APPLY) {
        await pool.query(
          `UPDATE decs_descriptors
           SET entry_terms = $1::jsonb
           WHERE ui = $2`,
          [JSON.stringify(result.kept), result.ui],
        );
        report.updates_applied++;
      }
    }

    offset += rows.length;
    const pct =
      totalCandidates > 0
        ? ((Math.min(offset, totalCandidates) / totalCandidates) * 100).toFixed(1)
        : '?';
    console.log(
      `   … progresso offset=${offset} | escaneados=${scanned} | ` +
        `alterados=${report.rows_changed} | removidos=${report.terms_removed} | ~${pct}%`,
    );

    if (rows.length < take) break;
  }

  // Salva relatório
  try {
    writeFileSync(resolve(process.cwd(), OUT_FILE), JSON.stringify(report, null, 2), 'utf8');
    console.log(`\n📝 Relatório salvo em ${OUT_FILE}`);
  } catch (e) {
    console.warn(`\n⚠️  Não foi possível gravar relatório em ${OUT_FILE}: ${e.message}`);
    console.warn('   (crie a pasta exports/ ou passe --out caminho/valido.json)');
  }

  console.log('\n══ Resumo ══════════════════════════════════════════');
  console.log(`   Escaneados:     ${report.rows_scanned}`);
  console.log(`   Linhas a mudar: ${report.rows_changed}`);
  console.log(`   Termos a tirar: ${report.terms_removed}`);
  console.log(`   UPDATEs feitos: ${report.updates_applied}${APPLY ? '' : ' (0 porque dry-run)'}`);
  console.log('═══════════════════════════════════════════════════\n');

  if (!APPLY && report.rows_changed > 0) {
    console.log('👉 Revise o relatório. Se estiver ok, rode de novo com --apply.\n');
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error('\n❌ Erro:', err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});

/*
═══════════════════════════════════════════════════════════════════════════════
COMO EXECUTAR (não rode estes comandos sem revisar o dry-run antes)
═══════════════════════════════════════════════════════════════════════════════

Pré-requisitos:
  - DATABASE_URL no .env.local apontando para o Postgres do MedMind
  - Pasta exports/ existente (ou use --out com outro caminho)

1) Dry-run (RECOMENDADO primeiro) — não altera o banco; só analisa e gera relatório:

   node --env-file=.env.local scripts/clean-decs-entry-terms-from-scope.mjs

   Amostra limitada (ex.: 200 linhas):

   node --env-file=.env.local scripts/clean-decs-entry-terms-from-scope.mjs --limit 200

2) Revisar o arquivo:
   exports/decs-entry-terms-scope-cleanup-report.json
   - samples[]: exemplos de termos que seriam removidos e o motivo
   - changes[]: lista completa ui + removed[]

3) Ajustar sensibilidade se necessário:
   --min-prose-chars 100     # só remove blocos ≥ 100 caracteres (padrão 80)
   --min-jaccard 0.65        # exige similaridade maior (padrão 0.55)
   --min-containment 0.80    # exigência maior de contenção (padrão 0.70)
   --aggressive-substring    # TAMBÉM remove sinônimos curtos contidos no scope
                             # (mais destrutivo — use com cautela)

4) Aplicar no banco (grava entry_terms limpo):

   node --env-file=.env.local scripts/clean-decs-entry-terms-from-scope.mjs --apply

   Ou só um lote:

   node --env-file=.env.local scripts/clean-decs-entry-terms-from-scope.mjs --apply --limit 1000

5) Depois do --apply (opcional mas recomendado):
   - Re-vetorizar descritores afetados, pois entry_terms entra no texto do embedding
     (ex.: scripts/embed-decs-descriptors.mjs --no-resume nos ui alterados, se houver suporte,
      ou reprocessar a tabela conforme seu fluxo atual).

Backup rápido (SQL, opcional, antes do --apply):

   CREATE TABLE decs_descriptors_entry_terms_backup AS
   SELECT ui, entry_terms, scope_note, NOW() AS backed_up_at
   FROM decs_descriptors
   WHERE entry_terms IS NOT NULL;

═══════════════════════════════════════════════════════════════════════════════
*/
