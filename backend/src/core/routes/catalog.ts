/**
 * Public site: the initiatives catalog, home banners, public impact numbers. Admin (catalog_manager / super_admin):
 * catalog editing and banner management.
 */
import { Router, type Request } from 'express';
import { ah, apiError, AppError, Errors, okMessage } from '../http/errors.js';
import { clientIp } from '../http/helpers.js';
import { isObj } from '../http/validate.js';
import { coreUserOf, requirePlatformRole } from '../middleware/auth.js';
import { addAuditLog } from '../store/audit.js';
import {
  CATALOG_STATUSES, EDITABLE_CATALOG_FIELDS, createCatalogItem, deleteCatalogItem, getCatalogItem, listCatalog, updateCatalogItem,
} from '../catalog/initiatives.js';
import {
  BANNER_LINK_TYPES, BANNER_PLACEMENTS, MAX_BANNERS, countBanners, createBanner, deleteBanner, getBannerById, getBannerRawImage,
  listBanners, listLiveBanners, reorderBanners, updateBanner, type BannerPatch, type HomeBanner,
} from '../catalog/banners.js';
import { getModule, MODULES } from '../../initiatives/registry.js';
import { publicImpact } from '../stats.js';

export const publicCatalogRouter = Router();
export const adminCatalogRouter = Router();

function withModuleInfo<T extends { moduleId: string | null }>(item: T) {
  const mod = item.moduleId ? getModule(item.moduleId) : undefined;
  return {
    ...item,
    hasModule: Boolean(mod),
    subject: mod?.subject ?? null,
    registerView: mod?.publicRouter ? `i/${mod.id}/register` : null,
    moduleStepsAr: mod?.requirements.moduleStepsAr ?? [],
    moduleStepsEn: mod?.requirements.moduleStepsEn ?? [],
  };
}

publicCatalogRouter.get('/initiatives', ah(async (_req, res) => okMessage(res, 200, 'ok', (await listCatalog()).map(withModuleInfo))));

publicCatalogRouter.get('/initiatives/:idOrSlug', ah(async (req, res) => {
  const item = await getCatalogItem(req.params.idOrSlug);
  if (!item) throw Errors.notFound('المبادرة غير موجودة.', 'Initiative not found.');
  return okMessage(res, 200, 'ok', withModuleInfo(item));
}));

publicCatalogRouter.get('/catalog/impact', ah(async (_req, res) => okMessage(res, 200, 'ok', await publicImpact())));

// ── Banners ──────────────────────────────────────────────────────────────

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGE_CHARS = 1_500_000;
const TEXT_LIMITS = { titleAr: 120, titleEn: 120, subtitleAr: 240, subtitleEn: 240, ctaLabelAr: 40, ctaLabelEn: 40 } as const;

function isHttpUrl(s: string, protocols = ['http:', 'https:']): boolean {
  if (s.length > 1000) return false;
  try { return protocols.includes(new URL(s).protocol); } catch { return false; }
}

