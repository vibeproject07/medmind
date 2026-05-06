/**
 * DeCS AI Pipeline — shared classifier logic
 *
 * Three quality layers:
 *   1. Local pgvector search (decs_descriptors table) — fast, offline
 *      Fallback → BVS API when local table is empty
 *   2. Category filter              (reject organism/virus categories unless biomed context)
 *   3. Gemini relevance validation  (one extra call to drop false positives)
 */

export interface DeCSRecord {
  term: string;
  code: string;
  tree_ids: string[];
  hierarchy_path: string;
  similarity?: number;
  role?: 'primary' | 'secondary';
  scope_note?: string;
  name_en?: string;
}

export interface DeCSThemes {
  primary: string[];
  secondary: string[];
}

// ── Category metadata ────────────────────────────────────────────────────────

export const DECS_CATEGORY_LABELS: Record<string, string> = {
  A: 'Anatomia',
  B: 'Organismos',
  C: 'Doenças',
  D: 'Compostos Químicos e Drogas',
  E: 'Técnicas e Equipamentos Analíticos',
  F: 'Psiquiatria e Psicologia',
  G: 'Fenômenos Biológicos',
  H: 'Disciplinas e Ocupações',
  I: 'Antropologia, Educação, Sociologia',
  J: 'Tecnologia, Indústria, Agricultura',
  K: 'Humanidades',
  L: 'Ciência da Informação',
  M: 'Grupos Identificados',
  N: 'Saúde',
  SP: 'Saúde Pública',
  VS: 'Vigilância Sanitária',
};

/**
 * Top-level category from a DeCS tree_id string.
 * E.g. "C01.635.500" → "C", "B04.820.578" → "B"
 */
export function treeCategory(treeId: string): string {
  return treeId.split('.')[0].replace(/[0-9]/g, '');
}

export function buildHierarchyPath(treeId: string): string {
  if (!treeId) return '';
  const cat = treeCategory(treeId);
  const label = DECS_CATEGORY_LABELS[cat] ?? cat;
  return treeId.split('.').length <= 1 ? label : `${label} › ${treeId}`;
}

// ── Improvement 2: Category filter ──────────────────────────────────────────

/**
 * Subcategories of B (Organisms) that are clinically relevant in medical questions:
 *   B01.050 = Eubacteria (e.g. Staphylococcus)
 *   B02     = Fungi
 *   B03     = Parasites  (some classification puts them differently)
 *   B04     = Viruses    — allowed only with biomed keywords
 *
 * We allow descriptors in these sub-trees when the question explicitly mentions
 * microbiology, infection, or organisms.
 */
const BIO_KEYWORD_RE =
  /\b(vírus|virus|bactéria|bacteria|bacilo|fungo|fung|parasita|parasit|microbiol|infectol|viral|bacteria|antibiótic|antibiotic|vaccin|vacin|patógen|patogen|prion|rickettsia|protozoár|helmint|coccídio|coccidi|tripanossom|leishman|plasmodium|schistosoma)\b/i;

/**
 * Returns true when the descriptor should be accepted.
 * Descriptors outside category B are always accepted.
 * B-category descriptors require an explicit bio/micro context in the question.
 */
export function isCategoryAcceptable(record: DeCSRecord, questionText: string): boolean {
  if (!record.tree_ids || record.tree_ids.length === 0) return true;
  const cats = record.tree_ids.map(treeCategory);
  const allOrganism = cats.every((c) => c === 'B');
  if (!allOrganism) return true; // Has at least one non-B category — keep
  return BIO_KEYWORD_RE.test(questionText);
}

// ── Improvement 1: Multi-candidate search + similarity ranking ────────────────

function toArray<T>(v: T | T[]): T[] {
  if (Array.isArray(v)) return v;
  if (v != null) return [v];
  return [];
}

/**
 * Simple word-level Jaccard similarity between two strings.
 * Short words (≤3 chars) are ignored as stopwords.
 */
export function wordJaccard(a: string, b: string): number {
  const tokenise = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/\W+/)
        .filter((w) => w.length > 3)
    );
  const A = tokenise(a);
  const B = tokenise(b);
  let inter = 0;
  A.forEach((w) => { if (B.has(w)) inter++; });
  const union = new Set(Array.from(A).concat(Array.from(B))).size;
  return union === 0 ? 0 : inter / union;
}

/**
 * Parse a raw DeCS record object into a DeCSRecord.
 * Returns null when it cannot extract a Portuguese term.
 */
