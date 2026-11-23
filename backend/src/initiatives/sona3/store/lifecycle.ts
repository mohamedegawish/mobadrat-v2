/** بيانات ما بعد الاختيار: إحالات التمويل، ومراحل الإنجاز والصرف، وتقارير الأثر، والتظلمات (docs/SONA3_DESIGN.md §5، §10–11). */
import { getDb, nowIso } from '../db/database.js';
import { newId } from '../http/helpers.js';
import type { ApplicationState } from '../workflow/workflow.js';

// ── إحالات التمويل ──────────────────────────────────────────────────────────

export type FinancingModel = 'soft_loan' | 'equity' | 'grant' | 'blended';

export interface FundingReferral {
  id: string; applicationId: string; funderOrgId: string; referredAt: string; referredBy: string | null; referralNote: string;
  status: 'pending' | 'approved' | 'declined'; decidedAt: string | null; decidedBy: string | null;
  amount: number | null; model: FinancingModel | null; terms: string; declineReason: string;
}

export async function listReferrals(appId: string): Promise<FundingReferral[]> {
  return await getDb().prepare('SELECT * FROM sona3_funding_referrals WHERE applicationId = ? ORDER BY referredAt, rowid').all(appId) as unknown as FundingReferral[];
}

export async function pendingReferral(appId: string): Promise<FundingReferral | null> {
  return (await getDb().prepare("SELECT * FROM sona3_funding_referrals WHERE applicationId = ? AND status = 'pending'").get(appId) as unknown as FundingReferral | undefined) ?? null;
}

export async function approvedReferral(appId: string): Promise<FundingReferral | null> {
  return (await getDb().prepare("SELECT * FROM sona3_funding_referrals WHERE applicationId = ? AND status = 'approved' ORDER BY decidedAt DESC LIMIT 1").get(appId) as unknown as FundingReferral | undefined) ?? null;
}

export async function hasReferralTo(appId: string, funderOrgId: string): Promise<boolean> {
  return Boolean(await getDb().prepare('SELECT 1 FROM sona3_funding_referrals WHERE applicationId = ? AND funderOrgId = ? LIMIT 1').get(appId, funderOrgId));
}