function normDate(v: unknown): string | null {
  if (v === '' || v === null) return '';
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function bad(field: string, issue: string, ar: string, en: string): never {
  throw new AppError(400, 'VALIDATION_ERROR', ar, en, [{ field, issue }]);
}

async function parseBannerBody(body: Record<string, unknown>, current?: HomeBanner): Promise<BannerPatch> {
  const patch: BannerPatch = {};
  const imageChanged = body.imageUrl !== undefined && !(current && body.imageUrl === current.imageUrl);
  if (imageChanged || !current) {
    const v = body.imageUrl;
    if (typeof v !== 'string' || !v.trim()) bad('imageUrl', 'required', 'صورة البانر مطلوبة.', 'imageUrl is required.');
    const s = (v as string).trim();
    if (s.length > MAX_IMAGE_CHARS) bad('imageUrl', 'too large', 'حجم صورة البانر كبير جداً — استخدم صورة أصغر.', 'Banner image is too large.');
    const ok = s.startsWith('data:') ? DATA_URL_RE.test(s) : ((s.startsWith('/') && !s.startsWith('//') && s.length <= 500) || isHttpUrl(s, ['https:']));
    if (!ok) bad('imageUrl', 'format', 'صيغة الصورة غير مدعومة — ارفع صورة PNG / JPG / WebP أو رابط https://', 'imageUrl must be an uploaded image or an https:// URL.');
    patch.imageUrl = s;
  }
  for (const [f, max] of Object.entries(TEXT_LIMITS) as Array<[keyof typeof TEXT_LIMITS, number]>) {
    const v = body[f];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v.trim().length > max) bad(f, `string <= ${max}`, `النص طويل جداً (الحد ${max} حرفاً).`, `${f} must be a string of at most ${max} chars.`);
    patch[f] = (v as string).trim();
  }
  if (body.placement !== undefined) {
    if (!BANNER_PLACEMENTS.includes(body.placement as HomeBanner['placement'])) bad('placement', 'invalid', 'مكان العرض غير صالح.', 'Invalid placement.');
    patch.placement = body.placement as HomeBanner['placement'];
  }
  if (body.linkType !== undefined) {
    if (!BANNER_LINK_TYPES.includes(body.linkType as HomeBanner['linkType'])) bad('linkType', 'invalid', 'نوع الرابط غير صالح.', 'Invalid linkType.');
    patch.linkType = body.linkType as HomeBanner['linkType'];
  }
  if (body.linkTarget !== undefined) {
    if (typeof body.linkTarget !== 'string') bad('linkTarget', 'string', 'وجهة الرابط غير صالحة.', 'linkTarget must be a string.');
    patch.linkTarget = (body.linkTarget as string).trim();
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') bad('active', 'boolean', 'حالة الظهور غير صالحة.', 'active must be boolean.');
    patch.active = body.active as boolean;
  }
  for (const f of ['startsAt', 'endsAt'] as const) {
    if (body[f] === undefined) continue;
    const d = normDate(body[f]);
    if (d === null) bad(f, 'ISO date or empty', 'التاريخ غير صالح.', `${f} must be an ISO date or empty.`);
    patch[f] = d as string;
  }
  const linkType = patch.linkType ?? current?.linkType ?? 'none';
  const linkTarget = patch.linkTarget ?? current?.linkTarget ?? '';
  if (linkType === 'none') { if (linkTarget) patch.linkTarget = ''; }
  else if (linkType === 'initiative') {
    if (!linkTarget || !(await getCatalogItem(linkTarget, { includeHidden: true }))) bad('linkTarget', 'initiative not found', 'اختر مبادرة موجودة للرابط.', 'linkTarget must be an existing initiative.');
  } else if (!isHttpUrl(linkTarget)) bad('linkTarget', 'http(s) url', 'الرابط الخارجي يجب أن يبدأ بـ https:// أو http://', 'linkTarget must be an http(s) URL.');
  const startsAt = patch.startsAt ?? current?.startsAt ?? '';
  const endsAt = patch.endsAt ?? current?.endsAt ?? '';
  if (startsAt && endsAt && endsAt <= startsAt) bad('endsAt', '> startsAt', 'تاريخ الانتهاء يجب أن يكون بعد تاريخ البدء.', 'endsAt must be after startsAt.');
  return patch;
}

const bannerLabel = (b: Pick<HomeBanner, 'titleAr' | 'titleEn'>) => { const t = b.titleAr || b.titleEn; return t ? ` «${t}»` : ''; };

async function audit(req: Request, action: string, entityType: string, entityId: string, summaryAr: string, details?: Record<string, unknown>) {
  const u = coreUserOf(req);
  await addAuditLog({ actorType: 'user', actorUserId: u.id, actorName: u.nameAr, actorRole: u.platformRole ?? '', ip: clientIp(req), action, entityType, entityId, summaryAr, details });
}

