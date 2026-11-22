/** قراءة عامة لمحتوى الواجهة المعدَّل (بدون مصادقة) — الحفظ/الاستعادة للأدمن في admin.ts. */
import { Router } from 'express';
import { ah, okMessage } from '../http/errors.js';
import { listOverrides } from '../store/siteContent.js';

export const siteContentRouter = Router();

siteContentRouter.get('/site-content', ah(async (_req, res) => {
  const overrides: Record<string, unknown> = {};
  for (const r of await listOverrides()) overrides[r.key] = r.value;
  return okMessage(res, 200, 'ok', { overrides });
}));
