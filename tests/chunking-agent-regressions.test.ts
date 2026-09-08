import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChunkingAgentError,
  chunkingAgentTestUtils,
} from '../lib/chunking-agent';
import type { SpacyChunkingSentence } from '../lib/spacy-tokenizer';

function sentences(
  total: number,
  unitFor: (number: number) => Array<number | string> = (number) => [
    `paragraph:${number}`,
  ],
): SpacyChunkingSentence[] {
  return Array.from({ length: total }, (_, index) => {
    const number = index + 1;
    return {
      index,
      number,
      text: `Conteúdo médico confidencial ${number}.`,
      start_char: index * 10,
      end_char: index * 10 + 9,
      token_count: 4,
      start_time: null,
      end_time: null,
      segment_ids: [],
      unit_ids: unitFor(number),
    };
  });
}

function oneChunk(start: number, end: number): string {
  return JSON.stringify({
    blocos: [
      {
        tipo: 'chunk',
        sentenca_id_inicio: start,
        sentenca_id_fim: end,
        contexto: `Contexto ${start}-${end}`,
      },
    ],
  });
}

test('subdivides MAX_TOKENS recursively without losing sentences', async () => {
  const input = sentences(80);
  const calls: Array<[number, number]> = [];
  const blocks = await chunkingAgentTestUtils.processSentenceBatch(
    input,
    1,
    1,
    async (batch) => {
      const range: [number, number] = [
        batch[0].number,
        batch[batch.length - 1].number,
      ];
      calls.push(range);
      if (batch.length >= 40) {
        throw new ChunkingAgentError('truncated', 'MAX_TOKENS');
      }
      return oneChunk(...range);
    },
  );

  assert.deepEqual(calls, [
    [1, 80],
    [1, 40],
    [1, 20],
    [21, 40],
    [41, 80],
    [41, 60],
    [61, 80],
  ]);
  assert.deepEqual(
    blocks.map((block) => [block.sentence_start, block.sentence_end]),
    [
      [1, 20],
      [21, 40],
      [41, 60],
      [61, 80],
    ],
  );
  assert.deepEqual(
    blocks.flatMap((block) =>
      Array.from(
        { length: block.sentence_end - block.sentence_start + 1 },
        (_, index) => block.sentence_start + index,
      ),
    ),
    Array.from({ length: 80 }, (_, index) => index + 1),
  );
});

test('moves a batch boundary to the start of the next unit when possible', () => {
  const input = sentences(250, (number) => [
    number <= 150 ? 'unit:a' : 'unit:b',
  ]);
  const batches = chunkingAgentTestUtils.splitSentenceBatches(input, 180);

  assert.deepEqual(
    batches.map((batch) => [batch[0].number, batch.at(-1)?.number]),
    [
      [1, 150],
      [151, 250],
    ],
  );
});

test('keeps the configured batch size when an oversized unit must be split', () => {
  const input = sentences(220, () => ['unit:oversized']);
  const batches = chunkingAgentTestUtils.splitSentenceBatches(input, 180);

  assert.deepEqual(
    batches.map((batch) => batch.length),
    [180, 40],
  );
});

test('rejects gaps, overlaps, and nonexistent sentence references', () => {
  const input = sentences(5);
  const validate = chunkingAgentTestUtils.enrichAndValidateBlocks;

  assert.throws(
    () =>
      validate(
        [
          {
            tipo: 'chunk',
            sentenca_id_inicio: 1,
            sentenca_id_fim: 2,
            contexto: 'Primeiro',
          },
          {
            tipo: 'chunk',
            sentenca_id_inicio: 4,
            sentenca_id_fim: 5,
            contexto: 'Segundo',
          },
        ],
        input,
      ),
    /lacuna ou sobreposição/,
  );
  assert.throws(
    () =>
      validate(
        [
          {
            tipo: 'chunk',
            sentenca_id_inicio: 1,
            sentenca_id_fim: 3,
            contexto: 'Primeiro',
          },
          {
            tipo: 'chunk',
            sentenca_id_inicio: 3,
            sentenca_id_fim: 5,
            contexto: 'Segundo',
          },
        ],
        input,
      ),
    /lacuna ou sobreposição/,
  );
  assert.throws(
    () =>
      validate(
        [
          {
            tipo: 'chunk',
            sentenca_id_inicio: 1,
            sentenca_id_fim: 6,
            contexto: 'Inválido',
          },
        ],
        input,
      ),
    /sentença inexistente 6/,
  );
});

test('preserves the complete union of source units in each block', () => {
  const input = sentences(3, (number) =>
    number === 2 ? ['segment:1', 'segment:2'] : [`segment:${number}`],
  );
  const [block] = chunkingAgentTestUtils.enrichAndValidateBlocks(
    [
      {
        tipo: 'chunk',
        sentenca_id_inicio: 1,
        sentenca_id_fim: 3,
        contexto: 'Contexto completo',
      },
    ],
    input,
  );

  assert.deepEqual(block.unit_ids, ['segment:1', 'segment:2', 'segment:3']);
});

test('the production generation path logs metadata but never medical contents', async () => {
  const input = sentences(2);
  const logged: unknown[][] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => logged.push(args);
  try {
    const responseText = JSON.stringify({
      blocos: [
        {
          tipo: 'chunk',
          sentenca_id_inicio: 1,
          sentenca_id_fim: 2,
          contexto: 'Contexto médico confidencial',
        },
      ],
    });
    const generated = await chunkingAgentTestUtils.generateStructuredChunks(
      input,
      1,
      1,
      {
        getAgent: async () => ({
          key: 'chunking_agent',
          system_instruction: 'Instrução confidencial',
          system_prompt: '',
          model: 'fake-model',
          temperature: 0.1,
          max_output_tokens: 1000,
        }),
        generateContent: async () => ({
          text: responseText,
          candidates: [{ finishReason: 'STOP' }],
        }),
      },
    );
    assert.equal(generated, responseText);
  } finally {
    console.info = originalInfo;
  }

  const serialized = JSON.stringify(logged);
  assert.match(serialized, /sentence_count/);
  assert.match(serialized, /STOP/);
  assert.doesNotMatch(serialized, /Conteúdo médico confidencial/);
  assert.doesNotMatch(serialized, /Contexto médico confidencial/);
  assert.doesNotMatch(serialized, /Instrução confidencial/);
});