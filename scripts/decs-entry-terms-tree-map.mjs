/**
 * decs-entry-terms-tree-map.mjs — Mapeia entry_terms (sinônimos) → tree_numbers (ramificações)
 *
 * Para cada descritor DeCS, extrai seus entry_terms (sinônimos/termos alternativos)
 * e associa cada um deles às tree_numbers (branches) do descritor a que pertencem —
 * já que um entry_term não tem posição hierárquica própria, ele HERDA todas as
 * ramificações do descritor "pai".
 *
 * Saída (documento JSON):
 *   {
 *     metadata:   { generated_at, filtros aplicados, total_descriptors, total_entry_terms }
 *     descriptors: [
 *       { code, name_pt, name_en, tree_ids, branches: [{tree_id, hierarchy_path}],
 *         entry_terms_count, entry_terms: [...] }
 *     ],
 *     term_tree_index: [
 *       { term, source_code, source_name_pt, tree_ids, branches: [{tree_id, hierarchy_path}] }
 *     ]   // versão "achatada" — um item por entry_term, pronta para lookup direto termo→árvore
 *   }
 *
 * Fontes reaproveitadas (estilo/estrutura):
 *   - scripts/decs-pipeline-v1-run.mjs    → DECS_CATEGORY_LABELS, buildHierarchyPath, buildBranches
 *   - scripts/decs-embed-search.mjs       → generateEmbedding (Gemini REST, sem taskType)
 *   - scripts/decs-vectorize-20.mjs       → estrutura de CLI args, createPool, export em JSON
 *   - scripts/decs-embedding-text-audit.mjs → padrão de --stats / relatório agregado
 *   - scripts/embed-decs-descriptors.mjs  → iteração paginada sobre decs_descriptors
 *
 * Uso e opções: ver bloco "COMANDOS DISPONÍVEIS" ao final deste arquivo.
 */

import pg   from 'pg';
import fs   from 'fs';
import path from 'path';

// ══════════════════════════════════════════════════════════════════════════════
// Configuração
// ══════════════════════════════════════════════════════════════════════════════

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

/** Resolve TODAS as ramificações (tree_ids) de um descritor — idêntico a lib/decs-pipeline.ts. */
function buildBranches(treeIds) {
  return (treeIds ?? []).filter(Boolean).map((tree_id) => ({ tree_id, hierarchy_path: buildHierarchyPath(tree_id) }));
}

// ── Banco de dados ────────────────────────────────────────────────────────────

function createPool() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      'DATABASE_URL não definida.\n' +
      'Use: node --env-file=.env.local scripts/decs-entry-terms-tree-map.mjs',
    );
  }
  const { Pool } = pg;
  return new Pool({ connectionString: url });
}

// ══════════════════════════════════════════════════════════════════════════════
// Busca de descritores (com filtros) + montagem do mapa entry_term → tree_numbers
// ══════════════════════════════════════════════════════════════════════════════