function parseDeCSRecord(rec: Record<string, unknown>): DeCSRecord | null {
  const attrObj = rec.attr as Record<string, string> | undefined;
  const code = attrObj?.mfn ?? '';

  const descriptors = toArray(rec.descriptor_list as unknown).flatMap((d) =>
    toArray(d as unknown)
  ) as Record<string, unknown>[];

  let term = '';
  for (const pl of ['pt-br', 'pt']) {
    const found = descriptors.find((d) => {
      const da = d?.attr as Record<string, string> | undefined;
      return da?.lang === pl;
    });
    if (found && typeof found.descriptor === 'string' && found.descriptor.trim()) {
      term = found.descriptor.trim();
      break;
    }
  }
  if (!term) return null;

  const treeList = toArray(rec.tree_id_list as unknown).flatMap((t) =>
    toArray(t as unknown)
  ) as Record<string, unknown>[];
  const tree_ids: string[] = treeList
    .map((t) => (t?.tree_id as string | undefined)?.trim() ?? '')
    .filter(Boolean);

  return { term, code, tree_ids, hierarchy_path: buildHierarchyPath(tree_ids[0] ?? '') };
}

// ── Layer 1 (primary): Local pgvector search ─────────────────────────────────

/**
 * Returns true if the decs_descriptors table is populated (has at least 1 row).
 * Used to decide whether to use the local index or fall back to BVS API.
 */
async function isLocalDeCSAvailable(): Promise<boolean> {
  try {
    // Dynamic import so this file is usable in scripts that don't have the DB pool
    const { query } = await import('@/lib/db');
    const res = await query(`SELECT 1 FROM decs_descriptors LIMIT 1`);
    return res.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Search local decs_descriptors via pgvector cosine similarity.
 * Embeds the search term with gemini-embedding-001 and returns the
 * top candidates sorted by semantic similarity.
 *
 * Returns an empty array when the local table is empty or on any error.
 */
export async function searchDeCSLocal(
  searchTerm: string,
  geminiKey: string,
  maxCandidates = 5,
  minSimilarity = 0.60
): Promise<DeCSRecord[]> {
  try {
    const { generateEmbedding, vectorToString } = await import('@/lib/embeddings');
    const { query } = await import('@/lib/db');

    const embedding = await generateEmbedding(searchTerm, geminiKey);
    const vec = vectorToString(embedding);

    // Cast to halfvec to use the halfvec HNSW index (pgvector 0.8, >2000 dims)
    const res = await query(`
      SELECT
        ui AS code,
        name_pt AS term,
        name_en,
        scope_note,
        tree_numbers,
        1 - (embedding::halfvec(3072) <=> $1::halfvec(3072)) AS similarity
      FROM decs_descriptors
      WHERE embedding IS NOT NULL
        AND (1 - (embedding::halfvec(3072) <=> $1::halfvec(3072))) >= $2
      ORDER BY embedding::halfvec(3072) <=> $1::halfvec(3072)
      LIMIT $3
    `, [vec, minSimilarity, maxCandidates]);

    return res.rows.map((r) => {
      const tree_ids: string[] = Array.isArray(r.tree_numbers)
        ? r.tree_numbers
        : JSON.parse(r.tree_numbers ?? '[]');
      return {
        term: r.term,
        code: r.code,
        tree_ids,
        hierarchy_path: buildHierarchyPath(tree_ids[0] ?? ''),
        similarity: parseFloat(r.similarity ?? '0'),
        scope_note: r.scope_note ?? undefined,
        name_en: r.name_en ?? undefined,
      };
    });
  } catch {
    return [];
  }
}

// ── BVS API (fallback) ────────────────────────────────────────────────────────

const DECS_BASE = 'https://api.bvsalud.org/decs/v2';

/**
 * Search DeCS and return up to `maxCandidates` parsed records.
 * Returns an empty array on any error.
 */
export async function searchDeCSCandidates(
  searchTerm: string,
  apiKey: string,
  maxCandidates = 5
): Promise<DeCSRecord[]> {
  try {
    const url = `${DECS_BASE}/search-by-words?words=${encodeURIComponent(searchTerm)}&lang=pt&format=json`;
    const res = await fetch(url, { headers: { apikey: apiKey } });
    if (!res.ok) return [];

    const data = await res.json() as Record<string, unknown>;
    const objects = data?.objects as unknown[];
    if (!Array.isArray(objects) || objects.length === 0) return [];

    const first = objects[0] as Record<string, unknown>;
    const resp = first?.decsws_response as Record<string, unknown>;
    const recordList = resp?.record_list as Record<string, unknown>;
    if (!recordList) return [];

    const rawRecords = toArray(recordList?.record as unknown).slice(0, maxCandidates);
    const parsed: DeCSRecord[] = [];
    for (const r of rawRecords) {
      const rec = parseDeCSRecord(r as Record<string, unknown>);
      if (rec) parsed.push(rec);
    }
    return parsed;
  } catch {
    return [];
  }
}

/**
 * Search DeCS, rank candidates by similarity to the search term,
 * apply category filter, and return the single best match (or null).
 *
 * Strategy:
 *   1. Try local pgvector search on decs_descriptors (fast, offline)
 *   2. If local returns nothing OR local table is empty → fall back to BVS API
 */
export async function findBestDeCSMatch(
  searchTerm: string,
  apiKey: string,
  questionText: string,
  minSimilarity = 0.15,
  maxCandidates = 5,
  geminiKey?: string
): Promise<DeCSRecord | null> {
  // ── Try local pgvector first ──────────────────────────────────────────────
  if (geminiKey && await isLocalDeCSAvailable()) {
    const localCandidates = await searchDeCSLocal(searchTerm, geminiKey, maxCandidates);
    const filtered = localCandidates
      .filter((c) => isCategoryAcceptable(c, questionText))
      .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
    if (filtered.length > 0) return filtered[0];
  }

  // ── Fallback: BVS API ─────────────────────────────────────────────────────
  const candidates = await searchDeCSCandidates(searchTerm, apiKey, maxCandidates);

  const scored = candidates
    .map((c) => ({ ...c, similarity: wordJaccard(searchTerm, c.term) }))
    .filter((c) => (c.similarity ?? 0) >= minSimilarity)
    .filter((c) => isCategoryAcceptable(c, questionText))
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));

  return scored.length > 0 ? scored[0] : null;
}

