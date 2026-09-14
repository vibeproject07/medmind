import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalTranscriptionText,
  processExtractedSource,
  type SourceContentPipelineDependencies,
} from '../lib/source-content-pipeline';
import type {
  SpacySentence,
  SpacyTokenizationResult,
} from '../lib/spacy-tokenizer';
import {
  processWithBroadFileExtraction,
  type BroadFileExtractionDependencies,
} from '../lib/broad-file-extraction';
import {
  preparePersistedSource,
  preparePersistedTranscription,
} from '../lib/persisted-source-pipeline';
import {
  normalizeYouTubeUrl,
  processYouTubeSource,
} from '../lib/youtube-source-processing';
import {
  normalizeNoteSourceProvenance,
  provenanceFromSourceResult,
} from '../lib/note-source-provenance';
import { getAiAgentUsage } from '../lib/ai-agent-usage';
import { mapProcessingRunTexts } from '../lib/processing-run-output-mapping';

const sentences: SpacySentence[] = [
  {
    index: 0, number: 1, text: 'Primeira frase.', start_char: 0, end_char: 15,
    token_start: 0, token_end: 2, token_count: 2, tokens: ['Primeira', 'frase.'],
    start_time: null, end_time: null, segment_ids: ['page-1'], unit_ids: ['page-1'],
  },
  {
    index: 1, number: 2, text: 'Segunda frase.', start_char: 16, end_char: 30,
    token_start: 2, token_end: 4, token_count: 2, tokens: ['Segunda', 'frase.'],
    start_time: null, end_time: null, segment_ids: ['page-2'], unit_ids: ['page-2'],
  },
];

test('inactive legacy agents have no application routes', () => {
  for (const key of [
    'extrair_texto',
    'youtube_transcript',
    'ajuste_transcricao',
    'transform_base',
    'resumo_documento',
    'resumo_imagem',
    'resumo_slides_pdf',
  ]) {
    assert.deepEqual(getAiAgentUsage(key).routes, []);
  }
  assert.ok(getAiAgentUsage('broad_file_extraction').routes.length > 0);
});

test('YouTube URL normalization only accepts exact HTTPS YouTube hosts', () => {
  assert.equal(
    normalizeYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  );
  assert.equal(
    normalizeYouTubeUrl('youtube.com/watch?v=dQw4w9WgXcQ'),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  );
  assert.throws(
    () => normalizeYouTubeUrl('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'),
    /URL inválida/,
  );
  assert.throws(
    () => normalizeYouTubeUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    /HTTPS/,
  );
});

test('processing run maps media and extraction outputs to generic and dedicated columns', () => {
  const media = mapProcessingRunTexts('video', {
    originalText: 'canônica',
    pipelineText: 'pipeline',
    wholeTranscription: 'transcrição integral',
    cleanedTranscription: 'transcrição limpa',
  });
  assert.equal(media.extractionText, 'transcrição integral');
  assert.equal(media.processedText, 'transcrição limpa');
  assert.equal(media.wholeTranscription, 'transcrição integral');
  assert.equal(media.cleanedTranscription, 'transcrição limpa');

  const document = mapProcessingRunTexts('document', {
    originalText: 'texto canônico',
    pipelineText: 'pipeline',
    wholeExtractionText: '{"unidades":[]}',
    cleanedExtractionText: '{"unidades":[{"texto":"limpo"}]}',
  });
  assert.equal(document.extractionText, '{"unidades":[]}');
  assert.equal(document.processedText, '{"unidades":[{"texto":"limpo"}]}');
  assert.equal(document.wholeExtractionText, '{"unidades":[]}');
  assert.equal(document.cleanedExtractionText, '{"unidades":[{"texto":"limpo"}]}');
});