async function fetchDescriptors(pool, args) {
  const { search, ui, category, limit, minTerms } = args;

  const conditions = [
    `entry_terms IS NOT NULL`,
    `entry_terms != 'null'::jsonb`,
    `jsonb_array_length(entry_terms) >= $1`,
  ];
  const params = [minTerms];

  if (ui) {
    params.push(ui);
    conditions.push(`ui = $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    const p = params.length;
    conditions.push(
      `(name_pt ILIKE $${p} OR EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(entry_terms) AS t WHERE t ILIKE $${p}
       ))`,
    );
  }

  if (category) {
    params.push(`${category.toUpperCase()}%`);
    conditions.push(
      `EXISTS (SELECT 1 FROM jsonb_array_elements_text(tree_numbers) AS tn WHERE tn LIKE $${params.length})`,
    );
  }

  const limitClause = limit > 0 ? `LIMIT $${params.length + 1}` : '';
  if (limit > 0) params.push(limit);

  const { rows } = await pool.query(
    `SELECT ui, name_pt, name_en, entry_terms, tree_numbers
     FROM decs_descriptors
     WHERE ${conditions.join(' AND ')}
     ORDER BY name_pt
     ${limitClause}`,
    params,
  );

  return rows.map((r) => {
    const tree_ids = Array.isArray(r.tree_numbers) ? r.tree_numbers : JSON.parse(r.tree_numbers ?? '[]');
    const entry_terms = Array.isArray(r.entry_terms) ? r.entry_terms : JSON.parse(r.entry_terms ?? '[]');
    return {
      code: r.ui,
      name_pt: r.name_pt,
      name_en: r.name_en ?? undefined,
      tree_ids,
      branches: buildBranches(tree_ids),
      entry_terms_count: entry_terms.length,
      entry_terms,
    };
  });
}

/** Achata descritores em uma lista termo→árvore (um item por entry_term). */
function buildTermTreeIndex(descriptors) {
  const index = [];
  for (const d of descriptors) {
    for (const term of d.entry_terms) {
      index.push({
        term,
        source_code: d.code,
        source_name_pt: d.name_pt,
        tree_ids: d.tree_ids,
        branches: d.branches,
      });
    }
  }
  return index;
}

// ── Estatísticas agregadas (--stats) ──────────────────────────────────────────

async function showStats(pool) {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE entry_terms IS NOT NULL AND entry_terms != 'null'::jsonb
                          AND jsonb_array_length(entry_terms) > 0)               AS descritores_com_termos,
      COUNT(*) FILTER (WHERE tree_numbers IS NOT NULL AND tree_numbers != 'null'::jsonb
                          AND jsonb_array_length(tree_numbers) > 1)              AS descritores_multi_ramo,
      SUM(jsonb_array_length(entry_terms))
        FILTER (WHERE entry_terms IS NOT NULL AND entry_terms != 'null'::jsonb)  AS total_entry_terms,
      ROUND(AVG(jsonb_array_length(tree_numbers))
        FILTER (WHERE tree_numbers IS NOT NULL AND tree_numbers != 'null'::jsonb
                  AND jsonb_array_length(tree_numbers) > 0), 2)                 AS media_tree_ids_por_descritor
    FROM decs_descriptors
  `);

  const s = rows[0];
  console.log('\n📊 Estatísticas — entry_terms × tree_numbers (decs_descriptors)\n');
  console.log(`   Descritores com entry_terms      : ${s.descritores_com_termos}`);
  console.log(`   Descritores com >1 ramificação    : ${s.descritores_multi_ramo}`);
  console.log(`   Total de entry_terms (sinônimos)  : ${s.total_entry_terms ?? 0}`);
  console.log(`   Média de tree_ids por descritor    : ${s.media_tree_ids_por_descritor ?? 0}`);
  console.log('');
}

// ── Impressão dos resultados (modo texto, não --json) ─────────────────────────

function printResults(descriptors, args) {
  if (descriptors.length === 0) {
    console.log('\nNenhum descritor encontrado com os filtros aplicados.\n');
    return;
  }

  descriptors.forEach((d, i) => {
    console.log(`\n[${i + 1}] ${d.name_pt}  [${d.code}]${d.name_en ? `  (${d.name_en})` : ''}`);
    console.log(`    Ramificações (${d.branches.length}):`);
    d.branches.forEach((b) => console.log(`      • ${b.tree_id}  —  ${b.hierarchy_path}`));
    console.log(`    Entry terms (${d.entry_terms_count}):`);
    if (d.entry_terms.length > 0) {
      const display = d.entry_terms.map((t) => `"${t}"`).join(', ');
      const wrapped = display.length > 200 ? display.slice(0, 200) + '…' : display;
      console.log(`      ${wrapped}`);
    } else {
      console.log('      —');
    }
  });
  console.log('');
}

// ── Parser de argumentos CLI ──────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    search:   null,
    ui:       null,
    category: null,
    limit:    50,
    minTerms: 1,
    json:     false,
    out:      null,
    stats:    false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if      (a === '--search')     args.search   = argv[++i] ?? null;
    else if (a === '--ui')         args.ui       = argv[++i] ?? null;
    else if (a === '--category')   args.category = argv[++i] ?? null;
    else if (a === '--limit')      args.limit    = parseInt(argv[++i] ?? '50', 10);
    else if (a === '--min-terms')  args.minTerms = parseInt(argv[++i] ?? '1', 10);
    else if (a === '--json')       args.json     = true;
    else if (a === '--out')        args.out      = argv[++i] ?? null;
    else if (a === '--stats')      args.stats    = true;
  }

  return args;
}