publicCatalogRouter.get('/highlights', ah(async (_req, res) => okMessage(res, 200, 'ok', await listLiveBanners())));

// Uploaded images are served as binary with a long cache (the URL carries ?v=updatedAt). Public: <img> sends no Bearer.
publicCatalogRouter.get('/highlights/:id/image', ah(async (req, res) => {
  const raw = await getBannerRawImage(req.params.id);
  const m = raw ? DATA_URL_RE.exec(raw) : null;
  if (!m) return apiError(res, 404, 'NOT_FOUND', 'الصورة غير موجودة.', 'Image not found.');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  return res.type(m[1]).send(Buffer.from(m[2], 'base64'));
}));

const contentRoles = requirePlatformRole('super_admin', 'catalog_manager');

adminCatalogRouter.get('/admin/highlights', contentRoles, ah(async (_req, res) => okMessage(res, 200, 'ok', await listBanners())));

adminCatalogRouter.post('/admin/highlights', contentRoles, ah(async (req, res) => {
  if (await countBanners() >= MAX_BANNERS) return apiError(res, 400, 'LIMIT_REACHED', `الحد الأقصى ${MAX_BANNERS} بانراً — احذف بانراً قديماً أولاً.`, `Maximum ${MAX_BANNERS} banners.`);
  const patch = await parseBannerBody((req.body ?? {}) as Record<string, unknown>);
  const created = await createBanner(patch as BannerPatch & { imageUrl: string });
  await audit(req, 'banner.create', 'banner', created.id, `إضافة بانر إعلاني${bannerLabel(created)} في الصفحة الرئيسية`);
  return okMessage(res, 201, 'تمت إضافة البانر', created);
}));

adminCatalogRouter.post('/admin/highlights/reorder', contentRoles, ah(async (req, res) => {
  const ids = (req.body ?? {}).ids as unknown;
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string') || new Set(ids).size !== ids.length) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'قائمة الترتيب غير صالحة.', 'ids must be an array of unique strings.', [{ field: 'ids', issue: 'unique string[]' }]);
  }
  const all = await listBanners();
  const known = new Set(all.map((b) => b.id));
  if ((ids as string[]).some((id) => !known.has(id)) || ids.length !== all.length) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'يجب إرسال كل البانرات في قائمة الترتيب.', 'ids must list every banner.', [{ field: 'ids', issue: 'must include all banners' }]);
  }
  await reorderBanners(ids as string[]);
  await audit(req, 'banner.reorder', 'banner', '', 'إعادة ترتيب بانرات الصفحة الرئيسية');
  return okMessage(res, 200, 'تم حفظ الترتيب', await listBanners());
}));

adminCatalogRouter.put('/admin/highlights/:id', contentRoles, ah(async (req, res) => {
  const current = await getBannerById(req.params.id);
  if (!current) return apiError(res, 404, 'NOT_FOUND', 'البانر غير موجود.', 'Banner not found.');
  const patch = await parseBannerBody((req.body ?? {}) as Record<string, unknown>, current);
  const updated = (await updateBanner(current.id, patch))!;
  await audit(req, 'banner.update', 'banner', current.id, `تعديل بانر إعلاني${bannerLabel(updated)}`);
  return okMessage(res, 200, 'تم حفظ البانر', updated);
}));

adminCatalogRouter.delete('/admin/highlights/:id', contentRoles, ah(async (req, res) => {
  const current = await getBannerById(req.params.id);
  if (!current) return apiError(res, 404, 'NOT_FOUND', 'البانر غير موجود.', 'Banner not found.');
  await deleteBanner(current.id);
  await audit(req, 'banner.delete', 'banner', current.id, `حذف بانر إعلاني${bannerLabel(current)}`);
  return okMessage(res, 200, 'تم حذف البانر', { id: current.id });
}));

// ── Catalog editing ──────────────────────────────────────────────────────

