import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendImages,
  removeImageAt,
  type ImageListUpdate,
} from '../lib/image-editor-updates';
import {
  resolveJsonArrayField,
  resolveNullableField,
} from '../lib/update-field-resolution';

function applyUpdate(images: string[], update: ImageListUpdate): string[] {
  return typeof update === 'function' ? update(images) : update;
}

test('shared editor appends newly uploaded images', () => {
  const result = applyUpdate(
    ['data:image/png;base64,existing'],
    appendImages(['data:image/png;base64,new']),
  );

  assert.deepEqual(result, [
    'data:image/png;base64,existing',
    'data:image/png;base64,new',
  ]);
});

test('shared editor removes only the selected image', () => {
  const result = applyUpdate(['first', 'second', 'third'], removeImageAt(1));

  assert.deepEqual(result, ['first', 'third']);
});

test('overlapping uploads keep additions that finish while another upload is pending', () => {
  const firstUpload = appendImages(['first-upload']);
  const secondUpload = appendImages(['second-upload']);

  let images = ['existing'];
  images = applyUpdate(images, secondUpload);
  images = applyUpdate(images, firstUpload);

  assert.deepEqual(images, ['existing', 'second-upload', 'first-upload']);
});

test('question API field resolution treats an explicit empty image list as a clear', () => {
  const result = resolveJsonArrayField(
    { images: [] },
    'images',
    JSON.stringify(['existing']),
  );

  assert.equal(result, '[]');
});

test('note API field resolution treats an explicit empty image list as a clear', () => {
  const result = resolveJsonArrayField(
    { title: 'Updated note', description: 'Updated description', images: [] },
    'images',
    JSON.stringify(['existing']),
  );

  assert.equal(result, '[]');
});

test('note API retains private source fields omitted from a save request', () => {
  const body = { title: 'Updated note', description: 'Updated description' };

  assert.equal(
    resolveNullableField(body, 'fontes_resumo_melhorado', 'private improved source'),
    'private improved source',
  );
  assert.equal(
    resolveNullableField(body, 'fontes_resumo_original', 'private original source'),
    'private original source',
  );
  assert.equal(
    resolveJsonArrayField(
      body,
      'fontes_arquivos',
      JSON.stringify([{ name: 'private.pdf' }]),
    ),
    JSON.stringify([{ name: 'private.pdf' }]),
  );
});