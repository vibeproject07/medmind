export interface ExtractionOutputCleanup {
  cleanedText: string;
  newJson: string | null;
  jsonWithDiscardFalse: string[];
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
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

function parseJsonOutput(output: string): JsonValue | null {
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
    return JSON.parse(withoutFence.slice(start, end + 1)) as JsonValue;
  } catch {
    return null;
  }
}

function isDiscardedObject(value: { [key: string]: JsonValue }): boolean {
  return value.descatada === true || value.descartada === true;
}

function removeDiscardedObjects(value: JsonValue): JsonValue | typeof REMOVED {
  if (Array.isArray(value)) {
    return value
      .map(removeDiscardedObjects)
      .filter((item): item is JsonValue => item !== REMOVED);
  }
  if (value && typeof value === 'object') {
    if (isDiscardedObject(value)) return REMOVED;
    const entries = Object.entries(value)
      .map(([key, child]) => [key, removeDiscardedObjects(child)] as const)
      .filter((entry): entry is readonly [string, JsonValue] => entry[1] !== REMOVED);
    return Object.fromEntries(entries) as JsonValue;
  }
  return value;
}

function collectRetainedFlaggedObjects(value: JsonValue, collected: string[]): void {
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
 * Interpreta a saída como JSON e remove apenas objetos marcados com
 * `descatada: true` ou `descartada: true`.
 */
export function cleanExtractionAgentOutput(
  output: string,
  options: { requireJson?: boolean } = {},
): ExtractionOutputCleanup {
  const parsed = parseJsonOutput(output);
  if (!parsed) {
    if (options.requireJson) {
      throw new Error('O agente de extração não retornou um JSON válido.');
    }
    return {
      cleanedText: removeCommonMarkdown(output),
      newJson: null,
      jsonWithDiscardFalse: [],
    };
  }
  const filtered = removeDiscardedObjects(parsed);
  const retained = filtered === REMOVED ? [] : filtered;
  const jsonWithDiscardFalse: string[] = [];
  collectRetainedFlaggedObjects(retained, jsonWithDiscardFalse);
  return {
    cleanedText: removeCommonMarkdown(output),
    newJson: JSON.stringify(retained, null, 2),
    jsonWithDiscardFalse,
  };
}