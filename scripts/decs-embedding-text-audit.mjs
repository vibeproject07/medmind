/**
 * decs-embedding-text-audit.mjs
 *
 * Para cada descritor alvo, exibe:
 *   1. O texto EXATO que seria enviado ao Gemini (via buildDeCSText)
 *   2. Uma análise das perdas de informação (truncamentos, campos ausentes)
 *   3. Uma sugestão de texto IDEAL para o melhor embedding possível,
 *      com indicação das informações que faltam no banco
 *
 * Exporta JSON compacto em exports/decs-embedding-text-audit.json
 *
 * Usage:
 *   node --env-file=.env.local scripts/decs-embedding-text-audit.mjs
 */

import pg   from 'pg';
import fs   from 'fs';
import path from 'path';

const TARGET_NAMES = [
  'espasmos infantis',
  'síndrome de lennox-gastaut',
  'síndromes epilépticas',
  'epilepsias mioclônicas',
  'epilepsia mioclônica juvenil',
];

const OUT_FILE        = 'exports/decs-embedding-text-audit.json';
const EMBEDDING_MODEL = 'gemini-embedding-001';

// ── buildDeCSText — cópia exata da função usada nos scripts de vetorização ────

function buildDeCSText(d) {
  const terms = Array.isArray(d.entry_terms)  ? d.entry_terms  : JSON.parse(d.entry_terms  || '[]');
  const trees = Array.isArray(d.tree_numbers) ? d.tree_numbers : JSON.parse(d.tree_numbers || '[]');
  return [
    d.name_pt,
    d.name_en ? `[${d.name_en}]` : null,
    terms.length > 0 ? `Sinônimos: ${terms.slice(0, 245).join(', ')}` : null,
    d.scope_note     ? d.scope_note.slice(0, 5000) : null,
    trees.length > 0 ? `Hierarquia: ${trees.slice(0, 5).join(' | ')}` : null,
  ].filter(Boolean).join('\n').slice(0, 8000);
}

// ── Serializador compacto ─────────────────────────────────────────────────────

const INDENT       = '  ';
const VEC_PER_LINE = 8;
const STR_PER_LINE = 4;

function isStringArr(a) { return Array.isArray(a) && a.every(v => typeof v === 'string'); }
function isNumberArr(a) { return Array.isArray(a) && a.every(v => typeof v === 'number'); }

function fmtStrArr(arr, base) {
  if (!arr.length) return '[]';
  const inn = base + INDENT;
  const chunks = [];
  for (let i = 0; i < arr.length; i += STR_PER_LINE)
    chunks.push(inn + arr.slice(i, i + STR_PER_LINE).map(s => JSON.stringify(s)).join(', '));
  return '[\n' + chunks.join(',\n') + '\n' + base + ']';
}

function fmtVec(arr, base) {
  if (!arr.length) return '[]';
  const inn = base + INDENT;
  const chunks = [];
  for (let i = 0; i < arr.length; i += VEC_PER_LINE)
    chunks.push(inn + arr.slice(i, i + VEC_PER_LINE).join(', '));
  return '[\n' + chunks.join(',\n') + '\n' + base + ']';
}

function serialize(value, indent, key) {
  if (value === null)             return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number')  return String(value);
  if (typeof value === 'string')  return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (key === 'embedding_vector' && isNumberArr(value)) return fmtVec(value, indent);
    if (isStringArr(value)) return fmtStrArr(value, indent);
    if (!value.length) return '[]';
    const inn   = indent + INDENT;
    const items = value.map(v => inn + serialize(v, inn, null));
    return '[\n' + items.join(',\n') + '\n' + indent + ']';
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    const inn   = indent + INDENT;
    const lines = entries.map(([k, v]) => `${inn}${JSON.stringify(k)}: ${serialize(v, inn, k)}`);
    return '{\n' + lines.join(',\n') + '\n' + indent + '}';
  }
  return JSON.stringify(value);
}

