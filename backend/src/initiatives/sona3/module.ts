/**
 * Sona'a El-Mostaqbal (صُنّاع المستقبل) — the initiative module. The original application's business logic (eligibility,
 * feasibility study, committee evaluation with weighted scores, selection, funding referrals, milestones and disbursement,
 * impact reports, appeals) runs on sona3_* tables, its users are platform accounts with a Sona3 membership, and its
 * notifications/audit go to the platform's shared outbox/log tagged with this initiative.
 */
import { Router } from 'express';
import fs from 'node:fs';
import type { InitiativeModule, HubCard } from '../contract.js';
import { migrationsDirFor } from '../../core/db/index.js';
import { makeLimiter } from './http/rateLimits.js';
import { sona3ActorGuard } from './middleware/auth.js';
import { meRouter, publicAuthRouter } from './routes/auth.js';
import { metaRouter } from './routes/meta.js';
import { siteContentRouter } from './routes/siteContent.js';
import { applicantRouter } from './routes/applicant.js';
import { applicationsRouter } from './routes/applications.js';
import { expertsRouter } from './routes/experts.js';
import { cohortsRouter } from './routes/cohorts.js';
import { inboxRouter } from './routes/inbox.js';
import { reportsRouter } from './routes/reports.js';
import { adminRouter } from './routes/admin.js';
import { integrationRouter } from './integration/router.js';
import { ROLE_LABELS, ROLE_ORG_TYPE, type Role } from './domain.js';
import { getUserById, platformAdminActor } from './store/users.js';
import { createOrganization, getOrganization } from './store/organizations.js';
import { createApplicant, getApplicantByOrg } from './store/applicants.js';

import { createDraft } from './workflow/applicationService.js';
import { findOpenApplicationForApplicant, writeSection } from './store/applications.js';
import { STATE_LABELS, STATE_TASKS, isTerminal } from './workflow/workflow.js';
import { addDocumentVersion } from './store/documents.js';
import { uploadRoot } from './http/upload.js';
import { addAuditLog } from './store/audit.js';
import { requirements, personalFromProfile, DOC_MAP } from './requirements.js';
import { stats } from './stats.js';
import { sona3Bodies } from './bodies.js';
import { seedDevData } from './db/seed.js';
import { readinessReport } from './services/readiness.js';
import { startSlaMonitor, stopSlaMonitor } from './jobs/slaMonitor.js';
import { startWebhookWorker, stopWebhookWorker } from './jobs/webhookWorker.js';
import { registerCidResolver } from '../../core/mail/mailer.js';
import { LOGO_CID, logoAttachment } from './mail/layout.js';
import { createMembership } from '../../core/store/memberships.js';
import { getPersonProfile, listCurrentDocuments } from '../../core/profile/store.js';
import { copyStoredFile } from '../../core/http/upload.js';
import { MODULE_ID } from './config.js';

const DEFAULT_VIEW: Record<Role, string> = {
  applicant: 'applicant-dashboard', imc_officer: 'work-queue', evaluator: 'my-evaluations', funder_reviewer: 'work-queue', system_admin: 'admin-dashboard',
};

