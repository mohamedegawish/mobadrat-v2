/**
 * The signed-in person's platform space: memberships (the initiative chooser), the shared profile (person + factories +
 * reusable documents), "what is missing to apply to initiative X", enrolling, and the unified notifications inbox.
 */
import { Router } from 'express';
import { tx } from '../db/index.js';
import { ah, apiError, AppError, Errors, okMessage, type ErrorDetail } from '../http/errors.js';
import { clientIp, normPage, normPageSize, paginate } from '../http/helpers.js';
import { isObj, onlyKeys } from '../http/validate.js';
import { makeLimiter, byUser } from '../http/rateLimits.js';
import { coreUserOf } from '../middleware/auth.js';
import { toPublicCoreUser, PLATFORM_ROLE_LABELS, getUserById } from '../store/users.js';
import { getMembership, listMembershipsOfUser } from '../store/memberships.js';
import { listUserNotifications, markAllRead, markRead, unreadCount, unreadCountsByInitiative } from '../store/userNotifications.js';
import { addAuditLog } from '../store/audit.js';
import { acceptPdf, discardUpload, sendPdfFile, singlePdfUpload, storedPathIn } from '../http/upload.js';
import { cleanProfileValue, DOC_KIND_BY_KEY, FIELD_BY_KEY, PROFILE_DOC_KINDS, PROFILE_FIELDS, type ProfileScope } from '../profile/catalog.js';
import {
  addProfileDocument, createFactoryProfile, factoryMemberRole, getFactoryProfile, getPersonProfile, getProfileDocument,
  listCurrentDocuments, listFactoryProfilesOfUser, savePersonProfile, saveFactoryProfile,
} from '../profile/store.js';
import { computeRequirements } from '../profile/requirements.js';
import { getCatalogByModule, getCatalogItem } from '../catalog/initiatives.js';
import { listGovernorates } from '../reference/locations.js';
import { MODULES, getModule } from '../../initiatives/registry.js';
import type { InitiativeModule } from '../../initiatives/contract.js';
import { dispatchCore } from '../notify/dispatch.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { config } from '../../config.js';

export const meRouter = Router();
const uploadLimiter = makeLimiter('upload', { keyGenerator: (req) => `u:${(req as { coreUser?: { id: string } }).coreUser?.id ?? ''}` });

/** Public metadata of the shared profile (field catalog, document kinds, governorates) — the profile/complete-data UI. */
export const profileMetaRouter = Router();
profileMetaRouter.get('/meta/profile', ah((_req, res) => okMessage(res, 200, 'ok', {
  fields: PROFILE_FIELDS, documentKinds: PROFILE_DOC_KINDS, governorates: listGovernorates(),
})));

// ── Who am I + my initiatives (hub) ───────────────────────────────────────

