/**
 * عقد API موقع «شمس الصناعة» — الأنواع المشتركة بين الواجهة والباك.
 * المصدر الوحيد للحالات والانتقالات: backend/src/workflow/shamsWorkflow.ts (اختبار العقود يتحقق من التطابق).
 * القواعد: camelCase، تواريخ ISO UTC، كل نص ظاهر له Ar وEn، الرد { message, status, data }، الخطأ ApiError.
 */

export const API_PREFIX = '/api/v1';

export interface ApiError {
  code: string;
  messageAr: string;
  messageEn: string;
  /** F7: each invalid field's own message (its Arabic name + what is wrong); `field`/`issue` stay codes for programs. */
  details?: { field: string; issue: string; messageAr?: string; messageEn?: string }[];
}

export interface Envelope<T> { message: string; status: 'ok'; data: T }

export interface Page<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number; /** PMU/الأدمن: المسودات غير المُرسلة (خارج القائمة — M5). */ draftsCount?: number }

export const APPLICATION_STATES = [
  'DRAFT', 'IMC_REVIEW', 'IMC_CORRECTION', 'ENCPC_REVIEW', 'ENCPC_CORRECTION', 'PROVIDER_SELECTION', 'OFFER_UPLOAD',
  'OFFER_REVIEW', 'OFFER_CORRECTION', 'ELECTRICITY_UPLOAD', 'ELECTRICITY_REVIEW', 'BANK_STUDY', 'CONTRACT_OUTCOME',
  'DISTRIBUTION_UPLOAD', 'DISTRIBUTION_REVIEW',
  'REJECTED', 'CONTRACTED', 'CLOSED_NOT_CONTRACTED', 'WITHDRAWN',
] as const;
export type ApplicationState = (typeof APPLICATION_STATES)[number];
export const TERMINAL_STATES: readonly ApplicationState[] = ['REJECTED', 'CONTRACTED', 'CLOSED_NOT_CONTRACTED', 'WITHDRAWN'];

export const ACTIONS = [
  'submit', 'resubmit', 'accept', 'request_correction', 'reject', 'compliant', 'non_compliant',
  'select_provider', 'submit_offer', 'submit_electricity', 'select_bank', 'record_contract', 'record_no_contract', 'withdraw',
  'select_distribution_path', 'submit_distribution_approval', 'reject_distribution',
] as const;
export type ActionName = (typeof ACTIONS)[number];

/** مسار التعاقد بعد قبول PMU لموافقة الكهرباء: بنك (اختيار البنك يثبّته) أو شركة توزيع الكهرباء. null = لم يُختر بعد. */
export type ContractPath = 'bank' | 'distribution';

/** bank_reviewer: دور ملغى (G-02) — يبقى في السجل التاريخي فقط؛ لا حسابات للبنوك. */
export type Role = 'factory_owner' | 'imc_reviewer' | 'encpc_reviewer' | 'pmu_reviewer' | 'bank_reviewer' | 'system_admin';
export type OrgType = 'factory' | 'imc' | 'encpc' | 'pmu' | 'bank' | 'admin';
export type ResponsibleType = 'factory' | 'imc' | 'encpc' | 'pmu' | 'bank' | 'none';
export type FormSection = 'general' | 'contact' | 'company' | 'engineering';
export type DocumentKind = 'commercialRegisterFile' | 'industrialRegisterFile' | 'taxCardFile' | 'electricityBill' | 'ownershipProofFile' | 'technicalOfferFile' | 'electricityApprovalFile' | 'contractFile' | 'distributionApprovalFile';

export interface User {
  id: string; email: string; nameAr: string; nameEn: string; phone: string; role: Role; organizationId: string;
  organizationType: OrgType; organizationNameAr: string; organizationNameEn: string; isActive: boolean;
  mustChangePassword: boolean; emailVerified: boolean; lastLoginAt: string | null; createdAt: string;
  /** حساب المصنع: approved = دخول كامل؛ pending/correction = دخول مقيّد بتعديل الطلب وإعادة إرساله؛ null لغير المصانع. */
  accountStatus?: FactoryAccountStatus | null;
}

export type FactoryAccountStatus = 'pending' | 'under_review' | 'correction' | 'approved' | 'rejected';

export interface LoginRes { accessToken: string; user: User }

