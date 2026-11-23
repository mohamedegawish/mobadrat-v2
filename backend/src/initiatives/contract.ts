/**
 * The contract every initiative module implements. An initiative is a self-contained, coded module (its own tables
 * `<id>_*`, workflow, roles, screens, notifications and jobs) mounted inside the platform:
 *
 *   /api/v1/i/<id>/public/*   before authentication (registration, public metadata)
 *   /api/v1/i/<id>/*          after core authentication + the module's membership check (req.user = the module actor)
 *   /api/integration/v1/i/<id>/*   the module's own integration API (its own keys)
 *
 * The platform core owns identity (one account per person), shared profiles, the catalog, the unified notifications
 * outbox/inbox and audit log, and the unified admin statistics (through `stats`).
 */
import type { Router } from 'express';
import type { MigrationSet } from '../core/db/index.js';
import type { CoreUser } from '../core/store/users.js';
import type { Membership } from '../core/store/memberships.js';
import type { RequirementsManifest } from '../core/profile/requirements.js';

/**
 * The kind of person a role makes you on the platform. The same kind of role in several initiatives (IMC in Shams and in
 * Sona3) shares one dashboard on the platform (core/routes/workspace.ts): one page, every initiative together.
 */
export type UserType = 'applicant' | 'imc' | 'encpc' | 'pmu' | 'evaluator' | 'funder' | 'system_admin';
/** The user types that have a platform dashboard (the applicant's single page is «مبادراتي»). */
export const WORKSPACE_TYPES: UserType[] = ['imc', 'pmu', 'encpc', 'funder', 'evaluator', 'system_admin'];

export interface RoleDef {
  key: string;
  labelAr: string;
  labelEn: string;
  kind: 'applicant' | 'staff' | 'admin';
  /** Organization types of the module that this role belongs to (the module validates it). */
  orgTypes: string[];
  /** Which platform dashboard the role belongs to (absent: the role has none, e.g. an external body without an account). */
  userType?: UserType;
}

// ── The platform dashboard of a user type (one page for every initiative) ──

/** queue tabs: mine = awaiting my decision, all, overdue; monitoring = reports; readiness = operations (system admin). */
export type WorkspaceTab = 'mine' | 'all' | 'overdue' | 'monitoring' | 'readiness';
export const WORKSPACE_TABS: WorkspaceTab[] = ['mine', 'all', 'overdue', 'monitoring', 'readiness'];

export interface WorkspaceQuery {
  tab: WorkspaceTab;
  page: number;
  pageSize: number;
  q?: string;
  /** Module state keys, comma separated (the module keeps only the ones it knows). */
  state?: string;
  sort?: string;
  from?: string;
  to?: string;
  /** The module's own select filters (keys it declared in `filters`), e.g. governorate, bankOrgId, cohortId. */
  filters: Record<string, string>;
}

/** Where a card or an attention line leads: a tab (with a state filter) of the dashboard, or a module screen. */
export interface WorkspaceLink { tab?: WorkspaceTab; state?: string; view?: string }
export type WorkspaceTone = 'pending' | 'correction' | 'approved' | 'rejected' | 'completed' | 'closed' | 'info';

export interface WorkspaceCard {
  key: string; labelAr: string; labelEn: string; value: number; tone: WorkspaceTone;
  /** null = no honest filter shows exactly these rows, so the card is not a link. */
  link: WorkspaceLink | null;
  hintAr?: string; hintEn?: string;
}
export interface WorkspaceAttention { key: string; labelAr: string; labelEn: string; count: number; link: WorkspaceLink | null }
export interface WorkspaceRecent {
  at: string; applicationId: string; number: string | null; title: string;
  labelAr: string; labelEn: string; toLabelAr: string; toLabelEn: string;
}
export interface WorkspaceRow {
  id: string;
  number: string | null;
  /** The company (Shams) or the project and its founder (Sona3). */
  title: string;
  subtitle?: string;
  stateKey: string; stateLabelAr: string; stateLabelEn: string;
  governorateAr: string; governorateEn: string;
  responsibleAr: string; responsibleEn: string;
  enteredAt: string;
  daysInState: number;
  overdue: boolean;
  isMine: boolean;
  score?: number | null;
  /** The module screen that opens the row (hash route under #i/<id>/). */
  view: string;
}
export interface WorkspaceQueue { items: WorkspaceRow[]; total: number; page: number; pageSize: number; totalPages: number }
export interface WorkspaceFilter { key: string; labelAr: string; labelEn: string; options: Array<{ value: string; labelAr: string; labelEn: string }> }
/** A monitoring block: bars (a distribution), tiles (figures) or a table (label → value). */
export interface WorkspaceBlock {
  key: string; titleAr: string; titleEn: string; kind: 'bars' | 'tiles' | 'table';
  rows: Array<{ key: string; labelAr: string; labelEn: string; value: number; unit?: 'EGP' | 'days'; link?: WorkspaceLink }>;
  noteAr?: string; noteEn?: string;
}
/** A side panel of the role (ENCPC: the service provider directory). */
export interface WorkspacePanel {
  key: string; titleAr: string; titleEn: string;
  tiles: Array<{ key: string; labelAr: string; labelEn: string; value: number }>;
  action?: { view: string; labelAr: string; labelEn: string };
  warnAr?: string; warnEn?: string;
}
export interface WorkspaceReadiness {
  ok: boolean;
  checks: Array<{ key: string; ok: boolean; labelAr: string; labelEn: string; detailAr: string; detailEn: string;
    items?: Array<{ id: string; labelAr: string; labelEn: string; extraAr?: string; extraEn?: string }> }>;
  notifications: { failed: number; skipped: number; pending: number };
}

