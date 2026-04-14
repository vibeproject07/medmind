import { query } from '@/lib/db';
import { AI_AGENT_DEFAULTS, AiAgentDefault, getDefault } from '@/lib/ai-agents-defaults';

export interface AiAgent {
  key: string;
  name: string;
  description: string;
  system_prompt: string;
  model: string;
  temperature: number;
  max_output_tokens: number;
  is_customized: boolean;
  updated_at: string | null;
}

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ai_agents (
      key VARCHAR(100) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL,
      model VARCHAR(100) NOT NULL DEFAULT 'gemini-2.5-flash',
      temperature NUMERIC(3,2) NOT NULL DEFAULT 0.20,
      max_output_tokens INTEGER NOT NULL DEFAULT 4096,
      updated_at TIMESTAMPTZ
    )
  `);
}

function mergeWithDefault(row: Record<string, unknown>, def: AiAgentDefault): AiAgent {
  return {
    key: def.key,
    name: (row.name as string) ?? def.name,
    description: (row.description as string) ?? def.description,
    system_prompt: (row.system_prompt as string) ?? def.system_prompt,
    model: (row.model as string) ?? def.model,
    temperature: parseFloat(String(row.temperature ?? def.temperature)),
    max_output_tokens: parseInt(String(row.max_output_tokens ?? def.max_output_tokens), 10),
    is_customized: true,
    updated_at: (row.updated_at as string) ?? null,
  };
}

export async function listAgents(): Promise<AiAgent[]> {
  await ensureTable();
  const res = await query('SELECT * FROM ai_agents');
  const dbMap = new Map<string, Record<string, unknown>>();
  for (const row of res.rows) {
    dbMap.set(row.key as string, row as Record<string, unknown>);
  }

  return AI_AGENT_DEFAULTS.map((def) => {
    const row = dbMap.get(def.key);
    if (row) return mergeWithDefault(row, def);
    return {
      ...def,
      is_customized: false,
      updated_at: null,
    };
  });
}

export async function getAgent(key: string): Promise<AiAgent | null> {
  const def = getDefault(key);
  if (!def) return null;
  await ensureTable();
  const res = await query('SELECT * FROM ai_agents WHERE key = $1', [key]);
  if (res.rows.length === 0) {
    return { ...def, is_customized: false, updated_at: null };
  }
  return mergeWithDefault(res.rows[0] as Record<string, unknown>, def);
}

export async function upsertAgent(
  key: string,
  data: Partial<Pick<AiAgent, 'name' | 'description' | 'system_prompt' | 'model' | 'temperature' | 'max_output_tokens'>>
): Promise<AiAgent | null> {
  const def = getDefault(key);
  if (!def) return null;
  await ensureTable();

  const name = data.name ?? def.name;
  const description = data.description ?? def.description;
  const system_prompt = data.system_prompt ?? def.system_prompt;
  const model = data.model ?? def.model;
  const temperature = data.temperature ?? def.temperature;
  const max_output_tokens = data.max_output_tokens ?? def.max_output_tokens;

  await query(
    `INSERT INTO ai_agents (key, name, description, system_prompt, model, temperature, max_output_tokens, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (key) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       system_prompt = EXCLUDED.system_prompt,
       model = EXCLUDED.model,
       temperature = EXCLUDED.temperature,
       max_output_tokens = EXCLUDED.max_output_tokens,
       updated_at = NOW()`,
    [key, name, description, system_prompt, model, temperature, max_output_tokens]
  );

  return getAgent(key);
}

export async function resetAgent(key: string): Promise<AiAgent | null> {
  const def = getDefault(key);
  if (!def) return null;
  await ensureTable();
  await query('DELETE FROM ai_agents WHERE key = $1', [key]);
  return { ...def, is_customized: false, updated_at: null };
}

export async function getAgentPrompt(key: string): Promise<string> {
  const agent = await getAgent(key);
  return agent?.system_prompt ?? getDefault(key)?.system_prompt ?? '';
}