export const sona3Module: InitiativeModule = {
  id: MODULE_ID,
  titleAr: 'صُنّاع المستقبل',
  titleEn: "Sona'a El-Mostaqbal",
  migrations: { module: MODULE_ID, dir: migrationsDirFor(import.meta.url, 'db/migrations') },
  roles: (Object.keys(ROLE_LABELS) as Role[]).map((r) => ({
    key: r, labelAr: ROLE_LABELS[r].ar, labelEn: ROLE_LABELS[r].en,
    kind: r === 'applicant' ? 'applicant' : r === 'system_admin' ? 'admin' : 'staff', orgTypes: [ROLE_ORG_TYPE[r]],
  })),
  applicantRole: 'applicant',
  adminRole: 'system_admin',
  subject: 'person',
  requirements,
  catalogDefaults: {
    slug: 'sona3', titleAr: 'صُنّاع المستقبل', titleEn: 'Future Makers (Sona\'a El-Mostaqbal)', status: 'active', registrationOpen: true,
    taglineAr: 'تمويل ومرافقة رواد الأعمال الشباب لإطلاق مشروعات صناعية', taglineEn: 'Funding and mentoring young founders to launch industrial projects',
    descriptionAr: 'مبادرة مركز تحديث الصناعة لاكتشاف ورعاية المشروعات الصناعية الواعدة للشباب: تقديم وفحص أهلية، ثم دراسة جدوى، وتقييم لجنة متخصصة، واختيار، وموافقة، وربط بجهات التمويل، ثم متابعة التنفيذ والتشغيل وقياس الأثر.',
    descriptionEn: 'An IMC initiative that discovers and supports promising youth industrial projects: application and eligibility, feasibility study, committee evaluation, selection, approval, funder matching, then implementation follow-up and impact measurement.',
    category: 'ريادة الأعمال', categoryEn: 'Entrepreneurship', coverImage: '/covers/sona3.jpg', themeColor: '#123A78', accentColor: '#F7941D',
    badgeTextAr: 'الدورة مفتوحة', badgeTextEn: 'Cohort open', sortOrder: 2,
  },

  publicRouter() {
    const r = Router();
    r.use('/meta', makeLimiter('publicRead'));
    r.use(metaRouter);
    r.use('/site-content', makeLimiter('publicRead'));
    r.use(siteContentRouter);
    r.use(publicAuthRouter);
    return r;
  },

  router() {
    const r = Router();
    r.use(sona3ActorGuard);
    r.use(meRouter);
    r.use(metaRouter);
    r.use(siteContentRouter);
    r.use(applicantRouter);
    r.use(applicationsRouter);
    r.use(expertsRouter);
    r.use(cohortsRouter);
    r.use(inboxRouter);
    r.use(reportsRouter);
    r.use(adminRouter);
    return r;
  },

  integrationRouter() { return integrationRouter; },

  async resolveActor(user, membership) {
    if (membership) return await getUserById(user.id);
    if (user.platformRole === 'super_admin') return await platformAdminActor(user);
    return null;
  },

  async access() { return { status: 'full' }; },

  async hubCard(_user, membership): Promise<HubCard> {
    const role = membership.role as Role;
    if (role !== 'applicant') return { statusAr: ROLE_LABELS[role]?.ar ?? role, statusEn: ROLE_LABELS[role]?.en ?? role, view: DEFAULT_VIEW[role] ?? 'work-queue', tone: 'info' };
    const applicant = membership.organizationId ? await getApplicantByOrg(membership.organizationId) : null;
    const app = applicant ? await findOpenApplicationForApplicant(applicant.id) : null;
    if (!app) return { statusAr: 'لا يوجد طلب مفتوح', statusEn: 'No open application', nextActionAr: 'ابدأ طلبًا في الدورة المفتوحة', nextActionEn: 'Start an application in the open cohort', view: 'applicant-dashboard', tone: 'neutral' };
    const task = STATE_TASKS[app.state];
    return {
      statusAr: STATE_LABELS[app.state].ar, statusEn: STATE_LABELS[app.state].en, applicationNumber: app.number,
      nextActionAr: task?.ar, nextActionEn: task?.en,
      view: app.state === 'DRAFT' ? `apply/${app.id}` : `my-application/${app.id}`,
      tone: isTerminal(app.state) ? 'neutral' : app.state.endsWith('_CORRECTION') ? 'warning' : 'info',
    };
  },

  /**
   * "Already registered" path: the person's Sona3 applicant file (applicant organization + membership) and a DRAFT in the
   * open cohort with the personal section and documents taken from the shared profile. The rest of the form (team, project,
   * idea, readiness, declarations) is completed in the Sona3 wizard.
   */
  async enroll(user, input) {
    const person = await getPersonProfile(user.id);
    const fullName = String(person.values['person.fullNameAr'] ?? user.nameAr).trim() || user.nameAr;
    const org = await createOrganization({ type: 'applicant', nameAr: fullName, nameEn: fullName, contactEmail: user.email });
    await createApplicant(org.id, fullName, user.id, user.id);
    await createMembership({ userId: user.id, initiativeId: MODULE_ID, role: 'applicant', organizationId: org.id, createdBy: user.id });
    const actor = (await getUserById(user.id))!;
    const app = await createDraft(actor, input.ip);
    await writeSection(app.id, 'personal', 1, { email: user.email.toLowerCase(), nationality: 'egyptian', ...personalFromProfile(person.values) }, user.id);
    const docs = await listCurrentDocuments('person', user.id);
    for (const d of DOC_MAP) {
      const doc = docs.find((x) => x.kind === d.kind);
      if (!doc) continue;
      fs.mkdirSync(uploadRoot(), { recursive: true });
      const copy = copyStoredFile('core', doc.storedName, uploadRoot());
      await addDocumentVersion({
        applicationId: app.id, kind: d.kind, attempt: 1, uploadedInState: 'DRAFT', originalName: doc.originalName,
        storedName: copy.storedName, sizeBytes: copy.sizeBytes, sha256: copy.sha256, uploadedBy: user.id,
      }, false);
    }
    await addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, actorRole: 'applicant', actorOrgId: org.id, ip: input.ip,
      action: 'platform.enroll', entityType: 'applicant', entityId: org.id, applicationId: app.id, summaryAr: 'فتح ملف في المبادرة من بيانات المنصة', details: { documents: docs.length } });
    return { view: `apply/${app.id}`, applicationId: app.id };
  },

  stats,
  bodies: sona3Bodies,
  staffEntryPoints: [
    { view: 'work-queue', labelAr: 'قائمة العمل', labelEn: 'Work queue', roles: ['imc_officer', 'funder_reviewer', 'system_admin'] },
    { view: 'ranking', labelAr: 'ترتيب الدورة', labelEn: 'Cohort ranking', roles: ['imc_officer'] },
    { view: 'my-evaluations', labelAr: 'تقييماتي', labelEn: 'My evaluations', roles: ['evaluator'] },
    { view: 'monitoring', labelAr: 'المتابعة', labelEn: 'Monitoring', roles: ['imc_officer', 'funder_reviewer'] },
    { view: 'experts', labelAr: 'الخبراء', labelEn: 'Experts', roles: ['imc_officer'] },
    { view: 'admin-dashboard', labelAr: 'إدارة المبادرة', labelEn: 'Initiative administration', roles: ['system_admin'] },
  ],
  defaultView(role) { return DEFAULT_VIEW[role as Role] ?? 'applicant-dashboard'; },

  startJobs() { startWebhookWorker(); startSlaMonitor(); },
  stopJobs() { stopWebhookWorker(); stopSlaMonitor(); },

  async onBoot() {
    if (!(await getOrganization('org-imc'))) throw new Error('[sona3] structural organizations missing');
  },

  async readiness() {
    const r = await readinessReport();
    return r.checks.map((c: { key: string; ok: boolean; labelAr: string; labelEn: string; detailAr?: string }) => ({ key: `sona3.${c.key}`, ok: c.ok, labelAr: c.labelAr, labelEn: c.labelEn, detail: c.detailAr }));
  },

  async seedDemo(password) { return await seedDevData(password); },

  registerMail() {
    registerCidResolver((html) => {
      const a = html.includes(`cid:${LOGO_CID}`) ? logoAttachment() : null;
      return a ? [a] : [];
    });
  },
};
