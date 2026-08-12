import { query } from '@/lib/db';

export interface RuntimeAgent {
  key: string;
  /** Texto enviado ao Gemini como system_instruction / systemInstruction */
  system_instruction: string;
  system_prompt: string;
  model: string;
  temperature: number;
  max_output_tokens: number;
}

/** Resolve instrução: system_instruction tem prioridade sobre system_prompt. */
export function resolveSystemInstruction(row: {
  system_instruction?: string | null;
  system_prompt?: string | null;
}): string {
  const instruction = String(row.system_instruction ?? ''); //.trim();
  if (instruction) return instruction;
  return String(row.system_prompt ?? ''); //.trim();
}

export async function ensureAgentSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ai_agents (
      key VARCHAR(100) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      system_instruction TEXT,
      model VARCHAR(100) NOT NULL DEFAULT 'gemini-2.5-flash',
      temperature NUMERIC(3,2) NOT NULL DEFAULT 0.20,
      max_output_tokens INTEGER NOT NULL DEFAULT 4096,
      updated_at TIMESTAMPTZ
    )
  `);
  await query(`ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS system_instruction TEXT`);
}

/**
 * Carrega agente exclusivamente do banco (sem fallback para ai-agents-defaults).
 * Usado por pipelines de classificação DeCS e scripts em lote.
 */
export async function getRuntimeAgent(key: string): Promise<RuntimeAgent> {
  await ensureAgentSchema();
  const res = await query(`SELECT * FROM ai_agents WHERE key = $1`, [key]);
  if (res.rows.length === 0) {
    throw new Error(
      `Agente "${key}" não encontrado em ai_agents. ` +
        'Configure no Editor de Agentes ou execute POST /api/admin/seed-ai-agents.',
    );
  }

  const row = res.rows[0] as Record<string, unknown>;
  const system_instruction = resolveSystemInstruction({
    system_instruction: row.system_instruction as string | null,
    system_prompt: row.system_prompt as string | null,
  });
  if (!system_instruction) {
    throw new Error(
      `Agente "${key}" existe em ai_agents mas system_instruction e system_prompt estão vazios.`,
    );
  }

  return {
    key,
    system_instruction,
    system_prompt: String(row.system_prompt ?? ''),
    model: String(row.model ?? 'gemini-2.5-flash'),
    temperature: parseFloat(String(row.temperature ?? 0.2)),
    max_output_tokens: parseInt(String(row.max_output_tokens ?? 4096), 10),
  };
}

export async function getRuntimeAgents(keys: string[]): Promise<Map<string, RuntimeAgent>> {
  await ensureAgentSchema();
  const unique = [...new Set(keys)];
  const res = await query(`SELECT * FROM ai_agents WHERE key = ANY($1)`, [unique]);
  const map = new Map<string, RuntimeAgent>();

  for (const row of res.rows as Record<string, unknown>[]) {
    const key = String(row.key);
    const system_instruction = resolveSystemInstruction({
      system_instruction: row.system_instruction as string | null,
      system_prompt: row.system_prompt as string | null,
    });
    if (!system_instruction) continue;
    map.set(key, {
      key,
      system_instruction,
      system_prompt: String(row.system_prompt ?? ''),
      model: String(row.model ?? 'gemini-2.5-flash'),
      temperature: parseFloat(String(row.temperature ?? 0.2)),
      max_output_tokens: parseInt(String(row.max_output_tokens ?? 4096), 10),
    });
  }

  for (const key of unique) {
    if (!map.has(key)) {
      throw new Error(
        `Agente "${key}" não encontrado ou sem instrução em ai_agents.`,
      );
    }
  }

  return map;
}