export interface Responsible {
  type: ResponsibleType; labelAr: string; labelEn: string; orgId: string | null; orgNameAr: string | null; orgNameEn: string | null;
}

export interface AllowedAction {
  action: ActionName; labelAr: string; labelEn: string; to: ApplicationState; confirm: boolean;
  requires: {
    completeForm?: boolean; reason?: boolean; deficiencies?: boolean; providerId?: boolean; bankOrgId?: boolean;
    newDocument?: 'technicalOfferFile' | 'electricityApprovalFile' | 'contractFile' | 'distributionApprovalFile'; electricity?: boolean; contract?: boolean; bankSelected?: boolean;
  };
}

export interface OpenDeficiency { id: string; stage: ApplicationState; field: string; note: string; labelAr: string; labelEn: string }

export interface CurrentTask {
  state: ApplicationState; labelAr: string; labelEn: string; responsible: Responsible; isMine: boolean;
  dueAt: string | null; overdue: boolean; slaDays: number | null; daysInState: number; deficiencies: OpenDeficiency[];
}

export interface ApplicationListItem {
  id: string; number: string | null; state: ApplicationState; stateLabelAr: string; stateLabelEn: string; step: number;
  companyName: string; governorate: string; industrialZone: string; industrialRegistryNumber: string | null; totalRoofArea: number;
  attempt: number; version: number; submittedAt: string | null; stateEnteredAt: string; closedAt: string | null; createdAt: string; updatedAt: string;
  responsible: Responsible; isMine: boolean; overdue: boolean; dueAt: string | null; daysInState: number;
  bank: { id: string; nameAr: string; nameEn: string } | null;
  contractPath: ContractPath | null;
}

export interface ApplicationDocument {
  id: string; kind: DocumentKind; field: string; labelAr: string; labelEn: string; version: number; attempt: number;
  status: 'current' | 'superseded' | 'removed'; uploadedInState: ApplicationState; isCurrent: boolean; submitted: boolean;
  originalName: string; sizeBytes: number; sha256: string; createdAt: string;
  /** false للأدمن عند shamsPolicy.adminCanViewApplicationDocuments=false (بيانات وصفية فقط). */
  downloadable: boolean;
  /** اسم من رفع النسخة (للسجل الزمني). */
  uploadedByName: string;
}

export interface TransitionEntry {
  id: string; fromState: ApplicationState; toState: ApplicationState; action: ActionName; actorRole: string; actorOrgId: string | null;
  actorName: string; reason: string; attempt: number; createdAt: string; fromLabelAr: string; fromLabelEn: string; toLabelAr: string; toLabelEn: string;
  registryResult: string | null;
}

export interface DeficiencyEntry { id: string; stage: ApplicationState; field: string; note: string; resolved: boolean; createdAt: string; labelAr: string; labelEn: string }

export interface RoofArea { name: string; area: number }

