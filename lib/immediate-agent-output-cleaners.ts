export interface ExtractionOutputCleanup {
  cleanedText: string;
  jsonWithDiscardFalse: string[];
}

const TIMESTAMP = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?`;
const BRACKETED_TIMESTAMP = new RegExp(
  String.raw`[\[(<][ \t]*${TIMESTAMP}(?:[ \t]*(?:-->|-|–|—|até)[ \t]*${TIMESTAMP})?[ \t]*[\])>]`,
  'giu',
);
const SRT_TIMESTAMP_LINE = new RegExp(
  String.raw`^[ \t]*${TIMESTAMP}[ \t]*-->[ \t]*${TIMESTAMP}(?:[ \t]+[^\r\n]*)?$`,
  'gimu',
);
const LEADING_TIMESTAMP = new RegExp(
  String.raw`^[ \t]*${TIMESTAMP}(?:[ \t]*(?:-->|-|–|—|até)[ \t]*${TIMESTAMP})?[ \t]*(?:[-–—:|][ \t]*)?`,
  'gimu',
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
    .replace(/^\s*\d+\s*$/gmu, '')
    .replace(/^[ \t]+/gmu, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function removeCommonMarkdown(output: string): string {
  return output
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*```(?:json|jsonc|javascript|js|markdown|md|text)?\s*$/gimu, '')
    .replace(/!\[([^\]]*)\]\([^)\n]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)\n]+\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(/^\s{0,3}>\s?/gmu, '')
    .replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/gmu, '')
    .replace(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gmu, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function containsDiscardFalse(candidate: string): boolean {
  return (
    /(?:^|[,{;\[])\s*["']?descarte["']?\s*:\s*(?:false|falso)\s*;?/iu.test(candidate) ||
    /\[\s*descarte\s*:\s*(?:false|falso)\s*;?\s*\]/iu.test(candidate)
  );
}

/**
 * Extrai objetos delimitados por chaves, respeitando strings e escapes. Objetos
 * aninhados também são considerados individualmente e a lista final é deduplicada.
 */
function collectJsonObjectsWithDiscardFalse(output: string): string[] {
  const starts: number[] = [];
  const matches: string[] = [];
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < output.length; index += 1) {
    const character = output[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '{') {
      starts.push(index);
    } else if (character === '}' && starts.length > 0) {
      const start = starts.pop()!;
      const candidate = output.slice(start, index + 1).trim();
      if (containsDiscardFalse(candidate)) matches.push(candidate);
    }
  }

  return Array.from(new Set(matches));
}

/**
 * Limpa Markdown da saída imediata da extração e lista todos os objetos JSON ou
 * pseudo-JSON que marcam `descarte` como FALSE/FALSO.
 */
export function cleanExtractionAgentOutput(output: string): ExtractionOutputCleanup {
  const jsonWithDiscardFalse = collectJsonObjectsWithDiscardFalse(output);
  return {
    cleanedText: removeCommonMarkdown(output),
    jsonWithDiscardFalse,
  };
}