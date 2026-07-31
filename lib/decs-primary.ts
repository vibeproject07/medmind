import type { DeCSRecord } from '@/lib/decs-pipeline';

/** Descritor primário = role explícito "primary" (não trata null como primário). */
export function isPrimaryDeCSRole(role?: string | null): boolean {
  return String(role ?? '').toLowerCase() === 'primary';
}

export function hasPrimaryDeCSDescriptor(
  descriptors: Array<{ role?: string | null }>,
): boolean {
  return descriptors.some((d) => isPrimaryDeCSRole(d.role));
}

export function countPrimaryDeCSDescriptors(
  descriptors: Array<{ role?: string | null }>,
): number {
  return descriptors.filter((d) => isPrimaryDeCSRole(d.role)).length;
}

/**
 * Flag da fila de revisão: só ausência real de DeCS com role=primary.
 * Sinais do agente LLM vão para needs_manual_review / review_reason, não para a fila.
 */
export function computeMissingPrimaryTerms(
  descriptorsKept: Array<{ role?: string | null }>,
): boolean {
  return (
    descriptorsKept.length === 0 || !hasPrimaryDeCSDescriptor(descriptorsKept)
  );
}

export function buildDeCSValidationMeta(opts: {
  descriptorsKept: DeCSRecord[];
  agentNeedsManualReview?: boolean;
  agentMissingPrimaryHint?: boolean;
  agentReviewReason?: string | null;
  coerencia_geral?: number;
  removed_count?: number;
  source?: string;
  dismissed_at?: string | null;
}): Record<string, unknown> {
  const missingPrimary = computeMissingPrimaryTerms(opts.descriptorsKept);
  const agentHint =
    opts.agentNeedsManualReview === true ||
    opts.agentMissingPrimaryHint === true;

  const reviewReason =
    opts.agentReviewReason ||
    (missingPrimary
      ? 'Questão sem descritor DeCS primário (role=primary) após a validação — revisão manual necessária.'
      : agentHint
        ? 'Validador sugeriu revisão manual (coerência/temas), mas há descritor primário no resultado.'
        : null);

  return {
    missing_primary_terms: missingPrimary,
    needs_manual_review: missingPrimary || agentHint,
    review_reason: reviewReason,
    coerencia_geral: opts.coerencia_geral ?? null,
    validated_at: new Date().toISOString(),
    removed_count: opts.removed_count ?? 0,
    kept_count: opts.descriptorsKept.length,
    primary_count: countPrimaryDeCSDescriptors(opts.descriptorsKept),
    dismissed_at: opts.dismissed_at ?? null,
    ...(opts.source ? { source: opts.source } : {}),
  };
}
