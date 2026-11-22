#!/usr/bin/env node
// Runs the backend test suites against MySQL (one throw-away database per test file, created/dropped by the helpers).
//   docker compose -f docker-compose.dev.yml --profile test up -d mysql-test   (MySQL 8.4 on 127.0.0.1:3308, tmpfs)
//   npm test                 all suites          npm run test:shams / test:sona3 / test:core
//   MYSQL_TEST_URL=mysql://root:root@127.0.0.1:3308 (default) — an account allowed to CREATE/DROP databases; never production.
//   Extra arguments filter files by substring: npm test -- 03-decisions
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const suites = { core: 'tests', shams: 'src/initiatives/shams/tests', sona3: 'src/initiatives/sona3/tests' };
const args = process.argv.slice(2);
const picked = args.filter((a) => a in suites);
const filters = args.filter((a) => !(a in suites));
const files = [];
for (const s of picked.length ? picked : Object.keys(suites)) {
  const dir = path.join(root, suites[s]);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.test.ts')).sort()) {
    const rel = path.join(suites[s], f);
    if (!filters.length || filters.some((x) => rel.includes(x))) files.push(rel);
  }
}
if (!files.length) { console.error('no test files'); process.exit(1); }
console.log(`[test] ${files.length} file(s) on ${process.env.MYSQL_TEST_URL || 'mysql://root:root@127.0.0.1:3308'}`);
const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-force-exit', ...files], {
  cwd: root, stdio: 'inherit', env: { ...process.env, MYSQL_TEST_URL: process.env.MYSQL_TEST_URL || 'mysql://root:root@127.0.0.1:3308' },
});
process.exit(r.status ?? 1);