function cleanCatalogPatch(body: unknown, creating: boolean): Record<string, unknown> {
  if (!isObj(body)) throw Errors.validation([{ field: '_body', issue: 'must be a JSON object' }]);
  const out: Record<string, unknown> = {};
  const details: Array<{ field: string; issue: string }> = [];
  for (const [k, v] of Object.entries(body)) {
    if (k === 'moduleId' && creating) continue;
    if (!EDITABLE_CATALOG_FIELDS.includes(k)) { details.push({ field: k, issue: 'unknown field' }); continue; }
    out[k] = v;
  }
  if (out.status !== undefined && !(CATALOG_STATUSES as readonly string[]).includes(String(out.status))) details.push({ field: 'status', issue: 'invalid status' });
  if (out.slug !== undefined && !/^[a-z0-9][a-z0-9-]{1,78}$/.test(String(out.slug))) details.push({ field: 'slug', issue: 'lowercase letters, digits and dashes' });
  if (creating && !String(out.titleAr ?? '').trim()) details.push({ field: 'titleAr', issue: 'required' });
  if (creating && !out.slug) details.push({ field: 'slug', issue: 'required' });
  if (details.length) throw Errors.validation(details);
  return out;
}

adminCatalogRouter.get('/admin/catalog', contentRoles, ah(async (_req, res) => {
  const items = (await listCatalog({ includeHidden: true, includeAdmin: true })).map(withModuleInfo);
  return okMessage(res, 200, 'ok', { items, modules: MODULES.map((m) => ({ id: m.id, titleAr: m.titleAr, titleEn: m.titleEn })) });
}));

adminCatalogRouter.post('/admin/catalog', contentRoles, ah(async (req, res) => {
  const patch = cleanCatalogPatch(req.body, true);
  if (await getCatalogItem(String(patch.slug), { includeHidden: true })) throw Errors.conflict('SLUG_TAKEN', 'الرابط المختصر مستخدم لمبادرة أخرى.', 'The slug is already used.');
  // Only information pages are created here; module-run initiatives are registered by their module (seed / migration).
  const item = await createCatalogItem({ ...patch, titleAr: String(patch.titleAr), slug: String(patch.slug), moduleId: null });
  await audit(req, 'catalog.create', 'initiative', item.id, `إضافة مبادرة للدليل: ${item.titleAr}`);
  return okMessage(res, 201, 'تمت إضافة المبادرة.', item);
}));

adminCatalogRouter.put('/admin/catalog/:id', contentRoles, ah(async (req, res) => {
  const cur = await getCatalogItem(req.params.id, { includeHidden: true });
  if (!cur) throw Errors.notFound();
  const patch = cleanCatalogPatch(req.body, false);
  if (patch.slug && patch.slug !== cur.slug && await getCatalogItem(String(patch.slug), { includeHidden: true })) throw Errors.conflict('SLUG_TAKEN', 'الرابط المختصر مستخدم لمبادرة أخرى.', 'The slug is already used.');
  const item = await updateCatalogItem(cur.id, patch);
  await audit(req, 'catalog.update', 'initiative', cur.id, `تعديل بيانات المبادرة: ${cur.titleAr}`, { fields: Object.keys(patch) });
  return okMessage(res, 200, 'تم حفظ المبادرة.', item);
}));

adminCatalogRouter.delete('/admin/catalog/:id', requirePlatformRole('super_admin'), ah(async (req, res) => {
  const cur = await getCatalogItem(req.params.id, { includeHidden: true });
  if (!cur) throw Errors.notFound();
  if (cur.moduleId) throw Errors.conflict('MODULE_INITIATIVE', 'مبادرة تعمل بنظامها الخاص لا تُحذف — غيّر حالتها إلى «مؤرشفة».', 'A module-run initiative cannot be deleted — archive it instead.');
  await deleteCatalogItem(cur.id);
  await audit(req, 'catalog.delete', 'initiative', cur.id, `حذف مبادرة من الدليل: ${cur.titleAr}`);
  return okMessage(res, 200, 'تم الحذف.', { id: cur.id });
}));
