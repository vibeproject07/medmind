import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeSourceUploadCorsRules,
  normalizeSourceUploadOrigin,
} from '../lib/s3';

test('normaliza a origem sem manter caminho, consulta ou fragmento', () => {
  assert.equal(
    normalizeSourceUploadOrigin('https://app.example.com/dashboard?x=1#top'),
    'https://app.example.com',
  );
});

test('preserva regras existentes e adiciona a regra de upload', () => {
  const rules = mergeSourceUploadCorsRules(
    [{
      ID: 'ExistingRule',
      AllowedOrigins: ['https://existing.example'],
      AllowedMethods: ['GET'],
    }],
    'https://medmind.example',
  );

  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0], {
    ID: 'ExistingRule',
    AllowedOrigins: ['https://existing.example'],
    AllowedMethods: ['GET'],
  });
  assert.deepEqual(rules[1], {
    ID: 'MedMindSourceUploads',
    AllowedOrigins: ['https://medmind.example'],
    AllowedMethods: ['POST'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag', 'x-amz-checksum-sha256'],
    MaxAgeSeconds: 3600,
  });
});

test('atualiza a regra MedMind sem duplicar origens', () => {
  const rules = mergeSourceUploadCorsRules(
    [{
      ID: 'MedMindSourceUploads',
      AllowedOrigins: ['https://dev.example'],
      AllowedMethods: ['POST'],
    }],
    'https://dev.example/path',
  );

  assert.deepEqual(rules[0]?.AllowedOrigins, ['https://dev.example']);
});

test('rejeita protocolos que não podem ser origens web', () => {
  assert.throws(
    () => normalizeSourceUploadOrigin('javascript:alert(1)'),
    /Origem inválida/,
  );
});