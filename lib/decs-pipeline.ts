/**
 * DeCS AI Pipeline — shared classifier logic
 *
 * Quality layers:
 *   1. Busca TEXTUAL local (name_pt / name_en / entry_terms)
 *   2. Fallback → busca VETORIAL local (pgvector)
 *   3. Fallback final → API pública do BVS
 *   4. Category filter
 *   5. Gemini relevance validation (opcional; desativada no Gerar V1 de questões)
 */

import { DECS_MAX_CANDIDATES } from "./decs-search-limits";

export interface DeCSRecord {
  // interface is a way to define the structure of an object!!
  term: string; // nome do descritor
  code: string; //identificador DeCS (index) (UI)
  tree_ids: string[]; // e.g. ["C01.635.500", "C01.635.500.500"] - posição hierárquica
  hierarchy_path: string; // e.g. "Doenças › C01.635.500" - caminho categórico
  similarity?: number; // score vetorial / Jaccard
  role?: "primary" | "secondary"; // importância temática
  scope_note?: string; // descrição do conceito
  name_en?: string; // nome em inglês
  search_method?: "text" | "vector" | "bvs";
  text_exact_match?: boolean;
}

export interface DeCSThemes {
  // export (function/const/interface) makes it available to other files!!
  primary: string[];
  secondary: string[];
}

/** Rastreio por termo parcial (Gemini) — exposição ao frontend. */
export interface DeCSPipelineTermTrace {
  gemini_partial_term: string;
  role: "primary" | "secondary";
  text_search: {
    executed: boolean;
    candidates: Array<{
      code: string;
      term: string;
      name_en?: string;
      similarity?: number;
      hierarchy_path?: string;
      exact_match: boolean;
    }>;
    accepted: boolean;
    accepted_descriptor?: DeCSRecord | null;
  };
  vector_search: {
    executed: boolean;
    candidates: Array<{
      code: string;
      term: string;
      name_en?: string;
      similarity?: number;
      hierarchy_path?: string;
    }>;
    accepted: boolean;
    accepted_descriptor?: DeCSRecord | null;
  };
  bvs_search: {
    executed: boolean;
    candidates: Array<{
      code: string;
      term: string;
      similarity?: number;
      hierarchy_path?: string;
    }>;
    accepted: boolean;
    accepted_descriptor?: DeCSRecord | null;
  };
  final_method?: "text" | "vector" | "bvs";
  outcome: "accepted" | "category_filtered" | "no_candidate" | "deduped";
}

/**
 * Builds the user message for DeCS classification/validation agents.
 * Includes statement, alternatives A–E, and the correct-answer letter (gabarito)
 * without repeating the text of the correct alternative.
 */
