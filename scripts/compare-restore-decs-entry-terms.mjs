/**
 * compare-restore-decs-entry-terms.mjs
 *
 * Compara `entry_terms` do backup_completo.sql com o banco atual e, opcionalmente,
 * restaura termos que sumiram no DB mas NÃO são contaminação de scope_note.
 *
 * Fluxo:
 *  1. Faz streaming do COPY de public.decs_descriptors no backup SQL.
 *  2. Extrai ui + scope_note + entry_terms (ignora embedding para não estourar memória).
 *  3. Lê entry_terms atuais do Postgres.
 *  4. Diff por descritor:
 *       - missing_scope: termos do backup ausentes no DB que parecem o texto do scope_note
 *       - missing_other: termos ausentes que NÃO parecem scope (possível remoção indevida)
 *  5. Gera relatório JSON.
 *  6. Com --restore-other: reanexa ao DB apenas os missing_other (união preservando
 *     ordem: termos atuais + termos legítimos do backup que faltam).
 *
 * Padrão = só comparar (dry-run). NÃO aplica UPDATE sem --restore-other.
 */

import fs from 'fs';
import readline from 'readline';
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

const BACKUP_PATH = resolve(
  process.cwd(),
  getArg('backup', 'backup_completo.sql'),
);
const OUT_FILE = getArg(
  'out',
  'exports/decs-entry-terms-backup-vs-db.json',
);
const RESTORE_OTHER = hasFlag('restore-other');
const LIMIT = parseInt(getArg('limit', '0'), 10); // 0 = todos (só limita sample de restore se >0)