export interface ApplicationDetail extends ApplicationListItem {
  factoryId?: string;
  data: Partial<Record<FormSection | 'provider' | 'electricity' | 'bank_result' | 'contract', Record<string, unknown>>>;
  registry: {
    /** manual = no registry API yet: IMC checks the number against the uploaded industrial registry certificate. */
    result: 'valid' | 'invalid' | 'unavailable' | 'manual'; registryNumber: string; checkedAt: string; facility: Record<string, unknown> | null; errorCode: string | null;
    /** بيانات السجل بتسميات عربية/إنجليزية (M1). */
    fields: { key: string; labelAr: string; labelEn: string; valueAr: string; valueEn: string }[];
    /** مقارنة اسم المنشأة في السجل باسم الشركة في الطلب — تمييز فقط، لا منع (I3). */
    nameCheck: { applicationName: string; registryName: string; matches: boolean } | null;
  } | null;
  /** تعارضات رقم السجل مع طلبات مصانع أخرى (IMC وPMU) — I3. */
  registryConflicts: RegistryConflict[];
  /**
   * F2 / D3 (owner, DRAFT or IMC_CORRECTION only): the draft's registry number is used by another factory's open application
   * (`in_use`) or on hold (`blocked` / `reserved`) — it cannot be submitted until PMU decides; the objection is offered.
   */
  /** D4: an objection by another factory to this application's registry number is under PMU review — only withdrawal remains. */
  registryDisputeOpen?: boolean;
  registryHold?: {
    registryNumber: string; reason: 'in_use' | 'blocked' | 'reserved';
    objection: { id: string; status: 'pending' | 'accepted' | 'rejected'; decisionReason: string; decisionReference: string } | null;
  } | null;
  /** selectable =يستطيع المصنع المتابعة معه الآن (مفعّل من ENCPC ومعتمد من PMU إن لزم)؛ false بعد الإيقاف/إلغاء التفعيل. */
  provider: { id: string; nameAr: string; nameEn: string; description: string; contactName: string; contactPhone: string; contactEmail: string; status: 'pending' | 'approved' | 'suspended'; isActive: boolean; selectable: boolean } | null;
  /** الإحالات السابقة قبل «إعادة الإحالة لبنك آخر» (I4). */
  referralHistory: { bankOrgId: string; bankNameAr: string; bankNameEn: string; referredAt: string; endedAt: string; endReason: string }[];
  bankReferral: {
    referredAt: string; studyResult: 'approved' | 'declined' | null; studyDate: string | null; bankNotes: string;
    contractStatus: 'contracted' | 'not_contracted' | null; contractDate: string | null; contractAmount: number | null; contractNotes: string; notContractedReason: string;
    /** I8: القيمة يسجلها المصنع لا البنك. */
    contractAmountRecordedBy: 'factory'; contractAmountAboveAlert: boolean;
  } | null;
  /** التعاقد عن طريق شركة توزيع الكهرباء: الاختيار والإرسال وقرار PMU النهائي. */
  distributionContract: {
    selectedAt: string; selectedByName: string; submittedAt: string | null; submissionCount: number; approvalDocumentId: string | null;
    reviewStatus: 'pending' | 'approved' | 'rejected' | null; decidedAt: string | null; decidedByName: string; decisionNotes: string;
  } | null;
  documents: ApplicationDocument[];
  transitions: TransitionEntry[];
  deficiencies: DeficiencyEntry[];
  returnCounts?: Partial<Record<ApplicationState, number>>;
  allowedActions: AllowedAction[];
  editableFields: string[];
  currentTask: CurrentTask | null;
  pendingAttempt?: number;
  hasPendingDocuments?: boolean;
  /** M8: بنود نواقص لم يُعدَّل فيها شيء منذ آخر إرسال (تنبيه فقط). */
  unchangedDeficiencies?: string[];
  /** الأدمن: بيانات وصفية فقط. */
  metadataOnly?: boolean;
}

export interface RegistryConflict {
  id: string; registryNumber: string; thisApplicationHoldsNumber: boolean; attempts: number; createdAt: string; lastAttemptAt: string;
  other: { id: string; number: string | null; companyName: string; state: ApplicationState; stateLabelAr: string; stateLabelEn: string } | null;
}

export interface ActionBody {
  expectedVersion: number; reason?: string; reasonCode?: 'registry_ownership_mismatch' | 'other'; note?: string; deficiencies?: { field: string; note: string }[];
  providerId?: string; distributionCompany?: string;
  /** select_bank فقط — بعد قبول PMU لموافقة الكهرباء (G-01). */
  bankOrgId?: string;
  contractDate?: string; contractAmount?: number; contractNotes?: string;
}

export interface FieldMeta {
  key: string; section: FormSection; type: 'text' | 'textarea' | 'select' | 'phone' | 'url' | 'email' | 'number' | 'date' | 'file' | 'files' | 'roofTable';
  labelAr: string; labelEn: string; maxLength?: number; docKind?: DocumentKind;
  options?: 'governorates' | 'zones' | 'capacityUnits' | 'loadUnits' | 'ownershipTypes'; required: boolean;
}

export interface Governorate { value: string; labelAr: string; labelEn: string; zones: { value: string; labelAr: string; labelEn: string }[] }

export interface StateMeta {
  state: ApplicationState; labelAr: string; labelEn: string; step: number; terminal: boolean;
  responsible: ResponsibleType; responsibleLabelAr: string; responsibleLabelEn: string;
}

