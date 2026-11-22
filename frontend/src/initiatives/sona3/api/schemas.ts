/**
 * أنواع عقد API لمنصة «صُنّاع المستقبل».
 * المصدر: backend/src/workflow/{applicationView,applicationForm,workflow}.ts و backend/src/routes/*.ts.
 * القواعد: camelCase، تواريخ ISO، كل نص ظاهر له Ar وEn، الرد { message, status, data }، الخطأ ApiError.
 * (لا نعتمد على contracts/api.contracts.ts لأنه قديم.)
 */

export const API_PREFIX = '/api/v1';

export interface ApiError {
  code: string;
  messageAr: string;
  messageEn: string;
  details?: { field: string; issue: string }[];
}
export interface Envelope<T> { message: string; status: 'ok'; data: T }
export interface Page<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number; draftsCount?: number }

// ── الحالات والإجراءات (workflow.ts) ──
export const APPLICATION_STATES = [
  'DRAFT', 'ELIGIBILITY_REVIEW', 'ELIGIBILITY_CORRECTION', 'STUDY_PREPARATION', 'STUDY_REVIEW', 'STUDY_CORRECTION',
  'COMMITTEE_EVALUATION', 'EVALUATED', 'SELECTED', 'FUNDING_SEARCH', 'FUNDER_REVIEW', 'IMPLEMENTATION', 'OPERATING',
  'REJECTED', 'NOT_SELECTED', 'NOT_APPROVED', 'CLOSED_NOT_FUNDED', 'COMPLETED', 'WITHDRAWN',
] as const;
export type ApplicationState = (typeof APPLICATION_STATES)[number];
export const TERMINAL_STATES: readonly ApplicationState[] = ['REJECTED', 'NOT_SELECTED', 'NOT_APPROVED', 'CLOSED_NOT_FUNDED', 'COMPLETED', 'WITHDRAWN'];

export const ACTIONS = [
  'submit', 'resubmit', 'accept', 'request_correction', 'reject', 'submit_study', 'complete_evaluation',
  'select', 'not_select', 'record_approval', 'record_not_approved', 'refer_funder', 'close_unfunded',
  'approve_funding', 'decline_funding', 'start_operation', 'complete', 'withdraw', 'reopen',
] as const;
export type ActionName = (typeof ACTIONS)[number];

export type Role = 'applicant' | 'imc_officer' | 'evaluator' | 'funder_reviewer' | 'system_admin';
export type OrgType = 'applicant' | 'imc' | 'committee' | 'funder' | 'admin';
export type ResponsibleType = 'applicant' | 'imc' | 'committee' | 'funder' | 'none';

export interface User {
  id: string; email: string; nameAr: string; nameEn: string; phone: string; role: Role; organizationId: string;
  organizationType: OrgType; organizationNameAr: string; organizationNameEn: string; isActive: boolean;
  mustChangePassword: boolean; emailVerified: boolean; lastLoginAt: string | null; createdAt: string;
}
export interface LoginRes { accessToken: string; user: User }

// ── الاستمارة ودراسة الجدوى (applicationForm.ts) ──
export type ApplicationSection = 'personal' | 'team' | 'project' | 'idea' | 'readiness' | 'declarations';
export type StudySection = 'study_market' | 'study_technical' | 'study_financial' | 'study_risks' | 'study_impact' | 'study_plan' | 'expert';
export type FormSection = ApplicationSection | StudySection;
export type DataSection = FormSection | 'approval';
export type FormKind = 'application' | 'study';

export type FieldType =
  | 'text' | 'textarea' | 'select' | 'phone' | 'email' | 'number' | 'integer' | 'money' | 'percent' | 'date'
  | 'nationalId' | 'yesNo' | 'checkbox' | 'file' | 'files' | 'table';

export type OptionsKey =
  | 'governorates' | 'nationalities' | 'applicationTypes' | 'sectors' | 'projectStages' | 'startTimelines'
  | 'technologyLevels' | 'materialSources' | 'financingModels' | 'experts';

export type DocumentKind =
  | 'nationalIdFile' | 'qualificationFile' | 'supportingFile' | 'studyFile' | 'quotationFile'
  | 'approvalFile' | 'fundingDecisionFile' | 'milestoneEvidence';

export interface ColumnMeta {
  key: string; type: 'text' | 'integer' | 'money' | 'number' | 'select' | 'nationalId'; labelAr: string; labelEn: string;
  required: boolean; maxLength?: number; options?: OptionsKey;
}

export interface FieldMeta {
  key: string; section: FormSection; type: FieldType; labelAr: string; labelEn: string; required: boolean;
  hintAr?: string; hintEn?: string; maxLength?: number; maxWords?: number; docKind?: DocumentKind;
  maxItems?: number; minItems?: number; options?: OptionsKey; columns?: ColumnMeta[];
  requiredWhen?: { field: string; equals: string | boolean };
}

