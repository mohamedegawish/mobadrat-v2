import { Router } from 'express';
import fs from 'node:fs';
import { config } from '../config.js';
import { getDb } from '../db/sqlite.js';
import { uploadRoot } from '../http/upload.js';
import { ah } from '../http/errors.js';

export const healthRouter = Router();

/** فحص الجاهزية: قاعدة البيانات + صلاحية الكتابة في مجلد الملفات. لا يكشف أسرارًا. */
export async function healthHandler(_req: unknown, res: import('express').Response) {
  const checks: Record<string, string> = {};
  let ok = true;
  try {
    await getDb().prepare('SELECT 1').get();
    const v = await getDb().prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
    checks.db = `ok (schema v${v.v ?? 0})`;
  } catch { checks.db = 'error'; ok = false; }
  try {
    fs.accessSync(uploadRoot(), fs.constants.W_OK);
    checks.uploads = 'ok';
  } catch { checks.uploads = 'error'; ok = false; }
  checks.registryAdapter = config.registryAdapter;
  res.status(ok ? 200 : 503).json({
    message: ok ? 'ok' : 'degraded', status: ok ? 'ok' : 'degraded',
    data: { service: 'shams-elsenaa', version: '1.0.0', time: new Date().toISOString(), env: config.env, checks },
  });
}

healthRouter.get('/health', ah(healthHandler));