meRouter.get('/me', ah(async (req, res) => {
  const user = coreUserOf(req);
  const memberships = await listMembershipsOfUser(user.id);
  const unread = await unreadCountsByInitiative(user.id);
  const items = [];
  for (const m of memberships) {
    const mod = getModule(m.initiativeId);
    const cat = await getCatalogByModule(m.initiativeId) ?? await getCatalogItem(m.initiativeId, { includeHidden: true });
    if (!mod) continue;
    const role = mod.roles.find((r) => r.key === m.role);
    let access = { status: 'full' } as Awaited<ReturnType<InitiativeModule['access']>>;
    let card = null;
    if (m.status === 'active') {
      try { access = await mod.access(user, m); } catch { access = { status: 'full' }; }
      try { card = await mod.hubCard(user, m); } catch { card = null; }
    }
    items.push({
      initiativeId: m.initiativeId, slug: cat?.slug ?? m.initiativeId, titleAr: cat?.titleAr ?? mod.titleAr, titleEn: cat?.titleEn ?? mod.titleEn,
      themeColor: cat?.themeColor ?? '#0B2545', accentColor: cat?.accentColor ?? '#C8102E', logoImage: cat?.logoImage ?? '',
      role: m.role, roleKind: role?.kind ?? 'applicant', roleLabelAr: role?.labelAr ?? m.role, roleLabelEn: role?.labelEn ?? m.role,
      status: m.status, access, card, defaultView: mod.defaultView(m.role), unread: unread[m.initiativeId] ?? 0,
    });
  }
  // A platform super admin can open every module as its administrator, without a membership.
  const adminEntries = user.platformRole === 'super_admin'
    ? MODULES.filter((mod) => !memberships.some((m) => m.initiativeId === mod.id)).map((mod) => ({ initiativeId: mod.id, defaultView: mod.defaultView(mod.adminRole), role: mod.adminRole, titleAr: mod.titleAr, titleEn: mod.titleEn }))
    : [];
  const person = await getPersonProfile(user.id);
  return okMessage(res, 200, 'ok', {
    user: toPublicCoreUser(user),
    platformRoleLabel: user.platformRole ? PLATFORM_ROLE_LABELS[user.platformRole] : null,
    memberships: items, adminEntries, unreadTotal: Object.values(unread).reduce((a, b) => a + b, 0),
    profile: { personUpdatedAt: person.updatedAt, factories: (await listFactoryProfilesOfUser(user.id)).length },
  });
}));

// ── Person profile ────────────────────────────────────────────────────────

function cleanValues(scope: ProfileScope, body: unknown, existing: Record<string, unknown>): Record<string, unknown> {
  if (!isObj(body) || !isObj(body.values)) throw Errors.validation([{ field: 'values', issue: 'must be an object of profile keys' }]);
  const input = body.values as Record<string, unknown>;
  const details: ErrorDetail[] = [];
  const out: Record<string, unknown> = {};
  const ctx = { ...existing, ...input };
  for (const [k, raw] of Object.entries(input)) {
    const f = FIELD_BY_KEY.get(k);
    if (!f || f.scope !== scope) { details.push({ field: k, issue: 'unknown field' }); continue; }
    const r = cleanProfileValue(f, raw, ctx);
    if ('issue' in r) details.push({ field: k, issue: r.issue }); else out[k] = r.value;
  }
  if (details.length) throw Errors.validation(details);
  return out;
}

meRouter.get('/me/profile', ah(async (req, res) => {
  const user = coreUserOf(req);
  const p = await getPersonProfile(user.id);
  const docs = await listCurrentDocuments('person', user.id);
  return okMessage(res, 200, 'ok', { values: p.values, version: p.version, updatedAt: p.updatedAt, documents: docs.map(publicDoc), email: user.email });
}));

meRouter.put('/me/profile', ah(async (req, res) => {
  const user = coreUserOf(req);
  const current = await getPersonProfile(user.id);
  const values = cleanValues('person', req.body, current.values);
  // The national ID is identity data: once set it is changed only by the platform administration (formal request).
  if ('person.nationalId' in values && current.values['person.nationalId'] && values['person.nationalId'] !== current.values['person.nationalId']) {
    throw new AppError(409, 'LOCKED_FIELD', 'لا يمكن تعديل الرقم القومي بعد حفظه — تواصل مع إدارة المنصة.', 'The national ID cannot be changed once saved — contact the platform administration.', [{ field: 'person.nationalId', issue: 'locked' }]);
  }
  const saved = await tx(async () => {
    const p = await savePersonProfile(user.id, values);
    await addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, ip: clientIp(req), action: 'profile.person_updated', entityType: 'person_profile', entityId: user.id, summaryAr: 'تحديث الملف الشخصي', details: { fields: Object.keys(values) } });
    return p;
  });
  return okMessage(res, 200, 'تم حفظ البيانات.', { values: saved.values, version: saved.version });
}));

// ── Factory profiles ──────────────────────────────────────────────────────

