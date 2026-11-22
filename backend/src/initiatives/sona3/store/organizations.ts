import { getDb, nowIso } from '../db/sqlite.js';
import { newId, likePattern, type SqlParam, filterSeq } from '../http/helpers.js';
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

export async function getOrganization(id: string): Promise<Organization | null> {
  const r = await getDb().prepare('SELECT * FROM sona3_organizations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export async function listOrganizations(f: { type?: OrgType; q?: string; includeApplicants?: boolean; activeOnly?: boolean }): Promise<Organization[]> {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (f.type) { where.push('type = ?'); params.push(f.type); }
  else if (!f.includeApplicants) where.push("type <> 'applicant'");
  if (f.activeOnly) where.push('isActive = 1');
  if (f.q) { where.push("(nameAr LIKE ? ESCAPE '\\' OR nameEn LIKE ? ESCAPE '\\')"); const p = likePattern(f.q); params.push(p, p); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return (await getDb().prepare(`SELECT * FROM sona3_organizations ${w} ORDER BY type, nameAr LIMIT 500`).all(...params) as Array<Record<string, unknown>>).map(map);
}

export async function createOrganization(input: { type: OrgType; nameAr: string; nameEn: string; contactEmail?: string; id?: string }): Promise<Organization> {
  const id = input.id ?? newId(`org-${input.type}`);
  const now = nowIso();
  await getDb().prepare('INSERT INTO sona3_organizations (id, type, nameAr, nameEn, contactEmail, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
    .run(id, input.type, input.nameAr, input.nameEn, input.contactEmail ?? '', now, now);
  return (await getOrganization(id))!;
}

export async function updateOrganization(id: string, patch: { nameAr?: string; nameEn?: string; contactEmail?: string; isActive?: boolean }): Promise<Organization | null> {
  const cur = await getOrganization(id);
  if (!cur) return null;
  await getDb().prepare('UPDATE sona3_organizations SET nameAr = ?, nameEn = ?, contactEmail = ?, isActive = ?, updatedAt = ? WHERE id = ?').run(
    patch.nameAr ?? cur.nameAr, patch.nameEn ?? cur.nameEn, patch.contactEmail ?? cur.contactEmail,
    (patch.isActive ?? cur.isActive) ? 1 : 0, nowIso(), id,
  );
  return getOrganization(id);
}

/** عدد المستخدمين النشطين بالدور المطلوب لنوع الجهة (لا يُسلَّم طلب لجهة بلا من يعمل فيها). */
export async function activeStaffCount(orgId: string): Promise<number> {
  return Number((await getDb().prepare(`SELECT COUNT(*) AS n FROM users u
    JOIN initiative_memberships m ON m.userId = u.id AND m.initiativeId = 'sona3'
    JOIN sona3_organizations o ON o.id = m.organizationId
    WHERE m.organizationId = ? AND u.isActive = 1 AND m.status = 'active' AND o.isActive = 1 AND m.role <> 'applicant'`).get(orgId) as { n: number }).n);
}

/** جهة التمويل متاحة للإحالة: نشطة ولها مستخدم نشط واحد على الأقل. */
export async function isFunderAvailable(id: string): Promise<boolean> {
  const o = await getOrganization(id);
  return Boolean(o && o.type === 'funder' && o.isActive && await activeStaffCount(id) > 0);
}

/** جهات التمويل النشطة ذات المستخدمين النشطين فقط. */
export async function listActiveFunders(): Promise<Array<{ id: string; nameAr: string; nameEn: string }>> {
  return (await filterSeq(await listOrganizations({ type: 'funder', activeOnly: true }), async (o) => await activeStaffCount(o.id) > 0))
    .map((o) => ({ id: o.id, nameAr: o.nameAr, nameEn: o.nameEn }));
}
