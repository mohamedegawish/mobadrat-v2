/**
 * Shams El-Senaa (شمس الصناعة) — the initiative module. The original application's business logic (19-state workflow,
 * IMC/ENCPC/PMU reviews, providers, registry disputes, account governance, notifications) runs unchanged on the platform:
 * its tables are prefixed `shams_`, its users are platform accounts with a Shams membership, and its notifications/audit go
 * to the platform's shared outbox/log tagged with this initiative.
 */
import { Router } from 'express';
import type { InitiativeModule, HubCard } from '../contract.js';
import { migrationsDirFor } from '../../core/db/index.js';
import { makeLimiter } from './http/rateLimits.js';
import { shamsActorGuard } from './middleware/auth.js';
import { restrictUnapprovedFactory } from './middleware/factoryAccess.js';
import { meRouter, publicAuthRouter } from './routes/auth.js';
import { metaRouter } from './routes/meta.js';
import { factoryRouter } from './routes/factory.js';
import { applicationsRouter } from './routes/applications.js';
import { providersRouter } from './routes/providers.js';
import { reportsRouter } from './routes/reports.js';
import { registryRouter } from './routes/registry.js';
import { approvalsRouter } from './routes/approvals.js';
import { notificationsRouter } from './routes/notifications.js';
import { adminRouter } from './routes/admin.js';
import { integrationRouter } from './integration/router.js';
import { ROLE_LABELS, ROLE_ORG_TYPE, STAFF_ROLES, ORG_IDS, type Role } from './domain.js';
import { getUserById, platformAdminActor } from './store/users.js';
import { accountLoginBlock } from './services/factoryAccount.js';
import { createOrganization, getOrganization } from './store/organizations.js';
import { createFactory, getFactoryByOrg, setFactoryProfile } from './store/factories.js';
import { findOpenApplicationForFactory, listApplications } from './store/applications.js';
import { performAction } from './workflow/actionService.js';
import { createRegistrationDraft } from './workflow/applicationService.js';
import { STATE_LABELS, STATE_TASKS, isTerminal } from './workflow/shamsWorkflow.js';
import { addDocumentVersion } from './store/documents.js';
import { uploadRoot } from './http/upload.js';
import { addAuditLog } from './store/audit.js';
import { requirements, sectionsFromProfile, DOC_MAP } from './requirements.js';
import { stats } from './stats.js';
import { shamsBodies } from './bodies.js';
import { seedDeployData, seedDevData } from './db/seed.js';
import { readinessReport } from './services/readiness.js';
import { startSlaMonitor, stopSlaMonitor } from './jobs/slaMonitor.js';
import { startWebhookWorker, stopWebhookWorker } from './jobs/webhookWorker.js';
import { startRecoveryWorker, stopRecoveryWorker } from './services/accountRecovery.js';
import { registerCidResolver } from '../../core/mail/mailer.js';
import { providerLogoAttachments } from './notifications/mailImages.js';
import { createMembership, getMembership } from '../../core/store/memberships.js';
import { getFactoryProfile, listCurrentDocuments } from '../../core/profile/store.js';
import { copyStoredFile } from '../../core/http/upload.js';
import { kickNotificationWorker } from './jobs/notificationWorker.js';
import { MODULE_ID } from './config.js';

const DEFAULT_VIEW: Record<Role, string> = {
  factory_owner: 'factory-dashboard', imc_reviewer: 'dashboard', encpc_reviewer: 'dashboard', pmu_reviewer: 'pmu-monitor',
  bank_reviewer: 'home', system_admin: 'admin-dashboard',
};

