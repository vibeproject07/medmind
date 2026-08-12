/**
 * Grande área curricular do agente de temas (prompt question_themes_assigner).
 * Mapeia para areas_conhecimento do produto.
 */

export const GRANDE_AREA_OPTIONS = [
  'Clinica Medica',
  'Cirurgia Geral',
  'Preventiva',
  'Pediatria',
  'GO',
] as const;

export type GrandeArea = (typeof GRANDE_AREA_OPTIONS)[number];

/** Rótulo canônico em questions.areas_conhecimento */
export const GRANDE_AREA_TO_AREAS_CONHECIMENTO: Record<GrandeArea, string> = {
  'Clinica Medica': 'Clínica Médica',
  'Cirurgia Geral': 'Cirurgia Geral',
  Preventiva: 'Medicina da Família e Comunidade (MFC)',
  Pediatria: 'Pediatria',
  GO: 'Ginecologia e Obstetrícia',
};

function matchKey(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ALIASES: Record<string, GrandeArea> = {
  'clinica medica': 'Clinica Medica',
  cm: 'Clinica Medica',
  'cirurgia geral': 'Cirurgia Geral',
  cg: 'Cirurgia Geral',
  preventiva: 'Preventiva',
  mfc: 'Preventiva',
  'medicina da familia': 'Preventiva',
  'medicina da familia e comunidade': 'Preventiva',
  'medicina da familia e comunidade mfc': 'Preventiva',
  pediatria: 'Pediatria',
  pedi: 'Pediatria',
  go: 'GO',
  'g o': 'GO',
  ginecologia: 'GO',
  obstetricia: 'GO',
  'ginecologia e obstetricia': 'GO',
};

export function normalizeGrandeArea(raw: unknown): GrandeArea | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  for (const opt of GRANDE_AREA_OPTIONS) {
    if (s === opt) return opt;
    if (matchKey(s) === matchKey(opt)) return opt;
  }

  const key = matchKey(s);
  return ALIASES[key] ?? null;
}

export function grandeAreaToAreasConhecimento(
  grandeArea: GrandeArea | null | undefined,
): string | null {
  if (!grandeArea) return null;
  return GRANDE_AREA_TO_AREAS_CONHECIMENTO[grandeArea] ?? null;
}
