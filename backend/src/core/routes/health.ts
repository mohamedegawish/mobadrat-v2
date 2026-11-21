import { Router } from 'express';
import fs from 'node:fs';
import { config } from '../../config.js';
import { getDb } from '../db/index.js';
import { namespaceDir } from '../http/upload.js';
import { ah } from '../http/errors.js';
import { MODULES } from '../../initiatives/registry.js';

export const healthRouter = Router();

/** Readiness probe: database + schema versions per module + writable upload folder. Reveals no secrets. */
export async function healthHandler(_req: unknown, res: import('express').Response) {
  const checks: Record<string, string> = {};
  let ok = true;
  try {
    await getDb().prepare('SELECT 1').get();
    const rows = await getDb().prepare('SELECT module, MAX(version) AS v FROM schema_migrations GROUP BY module').all() as Array<{ module: string; v: number }>;
    checks.db = `ok (${rows.map((r) => `${r.module} v${r.v}`).join(', ') || 'no schema'})`;
  } catch { checks.db = 'error'; ok = false; }
  try {
    fs.accessSync(namespaceDir('core', 'documents'), fs.constants.W_OK);
    checks.uploads = 'ok';
  } catch { checks.uploads = 'error'; ok = false; }
  checks.modules = MODULES.map((m) => m.id).join(',') || 'none';
  checks.registryAdapter = config.registryAdapter;
  res.status(ok ? 200 : 503).json({
    message: ok ? 'ok' : 'degraded', status: ok ? 'ok' : 'degraded',
    data: { service: 'mobadrat-platform', version: '2.0.0', time: new Date().toISOString(), env: config.env, checks },
  });
}

healthRouter.get('/health', ah(healthHandler));
