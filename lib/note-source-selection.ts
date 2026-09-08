export type OrderedNoteSource = {
  id: number;
  status: 'uploading' | 'ready';
  created_at: string;
};

export type NoteSourceSelection = {
  sourceId: number | null;
  selectedByUser: boolean;
};

export function compareNoteSourcesByCreation(
  left: OrderedNoteSource,
  right: OrderedNoteSource,
): number {
  const createdAtDifference =
    new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  return createdAtDifference || left.id - right.id;
}

export function sortNoteSourcesByCreation<T extends OrderedNoteSource>(sources: T[]): T[] {
  return [...sources].sort(compareNoteSourcesByCreation);
}

export function getPrimaryReadySource<T extends OrderedNoteSource>(
  sources: T[],
): T | null {
  return sortNoteSourcesByCreation(sources).find((source) => source.status === 'ready') ?? null;
}

/**
 * Keeps an explicit viewer choice stable while status polling updates sources.
 * Automatic selection always follows the oldest ready source. If the selected
 * source is deleted, the next oldest ready source becomes primary.
 */
export function reconcileNoteSourceSelection(
  sources: OrderedNoteSource[],
  selection: NoteSourceSelection,
): NoteSourceSelection {
  const selectedSource = selection.sourceId === null
    ? null
    : sources.find((source) => source.id === selection.sourceId);

  if (selection.selectedByUser && selectedSource?.status === 'ready') {
    return selection;
  }

  const primary = getPrimaryReadySource(sources);
  return {
    sourceId: primary?.id ?? null,
    selectedByUser: false,
  };
}