export interface Meta {
  form: {
    sections: FormSection[]; fields: FieldMeta[]; maxFileSizeMB: number; electricityBills: { min: number; max: number };
    roofAreas: { min: number; max: number }; capacityUnits: string[]; loadUnits: string[];
    ownershipTypes: { value: string; labelAr: string; labelEn: string }[];
  };
  governorates: Governorate[];
  documents: { kind: DocumentKind; labelAr: string; labelEn: string }[];
  states: StateMeta[];
  transitions: { step: number; from: string; action: ActionName; actorRole: Role; to: ApplicationState; when: string | null; proposed: boolean; labelAr: string; labelEn: string }[];
  roles: Record<Role, { ar: string; en: string }>;
  banks: { id: string; nameAr: string; nameEn: string }[];
  policy: {
    maxReturnsPerStage: number | null; withdrawFrom: string; bankSelection: string; slaDays: Partial<Record<ApplicationState, number | null>>;
    slaConfigured: boolean; contractAmountAlertEGP: number; imcRejectReasonCodes: string[]; adminCanViewApplicationDocuments: boolean;
  };
  /** قناة الاستفسار الرسمية — null عند عدم الضبط. */
  support: { email: string | null; phone: string | null };
}

export interface FactoryProfile {
  factory: { id: string; companyName: string; createdAt: string };
  user: User;
  applications: ApplicationListItem[];
  openApplicationId: string | null;
  canStartNew: boolean;
}

/** دليل مقدمي الخدمة. الحقول بعد `status` يرسلها السيرفر لـENCPC وPMU فقط؛ المصنع يرى الاسم والتفاصيل والشعار والموقع. */
export interface ServiceProvider {
  id: string; nameAr: string; nameEn: string; description: string; website: string; hasLogo: boolean; logoUrl: string | null;
  status: 'pending' | 'approved' | 'suspended';
  contactName?: string; contactPhone?: string; contactEmail?: string; notes?: string;
  /** ظهور المقدم للمصانع = مفعّل (ENCPC) + معتمد (PMU) إن كان الاعتماد مطلوبًا. */
  isActive?: boolean; selectable?: boolean; approvalRequired?: boolean;
  approvedAt?: string | null; approvedBy?: string | null; suspendedAt?: string | null; deactivatedAt?: string | null; createdAt?: string; updatedAt?: string;
}

export interface Organization {
  id: string; type: OrgType; nameAr: string; nameEn: string; contactEmail: string; isActive: boolean; isStructural: boolean; createdAt: string; updatedAt: string;
}

export interface AuditLogEntry {
  id: string; at: string; actorType: 'user' | 'integration_key' | 'system' | 'anonymous'; actorUserId: string | null; actorName: string;
  actorRole: string; actorOrgId: string | null; integrationKeyId: string | null; action: string; entityType: string; entityId: string;
  applicationId: string | null; summaryAr: string; details: Record<string, unknown>; ip: string;
}

export type IntegrationScope = 'read' | 'read_documents' | 'manage_users' | 'manage_providers' | 'read_audit';

export interface IntegrationKey {
  id: string; name: string; keyPrefix: string; scopes: IntegrationScope[]; rateLimitPerMinute: number; createdBy: string | null;
  createdAt: string; lastUsedAt: string | null; revokedAt: string | null; revokedBy: string | null; rotatedFromId: string | null;
  /** H1: مفاتيح نطاقات البيانات تبقى pending_approval حتى توافق PMU. */
  approvalStatus: 'active' | 'pending_approval' | 'rejected'; approvedBy: string | null; approvedAt: string | null;
}

/** H2: طلب إنشاء حساب جهة قرار أو تغيير بريده — تعتمده الجهة نفسها. */
export interface AccountRequest {
  id: string; kind: 'create_user' | 'change_email'; status: 'pending' | 'approved' | 'rejected'; email: string; nameAr: string; nameEn: string; phone: string;
  role: Role; roleLabelAr: string; roleLabelEn: string; reason: string; organizationId: string; organizationNameAr: string; organizationNameEn: string;
  targetUserId: string | null; targetCurrentEmail: string | null; requestedByType: 'user' | 'integration_key'; requestedByName: string;
  decidedAt: string | null; decisionNote: string; resultUserId: string | null; createdAt: string;
}

