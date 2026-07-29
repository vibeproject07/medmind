/**
 * Popula ai_agents com agentes ausentes (migração única a partir dos defaults).
 *
 * Uso:
 *   node --env-file=.env.local scripts/seed-ai-agents-db.mjs
 *
 * Alternativa via API (admin): POST /api/admin/seed-ai-agents
 */

import { spawnSync } from 'child_process';
import { resolve } from 'path';

const cwd = resolve(process.cwd());
const script = `
import { seedMissingAgentsFromDefaults } from './lib/seed-ai-agents.ts';

seedMissingAgentsFromDefaults()
  .then(({ inserted, skipped }) => {
    console.log('Inseridos:', inserted.length ? inserted.join(', ') : '(nenhum)');
    console.log('Já existiam:', skipped.length ? skipped.join(', ') : '(nenhum)');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
`;

const result = spawnSync('npx', ['--yes', 'tsx', '-e', script], {
  cwd,
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
