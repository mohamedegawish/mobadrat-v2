import { Router } from 'express';
import { mapSeq } from '../http/helpers.js';
import { ah, okMessage, Errors } from '../http/errors.js';
import { Checker, onlyKeys } from '../http/validate.js';
import { currentUser, requireRole } from '../middleware/auth.js';
import { getFactoryByOrg, renameFactory } from '../store/factories.js';
import { findOpenApplicationForFactory, listFactoryApplications } from '../store/applications.js';
import { toPublicUser } from '../store/users.js';
import { addAuditLog, actorFromReq } from '../store/audit.js';
import { buildListItem, preloadListOrgs } from '../workflow/applicationView.js';
import { shamsPolicy } from '../config/shamsPolicy.js';

export const factoryRouter = Router();
factoryRouter.use('/factory', requireRole('factory_owner'));

/** ملف المصنع + طلباته (الحالي والسابقة) — «لوحتي». */
factoryRouter.get('/factory/profile', ah(async (req, res) => {
  const user = currentUser(req);
  const factory = await getFactoryByOrg(user.organizationId);
  if (!factory) throw Errors.notFound('ملف المصنع غير موجود.', 'Factory profile not found.');
  const apps = await listFactoryApplications(factory.id);
  const open = await findOpenApplicationForFactory(factory.id);
  const orgs = await preloadListOrgs(apps); // PERF-3: one organization query for all of the factory's applications
  return okMessage(res, 200, 'ok', {
    factory: { id: factory.id, companyName: factory.companyName, createdAt: factory.createdAt },
    user: toPublicUser(user),
    applications: await mapSeq(apps, (a) => buildListItem(user, a, orgs)),
    openApplicationId: open?.id ?? null,
    canStartNew: !open && (apps.length === 0 || shamsPolicy.allowReapplyAfterTerminal),
  });
}));

factoryRouter.put('/factory/profile', ah(async (req, res) => {
  const user = currentUser(req);
  const factory = await getFactoryByOrg(user.organizationId);
  if (!factory) throw Errors.notFound();
  const b = onlyKeys(req.body, ['companyName']);
  const c = new Checker();
  const companyName = c.text(b, 'companyName', { required: true, min: 2, max: 200 });
  c.throwIfAny();
  await renameFactory(factory.id, companyName!);
  await addAuditLog({ ...actorFromReq(req), action: 'factory.update', entityType: 'factory', entityId: factory.id, summaryAr: 'تعديل اسم المصنع' });
  return okMessage(res, 200, 'تم الحفظ.', { id: factory.id, companyName });
}));
