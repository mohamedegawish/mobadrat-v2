/**
 * دليل مقدمي الخدمة — ليس بوابة مقدمين: لا حسابات ولا دخول لهم.
 *  - ENCPC (providerManagerRoles) تدير الدليل: إضافة وتعديل الاسم والتفاصيل ورفع/استبدال الشعار والتفعيل/إلغاء التفعيل.
 *  - PMU (providerApproverRoles) تعتمد وتوقف ما دام shamsPolicy.providerApprovalRequired (★ مقترح، افتراضيًا مطلوب).
 *  - المصنع (وأي دور آخر) يرى المقدمين المتاحين للاختيار فقط (isSelectable): الاسم والتفاصيل والشعار والموقع.
 * أي مقدم يصبح غير متاح وعليه طلبات يمر على applyProviderSuspension في المعاملة نفسها (القاعدة F).
 */
import { Router, type Request } from 'express';
import { ah, okMessage, Errors } from '../http/errors.js';
import { clientIp, str } from '../http/helpers.js';
import { Checker, isEmail, isPhone, isUrl, normalizeDigits, onlyKeys, withHttpScheme, type Obj } from '../http/validate.js';
import { currentUser } from '../middleware/auth.js';
import {
  createProvider, getProvider, isSelectable, listProviders, setProviderActive, setProviderLogo, setProviderStatus, updateProvider,
  PROVIDER_FIELDS, type ProviderInput, type ProviderStatus, type ServiceProvider,
} from '../store/providers.js';
import { addAuditLog, actorFromReq } from '../store/audit.js';
import { shamsPolicy } from '../config/shamsPolicy.js';
import { ORG_IDS, type Role } from '../domain.js';
import { tx } from '../db/sqlite.js';
import { dispatch, orgRecipients } from '../notifications/notify.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { applyProviderSuspension } from '../workflow/providerEvents.js';
import { recordProviderChange } from '../services/providerChanges.js';
import { acceptLogo, deleteLogoFile, discardUpload, sendLogo, singleImageUpload } from '../http/upload.js';

export const providersRouter = Router();

const snapshot = (p: ServiceProvider) => ({ status: p.status as string, isActive: p.isActive === 1 });
const canManage = (role: Role): boolean => shamsPolicy.providerManagerRoles.includes(role);
const canApprove = (role: Role): boolean => shamsPolicy.providerApproverRoles.includes(role);
/** من يرى الدليل كاملًا (كل الحالات): المديرون والمعتمدون. */
const seesAll = (role: Role): boolean => canManage(role) || canApprove(role);

export function cleanProviderInput(body: unknown, creating: boolean): ProviderInput & { nameAr?: string } {
  const b: Obj = onlyKeys(body, PROVIDER_FIELDS);
  const c = new Checker();
  const out: ProviderInput = {};
  out.nameAr = c.text(b, 'nameAr', { required: creating, min: 2, max: 200 });
  out.nameEn = c.text(b, 'nameEn', { max: 200 });
  out.description = c.text(b, 'description', { max: 2000 });
  out.contactName = c.text(b, 'contactName', { max: 200 });
  const phone = c.text(b, 'contactPhone', { max: 30 });
  out.contactPhone = phone === undefined ? undefined : normalizeDigits(phone);
  out.contactEmail = c.text(b, 'contactEmail', { max: 254 });
  const site = c.text(b, 'website', { max: 300 });
  out.website = site === undefined ? undefined : withHttpScheme(site);
  out.notes = c.text(b, 'notes', { max: 2000 });
  if (out.contactPhone && !isPhone(out.contactPhone)) c.add('contactPhone', 'invalid phone number');
  if (out.contactEmail && !isEmail(out.contactEmail)) c.add('contactEmail', 'invalid email');
  if (out.website && !isUrl(out.website)) c.add('website', 'invalid URL');
  c.throwIfAny();
  for (const k of Object.keys(out) as Array<keyof ProviderInput>) if (out[k] === undefined) delete out[k];
  return out;
}

/**
 * full = للمديرين وPMU والربط: كل الحقول. غير ذلك (المصنع وباقي الأدوار): الاسم والتفاصيل والشعار والموقع فقط —
 * بيانات الاتصال الاختيارية لا تُعرض للمصانع (قرار الإدارة: الدليل = اسم + تفاصيل + شعار).
 */