export interface Option { value: string; labelAr: string; labelEn: string }
export interface Zone { value: string; labelAr: string; labelEn: string }
export interface Governorate { value: string; labelAr: string; labelEn: string; zones: Zone[] }

export interface CriterionMeta { key: string; labelAr: string; labelEn: string; hintAr?: string; hintEn?: string }

/** GET /meta — يُقرأ بتساهل (utils/metaAccess.ts) لأن backend-core ما زال يضبط شكله. */
export interface Meta {
  form: {
    sections?: FormSection[];
    fields: FieldMeta[];
    maxFileSizeMB: number;
    sectionLabels?: Partial<Record<FormSection, { ar: string; en: string }>>;
    [k: string]: unknown;
  };
  options?: Partial<Record<OptionsKey | 'recommendations', Option[]>>;
  governorates: Governorate[];
  documents?: Array<{ kind: DocumentKind; labelAr: string; labelEn: string }>;
  states?: Array<{ state: ApplicationState; labelAr: string; labelEn: string; step: number; terminal: boolean; responsible: ResponsibleType; responsibleLabelAr: string; responsibleLabelEn: string }>;
  transitions?: Array<{ step: number; from: string; action: ActionName; actorRole: Role; to: ApplicationState; labelAr: string; labelEn: string; proposed?: boolean }>;
  journey?: Array<{ step: number; ar: string; en: string }>;
  criteria?: CriterionMeta[];
  roles: Record<Role, { ar: string; en: string }>;
  policy?: Record<string, unknown>;
  support: { email: string | null; phone: string | null };
  [k: string]: unknown;
}

// ── الطلب (applicationView.ts) ──
export interface Responsible {
  type: ResponsibleType; labelAr: string; labelEn: string; orgId: string | null; orgNameAr: string | null; orgNameEn: string | null;
}

export interface ActionRequires {
  completeApplication?: boolean; completeStudy?: boolean; reason?: boolean; reasonIfOutOfRank?: boolean;
  deficiencies?: 'application' | 'study'; assignedEvaluators?: boolean; evaluationsComplete?: boolean; selectable?: boolean;
  approval?: boolean; funderOrgId?: boolean; funding?: boolean;
}
export interface AllowedAction { action: ActionName; labelAr: string; labelEn: string; to: ApplicationState; confirm: boolean; requires: ActionRequires }

export interface OpenDeficiency { id: string; stage: ApplicationState; field: string; note: string; labelAr: string; labelEn: string }

export interface CurrentTask {
  state: ApplicationState; labelAr: string; labelEn: string; responsible: Responsible; isMine: boolean;
  dueAt: string | null; overdue: boolean; slaDays: number | null; daysInState: number; deficiencies: OpenDeficiency[];
}

export interface ApplicationListItem {
  id: string; number: string | null; state: ApplicationState; stateLabelAr: string; stateLabelEn: string; step: number;
  applicantName: string; projectName: string; sector: string; sectorLabelAr: string; sectorLabelEn: string;
  governorate: string; governorateLabelAr: string; governorateLabelEn: string; cohortId: string; cohortNameAr: string; teamSize: number;
  estimatedCost: number | null; requestedFunding: number | null; totalInvestment: number | null; expectedJobs: number | null;
  score: number | null; passedMinimums: boolean | null; isStalled: boolean; attempt: number; version: number;
  submittedAt: string | null; stateEnteredAt: string; closedAt: string | null; createdAt: string; updatedAt: string;
  responsible: Responsible; isMine: boolean; overdue: boolean; dueAt: string | null; daysInState: number;
  funder: { id: string; nameAr: string; nameEn: string } | null;
}

export interface ApplicationDocument {
  id: string; kind: DocumentKind; field: string; labelAr: string; labelEn: string; version: number; attempt: number;
  status: string; uploadedInState: ApplicationState; isCurrent: boolean; submitted: boolean;
  originalName: string; sizeBytes: number; sha256: string; createdAt: string; downloadable: boolean;
}

export interface TransitionEntry {
  id: string; fromState: ApplicationState; toState: ApplicationState; action: ActionName; actorRole: string; actorOrgId: string | null;
  actorName: string; reason: string; attempt: number; createdAt: string; fromLabelAr: string; fromLabelEn: string; toLabelAr: string; toLabelEn: string;
}

export interface DeficiencyEntry { id: string; stage: ApplicationState; field: string; note: string; resolved: boolean; createdAt: string; labelAr: string; labelEn: string }

