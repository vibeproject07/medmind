/**
 * decs-entry-terms-search.mjs — Busca de descritores DeCS por entry_terms
 *
 * Consulta a tabela decs_descriptors buscando descritores cujos entry_terms
 * (termos de entrada / sinônimos) contenham o texto pesquisado.
 * Útil para descobrir qual descritor oficial representa um sinônimo clínico.
 *
 * Usage:
 *   node --env-file=.env.local scripts/decs-entry-terms-search.mjs <texto> [opções]
 *
 * Options:
 *   --limit/-l  <n>          Máximo de resultados (padrão: 20)
 *   --exact/-e               Correspondência exata (padrão: substring)
 *   --lang/-L   <pt|en|all>  Idioma dos entry_terms a buscar (padrão: all)
 *   --category/-c <letra>    Filtrar por categoria DeCS (ex: C, D, N)
 *   --show-all-terms/-t      Mostrar todos os entry_terms, não só os que casaram
 *   --json/-j                Saída em JSON puro
 *   --stats/-S               Mostrar apenas estatísticas dos entry_terms no banco
 */

import pg from 'pg';

// ── Configuração ──────────────────────────────────────────────────────────────

const DECS_CATEGORY_LABELS = {
  A:  'Anatomia',
  B:  'Organismos',
  C:  'Doenças',
  D:  'Compostos Químicos e Drogas',
  E:  'Técnicas e Equipamentos Analíticos',
  F:  'Psiquiatria e Psicologia',
  G:  'Fenômenos Biológicos',
  H:  'Disciplinas e Ocupações',
  I:  'Antropologia, Educação, Sociologia',
  J:  'Tecnologia, Indústria, Agricultura',
  K:  'Humanidades',
  L:  'Ciência da Informação',
  M:  'Grupos Identificados',
  N:  'Saúde',
  SP: 'Saúde Pública',
  VS: 'Vigilância Sanitária',
};

function treeCategory(treeId) {
  return (treeId ?? '').split('.')[0].replace(/[0-9]/g, '');
}

function buildHierarchyPath(treeId) {
  if (!treeId) return '';
  const cat   = treeCategory(treeId);
  const label = DECS_CATEGORY_LABELS[cat] ?? cat;
  return treeId.split('.').length <= 1 ? label : `${label} › ${treeId}`;
}

// ── Banco de dados ────────────────────────────────────────────────────────────

function createPool() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      'DATABASE_URL não definida.\n' +
      'Use: node --env-file=.env.local scripts/decs-entry-terms-search.mjs <texto>',
    );
  }
  const { Pool } = pg;
  return new Pool({ connectionString: url });
}

// ── Estatísticas dos entry_terms ──────────────────────────────────────────────

