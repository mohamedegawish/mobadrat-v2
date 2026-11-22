/**
 * The platform's unified directory of bodies (دليل الجهات): one record per real body (IMC, ENCPC, a funder, a bank…), linked
 * to its organization in each initiative it takes part in, with its activity across initiatives (staff, decisions, pending
 * work). Viewing: super admin, ministry viewer, auditor. Managing: super admin. Links never grant access.
 */
import { Router, type Request } from 'express';
import { tx } from '../db/index.js';
import { ah, AppError, Errors, okMessage } from '../http/errors.js';
import { clientIp } from '../http/helpers.js';
import { Checker, isEmail, isPhone, isUrl, onlyKeys, withHttpScheme, type Obj } from '../http/validate.js';
import { coreUserOf, requirePlatformRole } from '../middleware/auth.js';
import { addAuditLog } from '../store/audit.js';
import { listMemberships } from '../store/memberships.js';
import { getUserNamesByIds, getUserById } from '../store/users.js';
import { getCatalogItem } from '../catalog/initiatives.js';
import { MODULES, getModule } from '../../initiatives/registry.js';
import type { BodyActivity, ModuleBody } from '../../initiatives/contract.js';
import {
  addLink, BODY_KIND_LABELS, BODY_KINDS, bodyAlreadyInInitiative, createBody, deleteBody, findLinkOfBody, findLinkOfOrganization, getBody,
  listBodies, listLinks, nameKey, orgAlreadyLinked, removeLink, updateBody, type BodyInput, type BodyKind, type PlatformBody,
} from '../bodies/store.js';

export const bodiesRouter = Router();

const viewers = requirePlatformRole('super_admin', 'ministry_viewer', 'auditor');
const superAdmin = requirePlatformRole('super_admin');

async function audit(req: Request, action: string, bodyId: string, summaryAr: string, details?: Record<string, unknown>, initiativeId: string | null = null) {
  const u = coreUserOf(req);
  await addAuditLog({ initiativeId, actorType: 'user', actorUserId: u.id, actorName: u.nameAr, actorRole: u.platformRole ?? '', ip: clientIp(req), action, entityType: 'platform_body', entityId: bodyId, summaryAr, details });
}

// ── input ─────────────────────────────────────────────────────────────────

function readBody(b: Obj, partial: boolean): Partial<BodyInput> & { isActive?: boolean } {
  const c = new Checker();
  const out: Partial<BodyInput> & { isActive?: boolean } = {};
  const nameAr = c.text(b, 'nameAr', { required: !partial, min: 2, max: 200 });
  if (nameAr !== undefined) out.nameAr = nameAr;
  const nameEn = c.text(b, 'nameEn', { max: 200 });
  if (nameEn !== undefined || (!partial)) out.nameEn = nameEn ?? '';
  if (b.kind !== undefined || !partial) {
    if (!BODY_KINDS.includes(b.kind as BodyKind)) c.add('kind', `one of ${BODY_KINDS.join(', ')}`);
    else out.kind = b.kind as BodyKind;
  }
  const description = c.text(b, 'description', { max: 2000 });
  if (description !== undefined || !partial) out.description = description ?? '';
  const email = c.text(b, 'contactEmail', { max: 254 });
  if (email && !isEmail(email)) c.add('contactEmail', 'invalid email');
  if (email !== undefined || !partial) out.contactEmail = (email ?? '').toLowerCase();
  if (b.contactEmail === '' && partial) out.contactEmail = '';
  const phone = c.text(b, 'contactPhone', { max: 40 });
  if (phone && !isPhone(phone)) c.add('contactPhone', 'invalid phone number');
  if (phone !== undefined || !partial) out.contactPhone = phone ?? '';
  if (b.contactPhone === '' && partial) out.contactPhone = '';
  const site = c.text(b, 'website', { max: 300 });
  const url = site ? withHttpScheme(site) : site;
  if (url && !(isUrl(url) && new URL(url).hostname.includes('.'))) c.add('website', 'invalid URL (http/https)');
  if (url !== undefined || !partial) out.website = url ?? '';
  if (b.website === '' && partial) out.website = '';
  if (b.isActive !== undefined) {
    if (typeof b.isActive !== 'boolean') c.add('isActive', 'must be true or false');
    else out.isActive = b.isActive;
  }
  c.throwIfAny();
  return out;
}

const STR = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

// ── presentation ──────────────────────────────────────────────────────────

/** The participating-body organizations of every initiative (one initiative failing does not hide the others). */
async function moduleOrganizations(): Promise<Map<string, Map<string, ModuleBody>>> {
  const out = new Map<string, Map<string, ModuleBody>>();
  for (const m of MODULES) {
    try { out.set(m.id, new Map((await m.bodies.list()).map((o) => [o.id, o]))); } catch { out.set(m.id, new Map()); }
  }
  return out;
}