// ══════════════════════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = createPool();

  try {
    if (args.stats) {
      await showStats(pool);
      return;
    }

    console.error(
      `⏳ Buscando descritores` +
      `${args.search ? ` [busca: "${args.search}"]` : ''}` +
      `${args.ui ? ` [ui: ${args.ui}]` : ''}` +
      `${args.category ? ` [categoria: ${args.category.toUpperCase()}]` : ''}` +
      `${args.limit > 0 ? ` [limit: ${args.limit}]` : ' [todos]'}...`,
    );

    const descriptors = await fetchDescriptors(pool, args);
    const termTreeIndex = buildTermTreeIndex(descriptors);

    console.error(`✓ ${descriptors.length} descritor(es) — ${termTreeIndex.length} entry_term(s) mapeado(s)\n`);

    if (!args.json) printResults(descriptors, args);

    const document = {
      metadata: {
        generated_at: new Date().toISOString(),
        filters: {
          search: args.search,
          ui: args.ui,
          category: args.category ? args.category.toUpperCase() : null,
          limit: args.limit,
          min_terms: args.minTerms,
        },
        total_descriptors: descriptors.length,
        total_entry_terms: termTreeIndex.length,
      },
      descriptors,
      term_tree_index: termTreeIndex,
    };

    if (args.json) process.stdout.write(JSON.stringify(document, null, 2) + '\n');

    const outFile = args.out ?? `exports/decs-entry-terms-tree-map-${Date.now()}.json`;
    const outDir = path.dirname(outFile);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(document, null, 2) + '\n', 'utf-8');
    console.error(`📄 Exportado: ${outFile}`);

  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('\n💥 Fatal:', err.message);
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// MODO DE USO
// ─────────────────────────────────────────────────────────────────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-tree-map.mjs [opções]
//
// ─────────────────────────────────────────────────────────────────────────────
// FUNCIONALIDADES (opções)
// ─────────────────────────────────────────────────────────────────────────────
//
//   Opção                Padrão   Descrição
//   ────────────────────────────────────────────────────────────────────────────
//   --search "<termo>"   (nenhum) Filtra descritores por name_pt/entry_terms (ILIKE, substring)
//   --ui <código>         (nenhum) Filtra por um único descritor (código UI, ex: D000292)
//   --category <letra>    (todas)  Filtra por categoria DeCS (primeira letra do tree_number)
//   --limit <n>            50      Máximo de descritores processados (0 = todos, ~35 mil)
//   --min-terms <n>         1      Só inclui descritores com pelo menos N entry_terms
//   --json                (não)   Saída em JSON puro (para piping/scripts)
//   --out <arquivo>        auto    Caminho de exportação (padrão: exports/decs-entry-terms-tree-map-<ts>.json)
//   --stats               (não)   Mostra estatísticas agregadas e sai (sem processar/exportar)
//
// ─────────────────────────────────────────────────────────────────────────────
// COMANDOS DISPONÍVEIS
// ─────────────────────────────────────────────────────────────────────────────
//
// ── Uso básico — mapeia os 50 primeiros descritores (padrão) ──────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-tree-map.mjs
//
// ── Buscar por termo específico ────────────────────────────────────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-tree-map.mjs --search "hipertensão"
//   node --env-file=.env.local scripts/decs-entry-terms-tree-map.mjs --search "diabetes" --limit 10
//
// ── Um único descritor pelo código UI ──────────────────────────────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-tree-map.mjs --ui D000293
//
// ── Filtrar por categoria DeCS ─────────────────────────────────────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-tree-map.mjs --category C --limit 20
//   node --env-file=.env.local scripts/decs-entry-terms-tree-map.mjs --category D --min-terms 3
//
// ── Rodar sobre TODOS os ~35 mil descritores (cuidado: pode gerar arquivo grande) ─
//
//   node --env-file=.env.local scripts/decs-entry-terms-tree-map.mjs --limit 0 --out exports/decs-full-tree-map.json
//
// ── Estatísticas agregadas (sem exportar) ──────────────────────────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-tree-map.mjs --stats
//
// ── Saída em JSON puro (para piping) ───────────────────────────────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-tree-map.mjs --search "sepse" --json > sepse.json
//
// ─────────────────────────────────────────────────────────────────────────────
