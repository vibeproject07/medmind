/**
 * Áreas do conhecimento, assuntos, siglas e cores (padrão dashboard).
 * Usado em questões, notas e dashboard para exibição em formato de siglas.
 */

export const AREAS_CONHECIMENTO_OPTIONS = [
  "Ciclo Básico", // deixa de exisitr - 07/08/2026
  "Cirurgia Geral",
  "Clínica Médica",
  "Ginecologia e Obstetrícia", // separar - 07/08/2026
  "Medicina da Família e Comunidade (MFC)", // preventiva PREV - 07/08/2026
  "Pediatria", // PED - 07/08/2026
];

export const AREAS_SIGLAS: Record<string, string> = {
  "Ciclo Básico": "CB",
  "Cirurgia Geral": "CG",
  "Clínica Médica": "CM",
  "Ginecologia e Obstetrícia": "G/O",
  "Medicina da Família e Comunidade (MFC)": "MFC",
  Pediatria: "Pedi",
};

export const AREAS_COLORIDO_BG: Record<string, string> = {
  "Ciclo Básico": "#FFADAD",
  "Cirurgia Geral": "#FFD6A5",
  "Clínica Médica": "#FDFFB6",
  "Ginecologia e Obstetrícia": "#CAFFBF",
  "Medicina da Família e Comunidade (MFC)": "#9BF6FF",
  Pediatria: "#ffc6ff",
};

export const ASSUNTOS_BY_AREA: Record<string, string[]> = {
  "Ciclo Básico": [
    "Anatomia",
    "Farmacologia",
    "Fisiologia",
    "Imunologia",
    "Infectologia",
    "Microbiologia",
    "Patologia",
  ],
  "Cirurgia Geral": [
    "Abdome Agudo",
    "Câncer Colorretal",
    "Câncer Gástrico",
    "Cicatrização",
    "Cirurgia Pediátrica",
    "Complicações Pós-operatórias",
    "Doença da Vesícula Vias Biliares",
    "Doença do Refluxo Gastroesofágico (DRGE)",
    "Hérnias da Parede Abdominal",
    "Pré-operatório",
    "Queimaduras",
    "Resposta Metabólica ao Trauma (REMIT)",
    "Risco Cirúrgico",
    "Trauma e ATLS",
  ],
  "Clínica Médica": [
    "Acidente Vascular Cerebral (AVC)",
    "Anemias",
    "Arboviroses",
    "Asma",
    "Cirrose e Complicações",
    "Diabetes Mellitus",
    "Distúrbios Ácido-Básicos",
    "Distúrbios Hidroelétricos",
    "Doença Pulmonar Obstrutiva Crônica (DPOC)",
    "Doença Renal Crônica",
    "Hipertensão Arterial Sistemática (HAS)",
    "Infecção pelo HIV",
    "Insuficiência Cardíaca (IC)",
    "Lesão Renal Aguda",
    "Pneumonias Adquiridas na Comunidade (PAC)",
    "Síndromes Coronarianas Agudas",
    "Tuberculose",
  ],
  "Ginecologia e Obstetrícia": [
    "Assistência Pré-natal",
    "Câncer de Colo Uterino",
    "Câncer de Mama",
    "Climatério",
    "Contracepção",
    "Ginecologia Endócrina",
    "HPV",
    "Incontinência Urinária",
    "Infecções Sexualmente Transmissíveis",
    "Menopausa",
    "Planejamento Familiar",
    "Prolapsos Pélvicos",
    "Puerpério",
    "Sangramento na Gestação (1ª e 2ª metades)",
    "Trabalho de Parto",
    "Vulvovaginites",
  ],
  "Medicina da Família e Comunidade (MFC)": [
    "Atenção Primária à Saúde",
    "Bioética",
    "Declaração de Óbito",
    "Doenças de Notificação Compulsória",
    "Epidemiologia",
    "Ética Médica",
    "Medicina Baseada em Evidências",
    "Método Clínico Centrado na Pessoa",
    "Níveis de Prevenção",
    "Saúde do Trabalhador",
    "Sistemas de Informação",
    "SUS",
    "Vigilância em Saúde",
  ],
  Pediatria: [
    "Aleitamento Materno",
    "Alimentação Complementar",
    "Calendário Vacinal",
    "Desidratação",
    "Diarreia Aguda",
    "Doenças Exantemáticas",
    "Doenças Respiratórias",
    "Faringoamigdalites",
    "Infecção do Trato Urinário (UTI)",
    "Neonatologia",
    "Otites",
    "Puericultura",
    "Síndromes Glomerulares (Nefrótica e Nefrítica)",
  ],
};

const _ASSUNTO_TO_AREA: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [area, assuntos] of Object.entries(ASSUNTOS_BY_AREA)) {
    for (const a of assuntos) map[a] = area;
  }
  return map;
})();
export const ASSUNTO_TO_AREA = _ASSUNTO_TO_AREA;

/** Exibe área no formato "Nome (SIGLA)" como no dashboard */
export function toDisplayArea(area: string): string {
  return `${area} (${AREAS_SIGLAS[area] ?? area})`;
}

/** Exibe assunto no formato "Assunto (SIGLA da área)" como no dashboard */
export function toDisplayAssunto(assunto: string): string {
  const area = _ASSUNTO_TO_AREA[assunto];
  return `${assunto} (${area ? AREAS_SIGLAS[area] : ""})`;
}

/** Remove sufixo " (SIGLA)" para obter nome completo (área ou assunto) */
export function fromDisplay(display: string): string {
  return display.replace(/\s*\([^)]+\)\s*$/, "").trim();
}

/** Opções de área no formato sigla para TagAutocomplete */
export const AREAS_OPTIONS_DISPLAY =
  AREAS_CONHECIMENTO_OPTIONS.map(toDisplayArea);

/** optionBackgroundMap para áreas (chave = display "Área (SIGLA)") */
export const AREAS_OPTIONS_BG_MAP: Record<string, string> = Object.fromEntries(
  AREAS_CONHECIMENTO_OPTIONS.map((a) => [
    toDisplayArea(a),
    AREAS_COLORIDO_BG[a],
  ]),
);

/** optionBackgroundMap para lista de assuntos (chaves = toDisplayAssunto(assunto)) */
export function getAssuntosOptionsBgMap(
  assuntos: string[],
): Record<string, string> {
  return Object.fromEntries(
    assuntos.map((a) => [
      toDisplayAssunto(a),
      AREAS_COLORIDO_BG[_ASSUNTO_TO_AREA[a]] ?? "#e5e7eb",
    ]),
  );
}
