/**
 * بيانات تطوير فقط — ترفض العمل في الإنتاج. الأسماء تجريبية صريحة ولا تمثل جهات أو أشخاصًا حقيقيين.
 * كل الحسابات بكلمة المرور SEED_PASSWORD (افتراضي Sona3@2026) ومفعّلة، بلا تغيير إجباري لتسهيل التطوير.
 */
import { config } from '../config.js';
import { getDb, nowIso, tx } from './sqlite.js';
import { hashPassword } from '../auth/jwt.js';
import { ORG_IDS, type Role } from '../domain.js';
import { policy } from '../config/initiativePolicy.js';

export const DEV_PASSWORD = () => process.env.SEED_PASSWORD || 'Sona3@2026';

export const DEV_ACCOUNTS: Array<{ id: string; email: string; nameAr: string; nameEn: string; role: Role; org: string; phone?: string }> = [
  { id: 'usr-admin', email: 'admin@sona3.local', nameAr: 'مدير النظام (تجريبي)', nameEn: 'System Admin (demo)', role: 'system_admin', org: ORG_IDS.admin },
  { id: 'usr-imc-1', email: 'imc@sona3.local', nameAr: 'مسؤول IMC (تجريبي)', nameEn: 'IMC Officer (demo)', role: 'imc_officer', org: ORG_IDS.imc },
  { id: 'usr-eval-1', email: 'evaluator1@sona3.local', nameAr: 'مقيّم لجنة التقييم الأول (تجريبي)', nameEn: 'Evaluator 1 (demo)', role: 'evaluator', org: ORG_IDS.committee },
  { id: 'usr-eval-2', email: 'evaluator2@sona3.local', nameAr: 'مقيّم لجنة التقييم الثاني (تجريبي)', nameEn: 'Evaluator 2 (demo)', role: 'evaluator', org: ORG_IDS.committee },
  { id: 'usr-funder-1', email: 'funder@sona3.local', nameAr: 'مسؤول جهة التمويل (تجريبي)', nameEn: 'Funder Officer (demo)', role: 'funder_reviewer', org: 'org-funder-demo-1' },
  { id: 'usr-applicant-1', email: 'applicant@sona3.local', nameAr: 'متقدم تجريبي', nameEn: 'Demo Applicant', role: 'applicant', org: 'org-applicant-demo-1', phone: '01000000001' },
];

export function assertSeedAllowed(): void {
  if (config.isProd && !config.seedAllowProduction) {
    throw new Error('[seed] refused: seed data is for development only (NODE_ENV=production). Set SEED_ALLOW_PRODUCTION=1 to override.');
  }
}

export function seedIfEmpty(): boolean {
  assertSeedAllowed();
  const n = (getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (n > 0) return false;
  seedDevData();
  return true;
}

const dayStr = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

export function seedDevData(): void {
  assertSeedAllowed();
  const db = getDb();
  const now = nowIso();
  const hash = hashPassword(DEV_PASSWORD());
  tx(() => {
    const org = db.prepare('INSERT OR IGNORE INTO organizations (id, type, nameAr, nameEn, contactEmail, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?)');
    org.run('org-funder-demo-1', 'funder', 'جهة تمويل تجريبية (صندوق تجريبي)', 'Demo Funder', '', now, now);
    org.run('org-applicant-demo-1', 'applicant', 'متقدم تجريبي', 'Demo Applicant', '', now, now);
    const user = db.prepare(`INSERT OR IGNORE INTO users (id, organizationId, role, email, nameAr, nameEn, phone, passwordHash, isActive, mustChangePassword,
      emailVerifiedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`);
    for (const a of DEV_ACCOUNTS) user.run(a.id, a.org, a.role, a.email, a.nameAr, a.nameEn, a.phone ?? '', hash, now, now, now);
    db.prepare('INSERT OR IGNORE INTO applicants (id, organizationId, fullName, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('apl-demo-1', 'org-applicant-demo-1', 'متقدم تجريبي', 'usr-applicant-1', now, now);
    // دورة مفتوحة الآن بأوزان افتراضية.
    db.prepare(`INSERT OR IGNORE INTO cohorts (id, nameAr, nameEn, opensAt, closesAt, evaluationTarget, selectionTarget, maxAge, ageReference, weights,
        minTotalScore, minFinancialScore, minTechnicalScore, minEvaluators, createdBy, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, 60, 15, 35, 'cohort_close', ?, 50, 50, 50, 1, ?, ?, ?)`)
      .run('coh-demo-1', 'الدورة الأولى (تجريبية)', 'Cohort 1 (demo)', dayStr(-7), dayStr(90), JSON.stringify(policy.defaultWeights), 'usr-admin', now, now);
    const ex = db.prepare(`INSERT OR IGNORE INTO experts (id, nameAr, nameEn, specialty, contactName, contactPhone, contactEmail, status, approvedBy, approvedAt, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    ex.run('exp-demo-1', 'خبير دراسات جدوى تجريبي (1)', 'Demo Feasibility Expert 1', 'دراسات الجدوى الصناعية', 'مسؤول تجريبي', '01000000101', 'expert1@sona3.local', 'approved', 'usr-imc-1', now, now, now);
    ex.run('exp-demo-2', 'مكتب استشاري تجريبي (2)', 'Demo Consultancy 2', 'التخطيط المالي وخطط الأعمال', 'مسؤول تجريبي', '01000000102', 'expert2@sona3.local', 'approved', 'usr-imc-1', now, now, now);
    ex.run('exp-demo-3', 'خبير تجريبي (3) — بانتظار الاعتماد', 'Demo Expert 3 (pending)', '', '', '', '', 'pending', null, null, now, now);
  });
}
