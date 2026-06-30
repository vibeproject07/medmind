/**
 * decs-entry-terms-search.mjs — Busca de descritores DeCS por entry_terms
 *
 * Dois modos de busca:
 *
 *   [TEXTO]   Padrão — consulta o array JSONB entry_terms via ILIKE.
 *             Não requer GEMINI_API_KEY. Funciona mesmo sem embeddings no banco.
 *
 *   [VETOR]   --vector — vetoriza o texto com Gemini e faz busca por similaridade
 *             coseno, exibindo os entry_terms dos descritores mais próximos.
 *             Requer GEMINI_API_KEY e embeddings gerados por embed-decs-descriptors.mjs.
 *
 * Usage:
 *   node --env-file=.env.local scripts/decs-entry-terms-search.mjs <texto> [opções]
 *
 * Options (texto):
 *   --limit/-l  <n>          Máximo de resultados (padrão: 20)
 *   --exact/-e               Correspondência exata (padrão: substring)
 *   --category/-c <letra>    Filtrar por categoria DeCS (ex: C, D, N)
 *   --show-all-terms/-t      Mostrar todos os entry_terms, não só os que casaram
 *   --json/-j                Saída em JSON puro
 *   --stats/-S               Mostrar estatísticas dos entry_terms no banco
 *
 * Options (vetor — requerem GEMINI_API_KEY):
 *   --vector/-v              Ativar modo vetorial (embedding + coseno)
 *   --min-similarity/-s <f>  Similaridade mínima (padrão: 0.15)
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

// ══════════════════════════════════════════════════════════════════════════════
// VETORIZAÇÃO — Gemini embedding (apenas no modo --vector)
// Referência: scripts/decs-embed-search.mjs
// ══════════════════════════════════════════════════════════════════════════════

const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIM   = 3072;

/**
 * [VETORIZAÇÃO] Gera embedding via API Gemini (gemini-embedding-001, 3072 dims).
 * Sem taskType → SEMANTIC_SIMILARITY, compatível com os embeddings existentes no banco.
 * Requer: GEMINI_API_KEY definida no ambiente.
 */
