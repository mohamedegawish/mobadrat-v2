#!/usr/bin/env node
// Build step after `tsc`: copies the non-TypeScript files the server reads at runtime (SQL migrations of the core and of
// every initiative module, API documents) from src/ to dist/, keeping their paths. Tests are not copied.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
let n = 0;
function walk(rel) {
  for (const e of fs.readdirSync(path.join(src, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) { if (e.name !== 'tests') walk(r); continue; }
    if (!e.isFile() || /\.(ts|tsx)$/.test(e.name)) continue;
    fs.mkdirSync(path.dirname(path.join(dist, r)), { recursive: true });
    fs.copyFileSync(path.join(src, r), path.join(dist, r));
    n++;
  }
}
if (!fs.existsSync(dist)) { console.error('[copy-assets] dist/ not found — run tsc first'); process.exit(1); }
walk('');
const migrations = ['core/db/migrations', 'initiatives/shams/db/migrations', 'initiatives/sona3/db/migrations'];
for (const m of migrations) {
  if (!fs.existsSync(path.join(dist, m)) || !fs.readdirSync(path.join(dist, m)).some((f) => f.endsWith('.sql'))) {
    console.error(`[copy-assets] no SQL migrations in dist/${m}`);
    process.exit(1);
  }
}
console.log(`[copy-assets] ${n} file(s) copied into dist/`);