// ── Candidate enrichment from DB ─────────────────────────────────────────────

/**
 * If a record came from the BVS API (no scope_note), try to enrich it
 * from the local decs_descriptors table by matching on ui (code).
 * Exported so decs-pipeline-v2.ts can import it instead of duplicating.
 */
export async function enrichFromDB(records: DeCSRecord[]): Promise<DeCSRecord[]> {
  if (records.length === 0) return [];
  const missing = records.filter((r) => !r.scope_note && r.code);
  if (missing.length === 0) return records;

  try {
    const { query } = await import('@/lib/db');
    const codes = missing.map((r) => r.code);
    const res = await query(
      `SELECT ui, name_en, scope_note FROM decs_descriptors WHERE ui = ANY($1)`,
      [codes]
    );
    const map = new Map<string, { name_en: string; scope_note: string }>(
      res.rows.map((r) => [r.ui, { name_en: r.name_en, scope_note: r.scope_note }])
    );
    return records.map((r) => {
      const extra = map.get(r.code);
      return extra ? { ...r, ...extra } : r;
    });
  } catch {
    return records;
  }
}

// ── Improvement 3: Gemini validation ────────────────────────────────────────

/**
 * Ask Gemini to validate which descriptors are truly relevant for the question.
 * Returns the subset of `descriptors` that Gemini approved.
 * On any error, returns the original list unchanged (fail-open).
 *
 * Reads the validation prompt from the `decs_validator` agent (DB or default).
 */