/** القاعدة G: اعتراض مصنع على حظر/حجز رقم سجل — تراجعه PMU. */
/** بطاقة في لوحة الدور. link.param = معامل #work-queue/<param>: mine | overdue | حالات مفصولة بـ«-». null = بلا رابط. */
export interface DashboardCard {
  key: string; labelAr: string; labelEn: string; count: number; tone: 'pending' | 'correction' | 'approved' | 'rejected' | 'completed' | 'closed' | 'info';
  link: { view: 'work-queue'; param: string } | null; hintAr?: string; hintEn?: string;
}
export interface DashboardAttention { key: string; labelAr: string; labelEn: string; count: number; link: { view: 'work-queue' | 'approvals' | 'providers'; param: string | null } | null }
export interface DashboardRecent { at: string; applicationId: string; number: string | null; companyName: string; labelAr: string; labelEn: string; toLabelAr: string; toLabelEn: string }
export interface RoleDashboard {
  role: Role; awaitingMe: { count: number; link: { view: 'work-queue'; param: string } }; total: number; slaConfigured: boolean;
  cards: DashboardCard[]; attention: DashboardAttention[]; recent: DashboardRecent[]; generatedAt: string;
  /** ENCPC فقط */
  providers?: { total: number; visible: number; inactive: number; awaitingApproval: number; approvalRequired: boolean };
  /** PMU فقط */
  byStage?: Array<{ state: ApplicationState; labelAr: string; labelEn: string; count: number }>; drafts?: number;
  stuck?: Array<{ id: string; number: string | null; companyName: string; reasonAr: string; reasonEn: string }>;
}

/** إشعار داخل المنصة. link = مسار hash داخلي (application/<id> | approvals | providers) أو فارغ. */
export interface InboxNotification {
  id: string; applicationId: string | null; templateKey: string; title: string; body: string; link: string; read: boolean; readAt: string | null; createdAt: string;
}

export interface RegistryObjection {
  id: string; registryNumber: string; factoryId: string; companyName: string; note: string;
  document: { originalName: string; sizeBytes: number; sha256: string }; status: 'pending' | 'accepted' | 'rejected';
  decidedAt: string | null; decisionReason: string; decisionReference: string; createdAt: string;
}

/** القاعدة G: نزاع على رقم سجل، مجمّع بالرقم مع تاريخه كاملًا. */
export interface RegistryDispute {
  registryNumber: string; status: 'open' | 'decided'; lastActivity: string;
  holderApplication: { id: string; number: string | null; companyName: string; state: string } | null;
  allowedFactory: { id: string | null; companyName: string | null; reason: string; reference: string; decidedAt: string | null } | null;
  parties: Array<{ id: string; companyName: string | null }>;
  conflicts: Array<{ id: string; attemptedFactoryId: string; companyName: string | null; attemptedApplicationId: string; attempts: number; firstAttemptAt: string; lastAttemptAt: string }>;
  blocks: Array<{ id: string; source: 'imc_reject' | 'pmu_dispute' | 'objection'; companyName: string | null; createdAt: string; active: boolean; releasedAt: string | null;
    allowedFactoryId: string | null; allowedCompanyName: string | null; releaseReason: string; releaseReference: string }>;
  objections: RegistryObjection[];
}

/** H4: طلب استرداد بريد حساب مصنع (الأدمن يسجل، PMU توافق، مهلة 48 ساعة). */
export interface RecoveryRequest {
  id: string; userId: string; companyName: string; currentEmail: string; oldEmail: string; newEmail: string; reason: string; requestReference: string;
  document: { originalName: string; sizeBytes: number; sha256: string };
  status: 'pending_approval' | 'cooling' | 'executed' | 'cancelled' | 'rejected'; requestedBy: string; requestedByName: string; requestedAt: string;
  approvedBy: string | null; approvedAt: string | null; coolingEndsAt: string | null; closedAt: string | null; closeReason: string; executedAt: string | null;
}

export interface NotificationLogEntry {
  id: string; channel: 'email' | 'sms'; templateKey: string; applicationId: string | null; recipientUserId: string | null; recipientAddress: string;
  applicationNumber: string | null;
  subject: string; status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'; skipReason: string; attempts: number; nextAttemptAt: string;
  lastError: string; createdAt: string; sentAt: string | null;
}

export interface WebhookLogEntry {
  id: string; eventId: string; eventType: string; transitionId: string | null; payload: Record<string, unknown>;
  status: 'pending' | 'sending' | 'delivered' | 'failed' | 'skipped'; attempts: number; nextAttemptAt: string;
  lastStatusCode: number | null; lastError: string; createdAt: string; deliveredAt: string | null;
}

