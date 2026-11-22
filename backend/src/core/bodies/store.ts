/**
 * The platform's unified directory of participating bodies (platform_bodies) and their links to the organizations of each
 * initiative (platform_body_links). A link only states "this initiative organization is that body": it grants nothing
 * (access stays each person's membership in each initiative).
 */
import { getDb, nowIso } from '../db/index.js';
import { newId, likePattern, type SqlParam } from '../http/helpers.js';
import { AppError } from '../http/errors.js';

export const BODY_KINDS = ['government', 'center', 'financial', 'company', 'committee', 'other'] as const;
export type BodyKind = (typeof BODY_KINDS)[number];
export const BODY_KIND_LABELS: Record<BodyKind, { ar: string; en: string }> = {
  government: { ar: 'جهة حكومية', en: 'Government body' },
  center: { ar: 'مركز أو هيئة فنية', en: 'Centre or technical agency' },
  financial: { ar: 'جهة تمويل أو بنك', en: 'Funder or bank' },
  company: { ar: 'شركة', en: 'Company' },
  committee: { ar: 'لجنة', en: 'Committee' },
  other: { ar: 'أخرى', en: 'Other' },
};

export interface PlatformBody {
  id: string; nameAr: string; nameEn: string; kind: BodyKind; description: string;
  contactEmail: string; contactPhone: string; website: string; isActive: boolean;
  createdBy: string | null; createdAt: string; updatedAt: string;
}

export interface BodyLink { bodyId: string; initiativeId: string; organizationId: string; createdBy: string | null; createdAt: string }

export type BodyInput = Pick<PlatformBody, 'nameAr' | 'nameEn' | 'kind' | 'description' | 'contactEmail' | 'contactPhone' | 'website'>;

function map(r: Record<string, unknown>): PlatformBody {
  return {
    id: String(r.id), nameAr: String(r.nameAr), nameEn: String(r.nameEn ?? ''), kind: r.kind as BodyKind, description: String(r.description ?? ''),
    contactEmail: String(r.contactEmail ?? ''), contactPhone: String(r.contactPhone ?? ''), website: String(r.website ?? ''),
    isActive: Number(r.isActive) === 1, createdBy: (r.createdBy as string | null) ?? null, createdAt: String(r.createdAt), updatedAt: String(r.updatedAt),
  };
}

const mapLink = (r: Record<string, unknown>): BodyLink => ({
  bodyId: String(r.bodyId), initiativeId: String(r.initiativeId), organizationId: String(r.organizationId),
  createdBy: (r.createdBy as string | null) ?? null, createdAt: String(r.createdAt),
});

function isDuplicate(e: unknown, key: string): boolean {
  const err = e as { errno?: number; message?: string };
  return err?.errno === 1062 && String(err.message ?? '').includes(key);
}

const nameTaken = () => new AppError(409, 'BODY_NAME_TAKEN', 'توجد جهة بنفس الاسم في دليل المنصة.', 'A body with this name already exists in the platform directory.', [{ field: 'nameAr', issue: 'taken' }]);

