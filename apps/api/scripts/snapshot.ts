/**
 * Read-only site: saves what the read-only pages show (routes/read.ts) as JSON files in
 * apps/web/dist-static/data, so the site needs no server. Starts from the curricula and editions and
 * follows every link the pages can make (objectives, lessons, other curricula), so every page has its data.
 * Fails if a linked page has no data. Run `pnpm site:build`, which builds the pages first.
 */
import { snapshotFile } from '@mapper/shared';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { sqlClient as sql } from '../src/db/client.js';
import { read } from '../src/routes/read.js';

const site = resolve(import.meta.dirname, '../../web/dist-static');
if (!existsSync(resolve(site, 'index.html'))) throw new Error(`No built site in ${site}; run pnpm site:build`);
rmSync(resolve(site, 'data'), { recursive: true, force: true });

// Cloudflare Pages limits
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const GRADES = [1, 2, 3, 4, 5, 6]; // the product browser's grade menu

const queue: string[] = [];
const seen = new Set<string>();
function visit(path: string) {
  if (seen.has(path)) return;
  seen.add(path);
  queue.push(path);
}
const missing: string[] = [];
let bytes = 0;

/** Queue every page the response links to. Location rows carry edition, grade and id (products?edition&grade&loc). */
function follow(x: unknown) {
  if (Array.isArray(x)) return x.forEach(follow);
  if (!x || typeof x !== 'object') return;
  const o = x as Record<string, unknown>;
  if (typeof o.objective_id === 'string') visit(`/objectives/${o.objective_id}`);
  if (typeof o.curriculum_id === 'string') visit(`/curricula/${o.curriculum_id}/coverage`);
  if (typeof o.location_id === 'string' && typeof o.edition_code === 'string') {
    if (typeof o.grade_num === 'number') visit(`/editions/${o.edition_code}/locations?grade=${o.grade_num}`);
    visit(`/locations/${o.location_id}`);
  }
  Object.values(o).forEach(follow);
}

function write(path: string, data: unknown) {
  // embedding vectors come with `SELECT co.*` and are large; no page uses them
  const text = JSON.stringify(data, (k, v) => (k === 'embedding' ? undefined : v));
  const file = resolve(site, `.${snapshotFile(path)}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  const size = Buffer.byteLength(text);
  bytes += size;
  if (size > MAX_FILE_BYTES) throw new Error(`${path} is ${size} bytes, over the Cloudflare Pages file limit`);
}

async function save(path: string) {
  const res = await read.request(path);
  if (res.status === 404) return void missing.push(path);
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as unknown;
  if (path === '/curricula') for (const c of data as { id: string }[]) visit(`/curricula/${c.id}/coverage`);
  if (path.endsWith('/coverage')) for (const o of (data as { objectives: { id: string }[] }).objectives) visit(`/objectives/${o.id}`);
  if (path === '/editions') for (const e of data as { code: string }[]) for (const g of GRADES) visit(`/editions/${e.code}/locations?grade=${g}`);
  follow(data);
  write(path, data);
}

visit('/curricula');
visit('/editions');
// a few workers in parallel (the database pool has 10 connections); each keeps going while the queue grows
await Promise.all(
  Array.from({ length: 6 }, async () => {
    for (let path; (path = queue.shift()); ) await save(path);
  }),
);

let commit: string | null = null;
try {
  commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {
  // not a git checkout
}
write('/meta', { at: new Date().toISOString(), commit });
await sql.end();

const files = seen.size + 1 - missing.length;
const count = (prefix: string) => [...seen].filter((p) => p.startsWith(prefix)).length;
console.log(
  `Saved ${files} data files (${(bytes / 1024 / 1024).toFixed(1)} MB): ` +
    `${count('/objectives/')} objectives, ${count('/locations/')} lessons/activities, ${count('/curricula/')} curricula, ` +
    `${count('/editions/')} product grade lists`,
);
if (missing.length) {
  console.error(`${missing.length} linked pages have no data:\n  ${missing.slice(0, 20).join('\n  ')}`);
  process.exit(1);
}
// plus the built pages themselves, a few dozen files
if (files > MAX_FILES - 100) throw new Error(`${files} files is too close to the Cloudflare Pages limit of ${MAX_FILES}`);
console.log(`Site ready in ${site}`);
