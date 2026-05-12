/**
 * DeCS AI Pipeline V2 — RAG-enhanced classification
 *
 * Improvements over V1:
 *   1. Deeper semantic interpretation (indexer mindset, not clinician)
 *   2. Candidates enriched with real scope_note + name_en from decs_descriptors
 *   3. Second Gemini call receives full DeCS context → selects with real IDs
 *   4. Output includes parent/child hierarchy resolved from tree_numbers in DB
 *   5. Text-based fallback for descriptors without embeddings
 */

import { buildHierarchyPath, isCategoryAcceptable, searchDeCSLocal, searchDeCSCandidates, enrichFromDB, type DeCSRecord } from './decs-pipeline';
import { getAgentPrompt } from './ai-agents';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeCSV2Descriptor {
  id: string;
  term: string;
  name_en?: string;
  scope_note?: string;
  tree_ids?: string[];
  hierarchy_path?: string;
  parents: Array<{ id: string; term: string }>;
  children: Array<{ id: string; term: string }>;
  role?: 'primary' | 'secondary';
}

export interface DeCSV2Result {
  decs_primary: DeCSV2Descriptor[];
  decs_secondary: DeCSV2Descriptor[];
}

export interface DeCSV2CandidateGroup {
  label: string;
  concepts: Array<{
    concept: string;
    candidates: Array<{
      id: string;
      term: string;
      term_en?: string;
      scope?: string;
      categoria?: string;
      arvore?: string[];
    }>;
  }>;
}

export interface DeCSV2DebugTrace {
  themes: { primary: string[]; secondary: string[] };
  candidate_groups: DeCSV2CandidateGroup[];
  selected_candidates: {
    primary: Array<{ id: string; term: string }>;
    secondary: Array<{ id: string; term: string }>;
  };
}

// ── Hierarchy resolver ─────────────────────────────────────────────────────────

/**
 * Resolves immediate parents and up to 5 children for a given descriptor
 * by querying the decs_descriptors table using tree_numbers.
 */
async function resolveHierarchy(
  record: DeCSRecord
): Promise<{ parents: Array<{ id: string; term: string }>; children: Array<{ id: string; term: string }> }> {
  const parents: Array<{ id: string; term: string }> = [];
  const children: Array<{ id: string; term: string }> = [];
  const seenParent = new Set<string>();
  const seenChild = new Set<string>();

  try {
    const { query } = await import('@/lib/db');

    for (const treeId of (record.tree_ids ?? []).slice(0, 3)) {
      const parts = treeId.split('.');
      if (parts.length > 1) {
        const parentPath = parts.slice(0, -1).join('.');
        const pRes = await query(
          `SELECT ui, name_pt FROM decs_descriptors WHERE tree_numbers @> $1::jsonb LIMIT 1`,
          [JSON.stringify([parentPath])]
        );
        for (const row of pRes.rows) {
          if (row.ui && !seenParent.has(row.ui)) {
            seenParent.add(row.ui);
            parents.push({ id: row.ui, term: row.name_pt });
          }
        }
      }

      const cRes = await query(
        `SELECT ui, name_pt FROM decs_descriptors
         WHERE tree_numbers::text LIKE $1
           AND ui != $2
         LIMIT 5`,
        [`%"${treeId}.%`, record.code]
      );
      for (const row of cRes.rows) {
        if (row.ui && !seenChild.has(row.ui)) {
          seenChild.add(row.ui);
          children.push({ id: row.ui, term: row.name_pt });
        }
      }
    }
  } catch {
    // DB error — return empty hierarchy
  }

  return { parents: parents.slice(0, 3), children: children.slice(0, 5) };
}

// ── Text-based DB search (no embedding required) ──────────────────────────────

/**
 * Searches decs_descriptors by name similarity when no embedding is available.
 * Uses ILIKE for simple substring matching on name_pt and name_en.
 */
