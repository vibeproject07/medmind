#!/usr/bin/env node
/**
 * Runner para arthur/classify-decs-100.ts via npx tsx (resolve @/lib/* do tsconfig).
 *
 * Na raiz do repositório:
 *   node arthur/run-classify-decs-100.mjs
 *   node --env-file=.env.local arthur/run-classify-decs-100.mjs --limit 100 --save
 */

import { readFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const script = path.join(__dirname, 'classify-decs-100.ts');
const extraArgs = process.argv.slice(2);

const env = { ...process.env };
if (!env.DATABASE_URL) {
  const envLocal = path.join(root, '.env.local');
  if (existsSync(envLocal)) {
    for (const line of readFileSync(envLocal, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim();
      if (!env[k]) env[k] = v;
    }
  }
}

const result = spawnSync(
  'npx',
  ['--yes', 'tsx', '--tsconfig', path.join(root, 'tsconfig.json'), script, ...extraArgs],
  {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: false,
  },
);

process.exit(result.status ?? 1);
