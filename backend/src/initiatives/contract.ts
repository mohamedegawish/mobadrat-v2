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

export interface RoleDef {
  key: string;
  labelAr: string;
  labelEn: string;
  kind: 'applicant' | 'staff' | 'admin';
  /** Organization types of the module that this role belongs to (the module validates it). */
  orgTypes: string[];
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
export interface DeploySeedAccount { email: string; initiativeId: string | null; role: string; status: 'created' | 'exists' | 'exists_disabled' }
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
  /** Registers inline-image resolvers for the module's e-mails (logos). */
  registerMail?(): void;
}
