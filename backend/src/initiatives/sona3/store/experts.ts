import { getDb, nowIso } from '../db/sqlite.js';
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

export function getExpert(id: string): Expert | null {
  return (getDb().prepare('SELECT * FROM experts WHERE id = ?').get(id) as unknown as Expert | undefined) ?? null;
}

export function listExperts(f: { status?: ExpertStatus; q?: string }): Expert[] {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (f.status) { where.push('status = ?'); params.push(f.status); }
  if (f.q) { where.push("(nameAr LIKE ? ESCAPE '\\' OR nameEn LIKE ? ESCAPE '\\' OR specialty LIKE ? ESCAPE '\\')"); const p = likePattern(f.q); params.push(p, p, p); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return getDb().prepare(`SELECT * FROM experts ${w} ORDER BY status = 'approved' DESC, nameAr LIMIT 500`).all(...params) as unknown as Expert[];
}

export function createExpert(input: ExpertInput & { nameAr: string }, createdBy: string | null): Expert {
  const id = newId('exp');
  const now = nowIso();
  getDb().prepare(`INSERT INTO experts (id, nameAr, nameEn, specialty, contactName, contactPhone, contactEmail, website, notes, status, createdBy, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`).run(
    id, input.nameAr, input.nameEn ?? '', input.specialty ?? '', input.contactName ?? '', input.contactPhone ?? '', input.contactEmail ?? '',
    input.website ?? '', input.notes ?? '', createdBy, now, now,
  );
  return getExpert(id)!;
}

export function updateExpert(id: string, patch: ExpertInput): Expert | null {
  const cur = getExpert(id);
  if (!cur) return null;
  const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  getDb().prepare(`UPDATE experts SET nameAr = ?, nameEn = ?, specialty = ?, contactName = ?, contactPhone = ?, contactEmail = ?, website = ?, notes = ?,
    updatedAt = ? WHERE id = ?`).run(next.nameAr, next.nameEn, next.specialty, next.contactName, next.contactPhone, next.contactEmail, next.website, next.notes, nowIso(), id);
  return getExpert(id);
}

export function setExpertStatus(id: string, status: ExpertStatus, userId: string | null): Expert | null {
  const now = nowIso();
  if (status === 'approved') {
    getDb().prepare("UPDATE experts SET status = 'approved', approvedBy = ?, approvedAt = ?, suspendedBy = NULL, suspendedAt = NULL, updatedAt = ? WHERE id = ?").run(userId, now, now, id);
  } else if (status === 'suspended') {
    getDb().prepare("UPDATE experts SET status = 'suspended', suspendedBy = ?, suspendedAt = ?, updatedAt = ? WHERE id = ?").run(userId, now, now, id);
  } else {
    getDb().prepare("UPDATE experts SET status = 'pending', updatedAt = ? WHERE id = ?").run(now, id);
  }
  return getExpert(id);
}