export interface Summary {
  total: number; drafts: number; open: number; overdue: number; slaConfigured: boolean; byState: Partial<Record<ApplicationState, number>>;
  passedOnToLaterStages?: number;
  avgDaysPerState: Partial<Record<ApplicationState, { avgDays: number; samples: number }>>;
  returnsByStage: Partial<Record<ApplicationState, number>>;
  /** count = كل التعاقدات (المساران)، وbyPath تفصيلها؛ totalAmount وaboveAlertCount للمسار البنكي وحده (لا قيمة مالية مسجلة لمسار شركة التوزيع). */
  contracted?: { count: number; byPath: { bank: number; distribution: number }; totalAmount: number; amountRecordedBy: 'factory'; aboveAlertCount: number; alertThresholdEGP: number };
  byGovernorate?: { governorate: string; count: number }[];
  stateLabels: Record<ApplicationState, { ar: string; en: string }>;
  generatedAt: string;
}

export type ReportRow = Record<string, string | number | boolean | null>;

/** I7: ورقة Excel مقروءة (رؤوس عربية، أسماء، توقيت القاهرة، نعم/لا). */
export interface ReportSheet { headers: string[]; rows: (string | number | null)[][] }

export interface ReadinessCheck {
  key: string; ok: boolean; labelAr: string; labelEn: string; detailAr: string; detailEn: string;
  items?: { id: string; labelAr: string; labelEn: string; extraAr?: string; extraEn?: string }[];
}

export interface Readiness {
  ok: boolean; checks: ReadinessCheck[];
  stuck: { id: string; number: string | null; companyName: string; state: ApplicationState; stateLabelAr: string; stateLabelEn: string; reasonAr: string; reasonEn: string }[];
  notifications: { failed: number; skipped: number; pending: number }; generatedAt: string;
}

export interface RegistryBlock {
  id: string; factoryId: string | null; registryNumber: string; applicationId: string | null; applicationNumber: string | null; companyName: string | null;
  source: 'imc_reject' | 'pmu_dispute' | 'objection'; allowedFactoryId: string | null; allowedCompanyName: string | null;
  createdAt: string; releasedAt: string | null; releaseReason: string; releaseReference: string;
}

