/**
 * Recalcula decs_validation_meta.missing_primary_terms a partir dos descritores
 * reais (role=primary), sem usar o flag do LLM.
 *
 *   npx tsx scripts/backfill-missing-primary-meta.ts
 */

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { query } from '@/lib/db';
import {
  buildDeCSValidationMeta,
  computeMissingPrimaryTerms,
  countPrimaryDeCSDescriptors,
} from '@/lib/decs-primary';
import type { DeCSRecord } from '@/lib/decs-pipeline';

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();
  await query(
    `ALTER TABLE questions ADD COLUMN IF NOT EXISTS decs_validation_meta JSONB`,
  );

  const res = await query(
    `SELECT id, ai_decs_descriptors, decs_validation_meta
     FROM questions
     WHERE decs_validation_meta IS NOT NULL
        OR (ai_decs_descriptors IS NOT NULL AND btrim(ai_decs_descriptors) <> '')`,
  );

  let updated = 0;
  let clearedFromQueue = 0;
  let addedToQueue = 0;
  let unchanged = 0;

  for (const row of res.rows as Array<{
    id: number;
    ai_decs_descriptors: string | null;
    decs_validation_meta: unknown;
  }>) {
    let descriptors: DeCSRecord[] = [];
    try {
      descriptors = row.ai_decs_descriptors
        ? JSON.parse(row.ai_decs_descriptors)
        : [];
    } catch {
      descriptors = [];
    }
    if (!Array.isArray(descriptors)) descriptors = [];

    let prevMeta: Record<string, unknown> = {};
    try {
      const raw = row.decs_validation_meta;
      prevMeta =
        typeof raw === 'string'
          ? JSON.parse(raw)
          : raw && typeof raw === 'object'
            ? (raw as Record<string, unknown>)
            : {};
    } catch {
      prevMeta = {};
    }

    const prevMissing = prevMeta.missing_primary_terms === true;
    const nextMissing = computeMissingPrimaryTerms(descriptors);

    const nextMeta = buildDeCSValidationMeta({
      descriptorsKept: descriptors,
      agentNeedsManualReview: prevMeta.needs_manual_review === true && !prevMissing,
      agentMissingPrimaryHint: false,
      agentReviewReason:
        typeof prevMeta.review_reason === 'string'
          ? prevMeta.review_reason
          : null,
      coerencia_geral:
        typeof prevMeta.coerencia_geral === 'number'
          ? prevMeta.coerencia_geral
          : undefined,
      removed_count:
        typeof prevMeta.removed_count === 'number'
          ? prevMeta.removed_count
          : 0,
      dismissed_at:
        typeof prevMeta.dismissed_at === 'string'
          ? prevMeta.dismissed_at
          : null,
      source: 'backfill-missing-primary-meta',
    });

    // Preservar dismissed_at e validated_at anterior quando possível
    if (prevMeta.validated_at) {
      nextMeta.validated_at = prevMeta.validated_at;
    }
    if (prevMeta.dismissed_at) {
      nextMeta.dismissed_at = prevMeta.dismissed_at;
    }

    if (prevMissing === nextMissing && prevMeta.primary_count === nextMeta.primary_count) {
      // ainda assim grava primary_count se faltava
      if (prevMeta.primary_count == null && descriptors.length > 0) {
        await query(
          `UPDATE questions
           SET decs_validation_meta = $1::jsonb, updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify({ ...prevMeta, primary_count: countPrimaryDeCSDescriptors(descriptors), missing_primary_terms: nextMissing }), row.id],
        );
        updated += 1;
      } else {
        unchanged += 1;
      }
      continue;
    }

    await query(
      `UPDATE questions
       SET decs_validation_meta = $1::jsonb, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(nextMeta), row.id],
    );
    updated += 1;
    if (prevMissing && !nextMissing) clearedFromQueue += 1;
    if (!prevMissing && nextMissing) addedToQueue += 1;
  }

  const stillInQueue = await query(
    `SELECT COUNT(*)::int AS n FROM questions
     WHERE (decs_validation_meta->>'missing_primary_terms') = 'true'
       AND (
         decs_validation_meta->>'dismissed_at' IS NULL
         OR btrim(decs_validation_meta->>'dismissed_at') = ''
       )`,
  );

  console.log(
    JSON.stringify(
      {
        scanned: res.rows.length,
        updated,
        unchanged,
        cleared_from_queue: clearedFromQueue,
        added_to_queue: addedToQueue,
        queue_remaining: stillInQueue.rows[0]?.n ?? 0,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
