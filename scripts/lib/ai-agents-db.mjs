/**
 * Carrega agentes da tabela ai_agents (sem fallback para defaults em arquivo).
 * Usado por scripts .mjs de classificação em lote.
 */

export function resolveSystemInstruction(row) {
  const instruction = String(row.system_instruction ?? '').trim();
  if (instruction) return instruction;
  return String(row.system_prompt ?? '').trim();
}

export async function ensureAgentSchema(pool) {
  await pool.query(`
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
  await pool.query(`ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS system_instruction TEXT`);
}

/**
 * @param {import('pg').Pool} pool
 * @param {string[]} keys
 * @returns {Promise<Map<string, { key: string, system_instruction: string, system_prompt: string, model: string, temperature: number, max_output_tokens: number }>>}
 */
export async function loadRuntimeAgents(pool, keys) {
  await ensureAgentSchema(pool);
  const unique = [...new Set(keys)];
  const { rows } = await pool.query(
    `SELECT key, system_prompt, system_instruction, model, temperature, max_output_tokens
     FROM ai_agents WHERE key = ANY($1)`,
    [unique],
  );

  const map = new Map();
  for (const row of rows) {
    const system_instruction = resolveSystemInstruction(row);
    if (!system_instruction) continue;
    map.set(row.key, {
      key: row.key,
      system_instruction,
      system_prompt: String(row.system_prompt ?? ''),
      model: row.model || 'gemini-2.5-flash',
      temperature: parseFloat(String(row.temperature ?? 0.2)),
      max_output_tokens: parseInt(String(row.max_output_tokens ?? 4096), 10),
    });
  }

  for (const key of unique) {
    if (!map.has(key)) {
      throw new Error(
        `Agente "${key}" não encontrado em ai_agents (ou sem system_prompt/system_instruction). ` +
          'Configure no Editor de Agentes ou rode: node --env-file=.env.local scripts/seed-ai-agents-db.mjs',
      );
    }
  }

  return map;
}

/**
 * Payload Gemini REST (system_instruction + generationConfig).
 */
export function buildGeminiBody(agent, userMessage, overrides = {}) {
  return {
    system_instruction: { parts: [{ text: agent.system_instruction }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      temperature: agent.temperature,
      maxOutputTokens: agent.max_output_tokens,
      ...overrides,
    },
  };
}
