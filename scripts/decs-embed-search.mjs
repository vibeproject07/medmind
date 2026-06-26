/**
 * decs-embed-search.mjs — Busca semântica no DeCS via embedding Gemini
 *
 * Recebe um texto livre, vetoriza com gemini-embedding-001 (SEMANTIC_SIMILARITY)
 * e retorna os descritores DeCS mais próximos por similaridade coseno.
 *
 * Não usa --env-file. Lê as variáveis de ambiente diretamente do shell:
 *   DATABASE_URL   — string de conexão PostgreSQL
 *   GEMINI_API_KEY — chave da API Google Generative Language
 */

import pg from 'pg';

// ── Configuração ──────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIM   = 3072;

// ── Helpers de hierarquia DeCS ────────────────────────────────────────────────

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

// ── Gemini embedding ──────────────────────────────────────────────────────────

async function generateEmbedding(text) {
  const key = process.env.GEMINI_API_KEY?.trim() ?? process.env.GOOGLE_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'GEMINI_API_KEY não definida.\n' +
      'Execute: export GEMINI_API_KEY="sua-chave" antes de rodar o script.',
    );
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${key}`;

  // Sem taskType → SEMANTIC_SIMILARITY (compatível com os embeddings dos descritores DeCS)
  const body = { content: { parts: [{ text: text.slice(0, 8000) }] } };

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data   = await res.json();
  const values = data?.embedding?.values;

  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Resposta de embedding vazia ou inválida da API Gemini.');
  }

  return values;
}

// ── Banco de dados ────────────────────────────────────────────────────────────

function createPool() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      'DATABASE_URL não definida.\n' +
      'Execute: export DATABASE_URL="postgres://..." antes de rodar o script.',
    );
  }
  const { Pool } = pg;
  return new Pool({ connectionString: url });
}

// ── Busca vetorial DeCS ───────────────────────────────────────────────────────

async function searchDeCS(pool, embedding, limit, minSimilarity) {
  const vec = '[' + embedding.join(',') + ']';

  const res = await pool.query(
    `SELECT
       ui       AS code,
       name_pt  AS term,
       name_en,
       scope_note,
       tree_numbers,
       1 - (embedding::halfvec(${EMBEDDING_DIM}) <=> $1::halfvec(${EMBEDDING_DIM})) AS similarity
     FROM decs_descriptors
     WHERE embedding IS NOT NULL
       AND (1 - (embedding::halfvec(${EMBEDDING_DIM}) <=> $1::halfvec(${EMBEDDING_DIM}))) >= $2
     ORDER BY embedding::halfvec(${EMBEDDING_DIM}) <=> $1::halfvec(${EMBEDDING_DIM})
     LIMIT $3`,
    [vec, minSimilarity, limit],
  );

  return res.rows.map(r => {
    const tree_ids = Array.isArray(r.tree_numbers)
      ? r.tree_numbers
      : JSON.parse(r.tree_numbers ?? '[]');

    return {
      term:           r.term,
      code:           r.code,
      tree_ids,
      hierarchy_path: buildHierarchyPath(tree_ids[0] ?? ''),
      similarity:     parseFloat(r.similarity ?? '0'),
      ...(r.name_en    ? { name_en:    r.name_en    } : {}),
      ...(r.scope_note ? { scope_note: r.scope_note } : {}),
    };
  });
}

// ── Parser de argumentos CLI ──────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { text: '', limit: 5, minSimilarity: 0.15, json: false }; // interessante mudar esses valores;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if      (a === '--limit'          || a === '-l') args.limit         = parseInt(argv[++i] ?? '5');
    else if (a === '--min-similarity' || a === '-s') args.minSimilarity = parseFloat(argv[++i] ?? '0.5');
    else if (a === '--json'           || a === '-j') args.json          = true;
    else if (!a.startsWith('-'))                     args.text         += (args.text ? ' ' : '') + a;
  }

  return args;
}

// ── Impressão dos resultados ──────────────────────────────────────────────────

function printResults(results, json) {
  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return;
  }

  if (results.length === 0) {
    console.log('Nenhum descritor encontrado para esse texto.');
    return;
  }

  results.forEach((r, i) => {
    console.log(`\n[${i + 1}] ${r.term}  (sim: ${r.similarity.toFixed(4)})`);
    console.log(`    Código:     ${r.code}`);
    console.log(`    Hierarquia: ${r.hierarchy_path || '—'}`);
    console.log(`    Tree IDs:   ${r.tree_ids.join(', ') || '—'}`);
    if (r.name_en)    console.log(`    EN:         ${r.name_en}`);
    if (r.scope_note) {
      const note = r.scope_note.length > 140 ? r.scope_note.slice(0, 140) + '…' : r.scope_note;
      console.log(`    Nota:       ${note}`);
    }
  });
}

// ── Ponto de entrada ──────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.text) {
    console.error(
      'Uso: node scripts/decs-embed-search.mjs <texto> [opções]\n\n' +
      'Opções:\n' +
      '  --limit/-l  <n>   Máximo de resultados (padrão: 5)\n' +
      '  --min-similarity/-s <f>  Similaridade mínima (padrão: 0.5)\n' +
      '  --json/-j         Saída em JSON puro\n\n' +
      'Variáveis de ambiente necessárias:\n' +
      '  DATABASE_URL    — string de conexão PostgreSQL\n' +
      '  GEMINI_API_KEY  — chave Google Generative Language API',
    );
    process.exit(1);
  }

  console.error(`⏳ Vetorizando: "${args.text}"`);

  const embedding = await generateEmbedding(args.text);
  console.error(`✓ Embedding gerado (${embedding.length} dims)`);

  const pool = createPool();
  try {
    const results = await searchDeCS(pool, embedding, args.limit, args.minSimilarity);
    console.error(`✓ ${results.length} resultado(s) [min-sim: ${args.minSimilarity}]\n`);
    printResults(results, args.json);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO OBRIGATÓRIA (apenas uma vez por sessão de terminal)
// ─────────────────────────────────────────────────────────────────────────────
//
//   export DATABASE_URL="postgres://postgres:password@helium/heliumdb"
//   export GEMINI_API_KEY="sua-chave-aqui"
//
// ─────────────────────────────────────────────────────────────────────────────
// COMANDOS DISPONÍVEIS
// ─────────────────────────────────────────────────────────────────────────────
//
// ── Busca básica ─────────────────────────────────────────────────────────────
//
//   node scripts/decs-embed-search.mjs "hipertensão arterial"
//   node scripts/decs-embed-search.mjs "diabetes mellitus tipo 2"
//   node scripts/decs-embed-search.mjs "infarto agudo do miocárdio"
//
// ── Mais resultados / ajustar threshold ─────────────────────────────────────
//
//   node scripts/decs-embed-search.mjs "pneumonia" --limit 10
//   node scripts/decs-embed-search.mjs "insuficiência renal" --limit 8 --min-similarity 0.6
//   node scripts/decs-embed-search.mjs "câncer de mama" --min-similarity 0.7
//
// ── Texto longo (trecho de questão médica) ───────────────────────────────────
//
//   node scripts/decs-embed-search.mjs \
//     "Paciente de 60 anos com dor torácica irradiando para o braço esquerdo, \
//      sudorese e dispneia. ECG mostra supradesnivelamento de ST em V1-V4." \
//     --limit 8
//
// ── Saída JSON (para piping ou salvar em arquivo) ────────────────────────────
//
//   node scripts/decs-embed-search.mjs "sepse" --json
//   node scripts/decs-embed-search.mjs "sepse" --json > resultados.json
//
// ── Apenas a saída JSON (suprimindo logs de progresso) ───────────────────────
//
//   node scripts/decs-embed-search.mjs "hepatite" --json 2>/dev/null
//   node scripts/decs-embed-search.mjs "hepatite" --json 2>/dev/null > resultados.json
//
// ─────────────────────────────────────────────────────────────────────────────