meRouter.get('/me/factories', ah(async (req, res) => {
  const user = coreUserOf(req);
  const list = await listFactoryProfilesOfUser(user.id);
  const out = [];
  for (const f of list) out.push({ id: f.id, role: f.role, values: f.values, version: f.version, updatedAt: f.updatedAt, documents: (await listCurrentDocuments('factory', f.id)).map(publicDoc) });
  return okMessage(res, 200, 'ok', { items: out });
}));

meRouter.post('/me/factories', ah(async (req, res) => {
  const user = coreUserOf(req);
  const values = cleanValues('factory', req.body, {});
  if (!values['factory.companyName']) throw Errors.validation([{ field: 'factory.companyName', issue: 'required' }]);
  if ((await listFactoryProfilesOfUser(user.id)).length >= 10) throw new AppError(409, 'LIMIT_REACHED', 'الحد الأقصى 10 منشآت لكل حساب.', 'At most 10 factories per account.');
  const f = await tx(async () => {
    const created = await createFactoryProfile(user.id, values);
    await addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, ip: clientIp(req), action: 'profile.factory_created', entityType: 'factory_profile', entityId: created.id, summaryAr: `إضافة منشأة: ${String(values['factory.companyName'])}` });
    return created;
  });
  return okMessage(res, 201, 'تمت إضافة المنشأة.', { id: f.id, values: f.values });
}));

meRouter.put('/me/factories/:id', ah(async (req, res) => {
  const user = coreUserOf(req);
  const role = await factoryMemberRole(req.params.id, user.id);
  if (!role) throw Errors.notFound();
  if (role !== 'owner') throw Errors.forbidden('تعديل بيانات المنشأة لمالكها فقط.', 'Only the owner can edit the factory.');
  const cur = await getFactoryProfile(req.params.id);
  const values = cleanValues('factory', req.body, cur?.values ?? {});
  const f = await tx(async () => {
    const saved = await saveFactoryProfile(req.params.id, values);
    await addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, ip: clientIp(req), action: 'profile.factory_updated', entityType: 'factory_profile', entityId: req.params.id, summaryAr: 'تحديث بيانات المنشأة', details: { fields: Object.keys(values) } });
    return saved;
  });
  return okMessage(res, 200, 'تم حفظ بيانات المنشأة.', { id: f!.id, values: f!.values, version: f!.version });
}));

// ── Reusable documents ────────────────────────────────────────────────────

function publicDoc(d: { id: string; kind: string; originalName: string; sizeBytes: number; sha256: string; createdAt: string; version: number }) {
  return { id: d.id, kind: d.kind, originalName: d.originalName, sizeBytes: d.sizeBytes, createdAt: d.createdAt, version: d.version };
}

async function assertOwner(userId: string, ownerType: ProfileScope, ownerId: string): Promise<void> {
  if (ownerType === 'person') { if (ownerId !== userId) throw Errors.notFound(); return; }
  if (!(await factoryMemberRole(ownerId, userId))) throw Errors.notFound();
}

meRouter.post('/me/profile-documents', uploadLimiter, singlePdfUpload, ah(async (req, res) => {
  const user = coreUserOf(req);
  try {
    const b = req.body as Record<string, unknown>;
    const kind = String(b.kind ?? '');
    const def = DOC_KIND_BY_KEY.get(kind);
    if (!def) throw Errors.validation([{ field: 'kind', issue: 'unknown document kind' }]);
    const ownerType = def.scope;
    const ownerId = ownerType === 'person' ? user.id : String(b.ownerId ?? '');
    await assertOwner(user.id, ownerType, ownerId);
    const stored = acceptPdf(req.file, 'core');
    const doc = await tx(async () => {
      const d = await addProfileDocument({ ownerType, ownerId, kind, ...stored, uploadedBy: user.id });
      await addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, ip: clientIp(req), action: 'profile.document_uploaded', entityType: 'profile_document', entityId: d.id, summaryAr: `رفع مستند: ${def.labelAr}`, details: { sha256: d.sha256 } });
      return d;
    });
    return okMessage(res, 201, 'تم رفع المستند.', publicDoc(doc));
  } catch (e) { discardUpload(req.file); throw e; }
}));