export async function insertReferral(appId: string, funderOrgId: string, by: string, note: string): Promise<FundingReferral> {
  const id = newId('ref');
  await getDb().prepare('INSERT INTO sona3_funding_referrals (id, applicationId, funderOrgId, referredAt, referredBy, referralNote) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, appId, funderOrgId, nowIso(), by, note);
  return await getDb().prepare('SELECT * FROM sona3_funding_referrals WHERE id = ?').get(id) as unknown as FundingReferral;
}

export async function decideReferral(id: string, by: string, d: { status: 'approved'; amount: number; model: FinancingModel; terms: string } | { status: 'declined'; reason: string }): Promise<void> {
  const now = nowIso();
  if (d.status === 'approved') {
    await getDb().prepare("UPDATE sona3_funding_referrals SET status = 'approved', decidedAt = ?, decidedBy = ?, amount = ?, model = ?, terms = ? WHERE id = ?")
      .run(now, by, d.amount, d.model, d.terms, id);
  } else {
    await getDb().prepare("UPDATE sona3_funding_referrals SET status = 'declined', decidedAt = ?, decidedBy = ?, declineReason = ? WHERE id = ?").run(now, by, d.reason, id);
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

export async function listMilestones(appId: string): Promise<Milestone[]> {
  return await getDb().prepare('SELECT * FROM sona3_milestones WHERE applicationId = ? ORDER BY seq').all(appId) as unknown as Milestone[];
}

export async function getMilestone(appId: string, id: string): Promise<Milestone | null> {
  return (await getDb().prepare('SELECT * FROM sona3_milestones WHERE id = ? AND applicationId = ?').get(id, appId) as unknown as Milestone | undefined) ?? null;
}

export async function insertMilestones(appId: string, rows: Array<{ title: string; dueDate: string | null; amount: number }>): Promise<void> {
  const now = nowIso();
  const st = getDb().prepare(`INSERT INTO sona3_milestones (id, applicationId, seq, title, dueDate, amount, status, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?)`);
  for (let i = 0; i < rows.length; i++) { const r = rows[i]; await st.run(newId('mst'), appId, i + 1, r.title, r.dueDate, r.amount, now, now); }
}

export async function reportMilestone(id: string, by: string, note: string, evidenceDocId: string | null): Promise<void> {
  const now = nowIso();
  await getDb().prepare("UPDATE sona3_milestones SET status = 'reported', reportNote = ?, reportedAt = ?, reportedBy = ?, evidenceDocId = ?, reviewNote = '', updatedAt = ? WHERE id = ?")
    .run(note, now, by, evidenceDocId, now, id);
}

export async function reviewMilestone(id: string, by: string, verified: boolean, note: string): Promise<void> {
  const now = nowIso();
  if (verified) {
    await getDb().prepare("UPDATE sona3_milestones SET status = 'verified', reviewNote = ?, verifiedAt = ?, verifiedBy = ?, updatedAt = ? WHERE id = ?").run(note, now, by, now, id);
  } else {
    await getDb().prepare("UPDATE sona3_milestones SET status = 'returned', reviewNote = ?, updatedAt = ? WHERE id = ?").run(note, now, id);
  }
}

export async function disburseMilestone(id: string, by: string, ref: string): Promise<void> {
  const now = nowIso();
  await getDb().prepare("UPDATE sona3_milestones SET status = 'disbursed', disbursedAt = ?, disbursedBy = ?, disbursementRef = ?, updatedAt = ? WHERE id = ?").run(now, by, ref, now, id);
}

// ── تقارير الأثر ────────────────────────────────────────────────────────────

export interface ImpactReport {
  id: string; applicationId: string; periodStart: string; periodEnd: string; revenue: number; costs: number; production: string;
  directJobs: number; indirectJobs: number; issues: string; submittedBy: string | null; submittedAt: string;
}

export async function listImpactReports(appId: string): Promise<ImpactReport[]> {
  return await getDb().prepare('SELECT * FROM sona3_impact_reports WHERE applicationId = ? ORDER BY periodEnd DESC').all(appId) as unknown as ImpactReport[];
}

export async function insertImpactReport(appId: string, r: Omit<ImpactReport, 'id' | 'applicationId' | 'submittedAt'>): Promise<ImpactReport> {
  const id = newId('imp');
  await getDb().prepare(`INSERT INTO sona3_impact_reports (id, applicationId, periodStart, periodEnd, revenue, costs, production, directJobs, indirectJobs, issues, submittedBy, submittedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, appId, r.periodStart, r.periodEnd, r.revenue, r.costs, r.production, r.directJobs, r.indirectJobs, r.issues, r.submittedBy, nowIso());
  return await getDb().prepare('SELECT * FROM sona3_impact_reports WHERE id = ?').get(id) as unknown as ImpactReport;
}

// ── التظلمات ────────────────────────────────────────────────────────────────

export interface Appeal {
  id: string; applicationId: string; decisionTransitionId: string; reviewState: ApplicationState; reason: string;
  status: 'pending' | 'accepted' | 'rejected'; decidedBy: string | null; decidedAt: string | null; decisionNote: string;
  createdBy: string | null; createdAt: string;
}

export async function getAppeal(appId: string): Promise<Appeal | null> {
  return (await getDb().prepare('SELECT * FROM sona3_appeals WHERE applicationId = ?').get(appId) as unknown as Appeal | undefined) ?? null;
}

export async function listPendingAppeals(): Promise<Appeal[]> {
  return await getDb().prepare("SELECT * FROM sona3_appeals WHERE status = 'pending' ORDER BY createdAt").all() as unknown as Appeal[];
}

export async function insertAppeal(appId: string, decisionTransitionId: string, reviewState: ApplicationState, reason: string, by: string): Promise<Appeal> {
  await getDb().prepare('INSERT INTO sona3_appeals (id, applicationId, decisionTransitionId, reviewState, reason, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId('apl-appeal'), appId, decisionTransitionId, reviewState, reason, by, nowIso());
  return (await getAppeal(appId))!;
}

export async function decideAppeal(id: string, by: string, accepted: boolean, note: string): Promise<void> {
  await getDb().prepare('UPDATE sona3_appeals SET status = ?, decidedBy = ?, decidedAt = ?, decisionNote = ? WHERE id = ?')
    .run(accepted ? 'accepted' : 'rejected', by, nowIso(), note, id);
}
