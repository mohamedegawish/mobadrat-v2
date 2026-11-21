/**
 * البيانات التجريبية (حسابات لكل دور + بنوك ومصانع ومقدمو خدمة تجريبيون). الأسماء تجريبية صريحة ولا تمثل جهات حقيقية.
 * كل الحسابات بكلمة المرور SEED_PASSWORD (افتراضي Shams@2026 في التطوير فقط) ومفعّلة، بلا تغيير إجباري.
 * في الإنتاج تعمل فقط مع SEED_PASSWORD خاص وقوي (seedPasswordProblem)، وعلى قاعدة بيانات فارغة فقط (seedIfEmpty).
 */
import { config, DEFAULT_SEED_PASSWORD, seedPasswordProblem } from '../config.js';
import { getDb, nowIso, tx } from './sqlite.js';
import { hashPassword } from '../auth/jwt.js';
import { ORG_IDS, type Role } from '../domain.js';

export const DEV_PASSWORD = () => process.env.SEED_PASSWORD || DEFAULT_SEED_PASSWORD;

export const DEV_ACCOUNTS: Array<{ id: string; email: string; nameAr: string; nameEn: string; role: Role; org: string; phone?: string }> = [
  { id: 'usr-admin', email: 'admin@shams.local', nameAr: 'مدير النظام (تجريبي)', nameEn: 'System Admin (demo)', role: 'system_admin', org: ORG_IDS.admin },
  { id: 'usr-imc-1', email: 'imc1@shams.local', nameAr: 'مراجع IMC الأول (تجريبي)', nameEn: 'IMC Reviewer 1 (demo)', role: 'imc_reviewer', org: ORG_IDS.imc },
  { id: 'usr-imc-2', email: 'imc2@shams.local', nameAr: 'مراجع IMC الثاني (تجريبي)', nameEn: 'IMC Reviewer 2 (demo)', role: 'imc_reviewer', org: ORG_IDS.imc },
  { id: 'usr-encpc-1', email: 'encpc@shams.local', nameAr: 'مراجع ENCPC (تجريبي)', nameEn: 'ENCPC Reviewer (demo)', role: 'encpc_reviewer', org: ORG_IDS.encpc },
  { id: 'usr-pmu-1', email: 'pmu@shams.local', nameAr: 'مراجع PMU (تجريبي)', nameEn: 'PMU Reviewer (demo)', role: 'pmu_reviewer', org: ORG_IDS.pmu },
  // G-02: البنوك جهات خارجية بلا حسابات — البنكان التجريبيان أدناه جهات فقط.
  { id: 'usr-factory-1', email: 'factory@shams.local', nameAr: 'مالك المصنع (تجريبي)', nameEn: 'Factory Owner (demo)', role: 'factory_owner', org: 'org-factory-demo-1', phone: '01000000001' },
  { id: 'usr-factory-2', email: 'factory2@shams.local', nameAr: 'مالك المصنع الثاني (تجريبي)', nameEn: 'Factory Owner 2 (demo)', role: 'factory_owner', org: 'org-factory-demo-2', phone: '01000000002' },
];

export function assertSeedAllowed(): void {
  if (!config.isProd) return;
  const problem = seedPasswordProblem();
  if (problem) throw new Error(`[seed] refused: ${problem}`);
}

export async function seedIfEmpty(): Promise<boolean> {
  assertSeedAllowed();
  const n = (await getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (n > 0) return false;
  await seedDevData();
  return true;
}

export async function seedDevData(): Promise<void> {
  assertSeedAllowed();
  const db = getDb();
  const now = nowIso();
  const hash = hashPassword(DEV_PASSWORD());
  await tx(async () => {
    const org = db.prepare('INSERT OR IGNORE INTO organizations (id, type, nameAr, nameEn, contactEmail, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?)');
    await org.run('org-bank-demo-a', 'bank', 'بنك تجريبي (أ)', 'Demo Bank A', '', now, now);
    await org.run('org-bank-demo-b', 'bank', 'بنك تجريبي (ب)', 'Demo Bank B', '', now, now);
    await org.run('org-factory-demo-1', 'factory', 'مصنع تجريبي للصناعات المعدنية', 'Demo Metal Industries Factory', '', now, now);
    await org.run('org-factory-demo-2', 'factory', 'مصنع تجريبي للصناعات الغذائية', 'Demo Food Industries Factory', '', now, now);
    const fac = db.prepare('INSERT OR IGNORE INTO factories (id, organizationId, companyName, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)');
    await fac.run('fac-demo-1', 'org-factory-demo-1', 'مصنع تجريبي للصناعات المعدنية', now, now);
    await fac.run('fac-demo-2', 'org-factory-demo-2', 'مصنع تجريبي للصناعات الغذائية', now, now);
    const user = db.prepare(`INSERT OR IGNORE INTO users (id, organizationId, role, email, nameAr, nameEn, phone, passwordHash, isActive, mustChangePassword,
      emailVerifiedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`);
    for (const a of DEV_ACCOUNTS) await user.run(a.id, a.org, a.role, a.email, a.nameAr, a.nameEn, a.phone ?? '', hash, now, now, now);
    const sp = db.prepare(`INSERT OR IGNORE INTO service_providers (id, nameAr, nameEn, contactName, contactPhone, contactEmail, status, approvedBy, approvedAt, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    await sp.run('sp-demo-1', 'مقدم خدمة تجريبي (1)', 'Demo Provider 1', 'مسؤول تجريبي', '01000000101', 'provider1@shams.local', 'approved', 'usr-pmu-1', now, now, now);
    await sp.run('sp-demo-2', 'مقدم خدمة تجريبي (2)', 'Demo Provider 2', 'مسؤول تجريبي', '01000000102', 'provider2@shams.local', 'approved', 'usr-pmu-1', now, now, now);
    await sp.run('sp-demo-3', 'مقدم خدمة تجريبي (3) — بانتظار الاعتماد', 'Demo Provider 3 (pending)', '', '', '', 'pending', null, null, now, now);
    await sp.run('sp-demo-4', 'مقدم خدمة تجريبي (4) — موقوف', 'Demo Provider 4 (suspended)', '', '', '', 'suspended', null, null, now, now);
  });
}