async function searchDeCSByText(
  searchTerm: string,
  maxCandidates = 5
): Promise<DeCSRecord[]> {
  try {
    const { query } = await import('@/lib/db');
    const pattern = `%${searchTerm.trim()}%`;
    const res = await query(
      `SELECT ui AS code, name_pt AS term, name_en, scope_note, tree_numbers
       FROM decs_descriptors
       WHERE name_pt ILIKE $1 OR name_en ILIKE $1
       ORDER BY
         CASE WHEN LOWER(name_pt) = LOWER($2) THEN 0
              WHEN name_pt ILIKE $2 THEN 1
              ELSE 2 END
       LIMIT $3`,
      [pattern, searchTerm.trim(), maxCandidates]
    );

    return res.rows.map((r) => {
      const tree_ids: string[] = Array.isArray(r.tree_numbers)
        ? r.tree_numbers
        : JSON.parse(r.tree_numbers ?? '[]');
      return {
        term: r.term,
        code: r.code,
        tree_ids,
        hierarchy_path: buildHierarchyPath(tree_ids[0] ?? ''),
        scope_note: r.scope_note ?? undefined,
        name_en: r.name_en ?? undefined,
      };
    });
  } catch {
    return [];
  }
}

// ── Gemini selector (Step 4) ──────────────────────────────────────────────────

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Given the question text and a map of concept→candidates (with full DeCS context),
 * asks Gemini to select the best descriptor for each concept and return them in
 * the V2 format: { decs_primary: [{id, term}], decs_secondary: [{id, term}] }
 *
 * IDs in the response are validated against the candidate list — hallucinated IDs
 * are silently dropped.
 */
