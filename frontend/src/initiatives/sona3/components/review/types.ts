// أنواع واجهات الموظفين (IMC، المقيّم، جهة التمويل، الأدمن) — مطابقة لردود الباك في applicationView / evaluationService.
export interface L2 { ar: string; en: string }

export type StaffRole = 'imc_officer' | 'evaluator' | 'funder_reviewer' | 'system_admin';

export interface Responsible {
  type: 'applicant' | 'imc' | 'committee' | 'funder' | 'none';
  labelAr: string; labelEn: string; orgId: string | null; orgNameAr: string | null; orgNameEn: string | null;
}

export interface ListItem {
  id: string; number: string | null; state: string; stateLabelAr: string; stateLabelEn: string; step: number;
  applicantName: string; projectName: string; sector: string; sectorLabelAr: string; sectorLabelEn: string;
  governorate: string; governorateLabelAr: string; governorateLabelEn: string;
  cohortId: string; cohortNameAr: string; teamSize: number;
  estimatedCost: number; requestedFunding: number; totalInvestment: number; expectedJobs: number;
  score: number | null; passedMinimums: boolean | null; isStalled: boolean; attempt: number; version: number;
  submittedAt: string | null; stateEnteredAt: string; closedAt: string | null; createdAt: string; updatedAt: string;
  responsible: Responsible; isMine: boolean; overdue: boolean; dueAt: string | null; daysInState: number;
  funder: { id: string; nameAr: string; nameEn: string } | null;
}

export interface Page<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number; draftsCount?: number }

export interface AllowedAction {
  action: string; labelAr: string; labelEn: string; to: string; confirm: boolean;
  requires: Record<string, boolean | string | undefined>;
}

export interface EligibilityCheck { key: string; labelAr: string; labelEn: string; ok: boolean | null; valueAr: string }

export interface CriterionDef { key: string; labelAr: string; labelEn: string; hintAr: string; hintEn: string; weight: number }

export interface AssignmentView {
  id: string; evaluatorUserId: string; evaluatorName: string; status: 'assigned' | 'draft' | 'submitted' | 'conflict' | 'removed';
  statusLabelAr: string; statusLabelEn: string; assignedAt: string; coiDeclaredAt: string | null; coiNote: string; submittedAt: string | null;
  scores?: Record<string, number>; notes?: Record<string, string>; recommendation?: string; weightedScore?: number | null;
}

export interface Aggregate { evaluators: number; score: number | null; perCriterion: Record<string, number | null> }

export interface ImcEvaluation {
  criteria: CriterionDef[]; assignments: AssignmentView[]; aggregate: Aggregate;
  minimums: { total: number; financial: number; technical: number; evaluators: number } | null; canAssign: boolean;
}
export interface EvaluatorEvaluation {
  criteria: CriterionDef[]; recommendations: Array<{ value: string; labelAr: string; labelEn: string }>;
  mine: AssignmentView | null; canScore: boolean;
}

export interface Referral {
  id: string; funderOrgId?: string; funderNameAr: string; funderNameEn?: string; status: 'pending' | 'approved' | 'declined';
  referredAt: string; referralNote?: string; decidedAt: string | null; amount?: number | null; model?: string | null; modelLabelAr?: string | null;
  terms?: string; declineReason?: string;
}

export type MilestoneStatus = 'planned' | 'reported' | 'verified' | 'returned' | 'disbursed';
export interface Milestone {
  id: string; seq: number; title: string; dueDate: string | null; amount: number; status: MilestoneStatus;
  reportNote: string; reportedAt: string | null; evidenceDocId: string | null; reviewNote: string;
  verifiedAt: string | null; disbursedAt: string | null; disbursementRef: string;
}

export interface ImpactReport {
  id: string; periodStart: string; periodEnd: string; revenue: number; costs: number; production: string;
  directJobs: number; indirectJobs: number; issues: string; createdAt?: string;
}

export interface DocView {
  id: string; kind: string; labelAr: string; labelEn: string; version: number; attempt: number; isCurrent: boolean; submitted: boolean;
  originalName: string; sizeBytes: number; createdAt: string; downloadable: boolean;
}

export interface TransitionView {
  id: string; fromState: string; toState: string; action: string; actorRole: string; actorName: string; reason: string; attempt: number; createdAt: string;
  fromLabelAr: string; fromLabelEn: string; toLabelAr: string; toLabelEn: string;
}

