/**
 * Remove tema/competência rejeitado(a) de todos os contextos:
 * fila pending + JSON nas questões (ai_question_themes / ai_habilities).
 */

import { query } from '@/lib/db';
import {
  normalizeTaxonomyLabel,
  ensureTaxonomyTables,
} from '@/lib/taxonomy-schema';
import type {
  HabilitiesResult,
  ThemesAssignResult,
} from '@/lib/taxonomy-agents';

function normKey(s: string): string {
  return normalizeTaxonomyLabel(s).toLowerCase();
}

function safeParse<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as T;
  const s = String(raw).trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/** Remove o par tema/subtema do resultado; retorna null se ficou vazio. */
export function stripThemePairFromResult(
  result: ThemesAssignResult,
  tema: string,
  subtema: string,
): ThemesAssignResult | null {
  const tKey = normKey(tema);
  const sKey = normKey(subtema);
  const selfPair = tKey === sKey;

  const temas = (result.temas ?? [])
    .map((g) => {
      if (normKey(g.tema) !== tKey) return g;
      if (selfPair) return null;
      const subtemas = (g.subtemas ?? []).filter((s) => normKey(s) !== sKey);
      if (subtemas.length === 0) return null;
      return { ...g, subtemas };
    })
    .filter((g): g is NonNullable<typeof g> => g != null);

  if (temas.length === 0) return null;

  let tema_principal = result.tema_principal;
  if (tema_principal && normKey(tema_principal) === tKey) {
    tema_principal = temas[0]?.tema;
  }

  return {
    temas,
    ...(tema_principal ? { tema_principal } : {}),
  };
}

/** Remove o par competência/conteúdo (e novas_competencias equivalentes). */
export function stripCompetencyPairFromResult(
  result: HabilitiesResult,
  competencia: string,
  conteudo: string,
): HabilitiesResult | null {
  const cKey = normKey(competencia);
  const oKey = normKey(conteudo);

  const competencias = (result.competencias ?? [])
    .map((g) => {
      if (normKey(g.competencia) !== cKey) return g;
      const conteudos = (g.conteudos ?? []).filter((c) => normKey(c) !== oKey);
      // Sem conteúdos restantes após remover o par proposto → remove o grupo
      if (conteudos.length === 0) return null;
      return { ...g, conteudos };
    })
    .filter((g): g is NonNullable<typeof g> => g != null);

  const novas = (result.novas_competencias ?? []).filter((n) => {
    if (normKey(n.nome) !== cKey) return true;
    const cat = normKey(n.categoria || '');
    const desc = normKey(n.descricao || '');
    const derived = cat || desc || '—';
    return derived !== oKey;
  });

  if (competencias.length === 0 && novas.length === 0) return null;

  return {
    competencias,
    novas_competencias: novas,
  };
}

async function scrubThemePairFromQuestions(
  tema: string,
  subtema: string,
): Promise<number> {
  const t = normalizeTaxonomyLabel(tema);
  const s = normalizeTaxonomyLabel(subtema);
  const res = await query(
    `SELECT id, ai_question_themes
     FROM questions
     WHERE ai_question_themes IS NOT NULL
       AND btrim(ai_question_themes) <> ''
       AND (
         ai_question_themes ILIKE '%' || $1 || '%'
         OR ai_question_themes ILIKE '%' || $2 || '%'
       )`,
    [t, s],
  );

  let updated = 0;
  for (const row of res.rows as Array<{ id: number; ai_question_themes: string }>) {
    const parsed = safeParse<ThemesAssignResult>(row.ai_question_themes);
    if (!parsed?.temas) continue;
    const next = stripThemePairFromResult(parsed, t, s);
    if (JSON.stringify(parsed) === JSON.stringify(next)) continue;

    await query(
      `UPDATE questions
       SET ai_question_themes = $1, updated_at = NOW()
       WHERE id = $2`,
      [next ? JSON.stringify(next) : null, row.id],
    );
    updated += 1;
  }
  return updated;
}

