/**
 * DeCS AI Pipeline — shared classifier logic
 *
 * Quality layers (active):
 *   1. Local pgvector search (decs_descriptors table) — fast, offline
 *      Fallback → BVS API when local table is empty
 *   2. Category filter              (reject organism/virus categories unless biomed context)
 *
 * Layer 3 (Gemini relevance validation via decs_validator) disabled 18/06/2026 —
 * was removing essential descriptors after an otherwise accurate pgvector/BVS match.
 */

export interface DeCSBranch {
  tree_id: string; // e.g. "C01.635.500"
  hierarchy_path: string; // e.g. "Doenças › C01.635.500"
}

export interface DeCSRecord {
  // interface is a way to define the structure of an object!!
  term: string; // nome do descritor
  code: string; //identificador DeCS (index) (UI)
  tree_ids: string[]; // e.g. ["C01.635.500", "C01.635.500.500"] - posição hierárquica
  hierarchy_path: string; // e.g. "Doenças › C01.635.500" - caminho categórico (primeiro ramo)
  branches?: DeCSBranch[]; // TODAS as ramificações (um descritor pode pertencer a mais de uma árvore)
  similarity?: number; // score vetorial
  role?: "primary" | "secondary"; // importância temática
  scope_note?: string; // descrição do conceito
  name_en?: string; // nome em inglês
}

export interface DeCSThemes {
  // export (function/const/interface) makes it available to other files!!
  primary: string[];
  secondary: string[];
}

// ── Category metadata ────────────────────────────────────────────────────────

export const DECS_CATEGORY_LABELS: Record<string, string> = {
  A: "Anatomia",
  B: "Organismos",
  C: "Doenças",
  D: "Compostos Químicos e Drogas",
  E: "Técnicas e Equipamentos Analíticos",
  F: "Psiquiatria e Psicologia",
  G: "Fenômenos Biológicos",
  H: "Disciplinas e Ocupações",
  I: "Antropologia, Educação, Sociologia",
  J: "Tecnologia, Indústria, Agricultura",
  K: "Humanidades",
  L: "Ciência da Informação",
  M: "Grupos Identificados",
  N: "Saúde",
  SP: "Saúde Pública",
  VS: "Vigilância Sanitária",
};

/**
 * Top-level category from a DeCS tree_id string.
 * E.g. "C01.635.500" → "C", "B04.820.578" → "B"
 */
export function treeCategory(treeId: string): string {
  return treeId.split(".")[0].replace(/[0-9]/g, ""); // [[[ROW 15]]]
  /*
   *the function gets the full tree_id as a param(eter) and returns the first letter of the first part of the tree_id by splitting the string by the dot and removing the numbers, choosing the index 0 of the array, the first part of the string;
   */
}

export function buildHierarchyPath(treeId: string): string {
  if (!treeId) return ""; // [[[ROW 15]]]
  const cat = treeCategory(treeId); //[[[ROWS 54-59]]]
  const label = DECS_CATEGORY_LABELS[cat] ?? cat; //[[[ROWS 31-48]]]
  return treeId.split(".").length <= 1 ? label : `${label} › ${treeId}`;
  /*
   * if treeId is empty, null, undefined or false, the return is an empty string; the variable 'cat' is equal the constant of the previous function treeCategory which parameter is the treeId; the variable 'label' is equal to the constant DECS_CATEGORY_LABELS, that grants access to an object or dictionary, which index is the variable 'cat';
   *[[label = DECS_CATEGORY_LABELS[cat] ?? cat;]] == if there is an existing label for the category, use its label, otherwise, use the category itself;
   * [[treeId.split(".").length <= 1 ? label : `${label} › ${treeId}`;]] == if (treeId.split(".").length <= 1) {return label;} else {return `${label} › ${treeId}`;} (ternary operator);
   *
   */
}

/**
 * Resolve TODAS as ramificações (tree_ids) de um descritor para exibição.
 * Um descritor DeCS pode pertencer a mais de uma árvore hierárquica ao mesmo
 * tempo (ex: um fármaco pode estar em "D" e também em "C" se também for uma
 * doença relacionada) — hierarchy_path sozinho só mostra a primeira.
 * Usado pelo frontend para exibir a lista completa de tree_numbers do termo
 * selecionado, não apenas o primeiro.
 */
