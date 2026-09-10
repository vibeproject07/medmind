import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanExtractionAgentOutput,
  cleanTranscriptionAgentOutput,
} from '../lib/immediate-agent-output-cleaners';

test('remove minutagens em colchetes sem remover o conteúdo transcrito', () => {
  const output = [
    '[00:00:03 - 00:00:08] Primeira fala.',
    '[12:45] Segunda fala.',
    'Uma dose de 12:45 mg deve permanecer por não estar no início.',
  ].join('\n');

  assert.equal(
    cleanTranscriptionAgentOutput(output),
    'Primeira fala.\nSegunda fala.\nUma dose de 12:45 mg deve permanecer por não estar no início.',
  );
});

test('remove minutagens SRT, índices de legenda e prefixos sem colchetes', () => {
  const output = [
    '1',
    '00:00:01,250 --> 00:00:04,900',
    'Introdução.',
    '',
    '02:15 - Próximo assunto.',
  ].join('\n');

  assert.equal(cleanTranscriptionAgentOutput(output), 'Introdução.\n\nPróximo assunto.');
});

test('remove markdown comum e coleta JSON com descarte false', () => {
  const output = [
    '## Resultado',
    '',
    '- **Item importante**',
    '```json',
    '{"titulo":"A","descarte":false,"texto":"Manter"}',
    '```',
    '{"titulo":"B","descarte":true}',
  ].join('\n');
  const result = cleanExtractionAgentOutput(output);

  assert.equal(
    result.cleanedText,
    'Resultado\nItem importante\n\n{"titulo":"A","descarte":false,"texto":"Manter"}\n\n{"titulo":"B","descarte":true}',
  );
  assert.deepEqual(result.jsonWithDiscardFalse, [
    '{"titulo":"A","descarte":false,"texto":"Manter"}',
  ]);
});

test('coleta pseudo-JSON com marcador literal e ignora chaves dentro de strings', () => {
  const output = [
    '{id: 1, metadado: "[descarte: FALSE;]", texto: "valor com { chave }"}',
    '{id: 2, descarte: FALSO; texto: "também manter"}',
    '{id: 3, descarte: TRUE;}',
  ].join('\n');
  const result = cleanExtractionAgentOutput(output);

  assert.deepEqual(result.jsonWithDiscardFalse, [
    '{id: 1, metadado: "[descarte: FALSE;]", texto: "valor com { chave }"}',
    '{id: 2, descarte: FALSO; texto: "também manter"}',
  ]);
});