function tokenization(sourceType: string, timed = false): SpacyTokenizationResult {
  const ordered = sentences.map((sentence, index) => timed ? {
    ...sentence,
    start_time: index * 2.5,
    end_time: (index + 1) * 2.5,
    segment_ids: [index + 10],
    unit_ids: [index + 10],
  } : sentence);
  return {
    schema_version: '1.0', pipeline: 'pt_core_news_sm', language: 'pt',
    source_type: sourceType, input_character_total: 30, processed_character_total: 30,
    normalization_applied: false, offset_basis: 'input_text', processed_text: null,
    timestamp_mapping_complete: timed, spacy_token_total: 4, token_total: 4,
    sentence_total: 2, view: 'sentences_text_order', sentences: ordered,
    chunking_sentences: ordered, pagination: {}, warnings: [],
  };
}

function dependencies(sourceType: string, timed = false) {
  const calls: unknown[] = [];
  const value = tokenization(sourceType, timed);
  const deps: SourceContentPipelineDependencies = {
    tokenize: async (input) => {
      calls.push({ step: 'tokenize', input });
      return value;
    },
    chunk: async (input) => {
      calls.push({ step: 'chunk', input });
      return {
        tokenization: value,
        chunking: {
          schema_version: '1.0', agent_key: 'chunking_agent',
          chunk_total: 1, discarded_total: 0,
          blocks: [{
            type: 'chunk', sentence_start: 1, sentence_end: 2,
            context: 'conteúdo', unit_ids: value.sentences!.flatMap((s) => s.unit_ids),
            text: value.sentences!.map((s) => s.text).join(' '),
          }],
        },
      };
    },
  };
  return { deps, calls, value };
}

for (const scenario of [
  { name: 'PDF', sourceType: 'document' },
  { name: 'Word', sourceType: 'document' },
  { name: 'Slides', sourceType: 'document' },
  { name: 'imagem', sourceType: 'image' },
  { name: 'link de documento', sourceType: 'document' },
]) {
  test(`${scenario.name} preserves text and returns ordered provenance separately`, async () => {
    const text = 'Primeira frase. Segunda frase.';
    const { deps, calls, value } = dependencies(scenario.sourceType);
    const result = await processExtractedSource({ text, sourceType: scenario.sourceType }, deps);

    assert.equal(calls.length, 2);
    assert.equal((calls[0] as any).input.text, text);
    assert.equal((calls[1] as any).input.text, text);
    assert.strictEqual((calls[1] as any).input.tokenization, value);
    assert.deepEqual(
      result.tokenization?.sentences_in_text_order.map((s) => ({
        text: s.text, start: s.start_char, end: s.end_char, units: s.unit_ids,
      })),
      [
        { text: 'Primeira frase.', start: 0, end: 15, units: ['page-1'] },
        { text: 'Segunda frase.', start: 16, end: 30, units: ['page-2'] },
      ],
    );
    assert.equal(result.chunking?.blocks[0].text, 'Primeira frase. Segunda frase.');
  });
}

for (const scenario of [
  { name: 'áudio', sourceType: 'audio', video: false },
  { name: 'vídeo', sourceType: 'video', video: true },
  { name: 'link de mídia', sourceType: 'audio', video: false },
]) {
  test(`${scenario.name} keeps segment order and timestamps through chunking`, async () => {
    const segments = [
      { id: 10, start: 0, end: 2.5, text: ' Primeira frase. ', part: 1 },
      { id: 11, start: 2.5, end: 5, text: 'Segunda frase.', part: 2 },
    ];
    const text = canonicalTranscriptionText({
      segments, rawText: 'Primeira frase. Segunda frase.', text: 'texto com minutagens',
    });
    const { deps, calls } = dependencies(scenario.sourceType, true);
    const result = await processExtractedSource({
      text, sourceType: scenario.sourceType, segments,
    }, deps);

    assert.equal(text, 'Primeira frase. Segunda frase.');
    assert.deepEqual((calls[0] as any).input.segments, segments);
    assert.deepEqual(
      result.tokenization?.sentences_in_text_order.map((s) => [
        s.number, s.start_time, s.end_time, s.segment_ids, s.unit_ids,
      ]),
      [
        [1, 0, 2.5, [10], [10]],
        [2, 2.5, 5, [11], [11]],
      ],
    );
  });
}

