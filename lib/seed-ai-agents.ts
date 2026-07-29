import { query } from '@/lib/db';
import { AI_AGENT_DEFAULTS } from '@/lib/ai-agents-defaults';
import { ensureAgentSchema } from '@/lib/ai-agent-runtime';

/**
 * Insere agentes ausentes em ai_agents a partir de ai-agents-defaults.ts.
 * Uso exclusivo de setup/migração — não é fallback de runtime.
 */
export async function seedMissingAgentsFromDefaults(): Promise<{
  inserted: string[];
  skipped: string[];
}> {
  await ensureAgentSchema();
  const inserted: string[] = [];
  const skipped: string[] = [];

  for (const def of AI_AGENT_DEFAULTS) {
    const exists = await query('SELECT key FROM ai_agents WHERE key = $1', [def.key]);
    if (exists.rows.length > 0) {
      skipped.push(def.key);
      continue;
    }

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
    inserted.push(def.key);
  }

  return { inserted, skipped };
}
