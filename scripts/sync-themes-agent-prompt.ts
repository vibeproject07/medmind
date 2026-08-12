/**
 * Atualiza o prompt do question_themes_assigner no DB a partir do default.
 *
 *   npx tsx scripts/sync-themes-agent-prompt.ts
 */

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { AI_AGENT_DEFAULTS } from '@/lib/ai-agents-defaults';
import { upsertAgent } from '@/lib/ai-agents';
import { ensureAgentSchema } from '@/lib/ai-agent-runtime';
import { query } from '@/lib/db';

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
  await ensureAgentSchema();
  const def = AI_AGENT_DEFAULTS.find((a) => a.key === 'question_themes_assigner');
  if (!def) throw new Error('default question_themes_assigner missing');

  const existing = await query(
    `SELECT key FROM ai_agents WHERE key = $1`,
    [def.key],
  );

  if (existing.rows.length === 0) {
    await query(
      `INSERT INTO ai_agents (
         key, name, description, system_prompt, system_instruction,
         model, temperature, max_output_tokens, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        def.key,
        def.name,
        def.description,
        def.system_prompt,
        def.system_prompt,
        def.model,
        def.temperature,
        def.max_output_tokens,
      ],
    );
    console.log('inserted question_themes_assigner');
  } else {
    await upsertAgent(def.key, {
      name: def.name,
      description: def.description,
      system_prompt: def.system_prompt,
      system_instruction: def.system_prompt,
      model: def.model,
      temperature: def.temperature,
      max_output_tokens: def.max_output_tokens,
    });
    console.log('updated question_themes_assigner prompt (grande_area)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
