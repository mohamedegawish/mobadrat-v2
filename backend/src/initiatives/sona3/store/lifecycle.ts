/** بيانات ما بعد الاختيار: إحالات التمويل، ومراحل الإنجاز والصرف، وتقارير الأثر، والتظلمات (docs/SONA3_DESIGN.md §5، §10–11). */
import { getDb, nowIso } from '../db/sqlite.js';
import { newId } from '../http/helpers.js';
import type { ApplicationState } from '../workflow/workflow.js';

// ── إحالات التمويل ──────────────────────────────────────────────────────────

export type FinancingModel = 'soft_loan' | 'equity' | 'grant' | 'blended';

export interface FundingReferral {
  id: string; applicationId: string; funderOrgId: string; referredAt: string; referredBy: string | null; referralNote: string;
  status: 'pending' | 'approved' | 'declined'; decidedAt: string | null; decidedBy: string | null;
  amount: number | null; model: FinancingModel | null; terms: string; declineReason: string;
}

export function listReferrals(appId: string): FundingReferral[] {
  return getDb().prepare('SELECT * FROM funding_referrals WHERE applicationId = ? ORDER BY referredAt, rowid').all(appId) as unknown as FundingReferral[];
}

export function pendingReferral(appId: string): FundingReferral | null {
  return (getDb().prepare("SELECT * FROM funding_referrals WHERE applicationId = ? AND status = 'pending'").get(appId) as unknown as FundingReferral | undefined) ?? null;
}

export function approvedReferral(appId: string): FundingReferral | null {
  return (getDb().prepare("SELECT * FROM funding_referrals WHERE applicationId = ? AND status = 'approved' ORDER BY decidedAt DESC LIMIT 1").get(appId) as unknown as FundingReferral | undefined) ?? null;
}

export function hasReferralTo(appId: string, funderOrgId: string): boolean {
  return Boolean(getDb().prepare('SELECT 1 FROM funding_referrals WHERE applicationId = ? AND funderOrgId = ? LIMIT 1').get(appId, funderOrgId));
}

