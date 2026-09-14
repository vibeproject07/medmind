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

test('interpreta JSON e remove objetos com descatada ou descartada true', () => {
  const output = `\`\`\`json
[
  {"titulo":"A","descatada":false,"texto":"Manter A"},
  {"titulo":"B","descatada":true,"texto":"Remover B"},
  {"titulo":"C","descartada":false,"texto":"Manter C"},
  {"titulo":"D","descartada":true,"texto":"Remover D"}
]
\`\`\``;
  const result = cleanExtractionAgentOutput(output);

  assert.equal(
    result.newJson,
    `[
  {
    "titulo": "A",
    "descatada": false,
    "texto": "Manter A"
  },
  {
    "titulo": "C",
    "descartada": false,
    "texto": "Manter C"
  }
]`,
  );
  assert.deepEqual(result.jsonWithDiscardFalse, [
    '{"titulo":"A","descatada":false,"texto":"Manter A"}',
    '{"titulo":"C","descartada":false,"texto":"Manter C"}',
  ]);
  assert.deepEqual(result.saida_extracao_pos_limpeza, []);
  assert.equal(result.cleanedText, '[]');
});

test('remove objetos descartados em listas aninhadas e preserva a estrutura', () => {
  const output = JSON.stringify({
    argumentos: [
      { unidade: 1, descartada: false, texto: 'Conteúdo clínico.' },
      { unidade: 2, descartada: true, texto: 'Publicidade.' },
    ],
    fonte: 'aula',
  });
  const result = cleanExtractionAgentOutput(output);

  assert.deepEqual(JSON.parse(result.newJson!), {
    argumentos: [
      { unidade: 1, descartada: false, texto: 'Conteúdo clínico.' },
    ],
    fonte: 'aula',
  });
  assert.deepEqual(result.saida_extracao_pos_limpeza, [
    '1',
    'Conteúdo clínico.',
  ]);
  assert.equal(result.cleanedText, '["1","Conteúdo clínico."]');
});

test('gera lista plana somente com unidade e texto de objetos descartada false', () => {
  const output = JSON.stringify({
    tipo_fonte: 'documento',
    unidades: [
      { unidade: 1, descartada: false, texto: 'Primeiro texto.', extra: 'ignorar' },
      { unidade: 2, descartada: true, texto: 'Texto descartado.' },
      { unidade: 3, descartada: false, texto: 42 },
      { unidade: 4, texto: 'Sem marcador explícito.' },
      { unidade: '5-A', descartada: false, texto: 'Último texto.' },
    ],
  });

  const result = cleanExtractionAgentOutput(output, { requireJson: true });

  assert.deepEqual(result.saida_extracao_pos_limpeza, [
    '1',
    'Primeiro texto.',
    '5-A',
    'Último texto.',
  ]);
  assert.equal(
    result.cleanedText,
    '["1","Primeiro texto.","5-A","Último texto."]',
  );
});

test('percorre unidades aninhadas sem interromper após objetos candidatos', () => {
  const output = JSON.stringify({
    unidade: 'pai',
    descartada: false,
    texto: 'Texto do pai.',
    filhos: [
      {
        unidade: 'filho-1',
        descartada: false,
        texto: 'Texto do primeiro filho.',
      },
      {
        unidade: { invalida: true },
        descartada: false,
        texto: 'Candidato inválido.',
        neto: {
          unidade: 'neto',
          descartada: false,
          texto: 'Texto do neto.',
        },
      },
      {
        unidade: 'legado',
        descatada: false,
        texto: 'Marcador escrito incorretamente.',
      },
      {
        unidade: 'descartado',
        descartada: true,
        texto: 'Não deve entrar.',
      },
    ],
  });

  const result = cleanExtractionAgentOutput(output, { requireJson: true });

  assert.deepEqual(result.saida_extracao_pos_limpeza, [
    'pai',
    'Texto do pai.',
    'filho-1',
    'Texto do primeiro filho.',
    'neto',
    'Texto do neto.',
  ]);
});

test('rejeita saída inválida quando JSON é obrigatório', () => {
  assert.throws(
    () => cleanExtractionAgentOutput('texto sem JSON', { requireJson: true }),
    /JSON válido/,
  );
});