let pendingNoteSources: File[] = [];

/**
 * Keeps files selected in the quick-create modal available while client-side
 * navigation opens the note editor. Files deliberately never enter storage
 * until a note exists and the user confirms saving it.
 */
export function stagePendingNoteSources(files: File[]): void {
  pendingNoteSources = files;
}

export function consumePendingNoteSources(): File[] {
  const files = pendingNoteSources;
  pendingNoteSources = [];
  return files;
}