export interface StudyTotals { totalAssets: number; monthlyMaterials: number; totalInvestment: number; firstYearNetProfit: number; planTotal: number; planWeeks: number; totalJobs: number }

export interface EligibilityCheck { key: string; labelAr: string; labelEn: string; ok: boolean | null; valueAr: string }

export type MilestoneStatus = 'planned' | 'reported' | 'verified' | 'returned' | 'disbursed';
export interface Milestone {
  id: string; applicationId: string; seq: number; title: string; dueDate: string | null; amount: number; status: MilestoneStatus;
  reportNote: string; reportedAt: string | null; evidenceDocId: string | null; reviewNote: string; verifiedAt: string | null;
  disbursedAt: string | null; disbursementRef: string;
}

export interface ImpactReport {
  id: string; applicationId?: string; periodStart: string; periodEnd: string; revenue: number; costs: number; production: string;
  directJobs: number; indirectJobs: number; issues: string; createdAt?: string;
}

export interface FundingReferral {
  id: string; funderOrgId?: string; funderNameAr: string; funderNameEn?: string; status: 'pending' | 'approved' | 'declined';
  referredAt: string; referralNote?: string; decidedAt: string | null; amount?: number | null; model?: string | null; modelLabelAr?: string | null;
  terms?: string; declineReason?: string;
}

export interface AppealBlock {
  canAppeal: boolean; deadline: string | null; windowDays: number; canDecide: boolean;
  appeal: { id: string; reason: string; status: 'pending' | 'accepted' | 'rejected'; createdAt: string; decidedAt: string | null; decisionNote: string } | null;
}

export interface ApplicationDetail extends ApplicationListItem {
  cohort: { id: string; nameAr: string; opensAt: string; closesAt: string; maxAge: number; selectionTarget: number; evaluationTarget: number } | null;
  data: Partial<Record<DataSection, Record<string, unknown>>>;
  studyTotals: StudyTotals | null;
  eligibility: { referenceDate: string | null; checks: EligibilityCheck[] } | null;
  expert: { id: string; nameAr: string; specialty: string; status: string } | null;
  evaluation: unknown;
  selectHint: unknown;
  referrals: FundingReferral[];
  milestones: Milestone[];
  impactReports: ImpactReport[];
  appeal: AppealBlock | null;
  documents: ApplicationDocument[];
  transitions: TransitionEntry[];
  deficiencies: DeficiencyEntry[];
  returnCounts?: Partial<Record<ApplicationState, number>>;
  stalledNote: string;
  allowedActions: AllowedAction[];
  editableForm: FormKind | null;
  editableFields: string[] | null;
  currentTask: CurrentTask | null;
  pendingAttempt?: number;
  unchangedDeficiencies?: string[];
  metadataOnly?: boolean;
  hasPendingDocuments?: boolean;
}

// ── المتقدم (routes/applicant.ts) ──
export interface ApplicantProfile {
  applicant: { id: string; fullName: string; createdAt: string };
  user: User;
  applications: ApplicationListItem[];
  openApplicationId: string | null;
  openCohort: { id: string; nameAr: string; nameEn: string; opensAt: string; closesAt: string; maxAge: number } | null;
  canStartNew: boolean;
}

export interface Expert {
  id: string; nameAr: string; nameEn?: string; specialty: string; contactName?: string; contactPhone?: string; contactEmail?: string;
  website?: string; status: 'pending' | 'approved' | 'suspended'; notes?: string;
}

export interface ActionBody {
  expectedVersion?: number; reason?: string; note?: string;
  deficiencies?: Array<{ field: string; note?: string }>;
  [k: string]: unknown;
}

export interface RegisterBody { fullName: string; email: string; mobile: string; password: string }

// ── أنواع الشاشات الإدارية (يملكها وكيل الواجهة الإدارية — تُركت بالشكل العام) ──
export interface Organization { id: string; type: OrgType; nameAr: string; nameEn: string; contactEmail: string; isActive: boolean; [k: string]: unknown }
export interface AuditLogEntry { id: string; createdAt: string; action: string; summaryAr: string; actorName?: string; actorRole?: string; ip?: string; [k: string]: unknown }
export interface NotificationLogEntry { id: string; status: string; channel: string; [k: string]: unknown }
export interface WebhookLogEntry { id: string; status: string; [k: string]: unknown }
export interface IntegrationKey { id: string; name: string; scopes: string[]; [k: string]: unknown }
export type IntegrationScope = string;
export interface Readiness { [k: string]: unknown }
export interface Summary { [k: string]: unknown }
export interface ReportSheet { headers: string[]; rows: Array<Array<string | number | null>>; [k: string]: unknown }
export type ReportRow = Record<string, unknown>;
