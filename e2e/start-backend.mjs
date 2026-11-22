// Starts the platform API for the e2e run on a FRESH database (dropped and re-created each run) with the demo seed.
//   MYSQL_E2E_URL (default mysql://root:root@127.0.0.1:3306) — an account allowed to create/drop databases; never production.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'backend');
const mysql = createRequire(path.join(backend, 'package.json'))('mysql2/promise');
const url = new URL(process.env.MYSQL_E2E_URL ?? 'mysql://root:root@127.0.0.1:3306');
const db = 'mobadrat_e2e';
const conn = await mysql.createConnection({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) });
await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
await conn.query(`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`);
await conn.end();
const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'mobadrat-e2e-'));
url.pathname = `/${db}`;
const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: backend, stdio: 'inherit',
  env: {
    ...process.env, NODE_ENV: 'development', PORT: '5200', DATABASE_URL: url.toString(), UPLOAD_DIR: uploads,
    SEED_ON_BOOT: '1', REGISTRY_ADAPTER: 'mock', APP_URL: 'http://localhost:5273', CORS_ORIGIN: 'http://localhost:5273',
    SMTP_HOST: '', GMAIL_USER: '', RATE_LIMIT_SCALE: '20',
  },
});
const stop = () => { child.kill(); fs.rmSync(uploads, { recursive: true, force: true }); };
process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('exit', stop);
child.on('exit', (code) => process.exit(code ?? 0));
