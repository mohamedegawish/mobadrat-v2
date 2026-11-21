import { getDb, nowIso } from '../db/sqlite.js';
import { newId, likePattern, type SqlParam } from '../http/helpers.js';
import { ORG_IDS, type OrgType } from '../domain.js';

export interface Organization {
  id: string; type: OrgType; nameAr: string; nameEn: string; contactEmail: string; isActive: boolean;
  isStructural: boolean; createdAt: string; updatedAt: string;
}

const STRUCTURAL = new Set<string>(Object.values(ORG_IDS));

function map(r: Record<string, unknown>): Organization {
  return {
    id: String(r.id), type: r.type as OrgType, nameAr: String(r.nameAr), nameEn: String(r.nameEn),
    contactEmail: String(r.contactEmail ?? ''), isActive: r.isActive === 1, isStructural: STRUCTURAL.has(String(r.id)),
    createdAt: String(r.createdAt), updatedAt: String(r.updatedAt),
  };
}

export function isStructuralOrg(id: string): boolean { return STRUCTURAL.has(id); }

export function getOrganization(id: string): Organization | null {
  const r = getDb().prepare('SELECT * FROM organizations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export function listOrganizations(f: { type?: OrgType; q?: string; includeApplicants?: boolean; activeOnly?: boolean }): Organization[] {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (f.type) { where.push('type = ?'); params.push(f.type); }
  else if (!f.includeApplicants) where.push("type <> 'applicant'");
  if (f.activeOnly) where.push('isActive = 1');
  if (f.q) { where.push("(nameAr LIKE ? ESCAPE '\\' OR nameEn LIKE ? ESCAPE '\\')"); const p = likePattern(f.q); params.push(p, p); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return (getDb().prepare(`SELECT * FROM organizations ${w} ORDER BY type, nameAr LIMIT 500`).all(...params) as Array<Record<string, unknown>>).map(map);
}

export function createOrganization(input: { type: OrgType; nameAr: string; nameEn: string; contactEmail?: string; id?: string }): Organization {
  const id = input.id ?? newId(`org-${input.type}`);
  const now = nowIso();
  getDb().prepare('INSERT INTO organizations (id, type, nameAr, nameEn, contactEmail, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
    .run(id, input.type, input.nameAr, input.nameEn, input.contactEmail ?? '', now, now);
  return getOrganization(id)!;
}

export function updateOrganization(id: string, patch: { nameAr?: string; nameEn?: string; contactEmail?: string; isActive?: boolean }): Organization | null {
  const cur = getOrganization(id);
  if (!cur) return null;
  getDb().prepare('UPDATE organizations SET nameAr = ?, nameEn = ?, contactEmail = ?, isActive = ?, updatedAt = ? WHERE id = ?').run(
    patch.nameAr ?? cur.nameAr, patch.nameEn ?? cur.nameEn, patch.contactEmail ?? cur.contactEmail,
    (patch.isActive ?? cur.isActive) ? 1 : 0, nowIso(), id,
  );
  return getOrganization(id);
}

/** عدد المستخدمين النشطين بالدور المطلوب لنوع الجهة (لا يُسلَّم طلب لجهة بلا من يعمل فيها). */
export function activeStaffCount(orgId: string): number {
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM users u JOIN organizations o ON o.id = u.organizationId
    WHERE u.organizationId = ? AND u.isActive = 1 AND o.isActive = 1 AND u.role <> 'applicant'`).get(orgId) as { n: number }).n;
}

/** جهة التمويل متاحة للإحالة: نشطة ولها مستخدم نشط واحد على الأقل. */
export function isFunderAvailable(id: string): boolean {
  const o = getOrganization(id);
  return Boolean(o && o.type === 'funder' && o.isActive && activeStaffCount(id) > 0);
}

/** جهات التمويل النشطة ذات المستخدمين النشطين فقط. */
export function listActiveFunders(): Array<{ id: string; nameAr: string; nameEn: string }> {
  return listOrganizations({ type: 'funder', activeOnly: true }).filter((o) => activeStaffCount(o.id) > 0)
    .map((o) => ({ id: o.id, nameAr: o.nameAr, nameEn: o.nameEn }));
}
