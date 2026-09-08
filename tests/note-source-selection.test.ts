import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reconcileNoteSourceSelection,
  sortNoteSourcesByCreation,
  type OrderedNoteSource,
} from '../lib/note-source-selection';

function source(
  id: number,
  createdAt: string,
  status: OrderedNoteSource['status'],
): OrderedNoteSource {
  return { id, created_at: createdAt, status };
}

test('keeps creation order when two uploads complete in reverse order', () => {
  const first = source(10, '2026-08-31T10:00:00.000Z', 'uploading');
  const second = source(11, '2026-08-31T10:00:01.000Z', 'ready');

  let selection = reconcileNoteSourceSelection([second, first], {
    sourceId: null,
    selectedByUser: false,
  });
  assert.equal(selection.sourceId, second.id);

  first.status = 'ready';
  selection = reconcileNoteSourceSelection([second, first], selection);
  assert.equal(selection.sourceId, first.id);

  const reloaded = reconcileNoteSourceSelection(
    sortNoteSourcesByCreation([second, first]),
    { sourceId: null, selectedByUser: false },
  );
  assert.equal(reloaded.sourceId, first.id);
});

test('uses id as a deterministic tie-breaker for equal creation timestamps', () => {
  const createdAt = '2026-08-31T10:00:00.000Z';
  const sources = [
    source(22, createdAt, 'ready'),
    source(21, createdAt, 'ready'),
  ];

  assert.deepEqual(sortNoteSourcesByCreation(sources).map(({ id }) => id), [21, 22]);
});

test('does not replace a user-selected source during ordinary status updates', () => {
  const first = source(30, '2026-08-31T10:00:00.000Z', 'ready');
  const second = source(31, '2026-08-31T10:00:01.000Z', 'ready');

  const selection = reconcileNoteSourceSelection([first, second], {
    sourceId: second.id,
    selectedByUser: true,
  });

  assert.deepEqual(selection, { sourceId: second.id, selectedByUser: true });
});

test('promotes the next available source after deleting the primary source', () => {
  const first = source(40, '2026-08-31T10:00:00.000Z', 'ready');
  const second = source(41, '2026-08-31T10:00:01.000Z', 'ready');
  const third = source(42, '2026-08-31T10:00:02.000Z', 'uploading');

  const selection = reconcileNoteSourceSelection([second, third], {
    sourceId: first.id,
    selectedByUser: false,
  });

  assert.deepEqual(selection, { sourceId: second.id, selectedByUser: false });
});