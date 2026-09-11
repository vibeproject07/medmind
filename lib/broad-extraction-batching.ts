import { PDFDocument } from 'pdf-lib';
import {
  GeminiGenerationError,
  geminiProcessDocument,
  geminiTransformTranscription,
} from '@/lib/gemini';
import {
  parseExtractionJsonOutput,
  type ExtractionJsonValue,
} from '@/lib/immediate-agent-output-cleaners';

type ExtractionUnit = {
  unidade: number;
  descartada: boolean;
  motivo_descarte: string | null;
  texto: string;
  [key: string]: ExtractionJsonValue;
};

type ExtractionDocument = {
  tipo_fonte: string;
  numeracao_inferida: boolean;
  unidades: ExtractionUnit[];
  [key: string]: ExtractionJsonValue;
};

type BatchGenerator<T> = (items: T[]) => Promise<string>;

class ExtractionBatchFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionBatchFormatError';
  }
}

const PDF_BATCH_PAGES = 8;
const TEXT_BATCH_CHARACTERS = 40_000;
const MIN_TEXT_BATCH_CHARACTERS = 2_000;

export const EXTRACTION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    tipo_fonte: { type: 'string' },
    numeracao_inferida: { type: 'boolean' },
    unidades: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          unidade: { type: 'integer' },
          descartada: { type: 'boolean' },
          motivo_descarte: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
          },
          texto: { type: 'string' },
        },
        required: ['unidade', 'descartada', 'motivo_descarte', 'texto'],
      },
    },
  },
  required: ['tipo_fonte', 'numeracao_inferida', 'unidades'],
} as const;

function parseAndValidateBatch(output: string): ExtractionDocument {
  const parsed = parseExtractionJsonOutput(output);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new ExtractionBatchFormatError(
      'O lote do agente de extração não retornou um objeto JSON válido.',
    );
  }
  if (!Array.isArray(parsed.unidades) || parsed.unidades.length === 0) {
    throw new ExtractionBatchFormatError(
      'O lote do agente de extração não retornou unidades.',
    );
  }
  const units = parsed.unidades.map((raw, index): ExtractionUnit => {
    if (!raw || Array.isArray(raw) || typeof raw !== 'object') {
      throw new ExtractionBatchFormatError(
        `A unidade ${index + 1} do lote não é um objeto.`,
      );
    }
    const number = Number(raw.unidade);
    const discarded = raw.descartada ?? raw.descatada;
    if (!Number.isInteger(number) || number <= 0) {
      throw new ExtractionBatchFormatError(
        `A unidade ${index + 1} não possui numeração válida.`,
      );
    }
    if (typeof discarded !== 'boolean') {
      throw new ExtractionBatchFormatError(
        `A unidade ${number} não possui descartada como booleano.`,
      );
    }
    if (typeof raw.texto !== 'string') {
      throw new ExtractionBatchFormatError(
        `A unidade ${number} não possui texto como string.`,
      );
    }
    return {
      ...raw,
      unidade: number,
      descartada: discarded,
      motivo_descarte:
        raw.motivo_descarte == null ? null : String(raw.motivo_descarte),
      texto: raw.texto,
    };
  });
  return {
    ...parsed,
    tipo_fonte: String(parsed.tipo_fonte ?? 'documento'),
    numeracao_inferida: Boolean(parsed.numeracao_inferida),
    unidades: units,
  };
}

async function generateWithRecursiveSplit<T>(
  items: T[],
  generate: BatchGenerator<T>,
  minimumItems = 1,
): Promise<ExtractionDocument[]> {
  try {
    return [parseAndValidateBatch(await generate(items))];
  } catch (error) {
    const retryable =
      error instanceof ExtractionBatchFormatError ||
      (error instanceof GeminiGenerationError && error.finishReason === 'MAX_TOKENS');
    if (!retryable) throw error;
    if (items.length <= minimumItems) {
      if (error instanceof GeminiGenerationError && error.finishReason === 'MAX_TOKENS') {
        throw new Error('Uma unidade isolada excedeu o limite de saída do agente de extração.');
      }
      throw error;
    }
    const midpoint = Math.ceil(items.length / 2);
    const left = items.slice(0, midpoint);
    const right = items.slice(midpoint);
    return [
      ...(await generateWithRecursiveSplit(left, generate, minimumItems)),
      ...(await generateWithRecursiveSplit(right, generate, minimumItems)),
    ];
  }
}

async function generateTextWithRecursiveSplit(
  text: string,
  generate: (text: string) => Promise<string>,
): Promise<ExtractionDocument[]> {
  try {
    return [parseAndValidateBatch(await generate(text))];
  } catch (error) {
    const retryable =
      error instanceof ExtractionBatchFormatError ||
      (error instanceof GeminiGenerationError && error.finishReason === 'MAX_TOKENS');
    if (!retryable) throw error;
    if (text.length <= MIN_TEXT_BATCH_CHARACTERS) throw error;
    const midpoint = Math.floor(text.length / 2);
    const preferredBreak = text.lastIndexOf('\n', midpoint);
    const splitAt = preferredBreak >= MIN_TEXT_BATCH_CHARACTERS
      ? preferredBreak
      : midpoint;
    const left = text.slice(0, splitAt);
    const right = text.slice(splitAt);
    if (!left || !right) throw error;
    return [
      ...(await generateTextWithRecursiveSplit(left, generate)),
      ...(await generateTextWithRecursiveSplit(right, generate)),
    ];
  }
}

