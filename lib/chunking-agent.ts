import { GoogleGenAI } from '@google/genai';
import { getRuntimeAgent } from '@/lib/ai-agent-runtime';
import {
  tokenizeText,
  type SpacyChunkingSentence,
  type SpacySourceSegment,
  type SpacyTokenizationResult,
} from '@/lib/spacy-tokenizer';

export type ChunkingBlockReason =
  | 'marca_curso_apresentador'
  | 'rotulo_categoria_isolado'
  | 'apresentacao_pessoal'
  | 'saudacao_abertura'
  | 'sumario_indice'
  | 'agradecimentos_encerramento'
  | 'informacao_administrativa'
  | 'publicidade'
  | 'encerramento_sem_conteudo'
  | 'declaracao_conflito_interesse'
  | 'cabecalho_rodape_repetido';

export interface ChunkingBlock {
  type: 'chunk' | 'discarded';
  sentence_start: number;
  sentence_end: number;
  context?: string;
  reason?: ChunkingBlockReason | string;
  unit_ids: Array<number | string>;
  text: string;
}

export interface ChunkingResult {
  schema_version: '1.0';
  agent_key: 'chunking_agent';
  chunk_total: number;
  discarded_total: number;
  blocks: ChunkingBlock[];
}

interface RawChunkingBlock {
  tipo?: unknown;
  sentenca_id_inicio?: unknown;
  sentenca_id_fim?: unknown;
  contexto?: unknown;
  motivo?: unknown;
}

function parseAgentJson(raw: string): { blocos?: RawChunkingBlock[] } {
  const withoutFence = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error('O chunking_agent não retornou um objeto JSON.');
  }
  try {
    return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1));
  } catch {
    throw new Error('O chunking_agent retornou um JSON inválido.');
  }
}

const CHUNKING_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['blocos'],
  properties: {
    blocos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tipo', 'sentenca_id_inicio', 'sentenca_id_fim'],
        properties: {
          tipo: { type: 'string', enum: ['chunk', 'descartado'] },
          sentenca_id_inicio: { type: 'integer', minimum: 1 },
          sentenca_id_fim: { type: 'integer', minimum: 1 },
          contexto: { type: 'string' },
          motivo: {
            type: 'string',
            enum: [
              'marca_curso_apresentador',
              'rotulo_categoria_isolado',
              'apresentacao_pessoal',
              'saudacao_abertura',
              'sumario_indice',
              'agradecimentos_encerramento',
              'informacao_administrativa',
              'publicidade',
              'encerramento_sem_conteudo',
              'declaracao_conflito_interesse',
              'cabecalho_rodape_repetido',
            ],
          },
        },
      },
    },
  },
} as const;
const MAX_SENTENCES_PER_AGENT_CALL = 180;
const MIN_SENTENCES_FOR_RETRY_SPLIT = 20;

export class ChunkingAgentError extends Error {
  constructor(
    message: string,
    public readonly finishReason?: string,
  ) {
    super(message);
    this.name = 'ChunkingAgentError';
  }
}

function sentenceUnit(sentence: SpacyChunkingSentence): number | string {
  return sentence.unit_ids[0] ?? sentence.segment_ids[0] ?? 'unknown';
}

function formatSentencesForAgent(sentences: SpacyChunkingSentence[]): string {
  return sentences
    .map(
      (sentence) =>
        `[[S:${sentence.number}|U:${sentenceUnit(sentence)}]] ${sentence.text
          .replace(/\s*\n+\s*/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()}`,
    )
    .join('\n');
}

