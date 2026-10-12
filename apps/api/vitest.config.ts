import { defineConfig } from 'vitest/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// load ../../.env for DATABASE_URL (integration tests)
const envFile = resolve(import.meta.dirname, '../../.env');
const env: Record<string, string> = {};
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
export default defineConfig({ test: { env, testTimeout: 30_000 } });