function mergeDocuments(
  documents: ExtractionDocument[],
  renumber: boolean,
): ExtractionDocument {
  if (documents.length === 0) {
    throw new Error('Nenhum lote de extração foi produzido.');
  }
  const units = documents.flatMap((document) => document.unidades);
  if (units.length === 0) throw new Error('A extração não produziu unidades.');
  const normalizedUnits = renumber
    ? units.map((unit, index) => ({ ...unit, unidade: index + 1 }))
    : units;
  const numbers = normalizedUnits.map((unit) => unit.unidade);
  if (new Set(numbers).size !== numbers.length) {
    throw new Error('A união dos lotes produziu unidades duplicadas.');
  }
  return {
    ...documents[0],
    numeracao_inferida: documents.some((document) => document.numeracao_inferida),
    unidades: normalizedUnits.sort((left, right) => left.unidade - right.unidade),
  };
}

function batchItems<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function splitText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    if (text.length - start <= TEXT_BATCH_CHARACTERS) {
      chunks.push(text.slice(start));
      break;
    }
    const maximumEnd = start + TEXT_BATCH_CHARACTERS;
    const paragraphBreak = text.lastIndexOf('\n\n', maximumEnd);
    const whitespaceBreak = text.lastIndexOf(' ', maximumEnd);
    const naturalBreak = Math.max(
      paragraphBreak >= start ? paragraphBreak + 2 : -1,
      whitespaceBreak,
    );
    const end = naturalBreak > start + Math.floor(TEXT_BATCH_CHARACTERS * 0.6)
      ? naturalBreak
      : maximumEnd;
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function textBatchInstruction(batchNumber: number, total: number): string {
  return [
    `Este é o lote ${batchNumber} de ${total}.`,
    'Retorne somente JSON compatível com o schema fornecido.',
    'Não use cercas Markdown.',
    'Inclua todo o conteúdo recebido, sem interromper a resposta.',
  ].join(' ');
}

export async function extractTextInBatches(text: string): Promise<string> {
  const chunks = splitText(text);
  const documents: ExtractionDocument[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const pieces = await generateTextWithRecursiveSplit(
      chunk,
      async (part) =>
        geminiTransformTranscription({
          transcription: part,
          instruction: textBatchInstruction(index + 1, chunks.length),
          agentKey: 'broad_file_extraction',
          responseMimeType: 'application/json',
          responseJsonSchema: EXTRACTION_RESPONSE_SCHEMA,
        }),
      );
    documents.push(...pieces);
  }
  return JSON.stringify(mergeDocuments(documents, true), null, 2);
}

async function createPdfBatch(buffer: Buffer, pageNumbers: number[]): Promise<Buffer> {
  const source = await PDFDocument.load(buffer);
  const target = await PDFDocument.create();
  const copied = await target.copyPages(
    source,
    pageNumbers.map((number) => number - 1),
  );
  copied.forEach((page) => target.addPage(page));
  return Buffer.from(await target.save());
}

export async function extractPdfInBatches(buffer: Buffer): Promise<string> {
  const source = await PDFDocument.load(buffer);
  const pageNumbers = Array.from({ length: source.getPageCount() }, (_, index) => index + 1);
  if (pageNumbers.length === 0) throw new Error('O PDF não possui páginas.');
  const documents: ExtractionDocument[] = [];
  for (const initialBatch of batchItems(pageNumbers, PDF_BATCH_PAGES)) {
    const pieces = await generateWithRecursiveSplit(initialBatch, async (pages) => {
      const batchPdf = await createPdfBatch(buffer, pages);
      const first = pages[0];
      const last = pages[pages.length - 1];
      const output = await geminiProcessDocument({
        file: batchPdf,
        mimeType: 'application/pdf',
        agentKey: 'broad_file_extraction',
        additionalInstruction: [
          `Este arquivo contém as páginas originais ${first} a ${last}.`,
          `Use os números originais ${first} a ${last} no campo unidade.`,
          'Retorne exatamente uma unidade para cada página, mesmo quando descartada.',
          'Retorne somente JSON compatível com o schema, sem cercas Markdown.',
        ].join(' '),
        responseMimeType: 'application/json',
        responseJsonSchema: EXTRACTION_RESPONSE_SCHEMA,
      });
      const parsed = parseAndValidateBatch(output);
      const returned = new Set(parsed.unidades.map((unit) => unit.unidade));
      const missing = pages.filter((page) => !returned.has(page));
      const outside = parsed.unidades.filter((unit) => !pages.includes(unit.unidade));
      const duplicates = returned.size !== parsed.unidades.length;
      if (missing.length > 0 || outside.length > 0 || duplicates) {
        throw new ExtractionBatchFormatError(
          `O lote ${first}-${last} não cobriu exatamente as páginas solicitadas.`,
        );
      }
      return output;
    });
    documents.push(...pieces);
  }
  return JSON.stringify(mergeDocuments(documents, false), null, 2);
}

export async function extractImageAsJson(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  return geminiProcessDocument({
    file: buffer,
    mimeType,
    agentKey: 'broad_file_extraction',
    additionalInstruction:
      'Retorne somente JSON compatível com o schema fornecido, sem cercas Markdown.',
    responseMimeType: 'application/json',
    responseJsonSchema: EXTRACTION_RESPONSE_SCHEMA,
  });
}

export const broadExtractionBatchTestUtils = {
  generateWithRecursiveSplit,
  generateTextWithRecursiveSplit,
  mergeDocuments,
  parseAndValidateBatch,
  splitText,
  createPdfBatch,
  MIN_TEXT_BATCH_CHARACTERS,
};