/** One initiative's part of a user type's dashboard, for the person's role in it. */
export interface ModuleWorkspace {
  role: string;
  /** The role takes workflow decisions (the «بانتظار قراري» tab); false for the read-only system admin. */
  decides: boolean;
  awaitingMe: number;
  overdue: number;
  open: number;
  total: number;
  slaConfigured: boolean;
  /** Unsubmitted drafts (kept out of the lists), for the roles that see them. */
  draftsCount?: number;
  cards: WorkspaceCard[];
  attention: WorkspaceAttention[];
  recent: WorkspaceRecent[];
  /** State filter options (the role's states). */
  states: Array<{ key: string; labelAr: string; labelEn: string }>;
  filters: WorkspaceFilter[];
  panels: WorkspacePanel[];
  /** tabs mine / all / overdue */
  queue?: WorkspaceQueue;
  /** tab monitoring */
  monitoring?: WorkspaceBlock[];
  /** tab readiness (system admin) */
  readiness?: WorkspaceReadiness;
  /** The role's tool screens in the module (providers, approvals, ranking, experts, administration…). */
  tools: Array<{ view: string; labelAr: string; labelEn: string }>;
}

export interface AccessState {
  status: 'full' | 'restricted' | 'blocked';
  code?: string;
  messageAr?: string;
  messageEn?: string;
}

export interface HubCard {
  /** Short status line of the person's file in this initiative (e.g. application state). */
  statusAr: string;
  statusEn: string;
  /** What the person should do next (empty when nothing is pending on them). */
  nextActionAr?: string;
  nextActionEn?: string;
  /** Module view to open (hash route under #i/<id>/). */
  view: string;
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  applicationNumber?: string | null;
}

export type NormalizedPhase =
  | 'draft' | 'screening' | 'correction' | 'evaluation' | 'decision' | 'execution' | 'success' | 'closed_unsuccessful' | 'withdrawn';

export const NORMALIZED_PHASES: NormalizedPhase[] = ['draft', 'screening', 'correction', 'evaluation', 'decision', 'execution', 'success', 'closed_unsuccessful', 'withdrawn'];

export interface StatsSummary {
  totals: {
    applicants: number; applications: number; drafts: number; open: number;
    positiveOutcome: number; negativeOutcome: number; withdrawn: number; overdue: number;
  };
  byPhase: Record<NormalizedPhase, number>;
  /** The initiative's own states with counts (labels in both languages), in workflow order. */
  byState: Array<{ key: string; labelAr: string; labelEn: string; count: number; phase: NormalizedPhase }>;
  funnel: Array<{ key: string; labelAr: string; labelEn: string; count: number }>;
  byGovernorate: Array<{ governorate: string; count: number }>;
  money?: { requestedEGP?: number; approvedEGP?: number; investmentEGP?: number; disbursedEGP?: number };
  jobs?: { expected?: number; actual?: number };
  kpis: Array<{ key: string; labelAr: string; labelEn: string; value: number; unit?: string }>;
  timeline: Array<{ month: string; submitted: number; closed: number }>;
}

export interface ActivityItem { at: string; applicationId: string | null; number: string | null; labelAr: string; labelEn: string; view: string }

export interface InitiativeStatsProvider {
  summary(f: { from?: string; to?: string }): Promise<StatsSummary>;
  recentActivity(limit: number): Promise<ActivityItem[]>;
}

/** An organization of the initiative that is a participating body (reviewers, committees, funders, banks — not applicants). */
export interface ModuleBody {
  id: string;
  type: string;
  typeLabelAr: string;
  typeLabelEn: string;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
}

/** What a body did and has pending in the initiative (for the platform's unified directory of bodies). */
export interface BodyActivity {
  /** Active staff (active accounts with an active membership in this organization). */
  staff: number;
  /** Workflow decisions taken by its staff (and, where the initiative has them, submitted evaluations). */
  decisions: number;
  /** Open applications currently waiting for this body. */
  pending: number;
  lastActivityAt: string | null;
}