async function present(bodies: PlatformBody[]) {
  const links = await listLinks(bodies.map((b) => b.id));
  const orgs = await moduleOrganizations();
  const activity = new Map<string, Record<string, BodyActivity>>();
  for (const m of MODULES) {
    const ids = links.filter((l) => l.initiativeId === m.id).map((l) => l.organizationId);
    try { activity.set(m.id, ids.length ? await m.bodies.activity(ids) : {}); } catch { activity.set(m.id, {}); }
  }
  return bodies.map((b) => {
    const mine = links.filter((l) => l.bodyId === b.id).map((l) => {
      const mod = getModule(l.initiativeId);
      const org = orgs.get(l.initiativeId)?.get(l.organizationId) ?? null;
      return {
        initiativeId: l.initiativeId, titleAr: mod?.titleAr ?? l.initiativeId, titleEn: mod?.titleEn ?? l.initiativeId,
        organizationId: l.organizationId, organization: org, missing: !org,
        activity: activity.get(l.initiativeId)?.[l.organizationId] ?? null, linkedAt: l.createdAt,
      };
    });
    const totals = mine.reduce((t, l) => ({
      staff: t.staff + (l.activity?.staff ?? 0), decisions: t.decisions + (l.activity?.decisions ?? 0), pending: t.pending + (l.activity?.pending ?? 0),
      lastActivityAt: [t.lastActivityAt, l.activity?.lastActivityAt].filter((x): x is string => Boolean(x)).sort().pop() ?? null,
    }), { staff: 0, decisions: 0, pending: 0, lastActivityAt: null as string | null });
    return { ...b, kindLabelAr: BODY_KIND_LABELS[b.kind].ar, kindLabelEn: BODY_KIND_LABELS[b.kind].en, links: mine, totals: { ...totals, initiatives: mine.length } };
  });
}

const meta = () => ({
  kinds: BODY_KINDS.map((k) => ({ key: k, labelAr: BODY_KIND_LABELS[k].ar, labelEn: BODY_KIND_LABELS[k].en })),
  initiatives: MODULES.map((m) => ({ id: m.id, titleAr: m.titleAr, titleEn: m.titleEn })),
});

// ── link rules ────────────────────────────────────────────────────────────

/** Validates one link request; returns the organization, or null when the very same link already exists. */
async function checkLink(body: PlatformBody, initiativeIdRaw: unknown, organizationIdRaw: unknown): Promise<{ initiativeId: string; organizationId: string; org: ModuleBody } | null> {
  const initiativeId = STR(initiativeIdRaw);
  const organizationId = STR(organizationIdRaw);
  const c = new Checker();
  if (!initiativeId) c.add('initiativeId', 'required');
  if (!organizationId) c.add('organizationId', 'required');
  c.throwIfAny();
  const mod = getModule(initiativeId);
  if (!mod) {
    if (await getCatalogItem(initiativeId, { includeHidden: true, includeAdmin: true })) {
      throw new AppError(422, 'INITIATIVE_HAS_NO_MODULE', 'هذه المبادرة صفحة معلومات فقط وليس لها جهات بعد.', 'This initiative is an information page only and has no bodies yet.', [{ field: 'initiativeId', issue: 'no module' }]);
    }
    throw new AppError(404, 'INITIATIVE_NOT_FOUND', 'المبادرة غير موجودة.', 'Initiative not found.', [{ field: 'initiativeId', issue: 'unknown' }]);
  }
  const org = (await mod.bodies.list()).find((o) => o.id === organizationId);
  if (!org) {
    throw new AppError(422, 'NOT_A_BODY', 'هذه ليست جهة مشاركة في المبادرة (أو غير موجودة) — لا تُربط جهات المتقدمين والمصانع.', 'This is not a participating body of the initiative (or does not exist). Applicant and factory organizations cannot be linked.', [{ field: 'organizationId', issue: 'not a body' }]);
  }
  if (!body.isActive) throw new AppError(409, 'BODY_INACTIVE', 'الجهة موقوفة في دليل المنصة — فعّلها أولًا.', 'The body is inactive in the platform directory. Activate it first.');
  const existing = await findLinkOfOrganization(initiativeId, organizationId);
  if (existing) {
    if (existing.bodyId === body.id) return null;
    throw orgAlreadyLinked();
  }
  const other = await findLinkOfBody(body.id, initiativeId);
  if (other) throw bodyAlreadyInInitiative();
  return { initiativeId, organizationId, org };
}

// ── routes ────────────────────────────────────────────────────────────────

