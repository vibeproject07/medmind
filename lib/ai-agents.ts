import { query } from '@/lib/db';
import { AI_AGENT_DEFAULTS } from '@/lib/ai-agents-defaults';
import { ensureAgentSchema } from '@/lib/ai-agent-runtime';

export interface AiAgent {
  key: string;
  name: string;
  description: string;
  system_prompt: string;
  system_instruction: string | null;
  model: string;
  temperature: number;
  max_output_tokens: number;
  is_customized: boolean;
  is_builtin: boolean;
  updated_at: string | null;
}

const BUILTIN_KEYS = new Set(AI_AGENT_DEFAULTS.map((d) => d.key));

function rowToAgent(row: Record<string, unknown>): AiAgent {
  const key = row.key as string;
  return {
    key,
    name: row.name as string,
    description: (row.description as string) ?? '',
    system_prompt: row.system_prompt as string,
    system_instruction: (row.system_instruction as string | null) ?? null,
    model: (row.model as string) ?? 'gemini-2.5-flash',
    temperature: parseFloat(String(row.temperature ?? 0.2)),
    max_output_tokens: parseInt(String(row.max_output_tokens ?? 4096), 10),
    is_customized: true,
    is_builtin: BUILTIN_KEYS.has(key),
    updated_at: (row.updated_at as string) ?? null,
  };
}

export async function listAgents(): Promise<AiAgent[]> {
  await ensureAgentSchema();
  const res = await query('SELECT * FROM ai_agents ORDER BY updated_at DESC NULLS LAST');
  return res.rows.map((row) => rowToAgent(row as Record<string, unknown>));
}

export async function getAgent(key: string): Promise<AiAgent | null> {
  await ensureAgentSchema();
  const res = await query('SELECT * FROM ai_agents WHERE key = $1', [key]);
  if (res.rows.length === 0) return null;
  return rowToAgent(res.rows[0] as Record<string, unknown>);
}

export async function upsertAgent(
  key: string,
  data: Partial<
    Pick<
      AiAgent,
      'name' | 'description' | 'system_prompt' | 'system_instruction' | 'model' | 'temperature' | 'max_output_tokens'
    >
  >
): Promise<AiAgent | null> {
  await ensureAgentSchema();

  const existing = await getAgent(key);
  if (!existing) return null;

  const name = data.name ?? existing.name;
  const description = data.description ?? existing.description;
  const system_prompt = data.system_prompt ?? existing.system_prompt;
  const system_instruction =
    data.system_instruction !== undefined
      ? data.system_instruction
      : existing.system_instruction;
  const model = data.model ?? existing.model;
  const temperature = data.temperature ?? existing.temperature;
  const max_output_tokens = data.max_output_tokens ?? existing.max_output_tokens;

  await query(
    `INSERT INTO ai_agents (key, name, description, system_prompt, system_instruction, model, temperature, max_output_tokens, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (key) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       system_prompt = EXCLUDED.system_prompt,
       system_instruction = EXCLUDED.system_instruction,
       model = EXCLUDED.model,
       temperature = EXCLUDED.temperature,
       max_output_tokens = EXCLUDED.max_output_tokens,
       updated_at = NOW()`,
    [key, name, description, system_prompt, system_instruction, model, temperature, max_output_tokens]
  );

  return getAgent(key);
}

export async function createAgent(data: {
  key: string;
  name: string;
  description: string;
  system_prompt: string;
  system_instruction?: string | null;
  model: string;
  temperature: number;
  max_output_tokens: number;
}): Promise<{ agent: AiAgent | null; conflict: boolean }> {
  await ensureAgentSchema();

  const existing = await query('SELECT key FROM ai_agents WHERE key = $1', [data.key]);
  if (existing.rows.length > 0) return { agent: null, conflict: true };

  try {
    await query(
      `INSERT INTO ai_agents (key, name, description, system_prompt, system_instruction, model, temperature, max_output_tokens, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        data.key,
        data.name,
        data.description,
        data.system_prompt,
        data.system_instruction ?? data.system_prompt,
        data.model,
        data.temperature,
        data.max_output_tokens,
      ],
    );
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === '23505') return { agent: null, conflict: true };
    throw err;
  }

  const agent = await getAgent(data.key);
  return { agent, conflict: false };
}

export async function resetAgent(key: string): Promise<AiAgent | null> {
  const def = AI_AGENT_DEFAULTS.find((d) => d.key === key);
  if (!def) return null;
  await ensureAgentSchema();

  await query(
    `INSERT INTO ai_agents (key, name, description, system_prompt, system_instruction, model, temperature, max_output_tokens, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (key) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       system_prompt = EXCLUDED.system_prompt,
       system_instruction = EXCLUDED.system_instruction,
       model = EXCLUDED.model,
       temperature = EXCLUDED.temperature,
       max_output_tokens = EXCLUDED.max_output_tokens,
       updated_at = NOW()`,
    [def.key, def.name, def.description, def.system_prompt, def.system_prompt, def.model, def.temperature, def.max_output_tokens]
  );

  return getAgent(key);
}

export async function deleteAgent(key: string): Promise<boolean> {
  await ensureAgentSchema();
  const res = await query('DELETE FROM ai_agents WHERE key = $1 RETURNING key', [key]);
  return res.rows.length > 0;
}

export async function getAgentPrompt(key: string): Promise<string> {
  const { getRuntimeAgent } = await import('@/lib/ai-agent-runtime');
  const agent = await getRuntimeAgent(key);
  return agent.system_instruction;
}