const MIN_PROSE_CHARS = parseInt(getArg('min-prose-chars', '80'), 10);
const MIN_JACCARD = parseFloat(getArg('min-jaccard', '0.55'));
const MIN_CONTAINMENT = parseFloat(getArg('min-containment', '0.70'));

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL não definida. Use --env-file=.env.local');
  process.exit(1);
}
if (!fs.existsSync(BACKUP_PATH)) {
  console.error(`❌ Backup não encontrado: ${BACKUP_PATH}`);
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

// ── Similaridade / classificação de scope ─────────────────────────────────────

function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  return new Set(
    normalize(s)
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

function jaccard(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

function containmentRatio(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  return longer.includes(shorter) ? shorter.length / longer.length : 0;
}

/** true se parece um entry term DeCS típico: "Nome PT[Name EN]" (sem parágrafo). */
function looksLikeStructuredEntryTerm(term) {
  const t = String(term ?? '').trim();
  // Um único bloco Nome[Tradução], sem várias frases
  if (/^[^\[\]]{1,200}\[[^\[\]]{1,200}\]$/.test(t) && !/[.!?].*[.!?]/.test(t)) {
    return true;
  }
  // Nome curto/médio sem ponto final de definição
  if (t.length < MIN_PROSE_CHARS && !/[.!?]/.test(t)) return true;
  return false;
}

/** true se o termo parece texto corrido do scope_note (contaminação). */
function isScopeContamination(term, scopeNote) {
  const raw = String(term ?? '').trim();
  const scope = String(scopeNote ?? '').trim();
  if (!raw || !scope) return false;

  const nTerm = normalize(raw);
  const nScope = normalize(scope);

  // Igualdade total com o scope
  if (nTerm === nScope) return true;

  // Scope inteiro (ou quase) embutido no elemento
  if (
    scope.length >= MIN_PROSE_CHARS &&
    (nTerm.includes(nScope) || containmentRatio(raw, scope) >= 0.85)
  ) {
    // Mas se for só Nome[EN] curto-estruturado, não tratar como prosa
    if (!looksLikeStructuredEntryTerm(raw) || raw.length >= scope.length * 0.9) {
      return true;
    }
  }

  // Parágrafo / prosa longa parecida com o scope (não é sinônimo Nome[EN])
  if (!looksLikeStructuredEntryTerm(raw) && raw.length >= MIN_PROSE_CHARS) {
    if (jaccard(raw, scope) >= MIN_JACCARD) return true;
    if (containmentRatio(raw, scope) >= MIN_CONTAINMENT) return true;
    if (nScope.includes(nTerm) && raw.length >= 120) return true;
  }

  // Elemento muito longo (>= 200) com alta sobreposição mesmo se tiver colchetes
  if (raw.length >= 200 && jaccard(raw, scope) >= MIN_JACCARD) return true;

  return false;
}

function unescapeCopy(field) {
  if (field == null || field === '\\N') return null;
  return field
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

/** Extrai só as 7 primeiras colunas TSV (até entry_terms), sem materializar embedding. */
function splitFirstColumns(line, nCols) {
  const parts = [];
  let cur = '';
  let i = 0;
  while (i < line.length && parts.length < nCols) {
    const ch = line[i];
    if (ch === '\t') {
      parts.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (ch === '\\' && i + 1 < line.length) {
      cur += ch + line[i + 1];
      i += 2;
      continue;
    }
    cur += ch;
    i++;
  }
  if (parts.length < nCols) parts.push(cur);
  return parts;
}

function parseTerms(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw == null) return [];
  if (typeof raw === 'object') {
    try {
      return Array.isArray(raw) ? raw.map(String) : [];
    } catch {
      return [];
    }
  }
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

// ── Backup stream ─────────────────────────────────────────────────────────────

async function loadBackupMap(path) {
  const map = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let inCopy = false;
  let n = 0;
  console.log(`📦 Lendo backup: ${path}`);

  for await (const line of rl) {
    if (!inCopy) {
      if (line.startsWith('COPY public.decs_descriptors ')) {
        inCopy = true;
        console.log('   COPY public.decs_descriptors encontrado…');
      }
      continue;
    }
    if (line === '\\.') break;

    // id, ui, name_pt, name_en, descriptor_class, scope_note, entry_terms, ...
    const parts = splitFirstColumns(line, 7);
    if (parts.length < 7) continue;

    const ui = unescapeCopy(parts[1]);
    if (!ui) continue;
    const scope = unescapeCopy(parts[5]) ?? '';
    const entryRaw = unescapeCopy(parts[6]);
    const terms = parseTerms(entryRaw);

    map.set(ui, { scope_note: scope, terms });
    n++;
    if (n % 5000 === 0) console.log(`   … backup: ${n} linhas`);
  }

  console.log(`   ✓ Backup: ${map.size} descritores\n`);
  return map;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔍 Comparação backup × banco — entry_terms\n');
  console.log(`   restore-other: ${RESTORE_OTHER ? 'SIM (vai gravar)' : 'não (só relatório)'}`);
  console.log(`   min-prose-chars: ${MIN_PROSE_CHARS}`);
  console.log(`   min-jaccard: ${MIN_JACCARD}`);
  console.log(`   min-containment: ${MIN_CONTAINMENT}\n`);

  const backup = await loadBackupMap(BACKUP_PATH);

  console.log('🗄️  Lendo banco atual…');
  const { rows } = await pool.query(
    `SELECT ui, name_pt, scope_note, entry_terms FROM decs_descriptors`,
  );
  console.log(`   ✓ DB: ${rows.length} descritores\n`);

  const dbMap = new Map();
  for (const r of rows) {
    dbMap.set(r.ui, {
      name_pt: r.name_pt,
      scope_note: r.scope_note || '',
      terms: parseTerms(r.entry_terms),
    });
  }

  const onlyInBackup = [];
  const onlyInDb = [];
  const diffs = [];

  let termsMissingScope = 0;
  let termsMissingOther = 0;
  let rowsOnlyScopeLoss = 0;
  let rowsOtherLoss = 0;
  let restoredRows = 0;
  let restoredTerms = 0;

  for (const [ui, b] of backup) {
    const d = dbMap.get(ui);
    if (!d) {
      onlyInBackup.push(ui);
      continue;
    }

    const dSet = new Set(d.terms);
    const bSet = new Set(b.terms);
    const missing = b.terms.filter((t) => !dSet.has(t));
    const added = d.terms.filter((t) => !bSet.has(t));
    if (missing.length === 0 && added.length === 0) continue;

    const scope = d.scope_note || b.scope_note || '';
    const missingScope = [];
    const missingOther = [];
    for (const t of missing) {
      if (isScopeContamination(t, scope)) missingScope.push(t);
      else missingOther.push(t);
    }

    termsMissingScope += missingScope.length;
    termsMissingOther += missingOther.length;
    if (missingOther.length > 0) rowsOtherLoss++;
    else if (missingScope.length > 0) rowsOnlyScopeLoss++;

    const entry = {
      ui,
      name_pt: d.name_pt,
      backup_count: b.terms.length,
      db_count: d.terms.length,
      missing_total: missing.length,
      missing_as_scope: missingScope.length,
      missing_other: missingOther.length,
      added: added.length,
      sample_missing_other: missingOther.slice(0, 8).map((t) => ({
        length: t.length,
        preview: t.slice(0, 160),
      })),
      sample_missing_scope: missingScope.slice(0, 3).map((t) => ({
        length: t.length,
        preview: t.slice(0, 160),
      })),
    };
    diffs.push(entry);

    // Restaura só missing_other
    if (RESTORE_OTHER && missingOther.length > 0) {
      if (LIMIT > 0 && restoredRows >= LIMIT) continue;
      const merged = [...d.terms];
      const seen = new Set(merged);
      for (const t of missingOther) {
        if (!seen.has(t)) {
          merged.push(t);
          seen.add(t);
          restoredTerms++;
        }
      }
      await pool.query(
        `UPDATE decs_descriptors SET entry_terms = $1::jsonb WHERE ui = $2`,
        [JSON.stringify(merged), ui],
      );
      restoredRows++;
    }
  }

  for (const ui of dbMap.keys()) {
    if (!backup.has(ui)) onlyInDb.push(ui);
  }

  diffs.sort((a, b) => b.missing_other - a.missing_other || b.missing_as_scope - a.missing_as_scope);

  const summary = {
    generated_at: new Date().toISOString(),
    backup_path: BACKUP_PATH,
    backup_descriptors: backup.size,
    db_descriptors: dbMap.size,
    only_in_backup: onlyInBackup.length,
    only_in_db: onlyInDb.length,
    rows_with_entry_terms_diff: diffs.length,
    rows_with_only_scope_contamination_missing: rowsOnlyScopeLoss,
    rows_with_non_scope_terms_missing: rowsOtherLoss,
    total_missing_terms_classified_as_scope: termsMissingScope,
    total_missing_terms_NOT_scope: termsMissingOther,
    restored_rows: restoredRows,
    restored_terms: restoredTerms,
    conclusion:
      termsMissingOther === 0
        ? 'Com a heurística atual: os termos ausentes no banco (vs backup) são classificados como contaminação de scope_note. Não há evidência de remoção massiva de sinônimos legítimos.'
        : `Atenção: ${termsMissingOther} termo(s) em ${rowsOtherLoss} descritor(es) estão no backup e não no DB, e NÃO foram classificados como scope_note. Revise o relatório; use --restore-other se quiser recolocá-los.`,
  };

  const report = {
    summary,
    top_other_losses: diffs.filter((d) => d.missing_other > 0).slice(0, 50),
    top_scope_losses: diffs.filter((d) => d.missing_as_scope > 0 && d.missing_other === 0).slice(0, 30),
    all_diffs_truncated: diffs.slice(0, 200),
  };

  fs.mkdirSync(resolve(process.cwd(), 'exports'), { recursive: true });
  fs.writeFileSync(resolve(process.cwd(), OUT_FILE), JSON.stringify(report, null, 2));

  console.log('══ Resumo ══════════════════════════════════════════');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\n📝 Relatório: ${OUT_FILE}\n`);

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
INSTRUÇÕES DE EXECUÇÃO (rode manualmente no terminal)
═══════════════════════════════════════════════════════════════════════════════

1) Só comparar (não altera o banco) — recomendado primeiro:

   node --env-file=.env.local scripts/compare-restore-decs-entry-terms.mjs

   Backup em outro caminho:

   node --env-file=.env.local scripts/compare-restore-decs-entry-terms.mjs \
     --backup /caminho/backup_completo.sql

2) Abrir o relatório:

   exports/decs-entry-terms-backup-vs-db.json

   Campos importantes em summary:
     - total_missing_terms_classified_as_scope  → ok remover / já removidos (prosa do scope)
     - total_missing_terms_NOT_scope            → possíveis sinônimos legítimos perdidos
     - rows_with_non_scope_terms_missing

3) Se houver missing_other e você quiser restaurá-los (união backup∖scope ∪ DB atual):

   node --env-file=.env.local scripts/compare-restore-decs-entry-terms.mjs --restore-other

   Amostra limitada:

   node --env-file=.env.local scripts/compare-restore-decs-entry-terms.mjs \
     --restore-other --limit 100

4) Opções de sensibilidade (mesma lógica do clean-decs-entry-terms-from-scope.mjs):

   --min-prose-chars 80
   --min-jaccard 0.55
   --min-containment 0.70

5) Depois de --restore-other (opcional): re-vetorizar descritores afetados,
   pois entry_terms entra no texto de embedding.

Nota: o backup já contém, em vários descritores, o texto do scope_note dentro
de entry_terms (contaminação de origem no import). A comparação separa isso
de termos que são sinônimos “normais”.

═══════════════════════════════════════════════════════════════════════════════
*/
