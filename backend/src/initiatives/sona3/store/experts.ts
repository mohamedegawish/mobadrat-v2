import { getDb, nowIso } from '../db/database.js';
import { newId, likePattern, type SqlParam } from '../http/helpers.js';

/** دليل الخبراء ومقدمي الخدمات الداعمين لإعداد الدراسات (المقترح — سادسًا). */
export type ExpertStatus = 'pending' | 'approved' | 'suspended';

export interface Expert {
  id: string; nameAr: string; nameEn: string; specialty: string; contactName: string; contactPhone: string; contactEmail: string; website: string;
  notes: string; status: ExpertStatus; approvedBy: string | null; approvedAt: string | null; suspendedBy: string | null;
  suspendedAt: string | null; createdBy: string | null; createdAt: string; updatedAt: string;
}

export const EXPERT_FIELDS = ['nameAr', 'nameEn', 'specialty', 'contactName', 'contactPhone', 'contactEmail', 'website', 'notes'] as const;
export type ExpertInput = Partial<Record<(typeof EXPERT_FIELDS)[number], string>>;

export async function getExpert(id: string): Promise<Expert | null> {
  return (await getDb().prepare('SELECT * FROM sona3_experts WHERE id = ?').get(id) as unknown as Expert | undefined) ?? null;
}

export async function listExperts(f: { status?: ExpertStatus; q?: string }): Promise<Expert[]> {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (f.status) { where.push('status = ?'); params.push(f.status); }
  if (f.q) { where.push("(nameAr LIKE ? ESCAPE '\\' OR nameEn LIKE ? ESCAPE '\\' OR specialty LIKE ? ESCAPE '\\')"); const p = likePattern(f.q); params.push(p, p, p); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return await getDb().prepare(`SELECT * FROM sona3_experts ${w} ORDER BY status = 'approved' DESC, nameAr LIMIT 500`).all(...params) as unknown as Expert[];
}

export async function createExpert(input: ExpertInput & { nameAr: string }, createdBy: string | null): Promise<Expert> {
  const id = newId('exp');
  const now = nowIso();
  await getDb().prepare(`INSERT INTO sona3_experts (id, nameAr, nameEn, specialty, contactName, contactPhone, contactEmail, website, notes, status, createdBy, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`).run(
    id, input.nameAr, input.nameEn ?? '', input.specialty ?? '', input.contactName ?? '', input.contactPhone ?? '', input.contactEmail ?? '',
    input.website ?? '', input.notes ?? '', createdBy, now, now,
  );
  return (await getExpert(id))!;
}

export async function updateExpert(id: string, patch: ExpertInput): Promise<Expert | null> {
  const cur = await getExpert(id);
  if (!cur) return null;
  const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  await getDb().prepare(`UPDATE sona3_experts SET nameAr = ?, nameEn = ?, specialty = ?, contactName = ?, contactPhone = ?, contactEmail = ?, website = ?, notes = ?,
    updatedAt = ? WHERE id = ?`).run(next.nameAr, next.nameEn, next.specialty, next.contactName, next.contactPhone, next.contactEmail, next.website, next.notes, nowIso(), id);
  return getExpert(id);
}

export async function setExpertStatus(id: string, status: ExpertStatus, userId: string | null): Promise<Expert | null> {
  const now = nowIso();
  if (status === 'approved') {
    await getDb().prepare("UPDATE sona3_experts SET status = 'approved', approvedBy = ?, approvedAt = ?, suspendedBy = NULL, suspendedAt = NULL, updatedAt = ? WHERE id = ?").run(userId, now, now, id);
  } else if (status === 'suspended') {
    await getDb().prepare("UPDATE sona3_experts SET status = 'suspended', suspendedBy = ?, suspendedAt = ?, updatedAt = ? WHERE id = ?").run(userId, now, now, id);
  } else {
    await getDb().prepare("UPDATE sona3_experts SET status = 'pending', updatedAt = ? WHERE id = ?").run(now, id);
  }
  return getExpert(id);
}
