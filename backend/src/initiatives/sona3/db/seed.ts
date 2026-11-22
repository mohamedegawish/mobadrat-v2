/**
 * Sona3 demo data (accounts per role, a demo funder, an open cohort, experts). Explicitly fictitious.
 * Platform accounts + Sona3 memberships; ids are prefixed s3- so they never collide with another initiative's demo data.
 */
import { getDb, nowIso, tx } from './sqlite.js';
import { hashPassword } from '../auth/jwt.js';
import { ORG_IDS, type Role } from '../domain.js';
import { policy } from '../config/initiativePolicy.js';
import { createCoreUser, getUserByEmail } from '../../../core/store/users.js';
import { createMembership, getMembership } from '../../../core/store/memberships.js';
import { savePersonProfile } from '../../../core/profile/store.js';
import { MODULE_ID } from '../config.js';

export const DEV_ACCOUNTS: Array<{ id: string; email: string; nameAr: string; nameEn: string; role: Role; org: string; phone?: string }> = [
  { id: 's3-usr-admin', email: 'admin@sona3.local', nameAr: 'مدير النظام (تجريبي)', nameEn: 'System Admin (demo)', role: 'system_admin', org: ORG_IDS.admin },
  { id: 's3-usr-imc-1', email: 'imc@sona3.local', nameAr: 'مسؤول IMC (تجريبي)', nameEn: 'IMC Officer (demo)', role: 'imc_officer', org: ORG_IDS.imc },
  { id: 's3-usr-eval-1', email: 'evaluator1@sona3.local', nameAr: 'مقيّم لجنة التقييم الأول (تجريبي)', nameEn: 'Evaluator 1 (demo)', role: 'evaluator', org: ORG_IDS.committee },
  { id: 's3-usr-eval-2', email: 'evaluator2@sona3.local', nameAr: 'مقيّم لجنة التقييم الثاني (تجريبي)', nameEn: 'Evaluator 2 (demo)', role: 'evaluator', org: ORG_IDS.committee },
  { id: 's3-usr-funder-1', email: 'funder@sona3.local', nameAr: 'مسؤول جهة التمويل (تجريبي)', nameEn: 'Funder Officer (demo)', role: 'funder_reviewer', org: 'org-funder-demo-1' },
  { id: 's3-usr-applicant-1', email: 'applicant@sona3.local', nameAr: 'متقدم تجريبي', nameEn: 'Demo Applicant', role: 'applicant', org: 'org-applicant-demo-1', phone: '01000000001' },
];

const dayStr = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

export async function seedDevData(password: string): Promise<void> {
  const db = getDb();
  const now = nowIso();
  const hash = hashPassword(password);
  await tx(async () => {
    const org = db.prepare('INSERT OR IGNORE INTO sona3_organizations (id, type, nameAr, nameEn, contactEmail, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?)');
    await org.run('org-funder-demo-1', 'funder', 'جهة تمويل تجريبية (صندوق تجريبي)', 'Demo Funder', '', now, now);
    await org.run('org-applicant-demo-1', 'applicant', 'متقدم تجريبي', 'Demo Applicant', '', now, now);
    const ids: Record<string, string> = {};
    for (const a of DEV_ACCOUNTS) {
      const existing = await getUserByEmail(a.email);
      const u = existing ?? await createCoreUser({ id: a.id, email: a.email, nameAr: a.nameAr, nameEn: a.nameEn, phone: a.phone ?? '', passwordHash: hash, emailVerified: true });
      ids[a.id] = u.id;
      if (!(await getMembership(u.id, MODULE_ID))) await createMembership({ userId: u.id, initiativeId: MODULE_ID, role: a.role, organizationId: a.org });
      await savePersonProfile(u.id, { 'person.fullNameAr': a.nameAr, 'person.fullNameEn': a.nameEn, ...(a.phone ? { 'person.phone': a.phone } : {}) });
    }
    await db.prepare('INSERT OR IGNORE INTO sona3_applicants (id, organizationId, userId, fullName, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('apl-demo-1', 'org-applicant-demo-1', ids['s3-usr-applicant-1'], 'متقدم تجريبي', ids['s3-usr-applicant-1'], now, now);
    await db.prepare(`INSERT OR IGNORE INTO sona3_cohorts (id, nameAr, nameEn, opensAt, closesAt, evaluationTarget, selectionTarget, maxAge, ageReference, weights,
        minTotalScore, minFinancialScore, minTechnicalScore, minEvaluators, createdBy, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, 60, 15, 35, 'cohort_close', ?, 50, 50, 50, 1, ?, ?, ?)`)
      .run('coh-demo-1', 'الدورة الأولى (تجريبية)', 'Cohort 1 (demo)', dayStr(-7), dayStr(90), JSON.stringify(policy.defaultWeights), ids['s3-usr-admin'], now, now);
    const ex = db.prepare(`INSERT OR IGNORE INTO sona3_experts (id, nameAr, nameEn, specialty, contactName, contactPhone, contactEmail, status, approvedBy, approvedAt, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    await ex.run('exp-demo-1', 'خبير دراسات جدوى تجريبي (1)', 'Demo Feasibility Expert 1', 'دراسات الجدوى الصناعية', 'مسؤول تجريبي', '01000000101', 'expert1@sona3.local', 'approved', ids['s3-usr-imc-1'], now, now, now);
    await ex.run('exp-demo-2', 'مكتب استشاري تجريبي (2)', 'Demo Consultancy 2', 'التخطيط المالي وخطط الأعمال', 'مسؤول تجريبي', '01000000102', 'expert2@sona3.local', 'approved', ids['s3-usr-imc-1'], now, now, now);
    await ex.run('exp-demo-3', 'خبير تجريبي (3) — بانتظار الاعتماد', 'Demo Expert 3 (pending)', '', '', '', '', 'pending', null, null, now, now);
  });
}
