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

export async function getOrganization(id: string): Promise<Organization | null> {
  const r = await getDb().prepare('SELECT * FROM shams_organizations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

/**
 * Several organizations in one round trip, for list pages and exports (PERF-3). These used to call getOrganization once
 * per row: 750 queries for one IMC work list with ?mine=1. Same rows and mapping as getOrganization; unknown ids are
 * simply absent from the map.
 */
export async function getOrganizationsByIds(ids: Iterable<string>): Promise<Map<string, Organization>> {
  const uniq = [...new Set([...ids].filter(Boolean))];
  const out = new Map<string, Organization>();
  for (let i = 0; i < uniq.length; i += 500) {
    const chunk = uniq.slice(i, i + 500);
    const rows = await getDb().prepare(`SELECT * FROM shams_organizations WHERE id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as Array<Record<string, unknown>>;
    for (const r of rows) out.set(String(r.id), map(r));
  }
  return out;
}

export async function listOrganizations(f: { type?: OrgType; q?: string; includeFactories?: boolean; activeOnly?: boolean }): Promise<Organization[]> {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (f.type) { where.push('type = ?'); params.push(f.type); }
  else if (!f.includeFactories) where.push("type <> 'factory'");
  if (f.activeOnly) where.push('isActive = 1');
  if (f.q) { where.push("(nameAr LIKE ? ESCAPE '\\' OR nameEn LIKE ? ESCAPE '\\')"); const p = likePattern(f.q); params.push(p, p); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return (await getDb().prepare(`SELECT * FROM shams_organizations ${w} ORDER BY type, nameAr LIMIT 500`).all(...params) as Array<Record<string, unknown>>).map(map);
}

export async function createOrganization(input: { type: OrgType; nameAr: string; nameEn: string; contactEmail?: string; id?: string }): Promise<Organization> {
  const id = input.id ?? newId(input.type === 'bank' ? 'org-bank' : `org-${input.type}`);
  const now = nowIso();
  await getDb().prepare('INSERT INTO shams_organizations (id, type, nameAr, nameEn, contactEmail, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
    .run(id, input.type, input.nameAr, input.nameEn, input.contactEmail ?? '', now, now);
  return (await getOrganization(id))!;
}

export async function updateOrganization(id: string, patch: { nameAr?: string; nameEn?: string; contactEmail?: string; isActive?: boolean }): Promise<Organization | null> {
  const cur = await getOrganization(id);
  if (!cur) return null;
  await getDb().prepare('UPDATE shams_organizations SET nameAr = ?, nameEn = ?, contactEmail = ?, isActive = ?, updatedAt = ? WHERE id = ?').run(
    patch.nameAr ?? cur.nameAr, patch.nameEn ?? cur.nameEn, patch.contactEmail ?? cur.contactEmail,
    (patch.isActive ?? cur.isActive) ? 1 : 0, nowIso(), id,
  );
  return await getOrganization(id);
}

/** عدد المستخدمين النشطين بالدور المطلوب لنوع الجهة (لا يُسلَّم طلب لجهة بلا من يعمل فيها). */
export async function activeStaffCount(orgId: string): Promise<number> {
  return Number((await getDb().prepare(`SELECT COUNT(*) AS n FROM users u
    JOIN initiative_memberships m ON m.userId = u.id AND m.initiativeId = 'shams'
    JOIN shams_organizations o ON o.id = m.organizationId
    WHERE m.organizationId = ? AND u.isActive = 1 AND m.status = 'active' AND o.isActive = 1 AND m.role <> 'factory_owner'`).get(orgId) as { n: number }).n);
}

/** البنك متاح للاختيار والإحالة: نشط وله مستخدم نشط واحد على الأقل (B2). */
export async function isBankAvailable(id: string): Promise<boolean> {
  const o = await getOrganization(id);
  // G-02: البنك جهة خارجية بلا مستخدمين — يكفي أن يكون بنكًا مُعرَّفًا ونشطًا.
  return Boolean(o && o.type === 'bank' && o.isActive);
}

/** البنوك التي يعرضها الموقع للمصنع — المُعرَّفة والنشطة فقط. */
export async function listActiveBanks(): Promise<Array<{ id: string; nameAr: string; nameEn: string }>> {
  return (await listOrganizations({ type: 'bank', activeOnly: true }))
    .map((o) => ({ id: o.id, nameAr: o.nameAr, nameEn: o.nameEn }));
}