// ── Resolução de hierarquia (busca nomes dos pais pelo prefixo tree_id) ───────

async function resolveHierarchy(pool, treeIds) {
  if (!treeIds.length) return [];

  // Para cada tree_id, gera todos os prefixos ancestrais
  const prefixes = new Set();
  for (const tid of treeIds) {
    const parts = tid.split('.');
    for (let i = 1; i < parts.length; i++) {
      prefixes.add(parts.slice(0, i).join('.'));
    }
  }

  if (!prefixes.size) return [];

  // Busca descritores cujo tree_numbers contém qualquer um dos prefixos
  const { rows } = await pool.query(`
    SELECT DISTINCT ui, name_pt, name_en, tree_numbers
    FROM decs_descriptors
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(tree_numbers) AS tn
      WHERE tn = ANY($1)
    )
    ORDER BY name_pt
  `, [[...prefixes]]);

  return rows.map(r => ({
    ui:      r.ui,
    name_pt: r.name_pt,
    name_en: r.name_en,
    tree_ids: Array.isArray(r.tree_numbers) ? r.tree_numbers : JSON.parse(r.tree_numbers || '[]'),
  }));
}

// ── Análise de perdas de informação ──────────────────────────────────────────

function analyzeInfo(d, terms, trees, currentText) {
  const issues  = [];
  const missing = [];

  // Scope note
  if (!d.scope_note || d.scope_note.trim() === '') {
    issues.push('scope_note AUSENTE — campo nulo ou vazio no banco');
  } else if (d.scope_note.length < 100) {
    issues.push(`scope_note MUITO CURTA (${d.scope_note.length} chars) — conteúdo clínico insuficiente para discriminar o conceito`);
  } else if (d.scope_note.length > 5000) {
    const lost = d.scope_note.length - 5000;
    issues.push(`scope_note TRUNCADA: ${d.scope_note.length} chars totais, ${lost} chars descartados (buildDeCSText limita a 5000)`);
  }

  // Entry terms
  if (terms.length === 0) {
    issues.push('entry_terms AUSENTES — sem sinônimos no banco');
  } else if (terms.length > 245) {
    const lost = terms.length - 245;
    issues.push(`entry_terms TRUNCADOS: ${terms.length} termos totais, ${lost} descartados (buildDeCSText limita slice a 245)`);
  }

  // Texto total
  if (currentText.length === 8000) {
    issues.push('TEXTO FINAL TRUNCADO em 8000 chars — parte do conteúdo foi cortada antes de chegar à API');
  }

  // Campos que poderiam enriquecer mas não existem no schema
  missing.push('Nome completo dos termos PAI na hierarquia (só temos os códigos, ex. "C10.228.140.490")');
  missing.push('Termos FILHOS (narrower terms) — conceitos mais específicos que ampliariam o contexto');
  missing.push('Termos RELACIONADOS (see also / related) — associações laterais entre descritores');
  if (!d.scope_note || d.scope_note.length < 200) {
    missing.push('Descrição clínica expandida — o scope_note no banco está incompleto para este descritor');
  }

  return { issues, missing };
}

// ── Geração do texto IDEAL ────────────────────────────────────────────────────