export function buildBranches(treeIds: string[]): DeCSBranch[] {
  return (treeIds ?? [])
    .filter(Boolean)
    .map((tree_id) => ({ tree_id, hierarchy_path: buildHierarchyPath(tree_id) }));
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
const BIO_KEYWORD_RE = // this is a regex (regular expression)
  /\b(vírus|virus|bactéria|bacteria|bacilo|fungo|fung|parasita|parasit|microbiol|infectol|viral|bacteria|antibiótic|antibiotic|vaccin|vacin|patógen|patogen|prion|rickettsia|protozoár|helmint|coccídio|coccidi|tripanossom|leishman|plasmodium|schistosoma)\b/i;

/**
 * Returns true when the descriptor should be accepted.
 * Descriptors outside category B are always accepted.
 * B-category descriptors require an explicit bio/micro context in the question.
 */
export function isCategoryAcceptable(
  record: DeCSRecord, // param that expects a DeCSRecord object rows // [[[ROWS 11-20]]]
  questionText: string, // param that expects the question text
): boolean {
  if (!record.tree_ids || record.tree_ids.length === 0) return true; // [[[ROW 15]]]
  // if there is no tree_ids (!treeIds == non existent) or the length of the array is 0, the return is true
  const cats = record.tree_ids.map(treeCategory); // [[[ROWS 54-59]]]
  // the variable cats is equal to the array of tree_ids, mapped to the treeCategory function
  const allOrganism = cats.every((c) => c === "B"); // [[[ROW 100]]]
  // the variable allOrganism is equal to the array of cats, every element of the array is equal to "B"
  if (!allOrganism) return true; // Has at least one non-B category — keep
  // if allOrganism is false, the return is true
  return BIO_KEYWORD_RE.test(questionText);
  // if allOrganism is true, the return is the result of the regex test on the questionText
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
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/\W+/)
        .filter((w) => w.length > 3),
    );
  const A = tokenise(a);
  const B = tokenise(b);
  let inter = 0;
  A.forEach((w) => {
    if (B.has(w)) inter++;
  });
  const union = new Set(Array.from(A).concat(Array.from(B))).size;
  return union === 0 ? 0 : inter / union;
}

/**
 * Parse a raw DeCS record object into a DeCSRecord.
 * Returns null when it cannot extract a Portuguese term.
 */
function parseDeCSRecord(rec: Record<string, unknown>): DeCSRecord | null {
  const attrObj = rec.attr as Record<string, string> | undefined;
  const code = attrObj?.mfn ?? ""; //what does const stand for? it is a variable that cannot be reassigned!!!!

  const descriptors = toArray(rec.descriptor_list as unknown).flatMap((d) =>
    toArray(d as unknown),
  ) as Record<string, unknown>[];

  let term = ""; // what does let stand for? it is a variable that can be reassigned!!!!
  for (const pl of ["pt-br", "pt"]) {
    const found = descriptors.find((d) => {
      const da = d?.attr as Record<string, string> | undefined;
      return da?.lang === pl;
    });
    if (
      found &&
      typeof found.descriptor === "string" &&
      found.descriptor.trim()
    ) {
      term = found.descriptor.trim();
      break;
    }
  }
  if (!term) return null;

  const treeList = toArray(rec.tree_id_list as unknown).flatMap((t) =>
    toArray(t as unknown),
  ) as Record<string, unknown>[];
  const tree_ids: string[] = treeList
    .map((t) => (t?.tree_id as string | undefined)?.trim() ?? "")
    .filter(Boolean);

  return {
    term,
    code,
    tree_ids,
    hierarchy_path: buildHierarchyPath(tree_ids[0] ?? ""),
    branches: buildBranches(tree_ids),
  };
}

// ── Layer 1 (primary): Local pgvector search ─────────────────────────────────

/**
 * Returns true if the decs_descriptors table is populated (has at least 1 row).
 * Used to decide whether to use the local index or fall back to BVS API.
 */