export function publicProvider(p: ServiceProvider, full: boolean) {
  const logoUrl = p.logoStoredName ? `/api/v1/i/shams/service-providers/${p.id}/logo?v=${encodeURIComponent(p.logoSha256?.slice(0, 12) ?? '')}` : null;
  const base = { id: p.id, nameAr: p.nameAr, nameEn: p.nameEn, description: p.description, website: p.website, hasLogo: Boolean(p.logoStoredName), logoUrl, status: p.status };
  if (!full) return base;
  return {
    ...base, contactName: p.contactName, contactPhone: p.contactPhone, contactEmail: p.contactEmail, notes: p.notes,
    isActive: p.isActive === 1, selectable: isSelectable(p), approvalRequired: shamsPolicy.providerApprovalRequired,
    approvedAt: p.approvedAt, approvedBy: p.approvedBy, suspendedAt: p.suspendedAt, deactivatedAt: p.deactivatedAt, createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

providersRouter.get('/service-providers', ah(async (req, res) => {
  const user = currentUser(req);
  if (!seesAll(user.role)) {
    // المصنع وباقي الأدوار: المتاحون للاختيار فقط.
    return okMessage(res, 200, 'ok', { items: (await listProviders({ selectable: true, q: str(req.query.q).slice(0, 100) || undefined })).map((p) => publicProvider(p, false)) });
  }
  const status = (['pending', 'approved', 'suspended'].includes(str(req.query.status)) ? str(req.query.status) : undefined) as ProviderStatus | undefined;
  const active = req.query.active === '1' ? true : req.query.active === '0' ? false : undefined;
  const list = await listProviders({ status, active, q: str(req.query.q).slice(0, 100) || undefined });
  return okMessage(res, 200, 'ok', { items: list.map((p) => publicProvider(p, true)), approvalRequired: shamsPolicy.providerApprovalRequired });
}));

function requireManager(req: Request) {
  const user = currentUser(req);
  if (!canManage(user.role)) throw Errors.forbidden();
  return user;
}
function requireApprover(req: Request) {
  const user = currentUser(req);
  if (!canApprove(user.role)) throw Errors.forbidden();
  if (!shamsPolicy.providerApprovalRequired) {
    throw Errors.conflict('PROVIDER_APPROVAL_DISABLED', 'اعتماد مقدمي الخدمة غير مطلوب حاليًا — التفعيل وإلغاؤه من ENCPC.', 'Provider approval is not required at the moment — activation is managed by ENCPC.');
  }
  return user;
}
async function load(id: string): Promise<ServiceProvider> {
  const p = await getProvider(id);
  if (!p) throw Errors.notFound();
  return p;
}

providersRouter.post('/service-providers', ah(async (req, res) => {
  const user = requireManager(req);
  const input = cleanProviderInput(req.body, true);
  const p = await createProvider(input as ProviderInput & { nameAr: string }, user.id);
  await addAuditLog({ ...actorFromReq(req), action: 'provider.create', entityType: 'service_provider', entityId: p.id, summaryAr: `إضافة مقدم خدمة: ${p.nameAr}` });
  return okMessage(res, 201, 'تمت إضافة مقدم الخدمة (غير مفعّل). أكمل بياناته وشعاره ثم فعّله ليظهر للمصانع.', publicProvider(p, true));
}));

providersRouter.put('/service-providers/:id', ah(async (req, res) => {
  requireManager(req);
  const before = await load(req.params.id);
  const patch = cleanProviderInput(req.body, false);
  // F-04: التعديل وفرقه المنظم وتنبيه PMU في معاملة واحدة. لا تغيير في الاعتماد أو التفعيل.
  const p = await tx(async () => {
    const after = (await updateProvider(before.id, patch))!;
    await recordProviderChange({ before, after, source: 'encpc', actor: actorFromReq(req), action: 'provider.update', summaryAr: `تعديل مقدم خدمة: ${after.nameAr}` });
    return after;
  });
  kickNotificationWorker();
  return okMessage(res, 200, 'تم الحفظ.', publicProvider(p, true));
}));

// ── التفعيل وإلغاؤه (ENCPC) ──
for (const [path, active, ar] of [['activate', true, 'تفعيل'], ['deactivate', false, 'إلغاء تفعيل']] as const) {
  providersRouter.post(`/service-providers/:id/${path}`, ah(async (req, res) => {
    const user = requireManager(req);
    onlyKeys(req.body ?? {}, []);
    const before = await load(req.params.id);
    const after = await tx(async () => {
      const a = (await setProviderActive(before.id, active, user.id))!;
      // يصبح غير متاح وعليه طلبات: عودة آلية/تنبيه حسب مرحلة كل طلب (القاعدة F).
      // F-06: المصدر وحالتا المقدم قبل/بعد وأثره على كل طلب مسجلة في تدقيق المقدم.
      const event = { source: 'encpc_deactivate' as const, before: snapshot(before), after: snapshot(a) };
      const effect = isSelectable(before) && !isSelectable(a)
        ? await applyProviderSuspension({ id: a.id, nameAr: a.nameAr, suspendedAt: a.deactivatedAt }, user, clientIp(req), event) : undefined;
      await addAuditLog({ ...actorFromReq(req), action: `provider.${path}`, entityType: 'service_provider', entityId: a.id, summaryAr: `${ar} مقدم خدمة: ${a.nameAr}`,
        details: { source: active ? 'encpc_activate' : 'encpc_deactivate', providerBefore: event.before, providerAfter: event.after, ...(effect ? { effect } : {}) } });
      // التفعيل ينتظر اعتماد PMU: نبّهها (إن كان الاعتماد مطلوبًا).
      if (active && shamsPolicy.providerApprovalRequired && a.status !== 'approved') {
        await dispatch('ops.provider_pending', { providerNameAr: a.nameAr }, await orgRecipients(ORG_IDS.pmu, 'pmu_reviewer'), { dedupePrefix: `spp:${a.id}:${a.updatedAt}`, channels: ['email'] });
      }
      return a;
    });
    kickNotificationWorker();
    return okMessage(res, 200, 'تم التحديث.', publicProvider(after, true));
  }));
}

// ── الاعتماد والإيقاف (PMU) ──
for (const [path, status, ar] of [['approve', 'approved', 'اعتماد'], ['suspend', 'suspended', 'إيقاف']] as const) {
  providersRouter.post(`/service-providers/:id/${path}`, ah(async (req, res) => {
    const user = requireApprover(req);
    onlyKeys(req.body ?? {}, []);
    const before = await load(req.params.id);
    const p = await tx(async () => {
      const after = (await setProviderStatus(before.id, status, user.id))!;
      const event = { source: 'pmu_suspend' as const, before: snapshot(before), after: snapshot(after) };
      const effect = isSelectable(before) && !isSelectable(after) ? await applyProviderSuspension(after, user, clientIp(req), event) : undefined;
      await addAuditLog({ ...actorFromReq(req), action: `provider.${path}`, entityType: 'service_provider', entityId: after.id, summaryAr: `${ar} مقدم خدمة: ${after.nameAr}`,
        details: { source: status === 'suspended' ? 'pmu_suspend' : 'pmu_approve', providerBefore: event.before, providerAfter: event.after, ...(effect ? { effect } : {}) } });
      return after;
    });
    kickNotificationWorker();
    return okMessage(res, 200, 'تم التحديث.', publicProvider(p, true));
  }));
}

// ── الشعار: رفع أو استبدال (ENCPC) ──
// الفحص قبل قبول الملف: غير المخوَّل يُحذف ملفه المؤقت فورًا.
providersRouter.post('/service-providers/:id/logo', singleImageUpload, ah(async (req, res) => {
  try {
    requireManager(req);
    await load(req.params.id);
  } catch (e) { discardUpload(req.file); throw e; }
  const stored = acceptLogo(req.file);
  const prev = await tx(async () => {
    const before = (await getProvider(req.params.id))!;
    const old = await setProviderLogo(req.params.id, { storedName: stored.storedName, mime: stored.mime, sha256: stored.sha256 });
    const after = (await getProvider(req.params.id))!;
    // F-04: بصمة الشعار قبل/بعد في التدقيق، وتنبيه PMU إن كان المقدم معتمدًا.
    await recordProviderChange({
      before, after, source: 'encpc', actor: actorFromReq(req), action: 'provider.logo', summaryAr: `رفع/استبدال شعار مقدم الخدمة ${after.nameAr}`,
      extraDetails: { sha256: stored.sha256, mime: stored.mime, sizeBytes: stored.sizeBytes },
    });
    return old;
  });
  kickNotificationWorker();
  deleteLogoFile(prev);
  return okMessage(res, 200, 'تم حفظ الشعار.', publicProvider((await getProvider(req.params.id))!, true));
}));

/** تقديم الشعار: المتاح للاختيار لأي مستخدم مسجل، وغير المتاح للمديرين وPMU فقط (404 لغيرهم — لا كشف). */
providersRouter.get('/service-providers/:id/logo', ah(async (req, res) => {
  const user = currentUser(req);
  const p = await getProvider(req.params.id);
  if (!p || !p.logoStoredName || !p.logoMime) throw Errors.notFound();
  if (!isSelectable(p) && !seesAll(user.role)) throw Errors.notFound();
  sendLogo(res, p.logoStoredName, p.logoMime);
}));
