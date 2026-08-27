const DRAFT_NOTE_KEY = 'draftNote';

/**
 * Saves a note draft without allowing browser storage limits to break the UI.
 * Images are base64 data URLs and can consume most of localStorage, so they are
 * omitted only when the full draft cannot be persisted.
 */
export function saveDraftNote(value: unknown): boolean {
  if (typeof window === 'undefined') return false;

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return false;
  }

  try {
    window.localStorage.setItem(DRAFT_NOTE_KEY, serialized);
    return true;
  } catch {
    try {
      const parsed = JSON.parse(serialized);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;

      const compactDraft = { ...(parsed as Record<string, unknown>), images: [] };
      window.localStorage.setItem(DRAFT_NOTE_KEY, JSON.stringify(compactDraft));
      return true;
    } catch {
      // Draft persistence is best-effort; navigation and editing must continue.
      return false;
    }
  }
}

export function removeDraftNote(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DRAFT_NOTE_KEY);
  } catch {
    // Ignore unavailable or full browser storage.
  }
}