function buildIdealText(d, terms, trees, ancestors) {
  const lines = [];

  // 1. Nome principal em PT + EN
  lines.push(`Conceito: ${d.name_pt}`);
  if (d.name_en) lines.push(`Nome em inglês: ${d.name_en}`);

  // 2. Todos os sinônimos (sem truncamento)
  const synonyms = terms.filter(t =>
    t !== d.name_pt &&
    t !== d.name_en &&
    !t.includes('NLM (') &&
    !t.includes('UNK (') &&
    !t.includes('OMIM (') &&
    !t.includes('GHR (') &&
    !t.includes('ORD (') &&
    !t.includes('BIOETHICS') &&
    !t.startsWith(d.name_pt + '[') &&
    !t.startsWith(d.scope_note?.slice(0, 30) ?? '\x00'),
  );
  if (synonyms.length > 0) {
    lines.push(`Sinônimos e termos alternativos: ${synonyms.join(', ')}`);
  }

  // 3. Scope note completa (sem limite de 5000)
  if (d.scope_note && d.scope_note.trim()) {
    lines.push(`Definição clínica: ${d.scope_note}`);
  } else {
    lines.push(`[LACUNA: scope_note ausente ou insuficiente — texto clínico expandido deveria ser inserido aqui]`);
  }

  // 4. Hierarquia resolvida com nomes
  if (ancestors.length > 0) {
    const ancestorStr = ancestors.map(a => `${a.name_pt} (${a.ui})`).join(' > ');
    lines.push(`Hierarquia (do mais geral ao mais específico): ${ancestorStr}`);
  } else if (trees.length > 0) {
    lines.push(`Códigos hierárquicos: ${trees.join(' | ')}`);
  }

  // 5. Filhos e relacionados (campo inexistente — marcador explícito)
  lines.push(`[LACUNA: termos filhos (narrower terms) não disponíveis no banco — ampliariam cobertura semântica]`);
  lines.push(`[LACUNA: termos relacionados (see also) não disponíveis no banco — enriqueceriam associações laterais]`);

  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL?.trim() });

  try {
    // Busca os 5 descritores (aceita variações de grafia sem 'l' em mioclônica/mioclônicas)
    const { rows } = await pool.query(`
      SELECT id, ui, name_pt, name_en, scope_note,
             entry_terms, tree_numbers,
             embedding IS NOT NULL AS has_embedding
      FROM decs_descriptors
      WHERE LOWER(name_pt) = ANY($1)
      ORDER BY name_pt
    `, [TARGET_NAMES]);

    // Alerta sobre termos não encontrados
    const foundNames = rows.map(r => r.name_pt.toLowerCase());
    const notFound   = TARGET_NAMES.filter(n => !foundNames.includes(n));
    if (notFound.length) {
      console.warn(`\n⚠️  Não encontrados (verifique grafia): ${notFound.join(', ')}`);
    }
    console.log(`\n✅ Encontrados: ${rows.length}/${TARGET_NAMES.length} descritores\n`);

    const results = [];

    for (const d of rows) {
      const terms = Array.isArray(d.entry_terms)  ? d.entry_terms  : JSON.parse(d.entry_terms  || '[]');
      const trees = Array.isArray(d.tree_numbers) ? d.tree_numbers : JSON.parse(d.tree_numbers || '[]');

      // Texto atual (exato — sem modificação)
      const currentText = buildDeCSText(d);

      // Análise de perdas
      const { issues, missing } = analyzeInfo(d, terms, trees, currentText);

      // Ancestrais resolvidos por nome
      const ancestors = await resolveHierarchy(pool, trees);

      // Texto ideal sugerido
      const idealText  = buildIdealText(d, terms, trees, ancestors);

      // Estatísticas
      const synonymsInCurrent = terms.slice(0, 245).filter(t =>
        t !== d.name_pt && t !== d.name_en &&
        !t.includes('NLM (') && !t.includes('UNK (') && !t.includes('OMIM ('),
      ).length;

      const result = {
        ui:          d.ui,
        name_pt:     d.name_pt,
        name_en:     d.name_en ?? null,
        has_embedding: d.has_embedding,

        stats: {
          entry_terms_total:       terms.length,
          entry_terms_in_current:  Math.min(terms.length, 245),
          entry_terms_lost:        Math.max(0, terms.length - 245),
          scope_note_total_chars:  d.scope_note ? d.scope_note.length : 0,
          scope_note_used_chars:   d.scope_note ? Math.min(d.scope_note.length, 5000) : 0,
          scope_note_truncated:    d.scope_note ? d.scope_note.length > 5000 : false,
          current_text_total_chars: currentText.length,
          current_text_truncated:  currentText.length === 8000,
          ideal_text_total_chars:  idealText.length,
          ancestor_terms_resolved: ancestors.length,
        },

        information_loss: {
          issues:                issues,
          missing_from_db:       missing,
          quality_score_current: scoreText(currentText, d, terms),
          quality_score_ideal:   scoreText(idealText,   d, terms),
        },

        current_embedding_text: currentText,
        ideal_embedding_text:   idealText,

        ideal_text_explanation: [
          'O texto ideal para embedding de um descritor DeCS médico deve conter:',
          '1. Nome principal em PT e EN — ancora o conceito em ambos os idiomas',
          '2. Todos os sinônimos filtrados (sem ruído de datas NLM/OMIM) — maximiza cobertura lexical',
          '3. scope_note completa sem truncamento — é a definição semântica central do conceito',
          '4. Hierarquia com NOMES resolvidos (não apenas códigos) — contextualiza o conceito na taxonomia',
          '5. Termos filhos (narrower terms) — ampliam a cobertura para buscas top-down',
          '6. Termos relacionados (see also) — capturam associações laterais não hierárquicas',
          'Lacunas identificadas neste banco: filhos e relacionados não estão armazenados em decs_descriptors.',
          'Solução recomendada: enriquecer via BVS API (get-tree) ou importação do arquivo MeSH/DeCS completo.',
        ],
      };

      results.push(result);

      console.log(`[${d.ui}] ${d.name_pt}`);
      console.log(`   entry_terms : ${terms.length} | scope_note: ${d.scope_note?.length ?? 0} chars`);
      console.log(`   Texto atual : ${currentText.length} chars${currentText.length === 8000 ? ' ⚠️ truncado' : ''}`);
      console.log(`   Texto ideal : ${idealText.length} chars`);
      if (issues.length) console.log(`   Problemas   : ${issues.join('; ')}`);
      console.log('');
    }

    // ── Exportar ──────────────────────────────────────────────────────────────

    const document = {
      metadata: {
        generated_at:    new Date().toISOString(),
        target_terms:    TARGET_NAMES,
        found:           rows.length,
        not_found:       notFound,
        embedding_model: EMBEDDING_MODEL,
        build_function:  'buildDeCSText (slice entry_terms 0–245, scope_note 0–5000, total 0–8000)',
        description:     'Auditoria do texto de embedding: texto atual vs. texto ideal por descritor',
      },
      descriptors: results,
    };

    const dir = path.dirname(OUT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OUT_FILE, serialize(document, '') + '\n', 'utf-8');

    const sizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2);
    console.log(`📄 Exportado: ${OUT_FILE}  (${sizeMB} MB)`);

  } finally {
    await pool.end();
  }
}

