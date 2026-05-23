import { query } from '@/lib/db';
import { getRuntimeAgent } from '@/lib/ai-agent-runtime';
import { GoogleGenAI } from '@google/genai';
import { runDeCSPipeline, type DeCSRecord, type DeCSThemes } from '@/lib/decs-pipeline';
import { buildNoteText } from '@/lib/enrichment';

export async function ensureNoteDeCsColumn(): Promise<void> {
  await query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_decs_descriptors TEXT`);
}

function parseThemesFromRaw(rawText: string): DeCSThemes {
  let themes: DeCSThemes = { primary: [], secondary: [] };
  try {
    const cleaned = rawText
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      themes.primary = parsed
        .filter((t) => typeof t === 'string' && t.trim())
        .slice(0, 3);
    } else if (parsed && typeof parsed === 'object') {
      themes.primary = (Array.isArray(parsed.primary) ? parsed.primary : [])
        .filter((t: unknown) => typeof t === 'string' && (t as string).trim())
        .slice(0, 3);
      themes.secondary = (Array.isArray(parsed.secondary) ? parsed.secondary : [])
        .filter((t: unknown) => typeof t === 'string' && (t as string).trim())
        .slice(0, 6);
    }
  } catch {
    const matches = rawText.match(/"([^"]+)"/g);
    if (matches) {
      themes.primary = matches
        .map((m) => m.replace(/"/g, '').trim())
        .filter(Boolean)
        .slice(0, 3);
    }
  }
  return themes;
}

/** Mantém `decs_terms` (JSONB legado) alinhado aos descritores com role. */
export async function syncLegacyDecsTerms(noteId: number, descriptors: DeCSRecord[]): Promise<void> {
  const terms = descriptors.map((d) => ({
    ui: d.code,
    name_pt: d.term,
    name_en: d.name_en ?? d.term,
    role: d.role ?? 'secondary',
  }));
  await query(`UPDATE notes SET decs_terms = $1::jsonb, updated_at = NOW() WHERE id = $2`, [
    JSON.stringify(terms),
    noteId,
  ]);
}

/**
 * Classifica uma nota com o mesmo pipeline das questões (temas primary/secondary + DeCS).
 * Persiste em `notes.ai_decs_descriptors` e sincroniza `notes.decs_terms`.
 */
export async function classifyNoteDeCS(noteId: number): Promise<DeCSRecord[]> {
  await ensureNoteDeCsColumn();

  const geminiKey = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)?.trim();
  const decsKey = process.env.DECS_API_KEY?.trim();
  if (!geminiKey || !decsKey) {
    throw new Error('GEMINI_API_KEY e DECS_API_KEY são necessários para classificar notas');
  }

  const nRes = await query(
    `SELECT id, title, description, tags, areas_conhecimento, assuntos FROM notes WHERE id = $1`,
    [noteId],
  );
  if (nRes.rows.length === 0) throw new Error('Nota não encontrada');
  const note = nRes.rows[0] as Record<string, unknown>;
  const noteText = buildNoteText({
    title: note.title as string,
    description: note.description as string,
    tags: note.tags as string | null,
    areas_conhecimento: note.areas_conhecimento as string | null,
    assuntos: note.assuntos as string | null,
  });

  const classifierAgent = await getRuntimeAgent('discover_notes_terms');
  await getRuntimeAgent('validate_notes_decs_terms');

  const ai = new GoogleGenAI({ apiKey: geminiKey, apiVersion: 'v1beta' });
  const response = await ai.models.generateContent({
    model: classifierAgent.model,
    contents: [{ role: 'user', parts: [{ text: noteText }] }],
    config: {
      systemInstruction: classifierAgent.system_instruction,
      temperature: classifierAgent.temperature,
      maxOutputTokens: classifierAgent.max_output_tokens,
      responseMimeType: 'application/json',
    },
  });

  const resp = response as { text?: string; candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const rawText =
    (typeof resp?.text === 'string' ? resp.text : '') ||
    (resp?.candidates?.[0]?.content?.parts
      ?.map((p) => p?.text)
      .filter(Boolean)
      .join('') ??
      '');

  const themes = parseThemesFromRaw(rawText);
  if (themes.primary.length === 0 && themes.secondary.length === 0) {
    await query(
      `UPDATE notes SET ai_decs_descriptors = $1, decs_terms = '[]'::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify([]), noteId],
    );
    return [];
  }

  const { descriptors } = await runDeCSPipeline(
    themes,
    noteText,
    decsKey,
    geminiKey,
    classifierAgent.model,
    'validate_notes_decs_terms',
  );

  await query(
    `UPDATE notes SET ai_decs_descriptors = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(descriptors), noteId],
  );
  await syncLegacyDecsTerms(noteId, descriptors);

  return descriptors;
}

export function parseNoteAiDeCsDescriptors(raw: string | null | undefined): DeCSRecord[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DeCSRecord[]) : [];
  } catch {
    return [];
  }
}
