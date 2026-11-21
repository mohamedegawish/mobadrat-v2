import { Router, type Request } from 'express';
import { ah, okMessage, Errors } from '../http/errors.js';
import { str } from '../http/helpers.js';
import { Checker, isEmail, isPhone, isUrl, normalizeDigits, onlyKeys, withHttpScheme, type Obj } from '../http/validate.js';
import { currentUser } from '../middleware/auth.js';
import { createExpert, getExpert, listExperts, setExpertStatus, updateExpert, EXPERT_FIELDS, type ExpertInput, type ExpertStatus } from '../store/experts.js';
import { addAuditLog, actorFromReq } from '../store/audit.js';
import type { Role } from '../domain.js';

export const expertsRouter = Router();

/** دليل الخبراء يديره فريق المبادرة (IMC) فقط. */
function canManage(role: Role): boolean {
  return role === 'imc_officer';
}

export function cleanExpertInput(body: unknown, creating: boolean): ExpertInput & { nameAr?: string } {
  const b: Obj = onlyKeys(body, EXPERT_FIELDS);
  const c = new Checker();
  const out: ExpertInput = {};
  out.nameAr = c.text(b, 'nameAr', { required: creating, min: 2, max: 200 });
  out.nameEn = c.text(b, 'nameEn', { max: 200 });
  out.specialty = c.text(b, 'specialty', { max: 300 });
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
  for (const k of Object.keys(out) as Array<keyof ExpertInput>) if (out[k] === undefined) delete out[k];
  return out;
}

export function publicExpert(p: NonNullable<ReturnType<typeof getExpert>>, full: boolean) {
  const base = { id: p.id, nameAr: p.nameAr, nameEn: p.nameEn, specialty: p.specialty, contactName: p.contactName, contactPhone: p.contactPhone, contactEmail: p.contactEmail, website: p.website, status: p.status };
  return full ? { ...base, notes: p.notes, approvedAt: p.approvedAt, approvedBy: p.approvedBy, suspendedAt: p.suspendedAt, createdAt: p.createdAt, updatedAt: p.updatedAt } : base;
}

expertsRouter.get('/experts', ah((req, res) => {
  const user = currentUser(req);
  const manage = canManage(user.role);
  // المتقدم وباقي الجهات يرون القائمة المعتمدة فقط.
  const status = manage ? ((['pending', 'approved', 'suspended'].includes(str(req.query.status)) ? str(req.query.status) : undefined) as ExpertStatus | undefined) : 'approved';
  const list = listExperts({ status, q: str(req.query.q).slice(0, 100) || undefined });
  return okMessage(res, 200, 'ok', { items: list.map((p) => publicExpert(p, manage)) });
}));

function requireManager(req: Request) {
  const user = currentUser(req);
  if (!canManage(user.role)) throw Errors.forbidden();
  return user;
}

expertsRouter.post('/experts', ah((req, res) => {
  const user = requireManager(req);
  const input = cleanExpertInput(req.body, true);
  const p = createExpert(input as ExpertInput & { nameAr: string }, user.id);
  addAuditLog({ ...actorFromReq(req), action: 'expert.create', entityType: 'expert', entityId: p.id, summaryAr: `إضافة خبير: ${p.nameAr}` });
  return okMessage(res, 201, 'تمت إضافة الخبير (بانتظار الاعتماد).', publicExpert(p, true));
}));

expertsRouter.put('/experts/:id', ah((req, res) => {
  requireManager(req);
  if (!getExpert(req.params.id)) throw Errors.notFound();
  const p = updateExpert(req.params.id, cleanExpertInput(req.body, false))!;
  addAuditLog({ ...actorFromReq(req), action: 'expert.update', entityType: 'expert', entityId: p.id, summaryAr: `تعديل خبير: ${p.nameAr}` });
  return okMessage(res, 200, 'تم الحفظ.', publicExpert(p, true));
}));

for (const [path, status, ar] of [['approve', 'approved', 'اعتماد'], ['suspend', 'suspended', 'إيقاف']] as const) {
  expertsRouter.post(`/experts/:id/${path}`, ah((req, res) => {
    const user = requireManager(req);
    onlyKeys(req.body ?? {}, []);
    if (!getExpert(req.params.id)) throw Errors.notFound();
    const p = setExpertStatus(req.params.id, status, user.id)!;
    addAuditLog({ ...actorFromReq(req), action: `expert.${path}`, entityType: 'expert', entityId: p.id, summaryAr: `${ar} خبير: ${p.nameAr}` });
    return okMessage(res, 200, 'تم التحديث.', publicExpert(p, true));
  }));
}

/** قوائم مساعدة لـ IMC: جهات التمويل المتاحة والمقيّمون النشطون. */
import { listActiveFunders } from '../store/organizations.js';
import { listUsers } from '../store/users.js';
expertsRouter.get('/funders', ah((req, res) => {
  if (currentUser(req).role !== 'imc_officer') throw Errors.forbidden();
  return okMessage(res, 200, 'ok', { items: listActiveFunders() });
}));
expertsRouter.get('/evaluators', ah((req, res) => {
  if (currentUser(req).role !== 'imc_officer') throw Errors.forbidden();
  const { rows } = listUsers({ role: 'evaluator' }, 1, 200);
  return okMessage(res, 200, 'ok', { items: rows.filter((u) => u.isActive).map((u) => ({ id: u.id, nameAr: u.nameAr, email: u.email })) });
}));