export async function listBodies(f: { q?: string; kind?: BodyKind; status?: 'active' | 'inactive'; initiativeId?: string } = {}): Promise<PlatformBody[]> {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (f.q) { where.push("(b.nameAr LIKE ? ESCAPE '\\' OR b.nameEn LIKE ? ESCAPE '\\')"); const p = likePattern(f.q); params.push(p, p); }
  if (f.kind) { where.push('b.kind = ?'); params.push(f.kind); }
  if (f.status) { where.push('b.isActive = ?'); params.push(f.status === 'active' ? 1 : 0); }
  if (f.initiativeId) { where.push('EXISTS (SELECT 1 FROM platform_body_links l WHERE l.bodyId = b.id AND l.initiativeId = ?)'); params.push(f.initiativeId); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return (await getDb().prepare(`SELECT b.* FROM platform_bodies b ${w} ORDER BY b.isActive DESC, b.nameAr LIMIT 500`).all(...params) as Array<Record<string, unknown>>).map(map);
}

export async function getBody(id: string): Promise<PlatformBody | null> {
  const r = await getDb().prepare('SELECT * FROM platform_bodies WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export async function createBody(input: BodyInput, createdBy: string | null, id?: string): Promise<PlatformBody> {
  const bid = id ?? newId('body');
  const now = nowIso();
  try {
    await getDb().prepare(`INSERT INTO platform_bodies (id, nameAr, nameEn, kind, description, contactEmail, contactPhone, website, isActive, createdBy, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).run(bid, input.nameAr, input.nameEn, input.kind, input.description, input.contactEmail, input.contactPhone, input.website, createdBy, now, now);
  } catch (e) {
    if (isDuplicate(e, 'ux_platform_bodies_name')) throw nameTaken();
    throw e;
  }
  return (await getBody(bid))!;
}

export async function updateBody(id: string, patch: Partial<BodyInput> & { isActive?: boolean }): Promise<PlatformBody | null> {
  const cur = await getBody(id);
  if (!cur) return null;
  const n = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as PlatformBody;
  try {
    await getDb().prepare(`UPDATE platform_bodies SET nameAr = ?, nameEn = ?, kind = ?, description = ?, contactEmail = ?, contactPhone = ?, website = ?, isActive = ?, updatedAt = ?
      WHERE id = ?`).run(n.nameAr, n.nameEn, n.kind, n.description, n.contactEmail, n.contactPhone, n.website, n.isActive ? 1 : 0, nowIso(), id);
  } catch (e) {
    if (isDuplicate(e, 'ux_platform_bodies_name')) throw nameTaken();
    throw e;
  }
  return await getBody(id);
}

/** Deletes a body without links (links must be removed first: a linked body is history the reports rely on). */
export async function deleteBody(id: string): Promise<boolean> {
  const r = await getDb().prepare('DELETE FROM platform_bodies WHERE id = ? AND NOT EXISTS (SELECT 1 FROM platform_body_links l WHERE l.bodyId = ?)').run(id, id);
  return Number(r.changes) === 1;
}

export async function listLinks(bodyIds?: string[]): Promise<BodyLink[]> {
  if (bodyIds && !bodyIds.length) return [];
  const sql = bodyIds
    ? `SELECT * FROM platform_body_links WHERE bodyId IN (${bodyIds.map(() => '?').join(', ')}) ORDER BY initiativeId`
    : 'SELECT * FROM platform_body_links ORDER BY initiativeId';
  return (await getDb().prepare(sql).all(...(bodyIds ?? [])) as Array<Record<string, unknown>>).map(mapLink);
}

export async function findLinkOfOrganization(initiativeId: string, organizationId: string): Promise<BodyLink | null> {
  const r = await getDb().prepare('SELECT * FROM platform_body_links WHERE initiativeId = ? AND organizationId = ?').get(initiativeId, organizationId) as Record<string, unknown> | undefined;
  return r ? mapLink(r) : null;
}

export async function findLinkOfBody(bodyId: string, initiativeId: string): Promise<BodyLink | null> {
  const r = await getDb().prepare('SELECT * FROM platform_body_links WHERE bodyId = ? AND initiativeId = ?').get(bodyId, initiativeId) as Record<string, unknown> | undefined;
  return r ? mapLink(r) : null;
}

export async function addLink(bodyId: string, initiativeId: string, organizationId: string, createdBy: string | null): Promise<BodyLink> {
  try {
    await getDb().prepare('INSERT INTO platform_body_links (bodyId, initiativeId, organizationId, createdBy, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(bodyId, initiativeId, organizationId, createdBy, nowIso());
  } catch (e) {
    // A concurrent link of the same organization or of the same body in this initiative lost the race.
    if (isDuplicate(e, 'PRIMARY')) throw orgAlreadyLinked();
    if (isDuplicate(e, 'ux_body_links_body_initiative')) throw bodyAlreadyInInitiative();
    throw e;
  }
  return (await findLinkOfOrganization(initiativeId, organizationId))!;
}

export async function removeLink(bodyId: string, initiativeId: string): Promise<boolean> {
  const r = await getDb().prepare('DELETE FROM platform_body_links WHERE bodyId = ? AND initiativeId = ?').run(bodyId, initiativeId);
  return Number(r.changes) === 1;
}

export const orgAlreadyLinked = () => new AppError(409, 'ORG_ALREADY_LINKED', 'هذه الجهة في المبادرة مربوطة بالفعل بجهة أخرى في دليل المنصة — افصلها أولًا.', 'This initiative organization is already linked to another platform body. Unlink it first.');
export const bodyAlreadyInInitiative = () => new AppError(409, 'BODY_ALREADY_IN_INITIATIVE', 'هذه الجهة مربوطة بالفعل بجهة أخرى في نفس المبادرة — افصلها أولًا.', 'This body is already linked to another organization of the same initiative. Unlink it first.');

/** Comparable form of a body name across initiatives: no parentheses part, no diacritics or tatweel, unified alef/ya/ta marbuta. */
export function nameKey(name: string): string {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
