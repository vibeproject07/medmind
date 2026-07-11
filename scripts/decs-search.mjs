/**
 * decs-search.mjs — Busca local no banco decs_descriptors
 *
 * Dois modos de operação, ambos sem nenhuma API externa:
 *
 *   text   — busca por ILIKE em name_pt, name_en e entry_terms (padrão)
 *   vector — busca por similaridade coseno usando um vetor pré-computado (JSON)
 *
 * Requer apenas DATABASE_URL apontando para o PostgreSQL do projeto.
 */

import pg from 'pg';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { DECS_MAX_CANDIDATES } from './decs-search-limits.mjs';

// ── Helpers de hierarquia DeCS (replicados de lib/decs-pipeline.ts) ───────────

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
  return treeId.split('.')[0].replace(/[0-9]/g, '');
}

function buildHierarchyPath(treeId) {
  if (!treeId) return '';
  const cat   = treeCategory(treeId);
  const label = DECS_CATEGORY_LABELS[cat] ?? cat;
  return treeId.split('.').length <= 1 ? label : `${label} › ${treeId}`;
}

// ── Parser de argumentos CLI ──────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    mode:          'text',
    term:          '',
    vectorFile:    null,
    limit:         DECS_MAX_CANDIDATES,
    minSimilarity: 0.6,
    json:          false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if      (a === '--term'           || a === '-t') args.term          = argv[++i] ?? '';
    else if (a === '--vector'         || a === '-v') args.vectorFile    = argv[++i] ?? null;
    else if (a === '--limit'          || a === '-l') args.limit         = parseInt(argv[++i] ?? String(DECS_MAX_CANDIDATES));
    else if (a === '--min-similarity' || a === '-s') args.minSimilarity = parseFloat(argv[++i] ?? '0.6');
    else if (a === '--json'           || a === '-j') args.json          = true;
    else if (!a.startsWith('-') && !args.term)       args.term          = a;
  }

  if (args.vectorFile) args.mode = 'vector';
  return args;
}

// ── Conexão com o banco ───────────────────────────────────────────────────────

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'Erro: DATABASE_URL não definida.\n' +
      'Use: node --env-file=.env.local scripts/decs-search.mjs ...\n' +
      ' ou: export DATABASE_URL="postgres://..." antes de rodar o script.',
    );
    process.exit(1);
  }
  const { Pool } = pg;
  return new Pool({ connectionString: url });
}

// ── Mapeamento de linha do banco → objeto DeCSRecord ─────────────────────────

function mapRow(r, similarity) {
  const tree_ids = Array.isArray(r.tree_numbers)
    ? r.tree_numbers
    : JSON.parse(r.tree_numbers ?? '[]');

  return {
    term:           r.term,
    code:           r.code,
    tree_ids,
    hierarchy_path: buildHierarchyPath(tree_ids[0] ?? ''),
    ...(r.name_en    ? { name_en:    r.name_en    } : {}),
    ...(r.scope_note ? { scope_note: r.scope_note } : {}),
    ...(similarity !== null ? { similarity } : {}),
  };
}

// ── Modo texto: ILIKE em name_pt, name_en e entry_terms ───────────────────────

async function searchByText(pool, term, limit) {
  const like = `%${term}%`;
  const res = await pool.query(
    `SELECT
       ui       AS code,
       name_pt  AS term,
       name_en,
       scope_note,
       tree_numbers
     FROM decs_descriptors
     WHERE
       name_pt    ILIKE $1
       OR name_en ILIKE $1
       OR entry_terms::text ILIKE $1
     ORDER BY
       CASE
         WHEN name_pt ILIKE $2 THEN 0
         WHEN name_en ILIKE $2 THEN 1
         ELSE 2
       END,
       name_pt
     LIMIT $3`,
    [like, `%${term}%`, limit],
  );
  return res.rows.map(r => mapRow(r, null));
}

// ── Modo vetor: similaridade coseno via halfvec HNSW ─────────────────────────

function vectorToString(arr) {
  return '[' + arr.join(',') + ']';
}

async function searchByVector(pool, vectorStr, limit, minSimilarity) {
  const res = await pool.query(
    `SELECT
       ui       AS code,
       name_pt  AS term,
       name_en,
       scope_note,
       tree_numbers,
       1 - (embedding::halfvec(3072) <=> $1::halfvec(3072)) AS similarity
     FROM decs_descriptors
     WHERE embedding IS NOT NULL
       AND (1 - (embedding::halfvec(3072) <=> $1::halfvec(3072))) >= $2
     ORDER BY embedding::halfvec(3072) <=> $1::halfvec(3072)
     LIMIT $3`,
    [vectorStr, minSimilarity, limit],
  );
  return res.rows.map(r => mapRow(r, parseFloat(r.similarity ?? '0')));
}

// ── Impressão de resultados ───────────────────────────────────────────────────