async function generateEmbedding(text) {
  const key = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '').trim();
  if (!key) {
    throw new Error(
      'GEMINI_API_KEY não definida.\n' +
      'Necessária apenas no modo --vector.\n' +
      'Use: node --env-file=.env.local scripts/decs-entry-terms-search.mjs <texto> --vector',
    );
  }

  const url  = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${key}`;
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

/**
 * [VETORIZAÇÃO] Busca descritores por similaridade coseno via halfvec.
 * Retorna os N mais próximos com score de similaridade e seus entry_terms.
 * Requer: embeddings gerados por embed-decs-descriptors.mjs.
 */
async function searchByVector(pool, embedding, limit, minSimilarity, category) {
  const vec = '[' + embedding.join(',') + ']';

  const categoryFilter = category
    ? `AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(tree_numbers) AS tn
         WHERE tn LIKE $4 || '%'
       )`
    : '';

  const params = [vec, minSimilarity, limit];
  if (category) params.push(category.toUpperCase());

  const { rows } = await pool.query(
    `SELECT
       ui,
       name_pt,
       name_en,
       scope_note,
       entry_terms,
       tree_numbers,
       1 - (embedding::halfvec(${EMBEDDING_DIM}) <=> $1::halfvec(${EMBEDDING_DIM})) AS similarity
     FROM decs_descriptors
     WHERE embedding IS NOT NULL
       AND (1 - (embedding::halfvec(${EMBEDDING_DIM}) <=> $1::halfvec(${EMBEDDING_DIM}))) >= $2
     ${categoryFilter}
     ORDER BY embedding::halfvec(${EMBEDDING_DIM}) <=> $1::halfvec(${EMBEDDING_DIM})
     LIMIT $3`,
    params,
  );

  return rows.map(r => {
    const tree_ids = Array.isArray(r.tree_numbers)
      ? r.tree_numbers
      : JSON.parse(r.tree_numbers ?? '[]');

    const all_terms = Array.isArray(r.entry_terms)
      ? r.entry_terms
      : JSON.parse(r.entry_terms ?? '[]');

    return {
      ui:               r.ui,
      name_pt:          r.name_pt,
      name_en:          r.name_en   ?? null,
      scope_note:       r.scope_note ?? null,
      tree_ids,
      hierarchy_path:   buildHierarchyPath(tree_ids[0] ?? ''),
      similarity:       parseFloat(r.similarity ?? '0'),
      total_entry_terms: all_terms.length,
      all_entry_terms:  all_terms,
    };
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// FIM DA SEÇÃO DE VETORIZAÇÃO
// ══════════════════════════════════════════════════════════════════════════════

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

// ── Busca por texto (modo padrão) ─────────────────────────────────────────────

async function searchEntryTerms(pool, args) {
  const { text, limit, exact, category } = args;

  const pattern = exact ? text : `%${text}%`;

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
      ui:                r.ui,
      name_pt:           r.name_pt,
      name_en:           r.name_en   ?? null,
      scope_note:        r.scope_note ?? null,
      tree_ids,
      hierarchy_path:    buildHierarchyPath(tree_ids[0] ?? ''),
      total_entry_terms: parseInt(r.total_entry_terms ?? '0'),
      matched_terms:     matched,
      all_entry_terms:   all_terms,
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
  const { json, text, showAllTerms, vector, exact } = args;

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return;
  }

  if (results.length === 0) {
    const hint = vector
      ? `Nenhum descritor encontrado com similaridade suficiente para "${text}".`
      : `Nenhum descritor encontrado com entry_term contendo "${text}".`;
    console.log(`\n${hint}\n`);
    return;
  }

  results.forEach((r, i) => {
    const header = vector
      ? `\n[${i + 1}] ${r.name_pt}  [${r.ui}]  (sim: ${r.similarity.toFixed(4)})`
      : `\n[${i + 1}] ${r.name_pt}  [${r.ui}]`;

    console.log(header);
    if (r.name_en) console.log(`    EN:           ${r.name_en}`);
    console.log(   `    Hierarquia:   ${r.hierarchy_path || '—'}`);
    console.log(   `    Tree IDs:     ${r.tree_ids.join(', ') || '—'}`);

    if (vector) {
      console.log(`    Total termos: ${r.total_entry_terms}`);
      if (r.all_entry_terms.length > 0) {
        const display = r.all_entry_terms.map(t => `"${t}"`).join(', ');
        const wrapped = display.length > 160 ? display.slice(0, 160) + '…' : display;
        console.log(`    Entry terms:  ${wrapped}`);
      }
    } else {
      const matchedStr = r.matched_terms
        .map(t => `"${highlight(t, text, exact)}"`)
        .join(', ');
      console.log(`    Casou em:     ${matchedStr}`);
      console.log(`    Total termos: ${r.total_entry_terms}`);
      if (showAllTerms && r.all_entry_terms.length > 0) {
        const display = r.all_entry_terms.map(t => `"${t}"`).join(', ');
        const wrapped = display.length > 120 ? display.slice(0, 120) + '…' : display;
        console.log(`    Todos os ET:  ${wrapped}`);
      }
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
    text:          '',
    limit:         20,
    exact:         false,
    category:      null,
    showAllTerms:  false,
    json:          false,
    stats:         false,
    vector:        false,
    minSimilarity: 0.15,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if      (a === '--limit'          || a === '-l') args.limit         = parseInt(argv[++i]   ?? '20');
    else if (a === '--exact'          || a === '-e') args.exact         = true;
    else if (a === '--category'       || a === '-c') args.category      = argv[++i]            ?? null;
    else if (a === '--show-all-terms' || a === '-t') args.showAllTerms  = true;
    else if (a === '--json'           || a === '-j') args.json          = true;
    else if (a === '--stats'          || a === '-S') args.stats         = true;
    else if (a === '--vector'         || a === '-v') args.vector        = true;
    else if (a === '--min-similarity' || a === '-s') args.minSimilarity = parseFloat(argv[++i] ?? '0.15');
    else if (!a.startsWith('-'))                     args.text         += (args.text ? ' ' : '') + a;
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
        'Opções (modo texto — padrão):\n' +
        '  --limit/-l  <n>          Máximo de resultados (padrão: 20)\n' +
        '  --exact/-e               Correspondência exata em vez de substring\n' +
        '  --category/-c <letra>    Filtrar por categoria DeCS (ex: C, D, N, SP)\n' +
        '  --show-all-terms/-t      Mostrar todos os entry_terms do descritor\n' +
        '  --json/-j                Saída em JSON puro\n' +
        '  --stats/-S               Mostrar estatísticas dos entry_terms no banco\n\n' +
        'Opções adicionais (modo vetor — requerem GEMINI_API_KEY):\n' +
        '  --vector/-v              Ativar busca por similaridade coseno (Gemini embedding)\n' +
        '  --min-similarity/-s <f>  Similaridade mínima, 0–1 (padrão: 0.15)\n\n' +
        'Exemplos:\n' +
        '  node --env-file=.env.local scripts/decs-entry-terms-search.mjs "pressão arterial"\n' +
        '  node --env-file=.env.local scripts/decs-entry-terms-search.mjs "blood pressure" --exact\n' +
        '  node --env-file=.env.local scripts/decs-entry-terms-search.mjs "infarto" --category C\n' +
        '  node --env-file=.env.local scripts/decs-entry-terms-search.mjs "diabetes" --vector\n' +
        '  node --env-file=.env.local scripts/decs-entry-terms-search.mjs --stats',
      );
      process.exit(1);
    }

    if (args.vector) {
      const catInfo = args.category ? ` | categoria: ${args.category.toUpperCase()}` : '';
      console.error(`⏳ [VETOR] Vetorizando: "${args.text}"${catInfo}`);
      const embedding = await generateEmbedding(args.text);
      console.error(`✓ Embedding gerado (${embedding.length} dims)`);
      const results = await searchByVector(pool, embedding, args.limit, args.minSimilarity, args.category);
      console.error(`✓ ${results.length} resultado(s) [min-sim: ${args.minSimilarity}]\n`);
      printResults(results, args);
    } else {
      const mode    = args.exact ? 'exata' : 'substring';
      const catInfo = args.category ? ` | categoria: ${args.category.toUpperCase()}` : '';
      console.error(`⏳ [TEXTO] Buscando entry_terms [${mode}]: "${args.text}"${catInfo}`);
      const results = await searchEntryTerms(pool, args);
      console.error(`✓ ${results.length} descritor(es) encontrado(s) [limit: ${args.limit}]\n`);
      printResults(results, args);
    }

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
//   Opção                       Atalho  Padrão   Descrição
//   ────────────────────────────────────────────────────────────────────────────
//   --limit <n>                 -l      20       Máximo de resultados retornados
//   --exact                     -e      (não)    Correspondência exata em vez de substring
//   --category <letra>          -c      (todos)  Filtrar por categoria DeCS (C, D, N, SP…)
//   --show-all-terms            -t      (não)    Exibir todos os entry_terms do descritor
//   --json                      -j      (não)    Saída em JSON puro (para piping/scripts)
//   --stats                     -S      (não)    Mostrar estatísticas dos entry_terms no banco
//   --vector  ★                 -v      (não)    Ativar modo vetorial (Gemini embedding + coseno)
//   --min-similarity  ★         -s      0.15     Similaridade mínima, 0–1 (só no modo --vector)
//
//   ★ Requerem GEMINI_API_KEY e embeddings gerados por embed-decs-descriptors.mjs
//   Obs.: termos que casam com a busca (modo texto) são destacados com «guillemets».
//
// ─────────────────────────────────────────────────────────────────────────────
// COMANDOS DISPONÍVEIS
// ─────────────────────────────────────────────────────────────────────────────
//
// ── [TEXTO] Busca básica por entry_terms (substring, case-insensitive) ─────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "pressão arterial"
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "infarto do miocardio"
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "tuberculose pulmonar"
//
// ── [TEXTO] Correspondência exata ─────────────────────────────────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "hipertensão arterial" --exact
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "blood pressure" --exact
//
// ── [TEXTO] Filtrar por categoria DeCS ───────────────────────────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "insuficiência" --category C
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "vacina" --category D --limit 5
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "epidemia" --category N
//
// ── [TEXTO] Ver todos os entry_terms do descritor retornado ──────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "diabetes" --show-all-terms
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "sepse" --show-all-terms --limit 3
//
// ── [VETOR] Busca semântica por embedding (requer GEMINI_API_KEY) ─────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "diabetes mellitus" --vector
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "pneumonia" --vector --limit 8
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "sepse" --vector --min-similarity 0.5
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "infarto" --vector --category C
//
// ── [JSON] Saída para piping ou arquivo ──────────────────────────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "pneumonia" --json
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "pneumonia" --vector --json
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs "pneumonia" --json 2>/dev/null > out.json
//
// ── [STATS] Estatísticas dos entry_terms no banco ────────────────────────────
//
//   node --env-file=.env.local scripts/decs-entry-terms-search.mjs --stats
//
// ─────────────────────────────────────────────────────────────────────────────