export async function validateDescriptorsWithGemini(
  descriptors: DeCSRecord[],
  questionText: string,
  geminiKey: string,
  model = 'gemini-2.5-flash'
): Promise<DeCSRecord[]> {
  if (descriptors.length === 0) return [];

  const candidateList = descriptors
    .map((d) => ({
      code: d.code,
      term: d.term,
      term_en: d.name_en ?? undefined,
      scope: d.scope_note ? d.scope_note.substring(0, 180) : undefined,
      categoria: buildHierarchyPath(d.tree_ids[0] ?? '').split(' › ')[0],
    }));

  const userMessage = [
    'Questão:',
    questionText,
    '',
    'Candidatos:',
    JSON.stringify(candidateList, null, 2),
  ].join('\n');

  try {
    const { getAgentPrompt } = await import('@/lib/ai-agents');
    const validationPrompt = await getAgentPrompt('decs_validator');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
    const body = {
      system_instruction: { parts: [{ text: validationPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return descriptors; // fail-open

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    const rawText: string =
      (data?.candidates?.[0]?.content?.parts
        ?.filter((p: Record<string, unknown>) => !p?.thought)
        ?.map((p: Record<string, unknown>) => p?.text)
        .filter(Boolean)
        .join('') ?? '');

    const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const approved: string[] = JSON.parse(cleaned);
    if (!Array.isArray(approved)) return descriptors;

    const approvedSet = new Set(approved.map(String));
    const filtered = descriptors.filter((d) => approvedSet.has(d.code));
    // If Gemini returns empty or all fail, fall back to original (avoid empty result)
    return filtered.length > 0 ? filtered : descriptors;
  } catch {
    return descriptors; // fail-open on parse/network errors
  }
}

// ── Full pipeline ────────────────────────────────────────────────────────────

/**
 * Given Gemini-extracted themes (primary + secondary), run the full 3-layer pipeline:
 *   1. Multi-candidate DeCS search + similarity ranking (per theme, tagged with role)
 *   2. Category filter
 *   3. Gemini validation
 *
 * Returns a flat, deduplicated, validated list of DeCS records with role tags.
 * Primary descriptors appear first; secondary follow.
 *
 * Also accepts a plain string[] for backward compatibility (all treated as 'primary').
 */
export async function runDeCSPipeline(
  themes: DeCSThemes | string[],
  questionText: string,
  decsKey: string,
  geminiKey: string,
  model = 'gemini-2.5-flash'
): Promise<{ descriptors: DeCSRecord[]; dropped_by_filter: number; dropped_by_gemini: number }> {
  // Normalise input — support legacy string[] call
  const structured: DeCSThemes = Array.isArray(themes)
    ? { primary: themes, secondary: [] }
    : themes;

  const seenCodes = new Set<string>();
  const afterSearch: DeCSRecord[] = [];

  // Search primary and secondary terms in parallel, tagging each with its role.
  // We inline the search so we can distinguish between:
  //   • dropped_by_filter  — candidates existed but ALL were rejected by isCategoryAcceptable
  //   • no_candidate       — no candidates returned at all (search failure / too dissimilar)
  //   • dropped_by_dedup   — best match found but code already in seenCodes
  const searchAll = [
    ...structured.primary.map((term) => ({ term, role: 'primary' as const })),
    ...structured.secondary.map((term) => ({ term, role: 'secondary' as const })),
  ];

  type SearchOutcome =
    | { status: 'accepted'; role: 'primary' | 'secondary'; match: DeCSRecord }
    | { status: 'category_filtered' }
    | { status: 'no_candidate' }
    | { status: 'deduped' };

  const outcomes = await Promise.allSettled(
    searchAll.map(async ({ term, role }): Promise<SearchOutcome> => {
      const MIN_SIMILARITY = 0.15;

      // ── 1. Try local pgvector first ────────────────────────────────────────
      let rawCandidates: DeCSRecord[] = [];
      if (geminiKey && await isLocalDeCSAvailable()) {
        rawCandidates = await searchDeCSLocal(term, geminiKey, 5, 0.60);
      }

      // ── 2. Fallback: BVS API ───────────────────────────────────────────────
      if (rawCandidates.length === 0) {
        const apiResults = await searchDeCSCandidates(term, decsKey, 5);
        rawCandidates = apiResults
          .map((c) => ({ ...c, similarity: wordJaccard(term, c.term) }))
          .filter((c) => (c.similarity ?? 0) >= MIN_SIMILARITY)
          .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
      }

      // No candidates found at all (search failed or similarity too low)
      if (rawCandidates.length === 0) return { status: 'no_candidate' };

      // ── 3. Category filter — track drops separately ────────────────────────
      const accepted = rawCandidates.filter((c) => isCategoryAcceptable(c, questionText));
      if (accepted.length === 0) {
        // Had candidates, but category B filter rejected all of them
        return { status: 'category_filtered' };
      }

      // ── 4. Deduplication ───────────────────────────────────────────────────
      const best = accepted[0];
      if (seenCodes.has(best.code)) return { status: 'deduped' };

      seenCodes.add(best.code);
      return { status: 'accepted', role, match: best };
    })
  );

  // Tally outcomes and build the search result list
  let droppedByFilter = 0; // terms with candidates that the category filter removed
  for (const res of outcomes) {
    if (res.status === 'rejected') continue; // unexpected error — skip silently
    const outcome = res.value;
    if (outcome.status === 'accepted') {
      afterSearch.push({ ...outcome.match, role: outcome.role });
    } else if (outcome.status === 'category_filtered') {
      droppedByFilter++;
    }
    // 'no_candidate' and 'deduped' do not count toward dropped_by_filter
  }

  // Enrich BVS API results with scope_note/name_en from local DB before validation
  const enriched = await enrichFromDB(afterSearch);

  // Step 3: Gemini validation — operates on the flat list, role is preserved
  const afterValidation = await validateDescriptorsWithGemini(
    enriched,
    questionText,
    geminiKey,
    model
  );

  const droppedByGemini = afterSearch.length - afterValidation.length;

  // Strip the internal similarity field, keep role; primary first
  const primary = afterValidation
    .filter((d) => d.role === 'primary')
    .map(({ similarity: _s, ...rest }) => rest);
  const secondary = afterValidation
    .filter((d) => d.role !== 'primary')
    .map(({ similarity: _s, ...rest }) => rest);

  const descriptors = [...primary, ...secondary];

  return { descriptors, dropped_by_filter: droppedByFilter, dropped_by_gemini: droppedByGemini };
}