bodiesRouter.get('/admin/bodies', viewers, ah(async (req, res) => {
  const q = STR(req.query.q).slice(0, 100) || undefined;
  const kind = STR(req.query.kind) || undefined;
  const status = STR(req.query.status) || undefined;
  const initiativeId = STR(req.query.initiativeId) || undefined;
  const c = new Checker();
  if (kind && !BODY_KINDS.includes(kind as BodyKind)) c.add('kind', 'invalid');
  if (status && status !== 'active' && status !== 'inactive') c.add('status', 'active | inactive');
  c.throwIfAny();
  const items = await present(await listBodies({ q, kind: kind as BodyKind | undefined, status: status as 'active' | 'inactive' | undefined, initiativeId }));
  return okMessage(res, 200, 'ok', { items, ...meta() });
}));

/** Every body organization of every initiative with its platform body (or none), and link suggestions for the unlinked. */
bodiesRouter.get('/admin/bodies/organizations', viewers, ah(async (_req, res) => {
  const orgs = await moduleOrganizations();
  const links = await listLinks();
  const bodyIds = [...new Set(links.map((l) => l.bodyId))];
  const bodies = new Map((await Promise.all(bodyIds.map((id) => getBody(id)))).filter((b): b is PlatformBody => Boolean(b)).map((b) => [b.id, b]));
  const items = [];
  for (const m of MODULES) {
    for (const o of orgs.get(m.id)?.values() ?? []) {
      const l = links.find((x) => x.initiativeId === m.id && x.organizationId === o.id);
      const b = l ? bodies.get(l.bodyId) : undefined;
      items.push({ initiativeId: m.id, titleAr: m.titleAr, titleEn: m.titleEn, organization: o, body: b ? { id: b.id, nameAr: b.nameAr, nameEn: b.nameEn } : null });
    }
  }
  // Same real body in several initiatives, not linked yet: same name (ignoring the parenthesised part, diacritics, case).
  const groups = new Map<string, typeof items>();
  for (const it of items.filter((x) => !x.body)) groups.set(nameKey(it.organization.nameAr), [...(groups.get(nameKey(it.organization.nameAr)) ?? []), it]);
  const suggestions = [...groups.values()]
    .filter((g) => new Set(g.map((x) => x.initiativeId)).size > 1)
    .map((g) => ({ nameAr: g[0].organization.nameAr, nameEn: g[0].organization.nameEn, organizations: g.map((x) => ({ initiativeId: x.initiativeId, titleAr: x.titleAr, organizationId: x.organization.id, nameAr: x.organization.nameAr })) }));
  return okMessage(res, 200, 'ok', { items, suggestions, ...meta() });
}));

bodiesRouter.get('/admin/bodies/:id', viewers, ah(async (req, res) => {
  const b = await getBody(req.params.id);
  if (!b) throw Errors.notFound('الجهة غير موجودة في دليل المنصة.', 'Body not found.');
  const [item] = await present([b]);
  // The people of the body in each initiative it takes part in (their memberships there).
  const people = [];
  for (const l of item.links) {
    const mod = getModule(l.initiativeId);
    const ms = await listMemberships({ initiativeId: l.initiativeId, organizationId: l.organizationId });
    const names = await getUserNamesByIds(new Set(ms.map((m) => m.userId)));
    for (const m of ms) {
      const u = await getUserById(m.userId);
      const role = mod?.roles.find((r) => r.key === m.role);
      people.push({
        userId: m.userId, nameAr: names.get(m.userId) ?? u?.nameAr ?? m.userId, email: u?.email ?? '', isActive: Boolean(u?.isActive),
        initiativeId: l.initiativeId, titleAr: l.titleAr, role: m.role, roleLabelAr: role?.labelAr ?? m.role, roleLabelEn: role?.labelEn ?? m.role, status: m.status,
      });
    }
  }
  return okMessage(res, 200, 'ok', { ...item, people, ...meta() });
}));

bodiesRouter.post('/admin/bodies', superAdmin, ah(async (req, res) => {
  const b = onlyKeys(req.body, ['nameAr', 'nameEn', 'kind', 'description', 'contactEmail', 'contactPhone', 'website', 'links']);
  const input = readBody(b, false) as BodyInput;
  const requested = b.links === undefined ? [] : b.links;
  if (!Array.isArray(requested) || requested.length > MODULES.length) throw Errors.validation([{ field: 'links', issue: `a list of at most ${MODULES.length}` }]);
  const actor = coreUserOf(req);
  const created = await tx(async () => {
    const body = await createBody(input, actor.id);
    await audit(req, 'body.created', body.id, `إضافة الجهة «${body.nameAr}» إلى دليل الجهات`, { kind: body.kind });
    for (const r of requested as Array<Record<string, unknown>>) {
      const ok = await checkLink(body, r?.initiativeId, r?.organizationId);
      if (!ok) continue;
      await addLink(body.id, ok.initiativeId, ok.organizationId, actor.id);
      await audit(req, 'body.linked', body.id, `ربط «${body.nameAr}» بجهة «${ok.org.nameAr}» في ${getModule(ok.initiativeId)!.titleAr}`, { organizationId: ok.organizationId }, ok.initiativeId);
    }
    return body;
  });
  const [item] = await present([created]);
  return okMessage(res, 201, 'أُضيفت الجهة إلى دليل المنصة.', item);
}));

