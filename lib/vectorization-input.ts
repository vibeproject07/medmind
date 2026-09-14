import type { ChunkingResult } from '@/lib/chunking-agent';

/**
 * Valida a fronteira entre chunking e embeddings. O texto do chunk é mantido
 * exatamente como produzido; `trim` é usado somente para rejeitar conteúdo
 * vazio, sem alterar a entrada enviada ao modelo de embedding.
 */
export function validateChunkingForVectorization(
  chunking: ChunkingResult,
): void {
  chunking.blocks.forEach((block, index) => {
    if (block.type !== 'chunk') return;
    if (typeof block.text !== 'string' || block.text.trim().length === 0) {
      throw new Error(
        `O bloco ${index} do chunking não possui texto válido para vetorização.`,
      );
    }
  });
}