export const shamsModule: InitiativeModule = {
  id: MODULE_ID,
  titleAr: 'شمس الصناعة',
  titleEn: 'Shams El-Senaa',
  migrations: { module: MODULE_ID, dir: migrationsDirFor(import.meta.url, 'db/migrations') },
  roles: (Object.keys(ROLE_LABELS) as Role[]).filter((r) => r !== 'bank_reviewer').map((r) => ({
    key: r, labelAr: ROLE_LABELS[r].ar, labelEn: ROLE_LABELS[r].en,
    kind: r === 'factory_owner' ? 'applicant' : r === 'system_admin' ? 'admin' : 'staff', orgTypes: [ROLE_ORG_TYPE[r]],
  })),
  applicantRole: 'factory_owner',
  adminRole: 'system_admin',
  subject: 'factory',
  requirements,
  catalogDefaults: {
    slug: 'shams', titleAr: 'شمس الصناعة', titleEn: 'Shams El-Senaa', status: 'active', registrationOpen: true,
    taglineAr: 'طاقة شمسية على أسطح المصانع — تمويل ومتابعة من التسجيل حتى التعاقد',
    taglineEn: 'Solar power on factory roofs — financing and follow-up from registration to contract',
    descriptionAr: 'مبادرة وزارة الصناعة لتركيب محطات الطاقة الشمسية على أسطح المنشآت الصناعية: تسجيل المصنع ومراجعة مركز تحديث الصناعة (IMC) ومطابقة ENCPC واختيار مقدم الخدمة والعرض الفني وموافقة شركة الكهرباء ثم التعاقد عبر البنك أو شركة التوزيع.',
    descriptionEn: 'A Ministry of Industry initiative to install solar plants on industrial roofs: factory registration, IMC review, ENCPC compliance, provider selection and technical offer, electricity approval, then contracting through a bank or the distribution company.',
    category: 'طاقة متجددة', categoryEn: 'Renewable energy', coverImage: '/covers/solar-2026.jpg', themeColor: '#142A4A', accentColor: '#C8102E',
    badgeTextAr: 'التسجيل متاح', badgeTextEn: 'Open for registration', sortOrder: 1,
  },

  publicRouter() {
    const r = Router();
    r.use('/meta', makeLimiter('publicRead'));
    r.use(metaRouter);
    r.use(publicAuthRouter);
    return r;
  },

  router() {
    const r = Router();
    r.use(shamsActorGuard);
    r.use(meRouter);
    r.use(metaRouter);
    r.use(restrictUnapprovedFactory); // a factory not approved yet: edit and resubmit its registration only
    r.use(factoryRouter);
    r.use(applicationsRouter);
    r.use(providersRouter);
    r.use(reportsRouter);
    r.use(registryRouter);
    r.use(approvalsRouter);
    r.use(notificationsRouter);
    r.use(adminRouter);
    return r;
  },

  integrationRouter() { return integrationRouter; },

  async resolveActor(user, membership) {
    if (membership) return await getUserById(user.id);
    if (user.platformRole === 'super_admin') return await platformAdminActor(user);
    return null;
  },

  async access(user) {
    const actor = await getUserById(user.id);
    if (!actor || actor.role !== 'factory_owner') return { status: 'full' };
    const block = accountLoginBlock(actor.factoryAccountStatus);
    if (block) return { status: 'blocked', code: block.code, messageAr: block.ar, messageEn: block.en };
    if (actor.factoryAccountStatus && actor.factoryAccountStatus !== 'approved') {
      return { status: 'restricted', code: 'ACCOUNT_RESTRICTED', messageAr: 'حساب المصنع لم يُقبل بعد — أكمل بيانات طلب التسجيل وأرسله.', messageEn: 'The factory account is not approved yet — complete and submit the registration.' };
    }
    return { status: 'full' };
  },

  async hubCard(user, membership): Promise<HubCard> {
    const role = membership.role as Role;
    if (role !== 'factory_owner') {
      return { statusAr: ROLE_LABELS[role]?.ar ?? role, statusEn: ROLE_LABELS[role]?.en ?? role, view: DEFAULT_VIEW[role] ?? 'dashboard', tone: 'info' };
    }
    const factory = membership.organizationId ? await getFactoryByOrg(membership.organizationId) : null;
    const app = factory ? (await findOpenApplicationForFactory(factory.id)) ?? (await listApplications({ scopeSql: 'a.factoryId = ?', scopeParams: [factory.id], includeDrafts: true }, 1, 1)).rows[0] ?? null : null;
    if (!app) return { statusAr: 'لا يوجد طلب مفتوح', statusEn: 'No open application', nextActionAr: 'ابدأ طلبًا جديدًا', nextActionEn: 'Start a new application', view: 'factory-dashboard', tone: 'neutral' };
    const task = STATE_TASKS[app.state];
    return {
      statusAr: STATE_LABELS[app.state].ar, statusEn: STATE_LABELS[app.state].en, applicationNumber: app.number,
      nextActionAr: task?.ar, nextActionEn: task?.en,
      // As in the old app: an approved factory lands on its dashboard («لوحتي»); one not approved yet on its registration
      // application, the only screen it may use.
      view: factory!.accountStatus !== 'approved' && !isTerminal(app.state) ? `apply/${app.id}` : 'factory-dashboard',
      tone: app.state === 'CONTRACTED' ? 'success' : isTerminal(app.state) ? 'neutral' : app.state.endsWith('_CORRECTION') ? 'warning' : 'info',
    };
  },

  /**
   * "Already registered" path: opens a Shams file for the person's factory profile — a Shams factory organization
   * (account status pending, like a self-registration), the membership, a DRAFT prefilled from the profile and the company
   * documents copied from the profile. The person completes the electricity bills in the wizard and submits to IMC.
   */
  async enroll(user, input) {
    const profile = input.factoryProfileId ? await getFactoryProfile(input.factoryProfileId) : null;
    if (!profile) throw new Error('factory profile required');
    const companyName = String(profile.values['factory.companyName'] ?? '').trim();
    const org = await createOrganization({ type: 'factory', nameAr: companyName, nameEn: companyName, contactEmail: user.email });
    const factory = await createFactory(org.id, companyName, user.id, 'pending');
    await setFactoryProfile(factory.id, profile.id);
    await createMembership({ userId: user.id, initiativeId: MODULE_ID, role: 'factory_owner', organizationId: org.id, createdBy: user.id });
    const actor = (await getUserById(user.id))!;
    const sections = sectionsFromProfile(profile.values);
    const app = await createRegistrationDraft(factory, actor, sections, input.ip);
    const docs = await listCurrentDocuments('factory', profile.id);
    for (const d of DOC_MAP) {
      const doc = docs.find((x) => x.kind === d.kind);
      if (!doc) continue;
      const copy = copyStoredFile('core', doc.storedName, uploadRoot());
      await addDocumentVersion({
        applicationId: app.id, kind: d.kind, attempt: 1, uploadedInState: 'DRAFT', originalName: doc.originalName,
        storedName: copy.storedName, sizeBytes: copy.sizeBytes, sha256: copy.sha256, uploadedBy: user.id,
      }, false);
    }
    await addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, actorRole: 'factory_owner', actorOrgId: org.id, ip: input.ip,
      action: 'platform.enroll', entityType: 'factory', entityId: factory.id, applicationId: app.id,
      summaryAr: `فتح ملف في المبادرة من بيانات المنصة: ${companyName}`, details: { factoryProfileId: profile.id, documents: docs.length } });
    return { view: `apply/${app.id}`, applicationId: app.id };
  },

  stats,
  bodies: shamsBodies,
  staffEntryPoints: [
    { view: 'work-queue', labelAr: 'قائمة العمل', labelEn: 'Work queue', roles: ['imc_reviewer', 'encpc_reviewer', 'pmu_reviewer', 'system_admin'] },
    { view: 'pmu-monitor', labelAr: 'متابعة وحدة إدارة المبادرة', labelEn: 'PMU monitoring', roles: ['pmu_reviewer'] },
    { view: 'providers', labelAr: 'مقدمو الخدمة', labelEn: 'Service providers', roles: ['encpc_reviewer', 'pmu_reviewer'] },
    { view: 'approvals', labelAr: 'الموافقات', labelEn: 'Approvals', roles: ['imc_reviewer', 'encpc_reviewer', 'pmu_reviewer'] },
    { view: 'admin-dashboard', labelAr: 'إدارة المبادرة', labelEn: 'Initiative administration', roles: ['system_admin'] },
  ],
  defaultView(role) { return DEFAULT_VIEW[role as Role] ?? 'factory-dashboard'; },

  hooks: {
    /** A self-registered factory: once the e-mail is proven, the registration (data + documents) goes to IMC automatically. */
    async onEmailVerified(user, ip) {
      const m = await getMembership(user.id, MODULE_ID);
      if (!m || m.role !== 'factory_owner' || !m.organizationId) return;
      const factory = await getFactoryByOrg(m.organizationId);
      if (factory?.accountStatus !== 'pending') return;
      const draft = await findOpenApplicationForFactory(factory.id);
      if (draft?.state !== 'DRAFT') return;
      try {
        await performAction((await getUserById(user.id))!, draft.id, 'submit', { expectedVersion: draft.version }, { ip });
        kickNotificationWorker();
        return { messageAr: 'وأُرسل طلب تسجيل المصنع في «شمس الصناعة» لمراجعة مركز تحديث الصناعة (IMC). ستصلك رسالة بالقرار.', data: { submitted: true } };
      } catch (e) {
        // Stays pending: the factory signs in (restricted) and resubmits — e.g. the registry service was unavailable.
        const err = e as { code?: string; message?: string; details?: unknown };
        console.warn(`[shams] auto-submit after e-mail verification failed for application ${draft.id}: ${err.code ?? ''} ${err.message ?? ''} ${err.details ? JSON.stringify(err.details) : ''}`);
        return { messageAr: 'تعذر إرسال طلب تسجيل المصنع للمراجعة الآن — افتح لوحة «شمس الصناعة» لإعادة إرساله.', data: { submitted: false } };
      }
    },
  },

  startJobs() {
    startWebhookWorker();
    startSlaMonitor();
    return startRecoveryWorker();
  },
  stopJobs() {
    stopWebhookWorker();
    stopSlaMonitor();
    stopRecoveryWorker();
  },

  async onBoot() {
    // The structural organizations are created by the migration; nothing else to do at boot.
    if (!(await getOrganization(ORG_IDS.imc))) throw new Error('[shams] structural organizations missing');
  },

  async readiness() {
    const r = await readinessReport();
    return r.checks.map((c) => ({ key: `shams.${c.key}`, ok: c.ok, labelAr: c.labelAr, labelEn: c.labelEn, detail: c.detailAr }));
  },

  seedDemo(password) { return seedDevData(password); },
  seedDeploy(passwordHash) { return seedDeployData(passwordHash); },

  registerMail() { registerCidResolver(providerLogoAttachments); },
};

export { STAFF_ROLES };