export interface InitiativeBodies {
  /** Every participating-body organization of the initiative (active or not). */
  list(): Promise<ModuleBody[]>;
  /** Activity per organization id (ids that are not bodies of the initiative are absent). */
  activity(orgIds: string[]): Promise<Record<string, BodyActivity>>;
}

export interface EnrollResult {
  /** Module view to open after enrolling (hash route under #i/<id>/). */
  view: string;
  applicationId?: string | null;
}

export interface ReadinessCheck { key: string; ok: boolean; labelAr: string; labelEn: string; detail?: string }

/** One account of the deploy seeder: created now, already there (left untouched), or already there but disabled. */
export interface DeploySeedAccount { email: string; initiativeId: string | null; role: string; status: 'created' | 'exists' | 'exists_disabled' | 'reset' }
/** What a module's deploy seeder did: its accounts, and one line per piece of demo data (added or why it was skipped). */
export interface DeploySeedResult { accounts: DeploySeedAccount[]; notes: string[] }

export interface ModuleContext {
  /** Absolute URL of the platform (APP_URL). */
  appUrl: string;
}

export interface InitiativeModule {
  /** Module id = table prefix = URL segment = initiatives.moduleId. */
  id: string;
  titleAr: string;
  titleEn: string;
  migrations: MigrationSet;
  roles: RoleDef[];
  applicantRole: string;
  /** The role a platform super_admin acts as inside the module (no membership needed). */
  adminRole: string;
  /** What an applicant represents: a person, or a factory/company. */
  subject: 'person' | 'factory';
  requirements: RequirementsManifest;
  /** The catalog row created for the module when it is missing (public page content; editable later by the admin). */
  catalogDefaults: Record<string, unknown> & { slug: string; titleAr: string; titleEn: string };

  publicRouter?(ctx: ModuleContext): Router;
  router(ctx: ModuleContext): Router;
  integrationRouter?(ctx: ModuleContext): Router;

  /** The module-shaped user its code expects (role, organizationId…). null = no access. */
  resolveActor(user: CoreUser, membership: Membership | null): Promise<unknown | null>;
  /** Whether the person may use the module now (e.g. a factory account still under review). */
  access(user: CoreUser, membership: Membership): Promise<AccessState>;
  /** Opens the person's file in the initiative (membership + module rows + prefilled draft). Runs inside a transaction. */
  enroll(user: CoreUser, input: { factoryProfileId?: string | null; ip: string }): Promise<EnrollResult>;
  hubCard(user: CoreUser, membership: Membership): Promise<HubCard>;
  stats: InitiativeStatsProvider;
  /** The initiative's participating bodies, linked by the platform to its unified directory of bodies. */
  bodies: InitiativeBodies;
  /** Staff screens the unified admin links to. */
  staffEntryPoints: Array<{ view: string; labelAr: string; labelEn: string; roles: string[] }>;
  /** Default module view per role (used by the hub). */
  defaultView(role: string): string;
  /**
   * The person's part of their user type's platform dashboard (for the actor `resolveActor` returned). Throws for a role
   * without a dashboard (an applicant).
   */
  workspace?(actor: unknown, query: WorkspaceQuery): Promise<ModuleWorkspace>;
  hooks?: {
    /** After the person verified their e-mail (core endpoint). May return a message for the response. */
    onEmailVerified?(user: CoreUser, ip: string): Promise<{ messageAr?: string; data?: Record<string, unknown> } | void>;
  };
  /** Background jobs (started by the platform scheduler when JOBS are enabled). */
  startJobs?(): Promise<void> | void;
  stopJobs?(): void;
  /** Called at boot after migrations (reference data, structural rows…). Idempotent. */
  onBoot?(): Promise<void>;
  readiness?(): Promise<ReadinessCheck[]>;
  seedDemo?(password: string): Promise<void>;
  /**
   * Deploy seeder (core/seedDeploy.ts, SEED_ON_DEPLOY=1): one account per role of the module + the demo data those accounts
   * need. Creates only what is missing and never changes an existing account; reference data people choose from is added
   * only when the module has none of its own. Runs inside the seeder's transaction.
   */
  seedDeploy?(passwordHash: string): Promise<DeploySeedResult>;
  /**
   * A seeded staff account shared by every initiative (core/seed.ts SHARED_DEMO_ACCOUNTS, e.g. one IMC officer for all):
   * gives the just-created account the module's role of that user type, in its structural organization. Returns the role,
   * or null when the module has no such role or the account already has a membership.
   */
  seedSharedStaff?(userId: string, type: UserType): Promise<string | null>;
  /** Registers inline-image resolvers for the module's e-mails (logos). */
  registerMail?(): void;
}
