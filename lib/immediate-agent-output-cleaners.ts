export interface ExtractionOutputCleanup {
  cleanedText: string;
  newJson: string | null;
  jsonWithDiscardFalse: string[];
  saida_extracao_pos_limpeza: string[];
}

export type ExtractionJsonValue =
  | null
  | boolean
  | number
  | string
  | ExtractionJsonValue[]
  | { [key: string]: ExtractionJsonValue };
const REMOVED = Symbol('removed');

const TIMESTAMP = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?`;
const BRACKETED_TIMESTAMP = new RegExp(
  String.raw`[\[(<][ \t]*${TIMESTAMP}(?:[ \t]*(?:-->|-|–|—|até)[ \t]*${TIMESTAMP})?[ \t]*[\])>]`,
  'gi',
);
const SRT_TIMESTAMP_LINE = new RegExp(
  String.raw`^[ \t]*${TIMESTAMP}[ \t]*-->[ \t]*${TIMESTAMP}(?:[ \t]+[^\r\n]*)?$`,
  'gim',
);
const LEADING_TIMESTAMP = new RegExp(
  String.raw`^[ \t]*${TIMESTAMP}(?:[ \t]*(?:-->|-|–|—|até)[ \t]*${TIMESTAMP})?[ \t]*(?:[-–—:|][ \t]*)?`,
  'gim',
);

/**
 * Limpa somente minutagens da saída textual imediata da transcrição.
 * Tempos estruturados dos segmentos permanecem disponíveis separadamente.
 */
export function cleanTranscriptionAgentOutput(output: string): string {
  return output
    .replace(/\r\n?/g, '\n')
    .replace(SRT_TIMESTAMP_LINE, '')
    .replace(BRACKETED_TIMESTAMP, '')
    .replace(LEADING_TIMESTAMP, '')
    .replace(/^\s*\d+\s*$/gm, '')
    .replace(/^[ \t]+/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function removeCommonMarkdown(output: string): string {
  return output
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*```(?:json|jsonc|javascript|js|markdown|md|text)?\s*$/gim, '')
    .replace(/!\[([^\]]*)\]\([^)\n]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)\n]+\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/gm, '')
    .replace(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseExtractionJsonOutput(output: string): ExtractionJsonValue | null {
  const withoutFence = output
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const objectStart = withoutFence.indexOf('{');
  const arrayStart = withoutFence.indexOf('[');
  const start =
    objectStart < 0 ? arrayStart :
      arrayStart < 0 ? objectStart :
        Math.min(objectStart, arrayStart);
  if (start < 0) return null;
  const opening = withoutFence[start];
  const closing = opening === '[' ? ']' : '}';
  const end = withoutFence.lastIndexOf(closing);
  if (end <= start) return null;
  try {
    return JSON.parse(withoutFence.slice(start, end + 1)) as ExtractionJsonValue;
  } catch {
    return null;
  }
}

function isDiscardedObject(value: { [key: string]: ExtractionJsonValue }): boolean {
  return value.descatada === true || value.descartada === true;
}

function removeDiscardedObjects(
  value: ExtractionJsonValue,
): ExtractionJsonValue | typeof REMOVED {
  if (Array.isArray(value)) {
    return value
      .map(removeDiscardedObjects)
      .filter((item): item is ExtractionJsonValue => item !== REMOVED);
  }
  if (value && typeof value === 'object') {
    if (isDiscardedObject(value)) return REMOVED;
    const entries = Object.entries(value)
      .map(([key, child]) => [key, removeDiscardedObjects(child)] as const)
      .filter((entry): entry is readonly [string, ExtractionJsonValue] => entry[1] !== REMOVED);
    return Object.fromEntries(entries) as ExtractionJsonValue;
  }
  return value;
}

function collectRetainedFlaggedObjects(
  value: ExtractionJsonValue,
  collected: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((child) => collectRetainedFlaggedObjects(child, collected));
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (
    Object.prototype.hasOwnProperty.call(value, 'descatada') ||
    Object.prototype.hasOwnProperty.call(value, 'descartada')
  ) {
    collected.push(JSON.stringify(value));
  }
  Object.values(value).forEach((child) => collectRetainedFlaggedObjects(child, collected));
}

/**
 * Percorre somente a estrutura JSON já interpretada. Não usa regex nem tenta
 * inferir conteúdo textual: aceita apenas objetos com `descartada === false`
 * e campos próprios `unidade` e `texto`.
 */
export function buildPostCleanupExtractionList(
  value: ExtractionJsonValue,
): string[] {
  const output: string[] = [];

  const visit = (current: ExtractionJsonValue): void => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!current || typeof current !== 'object') return;

    const hasUnit = Object.prototype.hasOwnProperty.call(current, 'unidade');
    const hasText = Object.prototype.hasOwnProperty.call(current, 'texto');
    if (current.descartada === false && hasUnit && hasText) {
      const unit = current.unidade;
      const text = current.texto;
      if (
        (typeof unit === 'string' || typeof unit === 'number') &&
        typeof text === 'string'
      ) {
        output.push(String(unit), text);
      }
    }

    Object.values(current).forEach(visit);
  };

  visit(value);
  return output;
}

/**
 * Interpreta a saída como JSON e remove apenas objetos marcados com
 * `descatada: true` ou `descartada: true`.
 */
export function cleanExtractionAgentOutput(
  output: string,
  options: { requireJson?: boolean } = {},
): ExtractionOutputCleanup {
  const parsed = parseExtractionJsonOutput(output);
  if (!parsed) {
    if (options.requireJson) {
      throw new Error('O agente de extração não retornou um JSON válido.');
    }
    return {
      cleanedText: removeCommonMarkdown(output),
      newJson: null,
      jsonWithDiscardFalse: [],
      saida_extracao_pos_limpeza: [],
    };
  }
  const filtered = removeDiscardedObjects(parsed);
  const retained = filtered === REMOVED ? [] : filtered;
  const jsonWithDiscardFalse: string[] = [];
  collectRetainedFlaggedObjects(retained, jsonWithDiscardFalse);
  const saida_extracao_pos_limpeza = buildPostCleanupExtractionList(parsed);
  return {
    cleanedText: JSON.stringify(saida_extracao_pos_limpeza),
    newJson: JSON.stringify(retained, null, 2),
    jsonWithDiscardFalse,
    saida_extracao_pos_limpeza,
  };
}