export function buildDeCSQuestionText(q: {
  statement?: string | null;
  option_a?: string | null;
  option_b?: string | null;
  option_c?: string | null;
  option_d?: string | null;
  option_e?: string | null;
  correct_answer?: string | null;
}): string {
  const letter = String(q.correct_answer ?? "").trim().toUpperCase();
  return [
    "Enunciado:",
    q.statement ?? "",
    "",
    "Alternativa A: " + (q.option_a ?? ""),
    "Alternativa B: " + (q.option_b ?? ""),
    q.option_c ? "Alternativa C: " + q.option_c : null,
    q.option_d ? "Alternativa D: " + q.option_d : null,
    q.option_e ? "Alternativa E: " + q.option_e : null,
    letter ? `Gabarito: ${letter}` : null,
  ]
    .filter(Boolean)
    .join("\n");
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

export function normalizeExact(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

/**
 * Normalização mínima para a seleção textual booleana.
 * Preserva letras e acentos; ignora somente caixa, espaços repetidos e
 * diferenças de composição Unicode. Não permite match por substring.
 */
export function normalizeTextualDescriptorMatch(s: string): string {
  return String(s ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
}

/**
 * Converte o JSONB `entry_terms` em lista de strings.
 * Aceita array já parseado pelo driver ou string JSON; ignora valores inválidos.
 */
export function parseEntryTermsJsonb(raw: unknown): string[] {
  if (raw == null) return [];
  let value: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      value = JSON.parse(trimmed);
    } catch {
      return [trimmed];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Formas de um entry_term para comparação exata.
 * Inclui a string completa e, se houver formato `Termo[English]`, as partes
 * antes e dentro dos colchetes (comuns no DeCS).
 */
function entryTermExactVariants(entryTerm: string): string[] {
  const variants = [entryTerm];
  const bracket = entryTerm.match(/^(.+?)\s*\[(.+)\]\s*$/);
  if (bracket) {
    const before = bracket[1]?.trim();
    const inside = bracket[2]?.trim();
    if (before) variants.push(before);
    if (inside) variants.push(inside);
  }
  return variants;
}

/**
 * Aceitação textual: igualdade exata (após normalização) com `name_pt`,
 * `name_en` ou qualquer elemento de `entry_terms`. O descritor retornado
 * continua sendo o registro oficial (`name_pt`).
 */
export function isTextualExactDescriptorMatch(
  searchTerm: string,
  namePt: string | null | undefined,
  nameEn: string | null | undefined,
  entryTermsRaw: unknown,
): boolean {
  const needle = normalizeTextualDescriptorMatch(searchTerm);
  if (!needle) return false;

  if (
    namePt &&
    normalizeTextualDescriptorMatch(namePt) === needle
  ) {
    return true;
  }
  if (
    nameEn &&
    normalizeTextualDescriptorMatch(nameEn) === needle
  ) {
    return true;
  }

  for (const entry of parseEntryTermsJsonb(entryTermsRaw)) {
    for (const variant of entryTermExactVariants(entry)) {
      if (normalizeTextualDescriptorMatch(variant) === needle) {
        return true;
      }
    }
  }
  return false;
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
        similarity: parseFloat(r.similarity ?? "0"),
        scope_note: r.scope_note ?? undefined,
        name_en: r.name_en ?? undefined,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Busca textual local em name_pt, name_en e entry_terms (ILIKE).
 *
 * Os resultados amplos são mantidos para rastreio, mas `text_exact_match`
 * só é verdadeiro quando o termo parcial é string igual (após normalização)
 * a `name_pt`, `name_en` ou a um elemento de `entry_terms` (JSONB array).
 * Em todos os casos o registro retornado usa o descritor oficial (`name_pt`).
 * Substrings / Jaccard não autorizam aceitação textual.
 */
export async function searchDeCSTextual(
  searchTerm: string,
  maxCandidates = DECS_MAX_CANDIDATES,
): Promise<DeCSRecord[]> {
  try {
    const { query } = await import("@/lib/db");
    const pattern = `%${searchTerm.trim()}%`;
    const res = await query(
      `
      SELECT
        ui AS code,
        name_pt AS term,
        name_en,
        scope_note,
        tree_numbers,
        entry_terms
      FROM decs_descriptors
      WHERE name_pt ILIKE $1
         OR name_en ILIKE $1
         OR entry_terms::text ILIKE $1
      ORDER BY
        CASE
          WHEN lower(btrim(name_pt)) = lower(btrim($2)) THEN 0
          WHEN lower(btrim(COALESCE(name_en, ''))) = lower(btrim($2)) THEN 1
          WHEN EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(
              CASE
                WHEN jsonb_typeof(entry_terms) = 'array' THEN entry_terms
                ELSE '[]'::jsonb
              END
            ) AS et(term)
            WHERE lower(btrim(et.term)) = lower(btrim($2))
               OR lower(btrim(split_part(et.term, '[', 1))) = lower(btrim($2))
          ) THEN 2
          ELSE 3
        END,
        length(name_pt),
        name_pt
      LIMIT $3
    `,
      [pattern, searchTerm.trim(), maxCandidates],
    );

    return res.rows.map((r) => {
      const tree_ids: string[] = Array.isArray(r.tree_numbers)
        ? r.tree_numbers
        : JSON.parse(r.tree_numbers ?? "[]");
      const jaccard = Math.max(
        wordJaccard(searchTerm, r.term ?? ""),
        r.name_en ? wordJaccard(searchTerm, r.name_en) : 0,
      );
      const exact = isTextualExactDescriptorMatch(
        searchTerm,
        r.term,
        r.name_en,
        r.entry_terms,
      );
      return {
        term: r.term,
        code: r.code,
        tree_ids,
        hierarchy_path: buildHierarchyPath(tree_ids[0] ?? ""),
        similarity: exact ? 1 : jaccard,
        scope_note: r.scope_note ?? undefined,
        name_en: r.name_en ?? undefined,
        search_method: "text" as const,
        text_exact_match: exact,
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
 * Reads the validation prompt from the `question_terms_validator` agent (DB).
 */
export async function validateDescriptorsWithGemini(
  descriptors: DeCSRecord[],
  questionText: string,
  geminiKey: string,
  model = "gemini-2.5-flash",
  validatorAgentKey = "question_terms_validator",
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
 * Given Gemini-extracted themes (primary + secondary), run the full pipeline:
 *   1. Textual → vector → BVS search (per theme), with category filter
 *   2. Gemini validation — only if `validatorAgentKey` is a non-empty string
 *      (Gerar V1 de questões passa null para pular question_terms_validator)
 *
 * Returns descriptors + term_trace for frontend exposure (in-memory only).
 */
export async function runDeCSPipeline(
  themes: DeCSThemes | string[],
  questionText: string,
  decsKey: string,
  geminiKey: string,
  model = "gemini-2.5-flash",
  validatorAgentKey: string | null = null,
): Promise<{
  descriptors: DeCSRecord[];
  dropped_by_filter: number;
  dropped_by_gemini: number;
  term_trace: DeCSPipelineTermTrace[];
  after_search: DeCSRecord[];
}> {
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

  const MIN_VECTOR_SIMILARITY = 0.6;
  const MIN_BVS_SIMILARITY = 0.15;
  let droppedByFilter = 0;

  // Sequencial — rastreio estável por termo (sem corrida em seenCodes)
  for (const { term, role } of searchAll) {
    const trace: DeCSPipelineTermTrace = {
      gemini_partial_term: term,
      role,
      text_search: { executed: false, candidates: [], accepted: false },
      vector_search: { executed: false, candidates: [], accepted: false },
      bvs_search: { executed: false, candidates: [], accepted: false },
      outcome: "no_candidate",
    };

    let winner: DeCSRecord | null = null;
    let categoryFilteredOnly = false;

    // ── 1. TEXTUAL ──────────────────────────────────────────────────────────
    trace.text_search.executed = true;
    const textRaw = await searchDeCSTextual(term, DECS_MAX_CANDIDATES);
    trace.text_search.candidates = textRaw.map((c) => ({
      code: c.code,
      term: c.term,
      name_en: c.name_en,
      similarity: c.similarity,
      hierarchy_path: c.hierarchy_path,
      exact_match: c.text_exact_match === true,
    }));
    const textExact = textRaw.filter((c) => c.text_exact_match === true);
    const textEligible = textExact.filter((c) =>
      isCategoryAcceptable(c, questionText),
    );
    if (textExact.length > 0 && textEligible.length === 0) {
      categoryFilteredOnly = true;
    }
    const textBest = textEligible[0];
    if (textBest) {
      winner = { ...textBest, role, search_method: "text" };
      trace.text_search.accepted = true;
      trace.text_search.accepted_descriptor = winner;
      trace.final_method = "text";
    }

    // ── 2. VECTOR ───────────────────────────────────────────────────────────
    if (!winner) {
      let rawVector: DeCSRecord[] = [];
      if (geminiKey && (await isLocalDeCSAvailable())) {
        trace.vector_search.executed = true;
        rawVector = await searchDeCSLocal(term, geminiKey, DECS_MAX_CANDIDATES, MIN_VECTOR_SIMILARITY);
      }
      trace.vector_search.candidates = rawVector.map((c) => ({
        code: c.code,
        term: c.term,
        name_en: c.name_en,
        similarity: c.similarity,
        hierarchy_path: c.hierarchy_path,
      }));
      const vectorEligible = rawVector
        .filter((c) => isCategoryAcceptable(c, questionText))
        .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
      if (rawVector.length > 0 && vectorEligible.length === 0) categoryFilteredOnly = true;
      if (vectorEligible.length > 0) {
        winner = { ...vectorEligible[0], role, search_method: "vector" };
        trace.vector_search.accepted = true;
        trace.vector_search.accepted_descriptor = winner;
        trace.final_method = "vector";
        categoryFilteredOnly = false;
      }
    }

    // ── 3. BVS ──────────────────────────────────────────────────────────────
    if (!winner) {
      trace.bvs_search.executed = true;
      const apiResults = await searchDeCSCandidates(term, decsKey, DECS_MAX_CANDIDATES);
      const scored = apiResults
        .map((c) => ({ ...c, similarity: wordJaccard(term, c.term) }))
        .filter((c) => (c.similarity ?? 0) >= MIN_BVS_SIMILARITY)
        .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
      trace.bvs_search.candidates = scored.map((c) => ({
        code: c.code,
        term: c.term,
        similarity: c.similarity,
        hierarchy_path: c.hierarchy_path,
      }));
      const bvsEligible = scored.filter((c) =>
        isCategoryAcceptable(c, questionText),
      );
      if (scored.length > 0 && bvsEligible.length === 0) categoryFilteredOnly = true;
      if (bvsEligible.length > 0) {
        winner = { ...bvsEligible[0], role, search_method: "bvs" };
        trace.bvs_search.accepted = true;
        trace.bvs_search.accepted_descriptor = winner;
        trace.final_method = "bvs";
        categoryFilteredOnly = false;
      }
    }

    if (!winner) {
      if (categoryFilteredOnly) {
        droppedByFilter++;
        trace.outcome = "category_filtered";
      } else {
        trace.outcome = "no_candidate";
      }
      termTrace.push(trace);
      continue;
    }

    if (seenCodes.has(winner.code)) {
      trace.outcome = "deduped";
      termTrace.push(trace);
      continue;
    }

    seenCodes.add(winner.code);
    afterSearch.push(winner);
    trace.outcome = "accepted";
    termTrace.push(trace);
  }

  const enriched = await enrichFromDB(afterSearch);

  // Validação Gemini desativável: Gerar V1 (questões) passa null.
  // Notas e chamadores que passam um key (ex.: validate_notes_decs_terms) mantêm a etapa.
  const afterValidation =
    validatorAgentKey && validatorAgentKey.trim()
      ? await validateDescriptorsWithGemini(
          enriched,
          questionText,
          geminiKey,
          model,
          validatorAgentKey,
        )
      : enriched;

  const droppedByGemini = afterSearch.length - afterValidation.length;

  const primary = afterValidation
    .filter((d) => d.role === "primary")
    .map(({ similarity: _s, text_exact_match: _exact, ...rest }) => rest);
  const secondary = afterValidation
    .filter((d) => d.role !== "primary")
    .map(({ similarity: _s, text_exact_match: _exact, ...rest }) => rest);

  const descriptors = [...primary, ...secondary];

  return {
    descriptors,
    dropped_by_filter: droppedByFilter,
    dropped_by_gemini: droppedByGemini,
    term_trace: termTrace,
    after_search: enriched,
  };
}