export interface StudyTotals { totalAssets: number; monthlyMaterials: number; totalInvestment: number; firstYearNetProfit: number; planTotal: number; planWeeks: number; totalJobs: number }

export interface AppealInfo {
  canAppeal: boolean; deadline: string | null; windowDays: number; canDecide: boolean;
  appeal: { id: string; reason: string; status: 'pending' | 'accepted' | 'rejected'; createdAt: string; decidedAt: string | null; decisionNote: string } | null;
}

export interface Detail extends ListItem {
  cohort: { id: string; nameAr: string; opensAt: string; closesAt: string; maxAge: number; selectionTarget: number; evaluationTarget: number } | null;
  data: Record<string, Record<string, unknown>>;
  studyTotals: StudyTotals | null;
  eligibility: { referenceDate: string | null; checks: EligibilityCheck[] } | null;
  expert: { id: string; nameAr: string; specialty: string; status: string } | null;
  evaluation: ImcEvaluation | EvaluatorEvaluation | null;
  selectHint: { outOfRank: boolean; selected: number; target: number; passedMinimums: boolean | null } | null;
  referrals: Referral[]; milestones: Milestone[]; impactReports: ImpactReport[];
  appeal: AppealInfo | null; documents: DocView[]; transitions: TransitionView[];
  deficiencies: Array<{ id: string; stage: string; field: string; note: string; resolved: boolean; labelAr: string; labelEn: string }>;
  returnCounts?: Record<string, number>;
  stalledNote: string; allowedActions: AllowedAction[];
  currentTask: { state: string; labelAr: string; labelEn: string; isMine: boolean; dueAt: string | null; overdue: boolean; daysInState: number } | null;
  metadataOnly?: boolean;
}

export interface RankingRow extends ListItem { rank: number }
export interface Ranking {
  cohort: { id: string; nameAr: string; selectionTarget: number; evaluationTarget: number; minTotalScore: number };
  selected: number; items: RankingRow[];
}

export interface QueueRow {
  id: string; evaluatorUserId: string; evaluatorName: string; status: AssignmentView['status']; statusLabelAr: string; statusLabelEn: string;
  assignedAt: string; coiDeclaredAt: string | null; coiNote: string; submittedAt: string | null;
  applicationId: string; number: string | null; projectName: string; sector: string; appState: string | null;
}

export interface Expert {
  id: string; nameAr: string; nameEn: string; specialty: string; contactName: string; contactPhone: string; contactEmail: string; website: string;
  status: 'pending' | 'approved' | 'suspended'; notes?: string;
}

export interface Person { id: string; nameAr: string; nameEn?: string; email?: string; organizationId?: string; organizationNameAr?: string }
export interface OrgRow { id: string; type: string; nameAr: string; nameEn: string; contactEmail: string; isActive: boolean; isStructural: boolean }

export interface Cohort {
  id: string; nameAr: string; nameEn: string; opensAt: string; closesAt: string; evaluationTarget: number; selectionTarget: number;
  maxAge: number; ageReference: 'cohort_close' | 'submission'; weights: Record<string, number>;
  minTotalScore: number; minFinancialScore: number; minTechnicalScore: number; minEvaluators: number;
  status?: 'upcoming' | 'open' | 'closed'; weightsLocked?: boolean;
}

export interface ReadinessCheck {
  key: string; ok: boolean; labelAr: string; labelEn: string; detailAr: string; detailEn: string;
  items?: Array<{ id: string; labelAr: string; labelEn: string; extraAr?: string; extraEn?: string }>;
}
export interface Readiness { ok: boolean; checks: ReadinessCheck[]; generatedAt: string; notifications?: { failed: number; skipped: number; pending: number } }

export interface MetaField {
  key: string; section: string; type: string; labelAr: string; labelEn: string;
  options?: string; columns?: Array<{ key: string; labelAr: string; labelEn: string; type: string; options?: string }>;
}
export interface Meta { form?: { fields?: MetaField[] } & Record<string, unknown>; [k: string]: unknown }

export interface UserRow { id: string; email: string; nameAr: string; nameEn: string; phone: string; role: string; organizationId: string; organizationNameAr: string; isActive: boolean; lastLoginAt: string | null }
