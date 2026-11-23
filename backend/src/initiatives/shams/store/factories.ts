import { getDb, nowIso } from '../db/database.js';
import { newId } from '../http/helpers.js';

/** قبول حساب المصنع (migration 009). */
export const FACTORY_ACCOUNT_STATUSES = ['pending', 'under_review', 'correction', 'approved', 'rejected'] as const;
export type FactoryAccountStatus = (typeof FACTORY_ACCOUNT_STATUSES)[number];

export interface Factory {
  id: string; organizationId: string; companyName: string; createdBy: string | null; createdAt: string; updatedAt: string;
  accountStatus: FactoryAccountStatus; approvedAt: string | null;
  /** The shared factory profile (platform core) of this Shams file. */
  factoryProfileId: string | null;
}

export async function getFactoryByOrg(organizationId: string): Promise<Factory | null> {
  return (await getDb().prepare('SELECT * FROM shams_factories WHERE organizationId = ?').get(organizationId) as unknown as Factory | undefined) ?? null;
}

export async function getFactory(id: string): Promise<Factory | null> {
  return (await getDb().prepare('SELECT * FROM shams_factories WHERE id = ?').get(id) as unknown as Factory | undefined) ?? null;
}

/** `accountStatus` الافتراضي approved (CLI والبذرة)؛ التسجيل الذاتي يمرر pending. */
export async function createFactory(organizationId: string, companyName: string, createdBy: string | null, accountStatus: FactoryAccountStatus = 'approved'): Promise<Factory> {
  const id = newId('fac');
  const now = nowIso();
  await getDb().prepare('INSERT INTO shams_factories (id, organizationId, companyName, createdBy, createdAt, updatedAt, accountStatus) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, organizationId, companyName, createdBy, now, now, accountStatus);
  return (await getFactory(id))!;
}

export async function setFactoryCreator(id: string, userId: string): Promise<void> {
  await getDb().prepare('UPDATE shams_factories SET createdBy = ? WHERE id = ?').run(userId, id);
}

export async function renameFactory(id: string, companyName: string): Promise<void> {
  const now = nowIso();
  const db = getDb();
  await db.prepare('UPDATE shams_factories SET companyName = ?, updatedAt = ? WHERE id = ?').run(companyName, now, id);
  await db.prepare('UPDATE shams_organizations SET nameAr = ?, nameEn = ?, updatedAt = ? WHERE id = (SELECT organizationId FROM shams_factories WHERE id = ?)')
    .run(companyName, companyName, now, id);
}


export async function setFactoryAccountStatus(id: string, status: FactoryAccountStatus): Promise<void> {
  const now = nowIso();
  // approvedAt: أول قبول فقط (لا يتغير بعده).
  await getDb().prepare('UPDATE shams_factories SET accountStatus = ?, approvedAt = COALESCE(approvedAt, ?), updatedAt = ? WHERE id = ?')
    .run(status, status === 'approved' ? now : null, now, id);
}

/** Links the Shams factory to the person's shared factory profile (platform core). */
export async function setFactoryProfile(id: string, factoryProfileId: string): Promise<void> {
  await getDb().prepare('UPDATE shams_factories SET factoryProfileId = ?, updatedAt = ? WHERE id = ?').run(factoryProfileId, nowIso(), id);
}

export async function getFactoryByProfile(factoryProfileId: string): Promise<Factory | null> {
  return (await getDb().prepare('SELECT * FROM shams_factories WHERE factoryProfileId = ? ORDER BY createdAt DESC LIMIT 1').get(factoryProfileId) as unknown as Factory | undefined) ?? null;
}