// ── Score heurístico de qualidade (0–100) ─────────────────────────────────────
// Avalia o quão "rico" semanticamente é o texto para fins de embedding médico.

function scoreText(text, d, terms) {
  let score = 0;

  // Tem nome PT                          +10
  if (text.includes(d.name_pt))           score += 10;
  // Tem nome EN                          +10
  if (d.name_en && text.includes(d.name_en)) score += 10;
  // scope_note presente e substancial    +30
  const snLen = d.scope_note?.length ?? 0;
  if (snLen > 400)  score += 30;
  else if (snLen > 100) score += 20;
  else if (snLen > 0)   score += 8;
  // Sinônimos                            +20
  const synCount = Math.min(terms.length, 245);
  if (synCount > 30)  score += 20;
  else if (synCount > 10) score += 12;
  else if (synCount > 0)  score += 5;
  // Hierarquia com nomes resolvidos      +15 (vs só códigos = +5)
  if (text.includes('Conceito:'))          score += 5;  // ideal usa "Conceito:"
  if (text.includes('Hierarquia (do mais geral')) score += 15;
  else if (text.includes('Hierarquia:'))   score += 5;
  // Sem truncamento                      +15
  if (text.length < 8000)                  score += 15;

  return Math.min(score, 100);
}

main().catch(e => { console.error('\n💥 Fatal:', e.message); process.exit(1); });