meRouter.get('/me/profile-documents/:id/download', ah(async (req, res) => {
  const user = coreUserOf(req);
  const d = await getProfileDocument(req.params.id);
  if (!d) throw Errors.notFound();
  await assertOwner(user.id, d.ownerType, d.ownerId);
  sendPdfFile(res, storedPathIn('core', d.storedName), d.originalName, req.query.inline === '1');
}));

// ── Requirements ("what is missing") and enrolling ────────────────────────

async function moduleForSlug(slug: string): Promise<{ mod: InitiativeModule; titleAr: string; titleEn: string; registrationOpen: boolean; status: string }> {
  const cat = await getCatalogItem(slug);
  const mod = cat?.moduleId ? getModule(cat.moduleId) : undefined;
  if (!cat || !mod) throw Errors.notFound('المبادرة غير موجودة أو لا تقبل التقديم عبر المنصة.', 'Initiative not found or not open for applications on the platform.');
  return { mod, titleAr: cat.titleAr, titleEn: cat.titleEn, registrationOpen: cat.registrationOpen, status: cat.status };
}

meRouter.get('/me/initiatives/:slug/requirements', ah(async (req, res) => {
  const user = coreUserOf(req);
  const { mod, titleAr, titleEn, registrationOpen, status } = await moduleForSlug(req.params.slug);
  const membership = await getMembership(user.id, mod.id);
  const r = await computeRequirements(mod.requirements, user, typeof req.query.factoryId === 'string' ? req.query.factoryId : null);
  const blockers = [...r.blockers];
  if (!registrationOpen || status !== 'active') blockers.unshift({ code: 'REGISTRATION_CLOSED', messageAr: 'التقديم على هذه المبادرة غير متاح حاليًا.', messageEn: 'Applications to this initiative are not open now.' });
  return okMessage(res, 200, 'ok', {
    initiativeId: mod.id, titleAr, titleEn, enrolled: Boolean(membership), membershipStatus: membership?.status ?? null,
    membershipRole: membership?.role ?? null, defaultView: membership ? mod.defaultView(membership.role) : null,
    ...r, blockers, complete: r.complete && blockers.length === 0,
  });
}));

const enrollLimiter = makeLimiter('actions', { keyGenerator: byUser });

