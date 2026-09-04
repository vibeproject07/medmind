import { geminiTransformTranscription } from '@/lib/gemini';
import {
  tokenizeText,
  type SpacySentence,
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

function sentenceUnit(sentence: SpacySentence): number | string {
  return sentence.segment_ids[0] ?? 1;
}

function formatSentencesForAgent(sentences: SpacySentence[]): string {
  return sentences
    .map(
      (sentence) =>
        `[[S:${sentence.number}|U:${sentenceUnit(sentence)}]] ${sentence.text.trim()}`,
    )
    .join('\n');
}

async function loadAllSentences({
  text,
  sourceType,
  segments,
  contentFormat,
}: {
  text: string;
  sourceType: string;
  segments: SpacySourceSegment[];
  contentFormat: 'auto' | 'plain';
}): Promise<SpacySentence[]> {
  const sentences: SpacySentence[] = [];
  let page = 1;

  while (true) {
    const result = await tokenizeText({
      text,
      sourceType,
      segments,
      contentFormat,
      view: 'sentences_text_order',
      page,
      pageSize: 1000,
    });
    sentences.push(...(result.sentences ?? result.sentences_in_text_order ?? []));
    const pagination = result.pagination.sentences;
    if (!pagination?.has_more) break;
    page += 1;
  }

  return sentences;
}

function enrichAndValidateBlocks(
  rawBlocks: RawChunkingBlock[],
  sentences: SpacySentence[],
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

    const blockSentences: SpacySentence[] = [];
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
      unit_ids: Array.from(new Set(blockSentences.map(sentenceUnit))),
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

export async function chunkTokenizedText({
  text,
  sourceType = 'text',
  segments = [],
  contentFormat = 'plain',
}: {
  text: string;
  sourceType?: string;
  segments?: SpacySourceSegment[];
  contentFormat?: 'auto' | 'plain';
}): Promise<{ tokenization: SpacyTokenizationResult; chunking: ChunkingResult }> {
  const tokenization = await tokenizeText({
    text,
    sourceType,
    segments,
    contentFormat,
    view: 'sentences_text_order',
    page: 1,
    pageSize: 1000,
  });
  const firstPage = tokenization.sentences ?? tokenization.sentences_in_text_order ?? [];
  const pagination = tokenization.pagination.sentences;
  const sentences = pagination?.has_more
    ? await loadAllSentences({ text, sourceType, segments, contentFormat })
    : firstPage;

  if (sentences.length === 0) {
    throw new Error('A spaCy não formou sentenças para enviar ao chunking_agent.');
  }

  const rawResponse = await geminiTransformTranscription({
    transcription: formatSentencesForAgent(sentences),
    instruction:
      'Agrupe as sentenças numeradas em chunks conforme as instruções do sistema e retorne somente o JSON obrigatório.',
    agentKey: 'chunking_agent',
  });
  const parsed = parseAgentJson(rawResponse);
  if (!Array.isArray(parsed.blocos) || parsed.blocos.length === 0) {
    throw new Error('O chunking_agent não retornou blocos.');
  }

  const blocks = enrichAndValidateBlocks(parsed.blocos, sentences);
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