function printResults(results, mode, json) {
  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return;
  }

  if (results.length === 0) {
    console.log('Nenhum resultado encontrado.');
    return;
  }

  results.forEach((r, i) => {
    const sim = r.similarity !== undefined ? ` (sim: ${r.similarity.toFixed(4)})` : '';
    console.log(`\n[${i + 1}] ${r.term}${sim}`);
    console.log(`    Código:     ${r.code}`);
    console.log(`    Hierarquia: ${r.hierarchy_path || '—'}`);
    console.log(`    Tree IDs:   ${r.tree_ids.join(', ') || '—'}`);
    if (r.name_en)    console.log(`    EN:         ${r.name_en}`);
    if (r.scope_note) console.log(`    Nota:       ${r.scope_note.slice(0, 120)}${r.scope_note.length > 120 ? '…' : ''}`);
  });
}

// ── Ponto de entrada ─────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.term && !args.vectorFile) {
    console.error(
      'Uso:\n' +
      '  node --env-file=.env.local scripts/decs-search.mjs --term <termo>\n' +
      '  node --env-file=.env.local scripts/decs-search.mjs --vector <arquivo.json>\n\n' +
      'Opções:\n' +
      '  --term/-t   <texto>   Termo de busca (modo texto, sem API)\n' +
      '  --vector/-v <arquivo> Arquivo JSON com vetor pré-computado (modo vetorial)\n' +
      '  --limit/-l  <n>       Máximo de resultados (padrão: 5)\n' +
      '  --min-similarity/-s <f> Similaridade mínima para modo vetor (padrão: 0.6)\n' +
      '  --json/-j             Saída em JSON puro (útil para piping)',
    );
    process.exit(1);
  }

  const pool = createPool();

  try {
    let results;

    if (args.mode === 'vector') {
      const vecPath = resolve(args.vectorFile);
      if (!existsSync(vecPath)) {
        console.error(`Arquivo não encontrado: ${vecPath}`);
        process.exit(1);
      }

      const raw = JSON.parse(readFileSync(vecPath, 'utf8'));
      const arr = Array.isArray(raw)
        ? raw
        : (raw.embedding ?? raw.vector ?? null);

      if (!Array.isArray(arr)) {
        console.error(
          'O arquivo JSON deve conter:\n' +
          '  • um array direto:          [0.012, -0.034, ...]\n' +
          '  • ou { "embedding": [...] }\n' +
          '  • ou { "vector":    [...] }',
        );
        process.exit(1);
      }

      if (arr.length !== 3072) {
        console.error(`Dimensão incorreta: esperado 3072, recebido ${arr.length}.`);
        process.exit(1);
      }

      results = await searchByVector(pool, vectorToString(arr), args.limit, args.minSimilarity);
      console.error(`✓ ${results.length} resultado(s) [modo: vetorial | min-sim: ${args.minSimilarity}]`);
    } else {
      results = await searchByText(pool, args.term, args.limit);
      console.error(`✓ ${results.length} resultado(s) [modo: texto | termo: "${args.term}"]`);
    }

    printResults(results, args.mode, args.json);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// COMANDOS DISPONÍVEIS
// ─────────────────────────────────────────────────────────────────────────────
//
// ── MODO TEXTO (sem API, busca ILIKE) ────────────────────────────────────────
//
//   # Busca básica por termo
//   node --env-file=.env.local scripts/decs-search.mjs --term "hipertensão"
//
//   # Argumento posicional (sem flag --term)
//   node --env-file=.env.local scripts/decs-search.mjs "diabetes mellitus"
//
//   # Aumentar número de resultados
//   node --env-file=.env.local scripts/decs-search.mjs --term "infarto" --limit 10
//
//   # Saída JSON pura (para piping ou salvar arquivo)
//   node --env-file=.env.local scripts/decs-search.mjs --term "pneumonia" --json
//   node --env-file=.env.local scripts/decs-search.mjs --term "pneumonia" --json > resultados.json
//
// ── MODO VETORIAL (busca por similaridade coseno) ───────────────────────────
//
//   # O arquivo JSON pode ser:
//   #   • array direto:          [0.012, -0.034, ...]          (3072 números)
//   #   • objeto com "embedding": { "embedding": [0.012, ...] }
//   #   • objeto com "vector":   { "vector":    [0.012, ...] }
//
//   node --env-file=.env.local scripts/decs-search.mjs --vector meu_vetor.json
//   node --env-file=.env.local scripts/decs-search.mjs --vector meu_vetor.json --limit 8
//   node --env-file=.env.local scripts/decs-search.mjs --vector meu_vetor.json --min-similarity 0.75
//   node --env-file=.env.local scripts/decs-search.mjs --vector meu_vetor.json --json > similares.json
//
// ── SEM --env-file (DATABASE_URL já exportada no shell) ─────────────────────
//
//   export DATABASE_URL="postgres://postgres:password@helium/heliumdb"
//   node scripts/decs-search.mjs --term "cardiopatia"
//
// ── CONSULTAS AUXILIARES (psql direto, não usam este script) ─────────────────
//
//   # Quantos descritores têm embedding no banco
//   psql $DATABASE_URL -c "SELECT COUNT(*) FROM decs_descriptors WHERE embedding IS NOT NULL;"
//
//   # Total de descritores
//   psql $DATABASE_URL -c "SELECT COUNT(*) FROM decs_descriptors;"
//
//   # Busca rápida por nome exato
//   psql $DATABASE_URL -c "SELECT ui, name_pt FROM decs_descriptors WHERE name_pt ILIKE '%hipertensão%' LIMIT 5;"
//
// ─────────────────────────────────────────────────────────────────────────────
