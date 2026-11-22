import { getDb, nowIso } from '../db/sqlite.js';
import { newId } from '../http/helpers.js';

/** ملف المتقدم — جهة نوع applicant لكل متقدم (تسجيل ذاتي). */
export interface Applicant { id: string; organizationId: string; userId: string | null; fullName: string; createdBy: string | null; createdAt: string; updatedAt: string }

export async function getApplicantByOrg(organizationId: string): Promise<Applicant | null> {
  return (await getDb().prepare('SELECT * FROM sona3_applicants WHERE organizationId = ?').get(organizationId) as unknown as Applicant | undefined) ?? null;
}

export async function getApplicant(id: string): Promise<Applicant | null> {
  return (await getDb().prepare('SELECT * FROM sona3_applicants WHERE id = ?').get(id) as unknown as Applicant | undefined) ?? null;
}

/** `userId` = the person's platform account (one applicant file per account). */
export async function createApplicant(organizationId: string, fullName: string, createdBy: string | null, userId: string | null = null): Promise<Applicant> {
  const id = newId('apl');
  const now = nowIso();
  await getDb().prepare('INSERT INTO sona3_applicants (id, organizationId, userId, fullName, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, organizationId, userId, fullName, createdBy, now, now);
  return (await getApplicant(id))!;
}

export async function setApplicantCreator(id: string, userId: string): Promise<void> {
  await getDb().prepare('UPDATE sona3_applicants SET createdBy = ? WHERE id = ?').run(userId, id);
}

export async function renameApplicant(id: string, fullName: string): Promise<void> {
  const now = nowIso();
  const db = getDb();
  await db.prepare('UPDATE sona3_applicants SET fullName = ?, updatedAt = ? WHERE id = ?').run(fullName, now, id);
  await db.prepare('UPDATE sona3_organizations SET nameAr = ?, nameEn = ?, updatedAt = ? WHERE id = (SELECT organizationId FROM sona3_applicants WHERE id = ?)')
    .run(fullName, fullName, now, id);
}

export async function getApplicantByUser(userId: string): Promise<Applicant | null> {
  return (await getDb().prepare('SELECT * FROM sona3_applicants WHERE userId = ? ORDER BY createdAt DESC LIMIT 1').get(userId) as unknown as Applicant | undefined) ?? null;
}