/** كل مسارات API الموقع — اختبار العقود يطابقها مع routes Express وopenapi.json. */
export const ROUTES = {
  meta: 'GET /api/v1/i/shams/meta',
  publicMeta: 'GET /api/v1/i/shams/public/meta',
  register: 'POST /api/v1/i/shams/public/register',
  me: 'GET /api/v1/i/shams/auth/me',
  factoryProfile: 'GET /api/v1/i/shams/factory/profile',
  updateFactoryProfile: 'PUT /api/v1/i/shams/factory/profile',
  listApplications: 'GET /api/v1/i/shams/applications',
  createApplication: 'POST /api/v1/i/shams/applications',
  getApplication: 'GET /api/v1/i/shams/applications/:id',
  saveSection: 'PUT /api/v1/i/shams/applications/:id/data/:section',
  uploadDocument: 'POST /api/v1/i/shams/applications/:id/documents',
  removeDocument: 'DELETE /api/v1/i/shams/applications/:id/documents/:docId',
  downloadDocument: 'GET /api/v1/i/shams/applications/:id/documents/:docId/download',
  performAction: 'POST /api/v1/i/shams/applications/:id/actions/:action',
  listProviders: 'GET /api/v1/i/shams/service-providers',
  createProvider: 'POST /api/v1/i/shams/service-providers',
  updateProvider: 'PUT /api/v1/i/shams/service-providers/:id',
  approveProvider: 'POST /api/v1/i/shams/service-providers/:id/approve',
  suspendProvider: 'POST /api/v1/i/shams/service-providers/:id/suspend',
  activateProvider: 'POST /api/v1/i/shams/service-providers/:id/activate',
  deactivateProvider: 'POST /api/v1/i/shams/service-providers/:id/deactivate',
  providerLogo: 'GET /api/v1/i/shams/service-providers/:id/logo',
  uploadProviderLogo: 'POST /api/v1/i/shams/service-providers/:id/logo',
  roleDashboard: 'GET /api/v1/i/shams/dashboard',
  notifications: 'GET /api/v1/i/shams/notifications',
  unreadNotifications: 'GET /api/v1/i/shams/notifications/unread-count',
  readAllNotifications: 'POST /api/v1/i/shams/notifications/read-all',
  readNotification: 'POST /api/v1/i/shams/notifications/:id/read',
  reportSummary: 'GET /api/v1/i/shams/reports/summary',
  reportApplications: 'GET /api/v1/i/shams/reports/applications',
  adminOrganizations: 'GET /api/v1/i/shams/admin/organizations',
  adminCreateOrganization: 'POST /api/v1/i/shams/admin/organizations',
  adminUpdateOrganization: 'PUT /api/v1/i/shams/admin/organizations/:id',
  adminUsers: 'GET /api/v1/i/shams/admin/users',
  adminCreateUser: 'POST /api/v1/i/shams/admin/users',
  adminUpdateUser: 'PUT /api/v1/i/shams/admin/users/:id',
  adminAccountRequests: 'GET /api/v1/i/shams/admin/account-requests',
  adminResetPassword: 'POST /api/v1/i/shams/admin/users/:id/reset-password',
  adminEmailChangeRequest: 'POST /api/v1/i/shams/admin/users/:id/email-change-request',
  accountRequests: 'GET /api/v1/i/shams/account-requests',
  approveAccountRequest: 'POST /api/v1/i/shams/account-requests/:id/approve',
  rejectAccountRequest: 'POST /api/v1/i/shams/account-requests/:id/reject',
  recoveryRequests: 'GET /api/v1/i/shams/recovery-requests',
  createRecoveryRequest: 'POST /api/v1/i/shams/recovery-requests',
  recoveryDocument: 'GET /api/v1/i/shams/recovery-requests/:id/document',
  approveRecovery: 'POST /api/v1/i/shams/recovery-requests/:id/approve',
  rejectRecovery: 'POST /api/v1/i/shams/recovery-requests/:id/reject',
  cancelRecovery: 'POST /api/v1/i/shams/recovery-requests/:id/cancel',
  cancelRecoveryByOwner: 'POST /api/v1/i/shams/public/recovery/cancel',
  pendingIntegrationKeys: 'GET /api/v1/i/shams/integration-keys/pending',
  approveIntegrationKey: 'POST /api/v1/i/shams/integration-keys/:id/approve',
  rejectIntegrationKey: 'POST /api/v1/i/shams/integration-keys/:id/reject',
  adminReadiness: 'GET /api/v1/i/shams/admin/readiness',
  registryBlocks: 'GET /api/v1/i/shams/registry-blocks',
  registryDisputes: 'GET /api/v1/i/shams/registry-disputes',
  decideRegistryDispute: 'POST /api/v1/i/shams/registry-disputes/decide',
  registryObjections: 'GET /api/v1/i/shams/registry-objections',
  createRegistryObjection: 'POST /api/v1/i/shams/registry-objections',
  registryObjectionDocument: 'GET /api/v1/i/shams/registry-objections/:id/document',
  acceptRegistryObjection: 'POST /api/v1/i/shams/registry-objections/:id/accept',
  rejectRegistryObjection: 'POST /api/v1/i/shams/registry-objections/:id/reject',
  releaseRegistryBlock: 'POST /api/v1/i/shams/registry-blocks/:id/release',
  adminAuditLogs: 'GET /api/v1/i/shams/admin/audit-logs',
  adminAuditExport: 'POST /api/v1/i/shams/admin/audit-logs/export',
  adminIntegrationKeys: 'GET /api/v1/i/shams/admin/integration-keys',
  adminCreateIntegrationKey: 'POST /api/v1/i/shams/admin/integration-keys',
  adminRevokeIntegrationKey: 'POST /api/v1/i/shams/admin/integration-keys/:id/revoke',
  adminRotateIntegrationKey: 'POST /api/v1/i/shams/admin/integration-keys/:id/rotate',
  adminNotifications: 'GET /api/v1/i/shams/admin/notifications',
  adminRetryNotification: 'POST /api/v1/i/shams/admin/notifications/:id/retry',
  adminWebhooks: 'GET /api/v1/i/shams/admin/webhooks',
  adminRetryWebhook: 'POST /api/v1/i/shams/admin/webhooks/:id/retry',
} as const;
