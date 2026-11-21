/**
 * initiative_memberships: the role a person holds in one initiative (applicant or staff), and the module organization it
 * belongs to there. One membership per (user, initiative); role and organization are immutable (DB trigger).
 */
import { getDb, nowIso } from '../db/index.js';
import { newId, type SqlParam } from '../http/helpers.js';

export type MembershipStatus = 'active' | 'suspended' | 'revoked';

export interface Membership {
  id: string; userId: string; initiativeId: string; role: string; organizationId: string | null;
  status: MembershipStatus; createdBy: string | null; createdAt: string; updatedAt: string;
}

function map(r: Record<string, unknown>): Membership {
  return {
    id: String(r.id), userId: String(r.userId), initiativeId: String(r.initiativeId), role: String(r.role),
    organizationId: (r.organizationId as string | null) ?? null, status: r.status as MembershipStatus,
    createdBy: (r.createdBy as string | null) ?? null, createdAt: String(r.createdAt), updatedAt: String(r.updatedAt),
  };
}

export async function getMembership(userId: string, initiativeId: string): Promise<Membership | null> {
  const r = await getDb().prepare('SELECT * FROM initiative_memberships WHERE userId = ? AND initiativeId = ?').get(userId, initiativeId);
  return r ? map(r) : null;
}

export async function getMembershipById(id: string): Promise<Membership | null> {
  const r = await getDb().prepare('SELECT * FROM initiative_memberships WHERE id = ?').get(id);
  return r ? map(r) : null;
}

export async function listMembershipsOfUser(userId: string): Promise<Membership[]> {
  return (await getDb().prepare('SELECT * FROM initiative_memberships WHERE userId = ? ORDER BY createdAt').all(userId)).map(map);
}

export async function listMemberships(f: { initiativeId?: string; role?: string; organizationId?: string; status?: MembershipStatus }): Promise<Membership[]> {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (f.initiativeId) { where.push('initiativeId = ?'); params.push(f.initiativeId); }
  if (f.role) { where.push('role = ?'); params.push(f.role); }
  if (f.organizationId) { where.push('organizationId = ?'); params.push(f.organizationId); }
  if (f.status) { where.push('status = ?'); params.push(f.status); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return (await getDb().prepare(`SELECT * FROM initiative_memberships ${w} ORDER BY createdAt`).all(...params)).map(map);
}

export interface CreateMembershipInput {
  userId: string; initiativeId: string; role: string; organizationId?: string | null; createdBy?: string | null; id?: string;
  status?: MembershipStatus;
}

export async function createMembership(input: CreateMembershipInput): Promise<Membership> {
  const id = input.id ?? newId('mbr');
  const now = nowIso();
  await getDb().prepare(`INSERT INTO initiative_memberships (id, userId, initiativeId, role, organizationId, status, createdBy, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, input.userId, input.initiativeId, input.role, input.organizationId ?? null, input.status ?? 'active', input.createdBy ?? null, now, now,
  );
  return (await getMembershipById(id))!;
}

export async function setMembershipStatus(id: string, status: MembershipStatus): Promise<void> {
  await getDb().prepare('UPDATE initiative_memberships SET status = ?, updatedAt = ? WHERE id = ?').run(status, nowIso(), id);
}

/** Removes a revoked membership so the person can be given a different role in the same initiative. */
export async function deleteMembership(id: string): Promise<void> {
  await getDb().prepare('DELETE FROM initiative_memberships WHERE id = ?').run(id);
}
