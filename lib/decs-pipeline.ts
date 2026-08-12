import { DECS_MAX_CANDIDATES } from "./decs-search-limits";

/**
 * DeCS AI Pipeline — shared classifier logic
 *
 * Quality layers (active) — 03/07/2026: busca por termo reordenada para
 * priorizar TEXTO, igual a scripts/decs-pipeline-v1-run.mjs:
 *   1. Busca TEXTUAL local (name_pt / entry_terms via ILIKE) — rápida, offline
 *   2. Fallback → busca VETORIAL local (pgvector, decs_descriptors) quando o texto
 *      não encontra um bom candidato
 *   3. Fallback final → API pública do BVS quando texto e vetor falham
 *   4. Category filter (reject organism/virus categories unless biomed context)
 *
 * Layer 5 (Gemini relevance validation via decs_validator) disabled 18/06/2026 —
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
  similarity?: number; // score (jaccard textual, cosseno vetorial, ou jaccard BVS)
  role?: "primary" | "secondary"; // importância temática
  scope_note?: string; // descrição do conceito
  name_en?: string; // nome em inglês
  search_method?: "text" | "vector" | "bvs"; // camada que encontrou o descritor
}

export interface DeCSThemes {
  // export (function/const/interface) makes it available to other files!!
  primary: string[];
  secondary: string[];
}

/** Rastreio por termo parcial (Gemini) — usado na exposição ao frontend. */
export interface DeCSPipelineTermTrace {
  gemini_partial_term: string;
  role: 'primary' | 'secondary';
  text_search: {
    candidates: Array<{
      code: string;
      official_term_pt: string;
      name_en?: string;
      matched_via: 'name_pt' | 'name_en' | 'entry_terms' | null;
      matched_entry_term?: string;
      similarity?: number;
      exact_entry_term_match?: boolean;
      hierarchy_path?: string;
      branches?: DeCSBranch[];
    }>;
    accepted: boolean;
    accept_reason?: string;
    accepted_descriptor?: DeCSRecord | null;
  };
  vector_search: {
    candidates: Array<{
      code: string;
      term: string;
      name_en?: string;
      similarity?: number;
      hierarchy_path?: string;
      branches?: DeCSBranch[];
    }>;
    accepted: boolean;
    accepted_descriptor?: DeCSRecord | null;
  };
  bvs_search: {
    candidates: Array<{
      code: string;
      term: string;
      similarity?: number;
      hierarchy_path?: string;
      branches?: DeCSBranch[];
    }>;
    accepted: boolean;
    accepted_descriptor?: DeCSRecord | null;
  };
  final_method?: 'text' | 'vector' | 'bvs';
  outcome: 'accepted' | 'category_filtered' | 'no_candidate' | 'deduped';
}

export type DeCSPipelineRunResult = {
  descriptors: DeCSRecord[];
  dropped_by_filter: number;
  dropped_by_gemini: number;
  term_trace: DeCSPipelineTermTrace[];
};

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
 * Normalise a string for exact-match comparison: lowercase, strip accents,
 * strip punctuation, trim. Identical to normalizeExact in
 * scripts/decs-pipeline-v1-run.mjs.
 */
