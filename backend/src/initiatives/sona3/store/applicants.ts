import { getDb, nowIso } from '../db/sqlite.js';
import { newId } from '../http/helpers.js';

/** ملف المتقدم — جهة نوع applicant لكل متقدم (تسجيل ذاتي). */
export interface Applicant { id: string; organizationId: string; fullName: string; createdBy: string | null; createdAt: string; updatedAt: string }

export function getApplicantByOrg(organizationId: string): Applicant | null {
  return (getDb().prepare('SELECT * FROM applicants WHERE organizationId = ?').get(organizationId) as unknown as Applicant | undefined) ?? null;
}

export function getApplicant(id: string): Applicant | null {
  return (getDb().prepare('SELECT * FROM applicants WHERE id = ?').get(id) as unknown as Applicant | undefined) ?? null;
}

export function createApplicant(organizationId: string, fullName: string, createdBy: string | null): Applicant {
  const id = newId('apl');
  const now = nowIso();
  getDb().prepare('INSERT INTO applicants (id, organizationId, fullName, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, organizationId, fullName, createdBy, now, now);
  return getApplicant(id)!;
}

export function setApplicantCreator(id: string, userId: string): void {
  getDb().prepare('UPDATE applicants SET createdBy = ? WHERE id = ?').run(userId, id);
}

export function renameApplicant(id: string, fullName: string): void {
  const now = nowIso();
  const db = getDb();
  db.prepare('UPDATE applicants SET fullName = ?, updatedAt = ? WHERE id = ?').run(fullName, now, id);
  db.prepare('UPDATE organizations SET nameAr = ?, nameEn = ?, updatedAt = ? WHERE id = (SELECT organizationId FROM applicants WHERE id = ?)')
    .run(fullName, fullName, now, id);
}
