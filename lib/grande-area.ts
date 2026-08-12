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

/** Cores Tailwind para exibição na UI */
export const GRANDE_AREA_UI: Record<
  GrandeArea,
  { label: string; badge: string; dot: string }
> = {
  'Clinica Medica': {
    label: 'Clínica Médica',
    badge: 'bg-blue-100 text-blue-800 border-blue-200',
    dot: 'bg-blue-500',
  },
  'Cirurgia Geral': {
    label: 'Cirurgia Geral',
    badge: 'bg-orange-100 text-orange-800 border-orange-200',
    dot: 'bg-orange-500',
  },
  Preventiva: {
    label: 'Preventiva / MFC',
    badge: 'bg-green-100 text-green-800 border-green-200',
    dot: 'bg-green-500',
  },
  Pediatria: {
    label: 'Pediatria',
    badge: 'bg-purple-100 text-purple-800 border-purple-200',
    dot: 'bg-purple-500',
  },
  GO: {
    label: 'Ginecologia e Obstetrícia',
    badge: 'bg-pink-100 text-pink-800 border-pink-200',
    dot: 'bg-pink-500',
  },
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