function enrichAndValidateBlocks(
  rawBlocks: RawChunkingBlock[],
  sentences: SpacyChunkingSentence[],
): ChunkingBlock[] {
  const sentenceByNumber = new Map(sentences.map((sentence) => [sentence.number, sentence]));
  const blocks = rawBlocks.map((rawBlock, index): ChunkingBlock => {
    const sentenceStart = Number(rawBlock.sentenca_id_inicio);
    const sentenceEnd = Number(rawBlock.sentenca_id_fim);
    const type =
      rawBlock.tipo === 'chunk'
        ? 'chunk'
        : rawBlock.tipo === 'descartado'
          ? 'discarded'
          : null;

    if (
      !type ||
      !Number.isInteger(sentenceStart) ||
      !Number.isInteger(sentenceEnd) ||
      sentenceStart > sentenceEnd
    ) {
      throw new Error(`Bloco ${index + 1} inválido retornado pelo chunking_agent.`);
    }

    const blockSentences: SpacyChunkingSentence[] = [];
    for (let number = sentenceStart; number <= sentenceEnd; number += 1) {
      const sentence = sentenceByNumber.get(number);
      if (!sentence) {
        throw new Error(`O chunking_agent referenciou a sentença inexistente ${number}.`);
      }
      blockSentences.push(sentence);
    }

    const context =
      typeof rawBlock.contexto === 'string' && rawBlock.contexto.trim()
        ? rawBlock.contexto.trim()
        : undefined;
    const reason =
      typeof rawBlock.motivo === 'string' && rawBlock.motivo.trim()
        ? rawBlock.motivo.trim()
        : undefined;
    if (type === 'chunk' && !context) {
      throw new Error(`O chunk ${index + 1} não contém contextualização.`);
    }
    if (type === 'discarded' && !reason) {
      throw new Error(`O bloco descartado ${index + 1} não contém motivo.`);
    }

    return {
      type,
      sentence_start: sentenceStart,
      sentence_end: sentenceEnd,
      context,
      reason,
      unit_ids: Array.from(
        new Set(
          blockSentences.flatMap((sentence) =>
            sentence.unit_ids.length > 0
              ? sentence.unit_ids
              : sentence.segment_ids.length > 0
                ? sentence.segment_ids
                : ['unknown'],
          ),
        ),
      ),
      text: blockSentences.map((sentence) => sentence.text).join(' '),
    };
  });

  const ordered = [...blocks].sort((a, b) => a.sentence_start - b.sentence_start);
  let expectedSentence = sentences[0]?.number ?? 1;
  for (const block of ordered) {
    if (block.sentence_start !== expectedSentence) {
      throw new Error(
        `Os blocos do chunking_agent têm lacuna ou sobreposição antes da sentença ${block.sentence_start}.`,
      );
    }
    expectedSentence = block.sentence_end + 1;
  }
  const finalSentence = sentences.at(-1)?.number ?? 0;
  if (expectedSentence !== finalSentence + 1) {
    throw new Error('Os blocos do chunking_agent não cobrem todas as sentenças.');
  }

  return ordered;
}

async function generateStructuredChunks(
  sentences: SpacyChunkingSentence[],
  batchNumber: number,
  batchTotal: number,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new ChunkingAgentError('GEMINI_API_KEY não configurada no servidor.');
  }
  const agent = await getRuntimeAgent('chunking_agent');
  const ai = new GoogleGenAI({ apiKey, apiVersion: 'v1beta' });
  const response = await ai.models.generateContent({
    model: agent.model,
    contents: [
      'Agrupe as sentenças numeradas conforme as instruções do sistema.',
      'Retorne somente o objeto JSON definido pelo schema.',
      `Este é o lote ${batchNumber} de ${batchTotal}; preserve os IDs globais sem renumerar.`,
      '',
      formatSentencesForAgent(sentences),
    ].join('\n'),
    config: {
      systemInstruction: agent.system_instruction,
      temperature: Math.min(agent.temperature, 0.1),
      maxOutputTokens: agent.max_output_tokens,
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: 'application/json',
      responseJsonSchema: CHUNKING_RESPONSE_SCHEMA,
    },
  });

  const candidate = response.candidates?.[0];
  const finishReason = candidate?.finishReason;
  console.info('[chunking-agent] geração concluída', {
    sentence_start: sentences[0]?.number,
    sentence_end: sentences.at(-1)?.number,
    sentence_count: sentences.length,
    finish_reason: finishReason ?? 'UNKNOWN',
    output_characters: typeof response.text === 'string' ? response.text.length : 0,
  });
  if (finishReason && finishReason !== 'STOP') {
    if (finishReason === 'MAX_TOKENS') {
      throw new ChunkingAgentError(
        'O chunking_agent atingiu o limite de saída antes de concluir o JSON. Divida a fonte em lotes menores.',
        finishReason,
      );
    }
    throw new ChunkingAgentError(
      `O chunking_agent encerrou a geração com o motivo ${finishReason}.`,
      finishReason,
    );
  }

  const text =
    typeof response.text === 'string'
      ? response.text.trim()
      : candidate?.content?.parts
          ?.map((part) => part.text)
          .filter(Boolean)
          .join('')
          .trim() ?? '';
  if (!text) {
    throw new ChunkingAgentError(
      'O chunking_agent não retornou conteúdo.',
      finishReason,
    );
  }
  return text;
}

