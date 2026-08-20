import { query } from '@/lib/db';

let metadataSchemaPromise: Promise<void> | null = null;

/**
 * Keeps installations created with the older notes schema compatible with the
 * optional metadata fields exposed by the editor.
 */
export function ensureNoteMetadataSchema(): Promise<void> {
  if (!metadataSchemaPromise) {
    metadataSchemaPromise = query(
      'ALTER TABLE notes ADD COLUMN IF NOT EXISTS tipo_conteudo TEXT',
    )
      .then(() => undefined)
      .catch((error) => {
        metadataSchemaPromise = null;
        throw error;
      });
  }
  return metadataSchemaPromise;
}