async function showStats(pool) {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)                                             AS total_descritores,
      COUNT(*) FILTER (WHERE entry_terms IS NOT NULL
                         AND entry_terms != 'null'::jsonb
                         AND jsonb_array_length(entry_terms) > 0) AS com_entry_terms,
      COUNT(*) FILTER (WHERE entry_terms IS NULL
                          OR entry_terms = 'null'::jsonb
                          OR jsonb_array_length(entry_terms) = 0) AS sem_entry_terms,
      SUM(jsonb_array_length(entry_terms))
        FILTER (WHERE entry_terms IS NOT NULL
                  AND entry_terms != 'null'::jsonb
                  AND jsonb_array_length(entry_terms) > 0)        AS total_entry_terms,
      ROUND(AVG(jsonb_array_length(entry_terms))
        FILTER (WHERE entry_terms IS NOT NULL
                  AND entry_terms != 'null'::jsonb
                  AND jsonb_array_length(entry_terms) > 0), 2)    AS media_por_descritor,
      MAX(jsonb_array_length(entry_terms))                         AS max_entry_terms
    FROM decs_descriptors
  `);

  const { rows: topRows } = await pool.query(`
    SELECT name_pt, ui, jsonb_array_length(entry_terms) AS n_terms
    FROM decs_descriptors
    WHERE entry_terms IS NOT NULL
      AND entry_terms != 'null'::jsonb
      AND jsonb_array_length(entry_terms) > 0
    ORDER BY jsonb_array_length(entry_terms) DESC
    LIMIT 10
  `);

  const s = rows[0];
  console.log('\n📊 Estatísticas de entry_terms — decs_descriptors\n');
  console.log(`   Total de descritores    : ${s.total_descritores}`);
  console.log(`   Com entry_terms         : ${s.com_entry_terms}`);
  console.log(`   Sem entry_terms         : ${s.sem_entry_terms}`);
  console.log(`   Total de termos         : ${s.total_entry_terms ?? 0}`);
  console.log(`   Média por descritor     : ${s.media_por_descritor ?? 0}`);
  console.log(`   Máximo em um descritor  : ${s.max_entry_terms ?? 0}`);

  console.log('\n   Top 10 descritores com mais entry_terms:');
  topRows.forEach((r, i) => {
    console.log(`   ${String(i + 1).padStart(2)}. [${r.ui}] ${r.name_pt} — ${r.n_terms} termos`);
  });
  console.log('');
}

// ── Busca principal ───────────────────────────────────────────────────────────

async function searchEntryTerms(pool, args) {
  const { text, limit, exact, lang, category } = args;

  // Padrão ILIKE para substring ou exato
  const pattern = exact ? text : `%${text}%`;

  // Filtro de idioma: pt → apenas entry_terms em pt-br (contendo letras com acento ou comuns),
  // en → apenas entry_terms em inglês. Na prática o banco mistura línguas no mesmo array,
  // então o filtro de língua aplica ILIKE à representação textual dos termos.
  // Para simplificar, fazemos sempre busca case-insensitive em todos os termos.
  const categoryFilter = category
    ? `AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(tree_numbers) AS tn
         WHERE tn LIKE $3 || '%'
       )`
    : '';

  const params = [pattern, limit];
  if (category) params.push(category.toUpperCase());

  const { rows } = await pool.query(
    `SELECT
       d.ui,
       d.name_pt,
       d.name_en,
       d.scope_note,
       d.entry_terms,
       d.tree_numbers,
       (
         SELECT jsonb_agg(t)
         FROM jsonb_array_elements_text(d.entry_terms) AS t
         WHERE t ILIKE $1
       ) AS matched_terms,
       jsonb_array_length(COALESCE(d.entry_terms, '[]')) AS total_entry_terms
     FROM decs_descriptors d
     WHERE EXISTS (
       SELECT 1
       FROM jsonb_array_elements_text(d.entry_terms) AS t
       WHERE t ILIKE $1
     )
     ${categoryFilter}
     ORDER BY name_pt
     LIMIT $2`,
    params,
  );

  return rows.map(r => {
    const tree_ids = Array.isArray(r.tree_numbers)
      ? r.tree_numbers
      : JSON.parse(r.tree_numbers ?? '[]');

    const all_terms = Array.isArray(r.entry_terms)
      ? r.entry_terms
      : JSON.parse(r.entry_terms ?? '[]');

    const matched = Array.isArray(r.matched_terms)
      ? r.matched_terms
      : JSON.parse(r.matched_terms ?? '[]');

    return {
      ui:               r.ui,
      name_pt:          r.name_pt,
      name_en:          r.name_en  ?? null,
      scope_note:       r.scope_note ?? null,
      tree_ids,
      hierarchy_path:   buildHierarchyPath(tree_ids[0] ?? ''),
      total_entry_terms: parseInt(r.total_entry_terms ?? '0'),
      matched_terms:    matched,
      all_entry_terms:  all_terms,
    };
  });
}

// ── Impressão dos resultados ──────────────────────────────────────────────────

function highlight(term, query, exact) {
  if (exact) return term;
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return term.replace(re, '«$1»');
}

function printResults(results, args) {
  const { json, text, showAllTerms } = args;

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return;
  }

  if (results.length === 0) {
    console.log(`\nNenhum descritor encontrado com entry_term contendo "${text}".\n`);
    return;
  }

  results.forEach((r, i) => {
    const matchedStr = r.matched_terms
      .map(t => `"${highlight(t, text, args.exact)}"`)
      .join(', ');

    console.log(`\n[${i + 1}] ${r.name_pt}  [${r.ui}]`);
    if (r.name_en)        console.log(`    EN:           ${r.name_en}`);
    console.log(          `    Hierarquia:   ${r.hierarchy_path || '—'}`);
    console.log(          `    Tree IDs:     ${r.tree_ids.join(', ') || '—'}`);
    console.log(          `    Casou em:     ${matchedStr}`);
    console.log(          `    Total termos: ${r.total_entry_terms}`);

    if (showAllTerms && r.all_entry_terms.length > 0) {
      const display = r.all_entry_terms.map(t => `"${t}"`).join(', ');
      const wrapped = display.length > 120 ? display.slice(0, 120) + '…' : display;
      console.log(`    Todos os ET:  ${wrapped}`);
    }

    if (r.scope_note) {
      const note = r.scope_note.length > 160
        ? r.scope_note.slice(0, 160) + '…'
        : r.scope_note;
      console.log(`    Nota:         ${note}`);
    }
  });
}

// ── Parser de argumentos CLI ──────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    text:         '',
    limit:        20,
    exact:        false,
    lang:         'all',
    category:     null,
    showAllTerms: false,
    json:         false,
    stats:        false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if      (a === '--limit'          || a === '-l') args.limit        = parseInt(argv[++i] ?? '20');
    else if (a === '--exact'          || a === '-e') args.exact        = true;
    else if (a === '--lang'           || a === '-L') args.lang         = argv[++i] ?? 'all';
    else if (a === '--category'       || a === '-c') args.category     = argv[++i] ?? null;
    else if (a === '--show-all-terms' || a === '-t') args.showAllTerms = true;
    else if (a === '--json'           || a === '-j') args.json         = true;
    else if (a === '--stats'          || a === '-S') args.stats        = true;
    else if (!a.startsWith('-'))                     args.text        += (args.text ? ' ' : '') + a;
  }

  return args;
}

// ── Ponto de entrada ──────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = createPool();

  try {
    if (args.stats) {
      await showStats(pool);
      return;
    }

    if (!args.text) {
      console.error(
        'Uso: node --env-file=.env.local scripts/decs-entry-terms-search.mjs <texto> [opções]\n\n' +
        'Opções:\n' +
        '  --limit/-l  <n>          Máximo de resultados (padrão: 20)\n' +
        '  --exact/-e               Correspondência exata em vez de substring\n' +
        '  --lang/-L   <pt|en|all>  Idioma a buscar nos entry_terms (padrão: all)\n' +
        '  --category/-c <letra>    Filtrar por categoria DeCS (ex: C, D, N, SP)\n' +
        '  --show-all-terms/-t      Mostrar todos os entry_terms do descritor\n' +
        '  --json/-j                Saída em JSON puro\n' +
        '  --stats/-S               Mostrar estatísticas dos entry_terms no banco\n\n' +
        'Exemplos:\n' +
        '  node --env-file=.env.local scripts/decs-entry-terms-search.mjs "pressão arterial"\n' +
        '  node --env-file=.env.local scripts/decs-entry-terms-search.mjs "blood pressure" --exact\n' +
        '  node --env-file=.env.local scripts/decs-entry-terms-search.mjs "infarto" --category C --limit 10\n' +
        '  node --env-file=.env.local scripts/decs-entry-terms-search.mjs "tuberculose" --show-all-terms\n' +
        '  node --env-file=.env.local scripts/decs-entry-terms-search.mjs "diabetes" --json\n' +
        '  node --env-file=.env.local scripts/decs-entry-terms-search.mjs --stats',
      );
      process.exit(1);
    }

    const mode = args.exact ? 'exata' : 'substring';
    const catInfo = args.category ? ` | categoria: ${args.category.toUpperCase()}` : '';
    console.error(`⏳ Buscando entry_terms [${mode}]: "${args.text}"${catInfo}`);

    const results = await searchEntryTerms(pool, args);

    console.error(`✓ ${results.length} descritor(es) encontrado(s) [limit: ${args.limit}]\n`);
    printResults(results, args);

  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// MODO DE USO
// ─────────────────────────────────────────────────────────────────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs <texto> [opções]
//
// ─────────────────────────────────────────────────────────────────────────────
// FUNCIONALIDADES (opções)
// ─────────────────────────────────────────────────────────────────────────────
//
//   Opção                       Atalho  Padrão  Descrição
//   ──────────────────────────────────────────────────────────────────────────
//   --limit <n>                 -l      20      Máximo de resultados retornados
//   --exact                     -e      (não)   Correspondência exata em vez de substring
//   --lang <pt|en|all>          -L      all     Idioma a buscar nos entry_terms
//   --category <letra>          -c      (todos) Filtrar por categoria DeCS (C, D, N, SP…)
//   --show-all-terms            -t      (não)   Exibir todos os entry_terms do descritor
//   --json                      -j      (não)   Saída em JSON puro (para piping/scripts)
//   --stats                     -S      (não)   Mostrar estatísticas dos entry_terms no banco
//
//   Obs.: termos que casam com a busca são destacados com «guillemets» na saída de texto.
//
// ─────────────────────────────────────────────────────────────────────────────
// COMANDOS DISPONÍVEIS
// ─────────────────────────────────────────────────────────────────────────────
//
// ── Busca básica (substring, case-insensitive) ────────────────────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "pressão arterial"
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "infarto do miocardio"
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "tuberculose pulmonar"
//
// ── Correspondência exata ─────────────────────────────────────────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "hipertensão arterial" --exact
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "blood pressure" --exact
//
// ── Filtrar por categoria DeCS ────────────────────────────────────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "insuficiência" --category C
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "vacina" --category D --limit 5
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "epidemia" --category N
//
// ── Ver todos os entry_terms do descritor retornado ───────────────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "diabetes" --show-all-terms
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "sepse" --show-all-terms --limit 3
//
// ── Saída em JSON (para uso em pipelines ou scripts) ─────────────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "pneumonia" --json
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "pneumonia" --json > resultados.json
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "pneumonia" --json 2>/dev/null
//
// ── Estatísticas dos entry_terms no banco ────────────────────────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs --stats
//
// ─────────────────────────────────────────────────────────────────────────────