async function isLocalDeCSAvailable(): Promise<boolean> {
  try {
    // Dynamic import so this file is usable in scripts that don't have the DB pool
    const { query } = await import("@/lib/db");
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
  minSimilarity = 0.6,
): Promise<DeCSRecord[]> {
  try {
    const { generateEmbedding, vectorToString } = await import(
      "@/lib/embeddings"
    );
    const { query } = await import("@/lib/db");

    const embedding = await generateEmbedding(searchTerm, geminiKey);
    const vec = vectorToString(embedding);

    // Cast to halfvec to use the halfvec HNSW index (pgvector 0.8, >2000 dims)
    const res = await query(
      `
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
    `,
      [vec, minSimilarity, maxCandidates],
    );

    return res.rows.map((r) => {
      const tree_ids: string[] = Array.isArray(r.tree_numbers)
        ? r.tree_numbers
        : JSON.parse(r.tree_numbers ?? "[]");
      return {
        term: r.term,
        code: r.code,
        tree_ids,
        hierarchy_path: buildHierarchyPath(tree_ids[0] ?? ""),
        branches: buildBranches(tree_ids),
        similarity: parseFloat(r.similarity ?? "0"),
        scope_note: r.scope_note ?? undefined,
        name_en: r.name_en ?? undefined,
      };
    });
  } catch {
    return [];
  }
}

// ── BVS API (fallback) ────────────────────────────────────────────────────────

const DECS_BASE = "https://api.bvsalud.org/decs/v2";

/**
 * Search DeCS and return up to `maxCandidates` parsed records.
 * Returns an empty array on any error.
 */
export async function searchDeCSCandidates(
  searchTerm: string,
  apiKey: string,
  maxCandidates = 5,
): Promise<DeCSRecord[]> {
  try {
    const url = `${DECS_BASE}/search-by-words?words=${encodeURIComponent(searchTerm)}&lang=pt&format=json`;
    const res = await fetch(url, { headers: { apikey: apiKey } });
    if (!res.ok) return [];

    const data = (await res.json()) as Record<string, unknown>;
    const objects = data?.objects as unknown[];
    if (!Array.isArray(objects) || objects.length === 0) return [];

    const first = objects[0] as Record<string, unknown>;
    const resp = first?.decsws_response as Record<string, unknown>;
    const recordList = resp?.record_list as Record<string, unknown>;
    if (!recordList) return [];

    const rawRecords = toArray(recordList?.record as unknown).slice(
      0,
      maxCandidates,
    );
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
  geminiKey?: string,
): Promise<DeCSRecord | null> {
  // ── Try local pgvector first ──────────────────────────────────────────────
  console.log("Candidatos", maxCandidates);
  if (geminiKey && (await isLocalDeCSAvailable())) {
    const localCandidates = await searchDeCSLocal(
      searchTerm,
      geminiKey,
      maxCandidates,
    );
    const filtered = localCandidates
      .filter((c) => isCategoryAcceptable(c, questionText))
      .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
    if (filtered.length > 0) return filtered[0];

    console.log("DB", localCandidates);
  }

  // ── Fallback: BVS API ─────────────────────────────────────────────────────
  const candidates = await searchDeCSCandidates(
    searchTerm,
    apiKey,
    maxCandidates,
  );

  console.log("API", candidates);

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
export async function enrichFromDB(
  records: DeCSRecord[],
): Promise<DeCSRecord[]> {
  if (records.length === 0) return [];
  const missing = records.filter((r) => !r.scope_note && r.code);
  if (missing.length === 0) return records;

  try {
    const { query } = await import("@/lib/db");
    const codes = missing.map((r) => r.code);
    const res = await query(
      `SELECT ui, name_en, scope_note FROM decs_descriptors WHERE ui = ANY($1)`,
      [codes],
    );
    const map = new Map<string, { name_en: string; scope_note: string }>(
      res.rows.map((r) => [
        r.ui,
        { name_en: r.name_en, scope_note: r.scope_note },
      ]),
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
  model = "gemini-2.5-flash",
  validatorAgentKey = "decs_validator",
): Promise<DeCSRecord[]> {
  if (descriptors.length === 0) return [];

  const candidateList = descriptors.map((d) => ({
    code: d.code,
    term: d.term,
    term_en: d.name_en ?? undefined,
    scope: d.scope_note ? d.scope_note.substring(0, 180) : undefined,
    categoria: buildHierarchyPath(d.tree_ids[0] ?? "").split(" › ")[0],
  }));

  const userMessage = [
    "Conteúdo:",
    questionText,
    "",
    "Candidatos:",
    JSON.stringify(candidateList, null, 2),
  ].join("\n");

  try {
    const { getRuntimeAgent } = await import("@/lib/ai-agent-runtime");
    const validator = await getRuntimeAgent(validatorAgentKey);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${validator.model}:generateContent?key=${geminiKey}`;
    const body = {
      system_instruction: { parts: [{ text: validator.system_instruction }] },
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig: {
        temperature: validator.temperature,
        maxOutputTokens: validator.max_output_tokens,
        responseMimeType: "application/json",
      },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return descriptors; // fail-open

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json()) as any;
    const rawText: string =
      data?.candidates?.[0]?.content?.parts
        ?.filter((p: Record<string, unknown>) => !p?.thought)
        ?.map((p: Record<string, unknown>) => p?.text)
        .filter(Boolean)
        .join("") ?? "";

    const cleaned = rawText
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
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
 * Given Gemini-extracted themes (primary + secondary), run the DeCS pipeline:
 *   1. Multi-candidate DeCS search + similarity ranking (per theme, tagged with role)
 *   2. Category filter
 *   (3. Gemini validation — disabled 18/06/2026, see validateDescriptorsWithGemini)
 *
 * Returns a flat, deduplicated list of DeCS records with role tags.
 * Primary descriptors appear first; secondary follow.
 *
 * Also accepts a plain string[] for backward compatibility (all treated as 'primary').
 */
export async function runDeCSPipeline(
  themes: DeCSThemes | string[],
  questionText: string,
  decsKey: string,
  geminiKey: string,
  model = "gemini-2.5-flash",
  validatorAgentKey = "decs_validator",
): Promise<{
  descriptors: DeCSRecord[];
  dropped_by_filter: number;
  dropped_by_gemini: number;
}> { 

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
    ...structured.primary.map((term) => ({ term, role: "primary" as const })),
    ...structured.secondary.map((term) => ({
      term,
      role: "secondary" as const,
    })),
  ];

  type SearchOutcome =
    | { status: "accepted"; role: "primary" | "secondary"; match: DeCSRecord }
    | { status: "category_filtered" }
    | { status: "no_candidate" }
    | { status: "deduped" };

    // 19/06/2026 - faz busca multi-candidata, filtro de categoria, validação Gemini. COMENTAR VALIDAÇÃO
  const outcomes = await Promise.allSettled(
    searchAll.map(async ({ term, role }): Promise<SearchOutcome> => {
      const MIN_SIMILARITY = 1; // 19/06/2026 - similaridade mínima para considerar um candidato

      // ── 1. Try local pgvector first ────────────────────────────────────────
      let rawCandidates: DeCSRecord[] = [];
      if (geminiKey && (await isLocalDeCSAvailable())) {
        rawCandidates = await searchDeCSLocal(term, geminiKey, 5, 0.6);
      }

      // ── 2. Fallback: BVS API ───────────────────────────────────────────────
      if (rawCandidates.length != 0 ) {
        const apiResults = await searchDeCSCandidates(term, decsKey, 5);
        rawCandidates = apiResults
          .map((c) => ({ ...c, similarity: wordJaccard(term, c.term) }))
          .filter((c) => (c.similarity ?? 0) >= MIN_SIMILARITY)
          .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
      }

      // No candidates found at all (search failed or similarity too low)
      if (rawCandidates.length === 0) return { status: "no_candidate" };

      // ── 3. Category filter — track drops separately ────────────────────────
      // 19/06/2026 - faz filtragem de categoria B (organismo sem contexto bio), não é validação
      const accepted = rawCandidates.filter((c) =>
        isCategoryAcceptable(c, questionText),
      );
      if (accepted.length === 0) {
        // Had candidates, but category B filter rejected all of them
        return { status: "category_filtered" };
      }

      // ── 4. Deduplication ───────────────────────────────────────────────────
      const best = accepted[0];
      if (seenCodes.has(best.code)) return { status: "deduped" };

      seenCodes.add(best.code);
      return { status: "accepted", role, match: best };
    }),
  );

  // 19/06/2026 - conta quantos termos foram removidos pelo filtro de categoria DEVERIA SER COMENTADO?
  // Tally outcomes and build the search result list
  let droppedByFilter = 0; // terms with candidates that the category filter removed
  for (const res of outcomes) {
    if (res.status === "rejected") continue; // unexpected error — skip silently
    const outcome = res.value;
    // 19/06/2026 - faz deduplicação, adiciona ao resultado
    if (outcome.status === "accepted") {
      afterSearch.push({ ...outcome.match, role: outcome.role });
    } else if (outcome.status === "category_filtered") {
      droppedByFilter++;
    }
    // 'no_candidate' and 'deduped' do not count toward dropped_by_filter
  }

  // Enrich BVS API results with scope_note/name_en from local DB
  const enriched = await enrichFromDB(afterSearch);

  // Validação Gemini (decs_validator) desativada em 18/06/2026 — removia termos
  // essenciais após busca pgvector/BVS com boa acurácia.
  // const afterValidation = await validateDescriptorsWithGemini(
  //   enriched,
  //   questionText,
  //   geminiKey,
  //   model,
  //   validatorAgentKey,
  // );
  // const droppedByGemini = afterSearch.length - afterValidation.length;
  const afterValidation = enriched;

  // Strip the internal similarity field, keep role; primary first
  const primary = afterValidation
    .filter((d) => d.role === "primary")
    .map(({ similarity: _s, ...rest }) => rest);
  const secondary = afterValidation
    .filter((d) => d.role !== "primary")
    .map(({ similarity: _s, ...rest }) => rest);

  const descriptors = [...primary, ...secondary];

  return {
    descriptors,
    dropped_by_filter: droppedByFilter,
    dropped_by_gemini: 0,
  };
}