test('tokenizer failure is reported without changing extracted content', async () => {
  const text = 'Conteúdo insubstituível.';
  const result = await processExtractedSource({ text, sourceType: 'image' }, {
    tokenize: async () => { throw new Error('spaCy indisponível'); },
    chunk: async () => { throw new Error('não deveria executar'); },
  });
  assert.deepEqual(result, { tokenization_error: 'spaCy indisponível' });
  assert.equal(text, 'Conteúdo insubstituível.');
});

test('chunking failure keeps tokenization, sentences and provenance', async () => {
  const value = tokenization('document');
  const result = await processExtractedSource(
    { text: 'Primeira frase. Segunda frase.', sourceType: 'document' },
    {
      tokenize: async () => value,
      chunk: async () => { throw new Error('agente de chunking indisponível'); },
    },
  );
  assert.equal(result.chunking, undefined);
  assert.equal(result.chunking_error, 'agente de chunking indisponível');
  assert.deepEqual(result.tokenization?.sentences_in_text_order, sentences);
});

test('partial media segments never replace the complete raw transcript', () => {
  assert.equal(
    canonicalTranscriptionText({
      segments: [{ id: 1, start: 0, end: 1, text: 'Trecho parcial.' }],
      rawText: 'Trecho parcial. Continuação que não possui segmento.',
      text: '[00:00:00] Trecho parcial.',
    }),
    'Trecho parcial. Continuação que não possui segmento.',
  );
});

test('summary exposes provenance beyond the first tokenizer page', async () => {
  const first = tokenization('document');
  const allSentences = Array.from({ length: 1001 }, (_, index) => ({
    ...sentences[0],
    index,
    number: index + 1,
    text: `Frase ${index + 1}.`,
    start_char: index * 10,
    end_char: index * 10 + 9,
    unit_ids: [`page-${Math.floor(index / 10) + 1}`],
    segment_ids: [`page-${Math.floor(index / 10) + 1}`],
  }));
  first.sentence_total = allSentences.length;
  first.sentences = allSentences.slice(0, 1000);
  first.chunking_sentences = allSentences;

  const result = await processExtractedSource(
    { text: 'fonte longa', sourceType: 'document' },
    {
      tokenize: async () => first,
      chunk: async () => ({
        tokenization: first,
        chunking: {
          schema_version: '1.0',
          agent_key: 'chunking_agent',
          chunk_total: 1,
          discarded_total: 0,
          blocks: [],
        },
      }),
    },
  );
  assert.equal(result.tokenization?.sentences_in_text_order.length, 1001);
  assert.equal(result.tokenization?.sentences_in_text_order[1000].number, 1001);
  assert.deepEqual(result.tokenization?.sentences_in_text_order[1000].unit_ids, ['page-101']);
  assert.equal(result.tokenization?.sentences_in_text_order[1000].token_start, 0);
  assert.equal(result.tokenization?.sentences_in_text_order[1000].token_end, 2);
});

function broadDependencies(
  extractedText: string,
  transformedText = 'Síntese auxiliar.',
): { dependencies: BroadFileExtractionDependencies; processed: Array<{ text: string; sourceType: string }> } {
  const processed: Array<{ text: string; sourceType: string }> = [];
  const dependencies: BroadFileExtractionDependencies = {
    extractDocx: async () => extractedText,
    extractPptx: async () => extractedText,
    transformExtractedText: async () => transformedText,
    processNativeDocument: async () => JSON.stringify({
      tipo_fonte: 'documento',
      numeracao_inferida: false,
      unidades: [{
        unidade: 1,
        descartada: false,
        motivo_descarte: null,
        texto: extractedText,
      }],
    }),
    processExtracted: async (input) => {
      processed.push({ text: input.text, sourceType: input.sourceType });
      return { tokenization: summarizeForIntegration(input.sourceType) };
    },
  };
  return { dependencies, processed };
}

function summarizeForIntegration(
  sourceType: string,
  value = tokenization(sourceType),
) {
  return {
    schema_version: value.schema_version,
    pipeline: value.pipeline,
    language: value.language,
    source_type: value.source_type,
    input_character_total: value.input_character_total,
    processed_character_total: value.processed_character_total,
    normalization_applied: value.normalization_applied,
    offset_basis: value.offset_basis,
    timestamp_mapping_complete: value.timestamp_mapping_complete,
    spacy_token_total: value.spacy_token_total,
    token_total: value.token_total,
    sentence_total: value.sentence_total,
    sentences_in_text_order: value.chunking_sentences!,
    pagination: value.pagination,
    warnings: value.warnings,
  };
}

