import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { GeminiGenerationError } from '../lib/gemini';
import { broadExtractionBatchTestUtils } from '../lib/broad-extraction-batching';

function documentJson(unitNumbers: number[]): string {
  return JSON.stringify({
    tipo_fonte: 'pdf',
    numeracao_inferida: false,
    unidades: unitNumbers.map((unidade) => ({
      unidade,
      descartada: false,
      motivo_descarte: null,
      texto: `Conteúdo ${unidade}`,
    })),
  });
}

test('subdivide páginas após MAX_TOKENS e preserva todas as unidades', async () => {
  const calls: number[][] = [];
  const documents = await broadExtractionBatchTestUtils.generateWithRecursiveSplit(
    [1, 2, 3, 4],
    async (pages) => {
      calls.push(pages);
      if (pages.length > 2) {
        throw new GeminiGenerationError('truncado', 'MAX_TOKENS');
      }
      return documentJson(pages);
    },
  );

  assert.deepEqual(calls, [[1, 2, 3, 4], [1, 2], [3, 4]]);
  const merged = broadExtractionBatchTestUtils.mergeDocuments(documents, false);
  assert.deepEqual(merged.unidades.map((unit) => unit.unidade), [1, 2, 3, 4]);
});

test('subdivide texto quando um lote retorna JSON incompleto', async () => {
  const input = 'A'.repeat(5_000);
  const calls: number[] = [];
  const documents = await broadExtractionBatchTestUtils.generateTextWithRecursiveSplit(
    input,
    async (part) => {
      calls.push(part.length);
      if (part.length > 2_500) return '{"unidades": [';
      return documentJson([1]);
    },
  );

  assert.deepEqual(calls, [5_000, 2_500, 2_500]);
  assert.equal(documents.length, 2);
});

test('rejeita unidade sem marcador descartada booleano', () => {
  assert.throws(
    () => broadExtractionBatchTestUtils.parseAndValidateBatch(
      JSON.stringify({
        tipo_fonte: 'pdf',
        numeracao_inferida: false,
        unidades: [{ unidade: 1, texto: 'Texto', motivo_descarte: null }],
      }),
    ),
    /descartada como booleano/,
  );
});

test('rejeita números duplicados ao unir lotes', () => {
  const first = broadExtractionBatchTestUtils.parseAndValidateBatch(documentJson([1]));
  const second = broadExtractionBatchTestUtils.parseAndValidateBatch(documentJson([1]));
  assert.throws(
    () => broadExtractionBatchTestUtils.mergeDocuments([first, second], false),
    /duplicadas/,
  );
});

test('não subdivide erros não recuperáveis', async () => {
  let calls = 0;
  await assert.rejects(
    broadExtractionBatchTestUtils.generateWithRecursiveSplit(
      [1, 2, 3, 4],
      async () => {
        calls += 1;
        throw new Error('falha de autenticação');
      },
    ),
    /falha de autenticação/,
  );
  assert.equal(calls, 1);
});

test('cria um PDF contendo somente as páginas solicitadas', async () => {
  const source = await PDFDocument.create();
  source.addPage();
  source.addPage();
  source.addPage();
  const batch = await broadExtractionBatchTestUtils.createPdfBatch(
    Buffer.from(await source.save()),
    [1, 3],
  );
  const parsed = await PDFDocument.load(batch);
  assert.equal(parsed.getPageCount(), 2);
});

test('divide texto sem remover ou normalizar nenhum caractere', () => {
  const input = [
    'Primeiro parágrafo.  ',
    '',
    'Segundo parágrafo com espaços.',
    'X'.repeat(45_000),
    '',
  ].join('\n');
  const chunks = broadExtractionBatchTestUtils.splitText(input);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(''), input);
});