#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const script = path.join(__dirname, 'backfill-missing-primary-meta.ts');

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
  ['--yes', 'tsx', '--tsconfig', path.join(root, 'tsconfig.json'), script],
  { cwd: root, env, stdio: 'inherit', shell: false },
);
process.exit(result.status ?? 1);