for (const fixture of [
  {
    name: 'Word',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sourceType: 'document',
    local: true,
  },
  {
    name: 'Slides',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    sourceType: 'document',
    local: true,
  },
  { name: 'PDF', mime: 'application/pdf', sourceType: 'document', local: false },
  { name: 'imagem', mime: 'image/png', sourceType: 'image', local: false },
]) {
  test(`${fixture.name} real extraction boundary preserves source before enrichment`, async () => {
    const extracted = 'Primeira frase. Segunda frase.';
    const { dependencies, processed } = broadDependencies(extracted);
    const result = await processWithBroadFileExtraction(
      Buffer.from('fixture'),
      fixture.mime,
      dependencies,
    );
    assert.equal(result.text, extracted);
    assert.equal(processed[0].text, extracted);
    assert.equal(processed[0].sourceType, fixture.sourceType);
    if (fixture.local) {
      assert.equal(result.originalText, extracted);
      assert.equal(result.wholeExtractionText, extracted);
      assert.equal(result.transformedText, 'Síntese auxiliar.');
    } else {
      assert.equal(result.originalText, extracted);
      assert.match(result.transformedText ?? '', /Primeira frase\. Segunda frase\./);
    }
  });
}

test('local document keeps extracted text when optional transformation fails', async () => {
  const extracted = 'Texto bruto que deve sobreviver.';
  const { dependencies, processed } = broadDependencies(extracted);
  dependencies.transformExtractedText = async () => {
    throw new Error('Gemini indisponível');
  };
  const result = await processWithBroadFileExtraction(
    Buffer.from('docx'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    dependencies,
  );
  assert.equal(result.text, extracted);
  assert.equal(result.originalText, extracted);
  assert.equal(result.transformation_error, 'Gemini indisponível');
  assert.equal(processed[0].text, extracted);
});

test('native PDF and image use only the active broad extraction agent', async () => {
  for (const mimeType of ['application/pdf', 'image/png']) {
    const calls: string[] = [];
    const { dependencies } = broadDependencies('Texto fiel.');
    dependencies.processNativeDocument = async ({ agentKey }) => {
      calls.push(agentKey);
      return JSON.stringify({
        tipo_fonte: 'documento',
        numeracao_inferida: false,
        unidades: [{
          unidade: 1,
          descartada: false,
          motivo_descarte: null,
          texto: 'Texto fiel.',
        }],
      });
    };
    const result = await processWithBroadFileExtraction(
      Buffer.from('native'),
      mimeType,
      dependencies,
    );
    assert.deepEqual(calls, ['broad_file_extraction']);
    assert.equal(result.originalText, 'Texto fiel.');
    assert.equal(result.text, 'Texto fiel.');
    assert.match(result.transformedText ?? '', /Texto fiel/);
  }
});

test('native broad extraction failure never invents original text', async () => {
  const { dependencies, processed } = broadDependencies('ignorado');
  dependencies.processNativeDocument = async () => {
    throw new Error('Extração indisponível');
  };
  await assert.rejects(
    processWithBroadFileExtraction(
      Buffer.from('pdf'),
      'application/pdf',
      dependencies,
    ),
    /Extração indisponível/,
  );
  assert.equal(processed.length, 0);
});

test('persisted media keeps complete raw text, segments and sentence timestamps', async () => {
  const rawText = 'Trecho segmentado. Continuação sem segmento.';
  const segments = [{ id: 7, start: 1.5, end: 3.25, text: 'Trecho segmentado.', part: 1 }];
  const value = tokenization('video', true);
  const output = await preparePersistedSource(
    {
      originalText: rawText,
      sourceType: 'video',
      segments,
      transform: async () => 'Resumo separado.',
    },
    async (input) => {
      assert.equal(input.text, rawText);
      assert.deepEqual(input.segments, segments);
      return {
        tokenization: summarizeForIntegration(value.source_type, value),
      };
    },
  );
  assert.equal(output.originalText, rawText);
  assert.equal(output.result, 'Resumo separado.');
  assert.deepEqual(output.provenance.segments, segments);
  assert.equal(
    output.provenance.tokenization?.sentences_in_text_order[0].start_time,
    0,
  );
});

test('persisted source survives optional transformation failure with provenance', async () => {
  const output = await preparePersistedSource(
    {
      originalText: 'Fonte canônica.',
      sourceType: 'document',
      transform: async () => { throw new Error('transformador indisponível'); },
    },
    async () => ({ chunking_error: 'chunking indisponível' }),
  );
  assert.equal(output.originalText, 'Fonte canônica.');
  assert.equal(output.result, 'Fonte canônica.');
  assert.equal(output.provenance.transformation_error, 'transformador indisponível');
  assert.equal(output.provenance.chunking_error, 'chunking indisponível');
});

test('persisted transcription boundary never replaces complete raw text with partial segments', async () => {
  const output = await preparePersistedTranscription(
    {
      transcription: {
        text: '[00:00:00] Trecho segmentado.',
        rawText: 'Trecho segmentado. Continuação completa.',
        segments: [{ id: 1, start: 0, end: 2, text: 'Trecho segmentado.' }],
      },
      sourceType: 'audio',
    },
    async (input) => {
      assert.equal(input.text, 'Trecho segmentado. Continuação completa.');
      return {};
    },
  );
  assert.equal(output.originalText, 'Trecho segmentado. Continuação completa.');
  assert.deepEqual(output.provenance.segments, [
    { id: 1, start: 0, end: 2, text: 'Trecho segmentado.' },
  ]);
});

test('YouTube boundary returns canonical extraction and enrichment separately', async () => {
  const result = await processYouTubeSource(
    'https://www.youtube.com/watch?v=fixture',
    {
      transcribe: async (url) => {
        assert.equal(url, 'https://www.youtube.com/watch?v=fixture');
        return 'Transcrição integral do vídeo.';
      },
      process: async (input) => {
        assert.equal(input.text, 'Transcrição integral do vídeo.');
        assert.equal(input.sourceType, 'video');
        return { chunking_error: 'auxiliar indisponível' };
      },
    },
  );
  assert.equal(result.rawText, 'Transcrição integral do vídeo.');
  assert.equal(result.text, 'Transcrição integral do vídeo.');
  assert.equal(result.chunking_error, 'auxiliar indisponível');
});

test('external-link provenance survives note payload serialization and reload', () => {
  const timed = tokenization('video', true);
  const provenance = provenanceFromSourceResult(
    {
      sourceType: 'video',
      filename: 'aula.mp4',
      segments: [{ id: 10, start: 0, end: 2.5, text: 'Primeira frase.' }],
      duration: 2.5,
      tokenization: summarizeForIntegration('video', timed),
      chunking_error: 'agente temporariamente indisponível',
    },
    'https://example.test/aula.mp4',
  );
  const reloaded = normalizeNoteSourceProvenance(
    JSON.parse(JSON.stringify(provenance)),
  );
  assert.equal(reloaded?.sourceReference, 'https://example.test/aula.mp4');
  assert.deepEqual(reloaded?.segments, [
    { id: 10, start: 0, end: 2.5, text: 'Primeira frase.' },
  ]);
  assert.deepEqual(
    reloaded?.tokenization?.sentences_in_text_order.map((sentence) => [
      sentence.start_char,
      sentence.end_char,
      sentence.start_time,
      sentence.end_time,
      sentence.unit_ids,
    ]),
    [
      [0, 15, 0, 2.5, [10]],
      [16, 30, 2.5, 5, [11]],
    ],
  );
  assert.equal(reloaded?.chunking_error, 'agente temporariamente indisponível');
});

test('note creation rejects malformed source provenance', () => {
  assert.throws(
    () => normalizeNoteSourceProvenance({ segments: [] }),
    /não informa o tipo/,
  );
  assert.throws(
    () => normalizeNoteSourceProvenance(['não', 'é', 'objeto']),
    /deve ser um objeto/,
  );
});