meRouter.post('/me/initiatives/:slug/enroll', enrollLimiter, ah(async (req, res) => {
  const user = coreUserOf(req);
  const b = onlyKeys(req.body ?? {}, ['factoryId']);
  const { mod, titleAr, titleEn, registrationOpen, status } = await moduleForSlug(req.params.slug);
  if (!registrationOpen || status !== 'active') throw new AppError(409, 'REGISTRATION_CLOSED', 'التقديم على هذه المبادرة غير متاح حاليًا.', 'Applications to this initiative are not open now.');
  const existing = await getMembership(user.id, mod.id);
  if (existing) {
    if (existing.status !== 'active') throw new AppError(403, 'MEMBERSHIP_SUSPENDED', 'عضويتك في هذه المبادرة موقوفة — تواصل مع إدارة المبادرة.', 'Your membership in this initiative is suspended.');
    return okMessage(res, 200, 'أنت مسجل بالفعل في هذه المبادرة.', { initiativeId: mod.id, view: mod.defaultView(existing.role), alreadyEnrolled: true });
  }
  const factoryId = typeof b.factoryId === 'string' && b.factoryId ? b.factoryId : null;
  const r = await computeRequirements(mod.requirements, user, factoryId);
  if (!r.complete) {
    const details: ErrorDetail[] = [
      ...(r.needsFactory ? [{ field: 'factoryId', issue: 'required' }] : []),
      ...r.missing.map((m) => ({ field: m.key, issue: 'required' })),
      ...r.missingDocuments.map((d) => ({ field: d.kind, issue: 'required file' })),
      ...r.blockers.map((x) => ({ field: '_blocker', issue: x.code })),
    ];
    const blocker = r.blockers[0];
    if (blocker && !r.missing.length && !r.missingDocuments.length && !r.needsFactory) throw new AppError(409, blocker.code, blocker.messageAr, blocker.messageEn, details);
    throw new AppError(422, 'REQUIREMENTS_MISSING', 'استكمل البيانات المطلوبة للتقديم على هذه المبادرة أولًا.', 'Complete the data required by this initiative first.', details);
  }
  let result: Awaited<ReturnType<typeof mod.enroll>>;
  try {
    result = await tx(() => mod.enroll(user, { factoryProfileId: r.selectedFactoryId, ip: clientIp(req) }));
  } catch (e) {
    // Two enrolments of the same person at once (double click, two tabs): the other one opened the file first.
    const won = await getMembership(user.id, mod.id);
    if (won) return okMessage(res, 200, 'أنت مسجل بالفعل في هذه المبادرة.', { initiativeId: mod.id, view: mod.defaultView(won.role), alreadyEnrolled: true });
    throw e;
  }
  const fresh = (await getUserById(user.id))!;
  await dispatchCore('platform.enrolled', { name: fresh.nameAr, initiativeAr: titleAr, initiativeEn: titleEn, link: `${config.appUrl}/#i/${mod.id}/${result.view}` },
    [{ userId: fresh.id, email: fresh.email }], { dedupePrefix: `enrolled:${fresh.id}:${mod.id}`, channels: ['email'], inboxLink: `i/${mod.id}/${result.view}` });
  kickNotificationWorker();
  return okMessage(res, 201, `فُتح لك ملف تقديم في «${titleAr}».`, { initiativeId: mod.id, ...result });
}));

// ── Unified notifications inbox (all initiatives) ─────────────────────────

meRouter.get('/me/notifications', ah(async (req, res) => {
  const user = coreUserOf(req);
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 20, 50);
  const initiativeId = typeof req.query.initiativeId === 'string' && req.query.initiativeId ? req.query.initiativeId : undefined;
  const { rows, total } = await listUserNotifications(user.id, { unreadOnly: req.query.unread === '1', initiativeId }, page, pageSize);
  const items = rows.map((n) => ({
    id: n.id, initiativeId: n.initiativeId, applicationId: n.applicationId, templateKey: n.templateKey, title: n.title, body: n.body,
    // Module links are relative to the module's screens; the platform prefixes them.
    link: n.link ? (n.initiativeId && !n.link.startsWith('i/') ? `i/${n.initiativeId}/${n.link}` : n.link) : (n.initiativeId ? `i/${n.initiativeId}` : ''),
    readAt: n.readAt, createdAt: n.createdAt,
  }));
  return okMessage(res, 200, 'ok', { ...paginate(items, total, page, pageSize), unread: await unreadCount(user.id) });
}));

meRouter.get('/me/notifications/unread-count', ah(async (req, res) => {
  const user = coreUserOf(req);
  return okMessage(res, 200, 'ok', { count: await unreadCount(user.id), byInitiative: await unreadCountsByInitiative(user.id) });
}));

meRouter.post('/me/notifications/read-all', ah(async (req, res) => {
  const user = coreUserOf(req);
  const initiativeId = typeof req.body?.initiativeId === 'string' ? req.body.initiativeId : undefined;
  return okMessage(res, 200, 'ok', { marked: await markAllRead(user.id, initiativeId) });
}));

meRouter.post('/me/notifications/:id/read', ah(async (req, res) => {
  const user = coreUserOf(req);
  const r = await markRead(user.id, req.params.id);
  if (r === 'not_found') return apiError(res, 404, 'NOT_FOUND', 'الإشعار غير موجود.', 'Notification not found.');
  return okMessage(res, 200, 'ok');
}));