bodiesRouter.put('/admin/bodies/:id', superAdmin, ah(async (req, res) => {
  const cur = await getBody(req.params.id);
  if (!cur) throw Errors.notFound('الجهة غير موجودة في دليل المنصة.', 'Body not found.');
  const patch = readBody(onlyKeys(req.body, ['nameAr', 'nameEn', 'kind', 'description', 'contactEmail', 'contactPhone', 'website', 'isActive']), true);
  const updated = await updateBody(cur.id, patch);
  const changed = Object.keys(patch).filter((k) => JSON.stringify((patch as Record<string, unknown>)[k]) !== JSON.stringify((cur as unknown as Record<string, unknown>)[k]));
  if (changed.length) {
    const action = patch.isActive === false && cur.isActive ? 'body.deactivated' : patch.isActive === true && !cur.isActive ? 'body.activated' : 'body.updated';
    await audit(req, action, cur.id, `${action === 'body.deactivated' ? 'إيقاف' : action === 'body.activated' ? 'تفعيل' : 'تعديل بيانات'} الجهة «${updated!.nameAr}»`, { fields: changed });
  }
  const [item] = await present([updated!]);
  return okMessage(res, 200, 'تم حفظ بيانات الجهة.', item);
}));

bodiesRouter.delete('/admin/bodies/:id', superAdmin, ah(async (req, res) => {
  const cur = await getBody(req.params.id);
  if (!cur) throw Errors.notFound('الجهة غير موجودة في دليل المنصة.', 'Body not found.');
  if (!(await deleteBody(cur.id))) {
    throw new AppError(409, 'BODY_HAS_LINKS', 'الجهة مربوطة بجهات في المبادرات — افصل الروابط أولًا أو أوقف الجهة بدل حذفها.', 'The body is linked to initiative organizations. Unlink them first, or deactivate the body instead.');
  }
  await audit(req, 'body.deleted', cur.id, `حذف الجهة «${cur.nameAr}» من دليل الجهات`);
  return okMessage(res, 200, 'حُذفت الجهة من دليل المنصة.');
}));

bodiesRouter.post('/admin/bodies/:id/links', superAdmin, ah(async (req, res) => {
  const b = onlyKeys(req.body, ['initiativeId', 'organizationId']);
  const actor = coreUserOf(req);
  const result = await tx(async () => {
    const body = await getBody(req.params.id);
    if (!body) throw Errors.notFound('الجهة غير موجودة في دليل المنصة.', 'Body not found.');
    const ok = await checkLink(body, b.initiativeId, b.organizationId);
    if (!ok) return { body, created: false };
    await addLink(body.id, ok.initiativeId, ok.organizationId, actor.id);
    await audit(req, 'body.linked', body.id, `ربط «${body.nameAr}» بجهة «${ok.org.nameAr}» في ${getModule(ok.initiativeId)!.titleAr}`, { organizationId: ok.organizationId }, ok.initiativeId);
    return { body, created: true };
  });
  const [item] = await present([result.body]);
  return okMessage(res, result.created ? 201 : 200, result.created ? 'رُبطت الجهة.' : 'الجهة مربوطة بالفعل بهذه الجهة.', item);
}));

bodiesRouter.delete('/admin/bodies/:id/links/:initiativeId', superAdmin, ah(async (req, res) => {
  const body = await getBody(req.params.id);
  if (!body) throw Errors.notFound('الجهة غير موجودة في دليل المنصة.', 'Body not found.');
  const link = await findLinkOfBody(body.id, req.params.initiativeId);
  if (!link || !(await removeLink(body.id, req.params.initiativeId))) {
    throw Errors.notFound('الجهة غير مربوطة بأي جهة في هذه المبادرة.', 'The body is not linked in this initiative.');
  }
  await audit(req, 'body.unlinked', body.id, `فصل «${body.nameAr}» عن جهتها في ${getModule(link.initiativeId)?.titleAr ?? link.initiativeId}`, { organizationId: link.organizationId }, link.initiativeId);
  const [item] = await present([body]);
  return okMessage(res, 200, 'فُصل الربط.', item);
}));