async function scrubCompetencyPairFromQuestions(
  competencia: string,
  conteudo: string,
): Promise<number> {
  const c = normalizeTaxonomyLabel(competencia);
  const o = normalizeTaxonomyLabel(conteudo);
  const res = await query(
    `SELECT id, ai_habilities
     FROM questions
     WHERE ai_habilities IS NOT NULL
       AND btrim(ai_habilities) <> ''
       AND (
         ai_habilities ILIKE '%' || $1 || '%'
         OR ai_habilities ILIKE '%' || $2 || '%'
       )`,
    [c, o],
  );

  let updated = 0;
  for (const row of res.rows as Array<{ id: number; ai_habilities: string }>) {
    const parsed = safeParse<HabilitiesResult>(row.ai_habilities);
    if (!parsed) continue;
    const next = stripCompetencyPairFromResult(parsed, c, o);
    if (JSON.stringify(parsed) === JSON.stringify(next)) continue;

    await query(
      `UPDATE questions SET ai_habilities = $1, updated_at = NOW() WHERE id = $2`,
      [next ? JSON.stringify(next) : null, row.id],
    );
    updated += 1;
  }
  return updated;
}

/**
 * Rejeita todos os pending do par e remove o termo das questões.
 */
export async function purgeThemePair(tema: string, subtema: string): Promise<{
  pending_rejected: number;
  questions_updated: number;
}> {
  await ensureTaxonomyTables();
  const t = normalizeTaxonomyLabel(tema);
  const s = normalizeTaxonomyLabel(subtema);

  const pend = await query(
    `UPDATE themes_pending
     SET status = 'rejected', updated_at = NOW()
     WHERE lower(tema) = lower($1) AND lower(subtema) = lower($2)
       AND status = 'pending'
     RETURNING id`,
    [t, s],
  );

  const questions_updated = await scrubThemePairFromQuestions(t, s);

  return {
    pending_rejected: pend.rows.length,
    questions_updated,
  };
}

export async function purgeCompetencyPair(
  competencia: string,
  conteudo: string,
): Promise<{
  pending_rejected: number;
  questions_updated: number;
}> {
  await ensureTaxonomyTables();
  const c = normalizeTaxonomyLabel(competencia);
  const o = normalizeTaxonomyLabel(conteudo);

  const pend = await query(
    `UPDATE competencies_pending
     SET status = 'rejected', updated_at = NOW()
     WHERE lower(competencia) = lower($1) AND lower(conteudo) = lower($2)
       AND status = 'pending'
     RETURNING id`,
    [c, o],
  );

  const questions_updated = await scrubCompetencyPairFromQuestions(c, o);

  return {
    pending_rejected: pend.rows.length,
    questions_updated,
  };
}

/** Exclusão hard do pending + purge do par. */
export async function deleteThemePendingAndPurge(id: number): Promise<{
  ok: boolean;
  purge?: { pending_rejected: number; questions_updated: number };
}> {
  await ensureTaxonomyTables();
  const res = await query(`SELECT * FROM themes_pending WHERE id = $1`, [id]);
  const row = res.rows[0] as { tema: string; subtema: string } | undefined;
  if (!row) return { ok: false };

  const purge = await purgeThemePair(row.tema, row.subtema);
  await query(
    `DELETE FROM themes_pending
     WHERE lower(tema) = lower($1) AND lower(subtema) = lower($2)`,
    [row.tema, row.subtema],
  );
  return { ok: true, purge };
}

export async function deleteCompetencyPendingAndPurge(id: number): Promise<{
  ok: boolean;
  purge?: { pending_rejected: number; questions_updated: number };
}> {
  await ensureTaxonomyTables();
  const res = await query(`SELECT * FROM competencies_pending WHERE id = $1`, [
    id,
  ]);
  const row = res.rows[0] as
    | { competencia: string; conteudo: string }
    | undefined;
  if (!row) return { ok: false };

  const purge = await purgeCompetencyPair(row.competencia, row.conteudo);
  await query(
    `DELETE FROM competencies_pending
     WHERE lower(competencia) = lower($1) AND lower(conteudo) = lower($2)`,
    [row.competencia, row.conteudo],
  );
  return { ok: true, purge };
}