export function normalizeExact(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
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
  maxCandidates = DECS_MAX_CANDIDATES,
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

// ── Layer 0 (priority): Local textual search (entry_terms / name_pt) ─────────

/**
 * DeCSRecord extended with the descriptor's full entry_terms list, needed to
 * detect exact synonym matches during textual search evaluation.
 */
export type DeCSTextCandidate = DeCSRecord & {
  official_term_pt?: string;
  all_entry_terms?: string[];
  exact_entry_term_match?: boolean;
  matched_via?: 'name_pt' | 'name_en' | 'entry_terms' | null;
  matched_entry_term?: string;
};

function detectTextMatchField(
  searchTerm: string,
  row: { name_pt: string; name_en?: string | null; entry_terms: string[] },
): { matched_via: 'name_pt' | 'name_en' | 'entry_terms' | null; matched_entry_term?: string } {
  const norm = normalizeExact(searchTerm);
  const pattern = norm.length > 0 ? norm : '';
  if (!pattern) return { matched_via: null };

  if (normalizeExact(row.name_pt).includes(pattern) || pattern.includes(normalizeExact(row.name_pt))) {
    return { matched_via: 'name_pt' };
  }
  if (row.name_en && normalizeExact(row.name_en).includes(pattern)) {
    return { matched_via: 'name_en' };
  }
  for (const et of row.entry_terms) {
    if (normalizeExact(et).includes(pattern) && pattern.length > 3) {
      return { matched_via: 'entry_terms', matched_entry_term: et };
    }
  }
  return { matched_via: null };
}

/** Carrega tree_numbers do banco e associa hierarchy_path/branches após match textual aceito. */
async function attachTextMatchHierarchy(
  candidate: Pick<DeCSTextCandidate, 'code' | 'term' | 'name_en'>,
): Promise<DeCSRecord> {
  try {
    const { query } = await import('@/lib/db');
    const res = await query(
      `SELECT name_pt, name_en, tree_numbers FROM decs_descriptors WHERE ui = $1`,
      [candidate.code],
    );
    if (res.rows.length === 0) {
      return {
        code: candidate.code,
        term: candidate.term,
        name_en: candidate.name_en,
        tree_ids: [],
        hierarchy_path: '',
        branches: [],
      };
    }
    const row = res.rows[0];
    const tree_ids: string[] = Array.isArray(row.tree_numbers)
      ? row.tree_numbers
      : JSON.parse(row.tree_numbers ?? '[]');
    return {
      code: candidate.code,
      term: String(row.name_pt ?? candidate.term),
      name_en: row.name_en ?? candidate.name_en,
      tree_ids,
      hierarchy_path: buildHierarchyPath(tree_ids[0] ?? ''),
      branches: buildBranches(tree_ids),
    };
  } catch {
    return {
      code: candidate.code,
      term: candidate.term,
      name_en: candidate.name_en,
      tree_ids: [],
      hierarchy_path: '',
      branches: [],
    };
  }
}

/**
 * Search local decs_descriptors by ILIKE match against name_pt, name_en and
 * entry_terms only. Hierarquia (tree_numbers → hierarchy_path) é carregada
 * somente após aceite do match textual (attachTextMatchHierarchy).
 */
export async function searchDeCSTextual(
  searchTerm: string,
  maxCandidates = DECS_MAX_CANDIDATES,
): Promise<DeCSTextCandidate[]> {
  try {
    const { query } = await import("@/lib/db");
    const pattern = `%${searchTerm}%`;

    const res = await query(
      `
      SELECT
        d.ui,
        d.name_pt,
        d.name_en,
        d.entry_terms
        -- scope_note: Parâmetro desconsiderado para fins de testes
        -- tree_numbers: Parâmetro desconsiderado para fins de testes (hierarquia só após match textual)
      FROM decs_descriptors d
      WHERE d.name_pt ILIKE $1
         OR d.name_en ILIKE $1
         OR EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(d.entry_terms) AS t WHERE t ILIKE $1
            )
      ORDER BY (d.name_pt ILIKE $1) DESC, (d.name_en ILIKE $1) DESC, name_pt
      LIMIT $2
    `,
      [pattern, maxCandidates],
    );

    return res.rows.map((r) => {
      const all_entry_terms: string[] = Array.isArray(r.entry_terms)
        ? r.entry_terms
        : JSON.parse(r.entry_terms ?? "[]");
      const match = detectTextMatchField(searchTerm, {
        name_pt: r.name_pt,
        name_en: r.name_en,
        entry_terms: all_entry_terms,
      });
      return {
        term: r.name_pt,
        official_term_pt: r.name_pt,
        code: r.ui,
        tree_ids: [],
        hierarchy_path: '',
        branches: [],
        name_en: r.name_en ?? undefined,
        all_entry_terms,
        matched_via: match.matched_via,
        matched_entry_term: match.matched_entry_term,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Rank textual candidates and decide whether the best one is a "good match"
 * (exact synonym/name match, or Jaccard similarity above minSimilarity).
 * Mirrors evaluateTextual() in scripts/decs-pipeline-v1-run.mjs.
 */
export function evaluateTextualMatch(
  term: string,
  candidates: DeCSTextCandidate[],
  questionText: string,
  minSimilarity = 0.3,
): { accepted: boolean; best: DeCSTextCandidate | null } {
  const scored = candidates.map((c) => {
    const jaccard = Math.max(
      wordJaccard(term, c.term),
      c.name_en ? wordJaccard(term, c.name_en) : 0,
    );
    const exact =
      normalizeExact(term) === normalizeExact(c.term) ||
      (c.name_en ? normalizeExact(term) === normalizeExact(c.name_en) : false) ||
      (c.all_entry_terms ?? []).some(
        (t) =>
          normalizeExact(t).includes(normalizeExact(term)) &&
          normalizeExact(term).length > 3,
      );
    return { ...c, similarity: jaccard, exact_entry_term_match: exact };
  });

  const eligible = scored
    .filter((c) => isCategoryAcceptable(c, questionText))
    .sort((a, b) => {
      if (a.exact_entry_term_match !== b.exact_entry_term_match) {
        return a.exact_entry_term_match ? -1 : 1;
      }
      return (b.similarity ?? 0) - (a.similarity ?? 0);
    });

  if (eligible.length === 0) return { accepted: false, best: null };

  const best = eligible[0];
  const goodMatch =
    best.exact_entry_term_match || (best.similarity ?? 0) >= minSimilarity;

  return { accepted: goodMatch, best };
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
  maxCandidates = DECS_MAX_CANDIDATES,
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
  maxCandidates = DECS_MAX_CANDIDATES, 
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
): Promise<DeCSPipelineRunResult> {
  const structured: DeCSThemes = Array.isArray(themes)
    ? { primary: themes, secondary: [] }
    : themes;

  const seenCodes = new Set<string>();
  const afterSearch: DeCSRecord[] = [];
  const termTrace: DeCSPipelineTermTrace[] = [];

  const searchAll = [
    ...structured.primary.map((term) => ({ term, role: "primary" as const })),
    ...structured.secondary.map((term) => ({
      term,
      role: "secondary" as const,
    })),
  ];

  const MIN_TEXT_SIMILARITY = 0.3;
  const MIN_VECTOR_SIMILARITY = 0.6;
  const MIN_BVS_SIMILARITY = 0.15;

  let droppedByFilter = 0;

  // Sequencial — uma busca por termo parcial, sem compartilhar estado entre termos
  for (const { term, role } of searchAll) {
    const traceEntry: DeCSPipelineTermTrace = {
      gemini_partial_term: term,
      role,
      text_search: { candidates: [], accepted: false },
      vector_search: { candidates: [], accepted: false },
      bvs_search: { candidates: [], accepted: false },
      outcome: 'no_candidate',
    };

    let winner: DeCSRecord | null = null;
    let method: "text" | "vector" | "bvs" | null = null;
    let categoryFilteredOnly = false;

    // ── 1. TEXTO — apenas name_pt, name_en, entry_terms ─────────────────────
    const textCandidates = await searchDeCSTextual(term, DECS_MAX_CANDIDATES);
    traceEntry.text_search.candidates = textCandidates.map((c) => ({
      code: c.code,
      official_term_pt: c.official_term_pt ?? c.term,
      name_en: c.name_en,
      matched_via: c.matched_via ?? null,
      matched_entry_term: c.matched_entry_term,
      similarity: c.similarity,
      exact_entry_term_match: c.exact_entry_term_match,
    }));

    const textEval = evaluateTextualMatch(
      term,
      textCandidates,
      questionText,
      MIN_TEXT_SIMILARITY,
    );
    if (textCandidates.length > 0 && !textEval.best) categoryFilteredOnly = true;

    if (textEval.accepted && textEval.best) {
      const withHierarchy = await attachTextMatchHierarchy(textEval.best);
      traceEntry.text_search.accepted = true;
      traceEntry.text_search.accept_reason = textEval.best.exact_entry_term_match
        ? 'match exato em name_pt, name_en ou entry_terms'
        : `similaridade Jaccard ≥ ${MIN_TEXT_SIMILARITY}`;
      traceEntry.text_search.accepted_descriptor = {
        ...withHierarchy,
        similarity: textEval.best.similarity,
        search_method: 'text',
      };
      const idx = traceEntry.text_search.candidates.findIndex((c) => c.code === withHierarchy.code);
      if (idx >= 0) {
        traceEntry.text_search.candidates[idx] = {
          ...traceEntry.text_search.candidates[idx],
          hierarchy_path: withHierarchy.hierarchy_path,
          branches: withHierarchy.branches,
        };
      }
      winner = traceEntry.text_search.accepted_descriptor;
      method = 'text';
    }

    // ── 2. VETOR ────────────────────────────────────────────────────────────
    if (!winner) {
      let rawVector: DeCSRecord[] = [];
      if (geminiKey && (await isLocalDeCSAvailable())) {
        rawVector = await searchDeCSLocal(term, geminiKey, DECS_MAX_CANDIDATES, MIN_VECTOR_SIMILARITY);
      }
      traceEntry.vector_search.candidates = rawVector.map((c) => ({
        code: c.code,
        term: c.term,
        name_en: c.name_en,
        similarity: c.similarity,
        hierarchy_path: c.hierarchy_path,
        branches: c.branches,
      }));

      const vectorAccepted = rawVector
        .filter((c) => isCategoryAcceptable(c, questionText))
        .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
      if (rawVector.length > 0 && vectorAccepted.length === 0) {
        categoryFilteredOnly = true;
      }
      if (vectorAccepted.length > 0) {
        traceEntry.vector_search.accepted = true;
        traceEntry.vector_search.accepted_descriptor = {
          ...vectorAccepted[0],
          search_method: 'vector',
        };
        winner = traceEntry.vector_search.accepted_descriptor;
        method = 'vector';
        categoryFilteredOnly = false;
      }
    }

    // ── 3. BVS ──────────────────────────────────────────────────────────────
    if (!winner) {
      const apiResults = await searchDeCSCandidates(term, decsKey, DECS_MAX_CANDIDATES);
      const scoredBvs = apiResults
        .map((c) => ({ ...c, similarity: wordJaccard(term, c.term) }))
        .filter((c) => (c.similarity ?? 0) >= MIN_BVS_SIMILARITY)
        .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
      traceEntry.bvs_search.candidates = scoredBvs.map((c) => ({
        code: c.code,
        term: c.term,
        similarity: c.similarity,
        hierarchy_path: c.hierarchy_path,
        branches: c.branches,
      }));

      const bvsAccepted = scoredBvs.filter((c) =>
        isCategoryAcceptable(c, questionText),
      );
      if (scoredBvs.length > 0 && bvsAccepted.length === 0) {
        categoryFilteredOnly = true;
      }
      if (bvsAccepted.length > 0) {
        traceEntry.bvs_search.accepted = true;
        traceEntry.bvs_search.accepted_descriptor = {
          ...bvsAccepted[0],
          search_method: 'bvs',
        };
        winner = traceEntry.bvs_search.accepted_descriptor;
        method = 'bvs';
        categoryFilteredOnly = false;
      }
    }

    if (!winner) {
      traceEntry.outcome = categoryFilteredOnly ? 'category_filtered' : 'no_candidate';
      if (categoryFilteredOnly) droppedByFilter++;
      termTrace.push(traceEntry);
      continue;
    }

    if (seenCodes.has(winner.code)) {
      traceEntry.outcome = 'deduped';
      traceEntry.final_method = method ?? undefined;
      termTrace.push(traceEntry);
      continue;
    }

    seenCodes.add(winner.code);
    traceEntry.outcome = 'accepted';
    traceEntry.final_method = method ?? undefined;
    afterSearch.push({ ...winner, role });
    termTrace.push(traceEntry);
  }

  const enriched = await enrichFromDB(afterSearch);
  const afterValidation = enriched;

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
    term_trace: termTrace,
  };
}

// Reexporta funções de exposição ao frontend (4 camadas)
export {
  exposeGeminiPartialTerms,
  exposeTextSearchLayer,
  exposeVectorSearchLayer,
  exposeBvsSearchLayer,
  buildPipelineFrontendExposure,
} from '@/lib/decs-pipeline-exposure';