async function selectDescriptorsWithGemini(
  questionText: string,
  primaryCandidates: Map<string, DeCSRecord[]>,
  secondaryCandidates: Map<string, DeCSRecord[]>,
  geminiKey: string,
  model = 'gemini-2.5-flash'
): Promise<{ primary: DeCSRecord[]; secondary: DeCSRecord[] }> {
  const buildCandidateBlock = (
    label: string,
    map: Map<string, DeCSRecord[]>
  ) => {
    const entries: object[] = [];
    for (const [concept, candidates] of Array.from(map.entries())) {
      entries.push({
        conceito_buscado: concept,
        candidatos: candidates.map((c: DeCSRecord) => ({
          id: c.code,
          term: c.term,
          term_en: c.name_en,
          scope: c.scope_note ? c.scope_note.substring(0, 200) : undefined,
          categoria: buildHierarchyPath(c.tree_ids[0] ?? '').split(' › ')[0],
          arvore: c.tree_ids.slice(0, 2),
        })),
      });
    }
    return { label, conceitos: entries };
  };

  const contextInput = {
    questao: questionText,
    temas_primarios: buildCandidateBlock('primários', primaryCandidates).conceitos,
    temas_secundarios: buildCandidateBlock('secundários', secondaryCandidates).conceitos,
  };

  const selectorPrompt = await getAgentPrompt('decs_selector_v2');

  try {
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${geminiKey}`;
    const body = {
      system_instruction: { parts: [{ text: selectorPrompt }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(contextInput, null, 2) }] }],
      generationConfig: {
        temperature: 0.05,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return fallbackSelect(primaryCandidates, secondaryCandidates);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    const rawText: string =
      data?.candidates?.[0]?.content?.parts
        ?.filter((p: Record<string, unknown>) => !p?.thought)
        ?.map((p: Record<string, unknown>) => p?.text)
        .filter(Boolean)
        .join('') ?? '';

    const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned) as {
      decs_primary?: Array<{ id: string }>;
      decs_secondary?: Array<{ id: string }>;
    };

    // Build a map of ALL candidates for ID lookup
    const allCandidates = new Map<string, DeCSRecord>();
    for (const candidates of Array.from(primaryCandidates.values()).concat(Array.from(secondaryCandidates.values()))) {
      for (const c of candidates) allCandidates.set(c.code, c);
    }

    const resolve = (items: Array<{ id: string }> = [], role: 'primary' | 'secondary') =>
      items
        .map((item) => allCandidates.get(item.id))
        .filter((r): r is DeCSRecord => r !== undefined)
        .map((r) => ({ ...r, role }));

    return {
      primary: resolve(parsed.decs_primary, 'primary'),
      secondary: resolve(parsed.decs_secondary, 'secondary'),
    };
  } catch {
    return fallbackSelect(primaryCandidates, secondaryCandidates);
  }
}

/** Fallback: take first candidate of each concept when Gemini fails. */
function fallbackSelect(
  primaryCandidates: Map<string, DeCSRecord[]>,
  secondaryCandidates: Map<string, DeCSRecord[]>
): { primary: DeCSRecord[]; secondary: DeCSRecord[] } {
  const pick = (map: Map<string, DeCSRecord[]>, role: 'primary' | 'secondary') =>
    Array.from(map.values())
      .map((candidates) => candidates[0])
      .filter(Boolean)
      .map((r) => ({ ...r, role }));
  return { primary: pick(primaryCandidates, 'primary'), secondary: pick(secondaryCandidates, 'secondary') };
}

// ── Main V2 pipeline ──────────────────────────────────────────────────────────

/**
 * Full V2 classification pipeline:
 *
 *   1. decs_indexer_v2 (Gemini) — deep semantic interpretation → concept names
 *   2. Search decs_descriptors per concept (vector → text fallback)
 *   3. Enrich candidates with scope_note/name_en from DB
 *   4. decs_selector_v2 (Gemini) — selects best descriptor per concept
 *   5. Resolve parents/children from tree_numbers in DB
 *   6. Return DeCSV2Result with full hierarchy
 */
export async function runDeCSPipelineV2(
  questionText: string,
  decsKey: string,
  geminiKey: string,
  model = 'gemini-2.5-flash'
): Promise<{
  result: DeCSV2Result;
  themes_identified: { primary: string[]; secondary: string[] };
  candidate_groups: DeCSV2CandidateGroup[];
  debug_trace: DeCSV2DebugTrace;
  stats: {
    primary_concepts: number;
    secondary_concepts: number;
    total_candidates: number;
    final_primary: number;
    final_secondary: number;
  };
}> {
  // ── Step 1: Extract concept names via decs_indexer_v2 ──────────────────────
  const indexerPrompt = await getAgentPrompt('decs_indexer_v2');
  let themes: { primary: string[]; secondary: string[] } = { primary: [], secondary: [] };

  try {
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${geminiKey}`;
    const body = {
      system_instruction: { parts: [{ text: indexerPrompt }] },
      contents: [{ role: 'user', parts: [{ text: questionText }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json() as any;
      const rawText: string =
        data?.candidates?.[0]?.content?.parts
          ?.filter((p: Record<string, unknown>) => !p?.thought)
          ?.map((p: Record<string, unknown>) => p?.text)
          .filter(Boolean)
          .join('') ?? '';
      const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object') {
        themes.primary = (Array.isArray(parsed.primary) ? parsed.primary : [])
          .filter((t: unknown) => typeof t === 'string' && t.trim())
          .slice(0, 3) as string[];
        themes.secondary = (Array.isArray(parsed.secondary) ? parsed.secondary : [])
          .filter((t: unknown) => typeof t === 'string' && t.trim())
          .slice(0, 6) as string[];
      }
    }
  } catch {
    themes = { primary: [], secondary: [] };
  }

  if (themes.primary.length === 0) {
    const fallbackTerms = questionText
      .split(/[\n\r.,;:()\-\/]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 3)
      .slice(0, 3);
    themes.primary = fallbackTerms;
  }

  // ── Step 2+3: Search + enrich candidates per concept ─────────────────────
  const primaryCandidates = new Map<string, DeCSRecord[]>();
  const secondaryCandidates = new Map<string, DeCSRecord[]>();
  let totalCandidates = 0;

  const searchConcept = async (term: string): Promise<DeCSRecord[]> => {
    // Try vector search first (only works for descriptors with embeddings)
    let candidates = await searchDeCSLocal(term, geminiKey, 5, 0.55);

    // Filter by category relevance
    candidates = candidates.filter((c) => isCategoryAcceptable(c, questionText));

    // If vector search returned nothing, fall back to text search in DB
    if (candidates.length === 0) {
      candidates = await searchDeCSByText(term, 5);
      candidates = candidates.filter((c) => isCategoryAcceptable(c, questionText));
    }

    // Last resort: BVS API
    if (candidates.length === 0) {
      const apiCandidates = await searchDeCSCandidates(term, decsKey, 5);
      candidates = apiCandidates.filter((c) => isCategoryAcceptable(c, questionText));
    }

    // If no real candidate found for this concept, skip it entirely
    if (candidates.length === 0) return [];

    // Enrich records that came from BVS API (no scope_note)
    candidates = await enrichFromDB(candidates);

    return candidates.slice(0, 5);
  };

  await Promise.allSettled([
    ...themes.primary.map(async (term) => {
      const candidates = await searchConcept(term);
      if (candidates.length > 0) {
        primaryCandidates.set(term, candidates);
        totalCandidates += candidates.length;
      }
    }),
    ...themes.secondary.map(async (term) => {
      const candidates = await searchConcept(term);
      if (candidates.length > 0) {
        secondaryCandidates.set(term, candidates);
        totalCandidates += candidates.length;
      }
    }),
  ]);

  if (primaryCandidates.size === 0) {
    throw new Error('Nenhum descritor DeCS encontrado para os temas identificados');
  }

  // ── Step 4: Gemini selects best descriptors from candidates ───────────────
  const { primary: selectedPrimary, secondary: selectedSecondary } =
    await selectDescriptorsWithGemini(
      questionText,
      primaryCandidates,
      secondaryCandidates,
      geminiKey,
      model
    );

  // ── Step 5: Resolve hierarchy (parents + children) from DB ────────────────
  const resolveAll = async (records: DeCSRecord[], role: 'primary' | 'secondary'): Promise<DeCSV2Descriptor[]> =>
    Promise.all(
      records.map(async (r) => {
        const { parents, children } = await resolveHierarchy(r);
        return {
          id: r.code,
          term: r.term,
          name_en: r.name_en,
          scope_note: r.scope_note,
          tree_ids: r.tree_ids,
          hierarchy_path: r.hierarchy_path,
          parents,
          children,
          role,
        };
      })
    );

  const [primDesc, secDesc] = await Promise.all([
    resolveAll(selectedPrimary, 'primary'),
    resolveAll(selectedSecondary, 'secondary'),
  ]);

  const candidate_groups: DeCSV2CandidateGroup[] = [
    {
      label: 'primários',
      concepts: Array.from(primaryCandidates.entries()).map(([concept, candidates]) => ({
        concept,
        candidates: candidates.map((c) => ({
          id: c.code,
          term: c.term,
          term_en: c.name_en,
          scope: c.scope_note ? c.scope_note.substring(0, 200) : undefined,
          categoria: buildHierarchyPath(c.tree_ids[0] ?? '').split(' › ')[0],
          arvore: c.tree_ids.slice(0, 2),
        })),
      })),
    },
    {
      label: 'secundários',
      concepts: Array.from(secondaryCandidates.entries()).map(([concept, candidates]) => ({
        concept,
        candidates: candidates.map((c) => ({
          id: c.code,
          term: c.term,
          term_en: c.name_en,
          scope: c.scope_note ? c.scope_note.substring(0, 200) : undefined,
          categoria: buildHierarchyPath(c.tree_ids[0] ?? '').split(' › ')[0],
          arvore: c.tree_ids.slice(0, 2),
        })),
      })),
    },
  ];

  return {
    result: { decs_primary: primDesc, decs_secondary: secDesc },
    themes_identified: themes,
    candidate_groups,
    debug_trace: {
      themes,
      candidate_groups,
      selected_candidates: {
        primary: primDesc.map((d) => ({ id: d.id, term: d.term })),
        secondary: secDesc.map((d) => ({ id: d.id, term: d.term })),
      },
    },
    stats: {
      primary_concepts: themes.primary.length,
      secondary_concepts: themes.secondary.length,
      total_candidates: totalCandidates,
      final_primary: primDesc.length,
      final_secondary: secDesc.length,
    },
  };
}
