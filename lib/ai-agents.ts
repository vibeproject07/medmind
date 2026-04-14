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
  is_builtin: boolean;
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

function rowToAgent(row: Record<string, unknown>, isBuiltin: boolean): AiAgent {
  return {
    key: row.key as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    system_prompt: row.system_prompt as string,
    model: (row.model as string) ?? 'gemini-2.5-flash',
    temperature: parseFloat(String(row.temperature ?? 0.2)),
    max_output_tokens: parseInt(String(row.max_output_tokens ?? 4096), 10),
    is_customized: true,
    is_builtin: isBuiltin,
    updated_at: (row.updated_at as string) ?? null,
  };
}

function mergeWithDefault(row: Record<string, unknown>, def: AiAgentDefault): AiAgent {
  return rowToAgent({ ...def, ...row, key: def.key }, true);
}

export async function listAgents(): Promise<AiAgent[]> {
  await ensureTable();
  const res = await query('SELECT * FROM ai_agents ORDER BY updated_at DESC NULLS LAST');
  const dbMap = new Map<string, Record<string, unknown>>();
  for (const row of res.rows) {
    dbMap.set(row.key as string, row as Record<string, unknown>);
  }

  const builtinKeys = new Set(AI_AGENT_DEFAULTS.map((d) => d.key));

  const builtins: AiAgent[] = AI_AGENT_DEFAULTS.map((def) => {
    const row = dbMap.get(def.key);
    if (row) return mergeWithDefault(row, def);
    return { ...def, is_customized: false, is_builtin: true, updated_at: null };
  });

  const customs: AiAgent[] = [];
  for (const [key, row] of dbMap.entries()) {
    if (!builtinKeys.has(key)) {
      customs.push(rowToAgent(row, false));
    }
  }

  return [...builtins, ...customs];
}

export async function getAgent(key: string): Promise<AiAgent | null> {
  await ensureTable();
  const def = getDefault(key);
  const res = await query('SELECT * FROM ai_agents WHERE key = $1', [key]);

  if (res.rows.length === 0) {
    if (!def) return null;
    return { ...def, is_customized: false, is_builtin: true, updated_at: null };
  }

  const row = res.rows[0] as Record<string, unknown>;
  if (def) return mergeWithDefault(row, def);
  return rowToAgent(row, false);
}

export async function upsertAgent(
  key: string,
  data: Partial<Pick<AiAgent, 'name' | 'description' | 'system_prompt' | 'model' | 'temperature' | 'max_output_tokens'>>
): Promise<AiAgent | null> {
  const def = getDefault(key);
  await ensureTable();

  const existing = await getAgent(key);
  if (!existing && !def) return null;

  const name = data.name ?? def?.name ?? existing?.name ?? '';
  const description = data.description ?? def?.description ?? existing?.description ?? '';
  const system_prompt = data.system_prompt ?? def?.system_prompt ?? existing?.system_prompt ?? '';
  const model = data.model ?? def?.model ?? existing?.model ?? 'gemini-2.5-flash';
  const temperature = data.temperature ?? def?.temperature ?? existing?.temperature ?? 0.2;
  const max_output_tokens = data.max_output_tokens ?? def?.max_output_tokens ?? existing?.max_output_tokens ?? 4096;

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

export async function createAgent(data: {
  key: string;
  name: string;
  description: string;
  system_prompt: string;
  model: string;
  temperature: number;
  max_output_tokens: number;
}): Promise<{ agent: AiAgent | null; conflict: boolean }> {
  await ensureTable();

  const existing = await query('SELECT key FROM ai_agents WHERE key = $1', [data.key]);
  if (existing.rows.length > 0) return { agent: null, conflict: true };

  const def = getDefault(data.key);
  if (def) return { agent: null, conflict: true };

  await query(
    `INSERT INTO ai_agents (key, name, description, system_prompt, model, temperature, max_output_tokens, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [data.key, data.name, data.description, data.system_prompt, data.model, data.temperature, data.max_output_tokens]
  );

  const agent = await getAgent(data.key);
  return { agent, conflict: false };
}

export async function resetAgent(key: string): Promise<AiAgent | null> {
  const def = getDefault(key);
  if (!def) return null;
  await ensureTable();
  await query('DELETE FROM ai_agents WHERE key = $1', [key]);
  return { ...def, is_customized: false, is_builtin: true, updated_at: null };
}

export async function deleteAgent(key: string): Promise<boolean> {
  const def = getDefault(key);
  if (def) return false;
  await ensureTable();
  const res = await query('DELETE FROM ai_agents WHERE key = $1 RETURNING key', [key]);
  return res.rows.length > 0;
}

export async function getAgentPrompt(key: string): Promise<string> {
  const agent = await getAgent(key);
  return agent?.system_prompt ?? getDefault(key)?.system_prompt ?? '';
}