export function insertReferral(appId: string, funderOrgId: string, by: string, note: string): FundingReferral {
  const id = newId('ref');
  getDb().prepare('INSERT INTO funding_referrals (id, applicationId, funderOrgId, referredAt, referredBy, referralNote) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, appId, funderOrgId, nowIso(), by, note);
  return getDb().prepare('SELECT * FROM funding_referrals WHERE id = ?').get(id) as unknown as FundingReferral;
}

export function decideReferral(id: string, by: string, d: { status: 'approved'; amount: number; model: FinancingModel; terms: string } | { status: 'declined'; reason: string }): void {
  const now = nowIso();
  if (d.status === 'approved') {
    getDb().prepare("UPDATE funding_referrals SET status = 'approved', decidedAt = ?, decidedBy = ?, amount = ?, model = ?, terms = ? WHERE id = ?")
      .run(now, by, d.amount, d.model, d.terms, id);
  } else {
    getDb().prepare("UPDATE funding_referrals SET status = 'declined', decidedAt = ?, decidedBy = ?, declineReason = ? WHERE id = ?").run(now, by, d.reason, id);
  }
}

// ── مراحل الإنجاز والصرف ────────────────────────────────────────────────────

export type MilestoneStatus = 'planned' | 'reported' | 'verified' | 'returned' | 'disbursed';

export interface Milestone {
  id: string; applicationId: string; seq: number; title: string; dueDate: string | null; amount: number; status: MilestoneStatus;
  reportNote: string; reportedAt: string | null; reportedBy: string | null; evidenceDocId: string | null; reviewNote: string;
  verifiedAt: string | null; verifiedBy: string | null; disbursedAt: string | null; disbursedBy: string | null; disbursementRef: string;
  createdAt: string; updatedAt: string;
}

export function listMilestones(appId: string): Milestone[] {
  return getDb().prepare('SELECT * FROM milestones WHERE applicationId = ? ORDER BY seq').all(appId) as unknown as Milestone[];
}

export function getMilestone(appId: string, id: string): Milestone | null {
  return (getDb().prepare('SELECT * FROM milestones WHERE id = ? AND applicationId = ?').get(id, appId) as unknown as Milestone | undefined) ?? null;
}

export function insertMilestones(appId: string, rows: Array<{ title: string; dueDate: string | null; amount: number }>): void {
  const now = nowIso();
  const st = getDb().prepare(`INSERT INTO milestones (id, applicationId, seq, title, dueDate, amount, status, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?)`);
  rows.forEach((r, i) => st.run(newId('mst'), appId, i + 1, r.title, r.dueDate, r.amount, now, now));
}

export function reportMilestone(id: string, by: string, note: string, evidenceDocId: string | null): void {
  const now = nowIso();
  getDb().prepare("UPDATE milestones SET status = 'reported', reportNote = ?, reportedAt = ?, reportedBy = ?, evidenceDocId = ?, reviewNote = '', updatedAt = ? WHERE id = ?")
    .run(note, now, by, evidenceDocId, now, id);
}

export function reviewMilestone(id: string, by: string, verified: boolean, note: string): void {
  const now = nowIso();
  if (verified) {
    getDb().prepare("UPDATE milestones SET status = 'verified', reviewNote = ?, verifiedAt = ?, verifiedBy = ?, updatedAt = ? WHERE id = ?").run(note, now, by, now, id);
  } else {
    getDb().prepare("UPDATE milestones SET status = 'returned', reviewNote = ?, updatedAt = ? WHERE id = ?").run(note, now, id);
  }
}

export function disburseMilestone(id: string, by: string, ref: string): void {
  const now = nowIso();
  getDb().prepare("UPDATE milestones SET status = 'disbursed', disbursedAt = ?, disbursedBy = ?, disbursementRef = ?, updatedAt = ? WHERE id = ?").run(now, by, ref, now, id);
}

// ── تقارير الأثر ────────────────────────────────────────────────────────────

export interface ImpactReport {
  id: string; applicationId: string; periodStart: string; periodEnd: string; revenue: number; costs: number; production: string;
  directJobs: number; indirectJobs: number; issues: string; submittedBy: string | null; submittedAt: string;
}

export function listImpactReports(appId: string): ImpactReport[] {
  return getDb().prepare('SELECT * FROM impact_reports WHERE applicationId = ? ORDER BY periodEnd DESC').all(appId) as unknown as ImpactReport[];
}

export function insertImpactReport(appId: string, r: Omit<ImpactReport, 'id' | 'applicationId' | 'submittedAt'>): ImpactReport {
  const id = newId('imp');
  getDb().prepare(`INSERT INTO impact_reports (id, applicationId, periodStart, periodEnd, revenue, costs, production, directJobs, indirectJobs, issues, submittedBy, submittedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, appId, r.periodStart, r.periodEnd, r.revenue, r.costs, r.production, r.directJobs, r.indirectJobs, r.issues, r.submittedBy, nowIso());
  return getDb().prepare('SELECT * FROM impact_reports WHERE id = ?').get(id) as unknown as ImpactReport;
}

// ── التظلمات ────────────────────────────────────────────────────────────────

export interface Appeal {
  id: string; applicationId: string; decisionTransitionId: string; reviewState: ApplicationState; reason: string;
  status: 'pending' | 'accepted' | 'rejected'; decidedBy: string | null; decidedAt: string | null; decisionNote: string;
  createdBy: string | null; createdAt: string;
}

export function getAppeal(appId: string): Appeal | null {
  return (getDb().prepare('SELECT * FROM appeals WHERE applicationId = ?').get(appId) as unknown as Appeal | undefined) ?? null;
}

export function listPendingAppeals(): Appeal[] {
  return getDb().prepare("SELECT * FROM appeals WHERE status = 'pending' ORDER BY createdAt").all() as unknown as Appeal[];
}

export function insertAppeal(appId: string, decisionTransitionId: string, reviewState: ApplicationState, reason: string, by: string): Appeal {
  getDb().prepare('INSERT INTO appeals (id, applicationId, decisionTransitionId, reviewState, reason, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId('apl-appeal'), appId, decisionTransitionId, reviewState, reason, by, nowIso());
  return getAppeal(appId)!;
}

export function decideAppeal(id: string, by: string, accepted: boolean, note: string): void {
  getDb().prepare('UPDATE appeals SET status = ?, decidedBy = ?, decidedAt = ?, decisionNote = ? WHERE id = ?')
    .run(accepted ? 'accepted' : 'rejected', by, nowIso(), note, id);
}
