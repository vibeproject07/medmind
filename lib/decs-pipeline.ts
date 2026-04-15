/**
 * DeCS AI Pipeline — shared classifier logic
 *
 * Three quality layers:
 *   1. Multi-candidate DeCS search  (top-N records, pick best by similarity)
 *   2. Category filter              (reject organism/virus categories unless biomed context)
 *   3. Gemini relevance validation  (one extra call to drop false positives)
 */

export interface DeCSRecord {
  term: string;
  code: string;
  tree_ids: string[];
  hierarchy_path: string;
  similarity?: number;
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
 */
export async function findBestDeCSMatch(
  searchTerm: string,
  apiKey: string,
  questionText: string,
  minSimilarity = 0.15,
  maxCandidates = 5
): Promise<DeCSRecord | null> {
  const candidates = await searchDeCSCandidates(searchTerm, apiKey, maxCandidates);

  const scored = candidates
    .map((c) => ({ ...c, similarity: wordJaccard(searchTerm, c.term) }))
    .filter((c) => (c.similarity ?? 0) >= minSimilarity)
    .filter((c) => isCategoryAcceptable(c, questionText))
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));

  return scored.length > 0 ? scored[0] : null;
}

// ── Improvement 3: Gemini validation ────────────────────────────────────────

const VALIDATION_PROMPT = `Você é um especialista em vocabulário controlado DeCS/MeSH.

Dado o enunciado de uma questão médica e uma lista de descritores DeCS candidatos, filtre e mantenha APENAS os descritores que são CLINICAMENTE RELEVANTES para o tema central da questão.

Critérios de relevância:
- O descritor deve representar um conceito clínico central da questão (condição, fármaco, exame, procedimento).
- Descritores de organismos (vírus, bactérias, animais) só são relevantes se a questão tratar explicitamente de infectologia/microbiologia.
- Descritores muito genéricos ou de área não relacionada devem ser removidos.

Retorne SOMENTE um array JSON com os códigos dos descritores aprovados.
Exemplo: ["292","4794","1234"]
Sem explicação, sem markdown.`;

/**
 * Ask Gemini to validate which descriptors are truly relevant for the question.
 * Returns the subset of `descriptors` that Gemini approved.
 * On any error, returns the original list unchanged (fail-open).
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
    const body = {
      system_instruction: { parts: [{ text: VALIDATION_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 256 },
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
 * Given a list of Gemini-suggested search terms, run the full 3-layer pipeline:
 *   1. Multi-candidate DeCS search + similarity ranking
 *   2. Category filter
 *   3. Gemini validation
 *
 * Returns a deduplicated, validated list of DeCS records.
 */
export async function runDeCSPipeline(
  searchTerms: string[],
  questionText: string,
  decsKey: string,
  geminiKey: string
): Promise<{ descriptors: DeCSRecord[]; dropped_by_filter: number; dropped_by_gemini: number }> {
  // Step 1+2: search + category filter (already inside findBestDeCSMatch)
  const seenCodes = new Set<string>();
  const afterSearch: DeCSRecord[] = [];

  await Promise.allSettled(
    searchTerms.map(async (term) => {
      const match = await findBestDeCSMatch(term, decsKey, questionText);
      if (match && !seenCodes.has(match.code)) {
        seenCodes.add(match.code);
        afterSearch.push(match);
      }
    })
  );

  const droppedByFilter = searchTerms.length - afterSearch.length;

  // Step 3: Gemini validation
  const afterValidation = await validateDescriptorsWithGemini(
    afterSearch,
    questionText,
    geminiKey
  );

  const droppedByGemini = afterSearch.length - afterValidation.length;

  // Strip the internal similarity field before returning
  const descriptors = afterValidation.map(({ similarity: _s, ...rest }) => rest);

  return { descriptors, dropped_by_filter: droppedByFilter, dropped_by_gemini: droppedByGemini };
}
