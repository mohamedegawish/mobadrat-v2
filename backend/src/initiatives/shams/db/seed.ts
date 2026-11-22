/**
 * Shams demo data (accounts per role + demo banks, factories and service providers). Explicitly fictitious names.
 * Platform accounts + Shams memberships; the factory owners also get a shared factory profile (to demonstrate reuse).
 * Run by the platform's seed (empty database only; production needs its own SEED_PASSWORD).
 */
import { getDb, nowIso, tx } from './sqlite.js';
import { hashPassword } from '../auth/jwt.js';
import { ORG_IDS, type Role } from '../domain.js';
import { createCoreUser, getUserByEmail } from '../../../core/store/users.js';
import { createMembership, getMembership } from '../../../core/store/memberships.js';
import { createFactoryProfile, savePersonProfile } from '../../../core/profile/store.js';
import { MODULE_ID } from '../config.js';

export const DEV_ACCOUNTS: Array<{ id: string; email: string; nameAr: string; nameEn: string; role: Role; org: string; phone?: string }> = [
  { id: 'usr-admin', email: 'admin@shams.local', nameAr: 'مدير النظام (تجريبي)', nameEn: 'System Admin (demo)', role: 'system_admin', org: ORG_IDS.admin },
  { id: 'usr-imc-1', email: 'imc1@shams.local', nameAr: 'مراجع IMC الأول (تجريبي)', nameEn: 'IMC Reviewer 1 (demo)', role: 'imc_reviewer', org: ORG_IDS.imc },
  { id: 'usr-imc-2', email: 'imc2@shams.local', nameAr: 'مراجع IMC الثاني (تجريبي)', nameEn: 'IMC Reviewer 2 (demo)', role: 'imc_reviewer', org: ORG_IDS.imc },
  { id: 'usr-encpc-1', email: 'encpc@shams.local', nameAr: 'مراجع ENCPC (تجريبي)', nameEn: 'ENCPC Reviewer (demo)', role: 'encpc_reviewer', org: ORG_IDS.encpc },
  { id: 'usr-pmu-1', email: 'pmu@shams.local', nameAr: 'مراجع PMU (تجريبي)', nameEn: 'PMU Reviewer (demo)', role: 'pmu_reviewer', org: ORG_IDS.pmu },
  { id: 'usr-factory-1', email: 'factory@shams.local', nameAr: 'مالك المصنع (تجريبي)', nameEn: 'Factory Owner (demo)', role: 'factory_owner', org: 'org-factory-demo-1', phone: '01000000001' },
  { id: 'usr-factory-2', email: 'factory2@shams.local', nameAr: 'مالك المصنع الثاني (تجريبي)', nameEn: 'Factory Owner 2 (demo)', role: 'factory_owner', org: 'org-factory-demo-2', phone: '01000000002' },
];

const DEMO_FACTORIES = [
  { org: 'org-factory-demo-1', fac: 'fac-demo-1', name: 'مصنع تجريبي للصناعات المعدنية', nameEn: 'Demo Metal Industries Factory', owner: 'usr-factory-1', governorate: 'sharqia', zone: 'other', reg: 'DEMO-REG-1001' },
  { org: 'org-factory-demo-2', fac: 'fac-demo-2', name: 'مصنع تجريبي للصناعات الغذائية', nameEn: 'Demo Food Industries Factory', owner: 'usr-factory-2', governorate: 'giza', zone: 'other', reg: 'DEMO-REG-1002' },
];

export async function seedDevData(password: string): Promise<void> {
  const db = getDb();
  const now = nowIso();
  const hash = hashPassword(password);
  await tx(async () => {
    const org = db.prepare('INSERT OR IGNORE INTO shams_organizations (id, type, nameAr, nameEn, contactEmail, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?)');
    await org.run('org-bank-demo-a', 'bank', 'بنك تجريبي (أ)', 'Demo Bank A', '', now, now);
    await org.run('org-bank-demo-b', 'bank', 'بنك تجريبي (ب)', 'Demo Bank B', '', now, now);
    for (const f of DEMO_FACTORIES) await org.run(f.org, 'factory', f.name, f.nameEn, '', now, now);
    const fac = db.prepare('INSERT OR IGNORE INTO shams_factories (id, organizationId, companyName, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)');
    for (const f of DEMO_FACTORIES) await fac.run(f.fac, f.org, f.name, now, now);
    for (const a of DEV_ACCOUNTS) {
      const existing = await getUserByEmail(a.email);
      const u = existing ?? await createCoreUser({ id: a.id, email: a.email, nameAr: a.nameAr, nameEn: a.nameEn, phone: a.phone ?? '', passwordHash: hash, emailVerified: true });
      if (!(await getMembership(u.id, MODULE_ID))) await createMembership({ userId: u.id, initiativeId: MODULE_ID, role: a.role, organizationId: a.org });
      await savePersonProfile(u.id, { 'person.fullNameAr': a.nameAr, 'person.fullNameEn': a.nameEn, ...(a.phone ? { 'person.phone': a.phone } : {}) });
    }
    for (const f of DEMO_FACTORIES) {
      const profile = await createFactoryProfile(f.owner, {
        'factory.companyName': f.name, 'factory.governorate': f.governorate, 'factory.industrialZone': f.zone,
        'factory.industrialRegistryNumber': f.reg, 'factory.address': 'عنوان تجريبي',
      });
      await db.prepare('UPDATE shams_factories SET factoryProfileId = ? WHERE id = ?').run(profile.id, f.fac);
    }
    const sp = db.prepare(`INSERT OR IGNORE INTO shams_service_providers (id, nameAr, nameEn, contactName, contactPhone, contactEmail, status, approvedBy, approvedAt, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    await sp.run('sp-demo-1', 'مقدم خدمة تجريبي (1)', 'Demo Provider 1', 'مسؤول تجريبي', '01000000101', 'provider1@shams.local', 'approved', 'usr-pmu-1', now, now, now);
    await sp.run('sp-demo-2', 'مقدم خدمة تجريبي (2)', 'Demo Provider 2', 'مسؤول تجريبي', '01000000102', 'provider2@shams.local', 'approved', 'usr-pmu-1', now, now, now);
    await sp.run('sp-demo-3', 'مقدم خدمة تجريبي (3) — بانتظار الاعتماد', 'Demo Provider 3 (pending)', '', '', '', 'pending', null, null, now, now);
    await sp.run('sp-demo-4', 'مقدم خدمة تجريبي (4) — موقوف', 'Demo Provider 4 (suspended)', '', '', '', 'suspended', null, null, now, now);
  });
}