function splitSentenceBatches(
  sentences: SpacyChunkingSentence[],
  maximumSize = MAX_SENTENCES_PER_AGENT_CALL,
): SpacyChunkingSentence[][] {
  const batches: SpacyChunkingSentence[][] = [];
  let start = 0;

  while (start < sentences.length) {
    let end = Math.min(start + maximumSize, sentences.length);
    if (end < sentences.length) {
      while (
        end > start + Math.floor(maximumSize * 0.6) &&
        sentenceUnit(sentences[end - 1]) === sentenceUnit(sentences[end])
      ) {
        end -= 1;
      }
    }
    if (end <= start) end = Math.min(start + maximumSize, sentences.length);
    batches.push(sentences.slice(start, end));
    start = end;
  }

  return batches;
}

async function processSentenceBatch(
  sentences: SpacyChunkingSentence[],
  batchNumber: number,
  batchTotal: number,
): Promise<ChunkingBlock[]> {
  try {
    const rawResponse = await generateStructuredChunks(
      sentences,
      batchNumber,
      batchTotal,
    );
    const parsed = parseAgentJson(rawResponse);
    if (!Array.isArray(parsed.blocos) || parsed.blocos.length === 0) {
      throw new Error('O chunking_agent não retornou blocos.');
    }
    return enrichAndValidateBlocks(parsed.blocos, sentences);
  } catch (error) {
    if (
      error instanceof ChunkingAgentError &&
      error.finishReason === 'MAX_TOKENS' &&
      sentences.length >= MIN_SENTENCES_FOR_RETRY_SPLIT
    ) {
      const midpoint = Math.ceil(sentences.length / 2);
      const left = sentences.slice(0, midpoint);
      const right = sentences.slice(midpoint);
      if (!left?.length || !right?.length) throw error;
      const leftBlocks = await processSentenceBatch(
        left,
        batchNumber,
        batchTotal + 1,
      );
      const rightBlocks = await processSentenceBatch(
        right,
        batchNumber + 1,
        batchTotal + 1,
      );
      return [...leftBlocks, ...rightBlocks];
    }
    throw error;
  }
}

export async function chunkTokenizedText({
  text,
  sourceType = 'text',
  segments = [],
  contentFormat = 'plain',
  tokenization: suppliedTokenization,
}: {
  text: string;
  sourceType?: string;
  segments?: SpacySourceSegment[];
  contentFormat?: 'auto' | 'plain';
  tokenization?: SpacyTokenizationResult;
}): Promise<{ tokenization: SpacyTokenizationResult; chunking: ChunkingResult }> {
  const tokenization =
    suppliedTokenization ??
    (await tokenizeText({
      text,
      sourceType,
      segments,
      contentFormat,
      view: 'sentences_text_order',
      page: 1,
      pageSize: 1000,
      includeChunkingSentences: true,
    }));
  const sentences =
    tokenization.chunking_sentences ??
    tokenization.sentences ??
    tokenization.sentences_in_text_order ??
    [];

  if (sentences.length === 0) {
    throw new Error('A spaCy não formou sentenças para enviar ao chunking_agent.');
  }

  const batches = splitSentenceBatches(sentences);
  const blocks: ChunkingBlock[] = [];
  for (let index = 0; index < batches.length; index += 1) {
    blocks.push(
      ...(await processSentenceBatch(batches[index], index + 1, batches.length)),
    );
  }
  return {
    tokenization,
    chunking: {
      schema_version: '1.0',
      agent_key: 'chunking_agent',
      chunk_total: blocks.filter((block) => block.type === 'chunk').length,
      discarded_total: blocks.filter((block) => block.type === 'discarded').length,
      blocks,
    },
  };
}