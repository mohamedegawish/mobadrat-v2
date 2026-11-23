/**
 * View model of the platform's public screens — header, home, catalog, initiative page, compare, impact, login,
 * «مبادراتي» and the admin sidebar. These screens keep the platform's original design and wording; this hook gives them
 * the shape they were written against (language, currentUser, initiatives, navigate(view, id)…), derived from the
 * platform store (platform/store.ts) and the platform API. The hash routes stay the platform's (#initiative/<slug>, #hub…).
 */
import { usePlatform, store as platform, isAdmin } from '../platform/store';
import type { Banner, Initiative as CatalogItem, Me, MembershipItem } from '../platform/api';
import { DEFAULT_CUSTOMIZATION, type BilingualItem, type Initiative, type InitiativeBenefit, type Language, type User, type WorkflowStage } from '../types';

export const GUEST_USER: User = {
  id: 'guest',
  name: 'تسجيل الدخول',
  nameEn: 'Sign In',
  email: '',
  role: 'guest',
  roleTitleAr: 'حساب منشأة أو جهة',
  roleTitleEn: 'Facility / Official Account',
  organizationId: '',
  organizationNameAr: 'منصة المبادرات',
  organizationNameEn: 'Initiatives Platform',
  avatar: '👤',
};

// ── catalog item → the screens' Initiative ──────────────────────────────

type Obj = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** First non-empty string among the keys. */
function pick(o: Obj, ...keys: string[]): string {
  for (const k of keys) if (typeof o[k] === 'string' && (o[k] as string).trim()) return o[k] as string;
  return '';
}

function bilingual(v: unknown): BilingualItem {
  if (typeof v === 'string') return { textAr: v, textEn: v };
  const o = (v ?? {}) as Obj;
  const ar = pick(o, 'textAr', 'titleAr', 'labelAr', 'nameAr', 'descriptionAr', 'valueAr');
  const en = pick(o, 'textEn', 'titleEn', 'labelEn', 'nameEn', 'descriptionEn', 'valueEn');
  return { textAr: ar || en, textEn: en || ar };
}

function benefit(v: unknown): InitiativeBenefit {
  if (typeof v === 'string') return { titleAr: v, titleEn: v, descriptionAr: '', descriptionEn: '', iconName: '' };
  const o = (v ?? {}) as Obj;
  const titleAr = pick(o, 'titleAr', 'textAr', 'nameAr');
  const titleEn = pick(o, 'titleEn', 'textEn', 'nameEn');
  const descriptionAr = pick(o, 'descriptionAr', 'descAr');
  const descriptionEn = pick(o, 'descriptionEn', 'descEn');
  return { titleAr: titleAr || titleEn, titleEn: titleEn || titleAr, descriptionAr: descriptionAr || descriptionEn, descriptionEn: descriptionEn || descriptionAr, iconName: str(o.iconName) };
}

function toInitiative(c: CatalogItem): Initiative {
  const raw = c as unknown as Obj;
  const m = (raw.impactMetrics ?? {}) as Obj;
  const stepsAr = c.moduleStepsAr ?? [];
  const stepsEn = c.moduleStepsEn ?? [];
  const stages: WorkflowStage[] = stepsAr.map((s, i) => ({ id: `step-${i + 1}`, order: i + 1, nameAr: s, nameEn: stepsEn[i] || s, assignedOrgNameAr: '', slaDays: 0 }));
  return {
    id: c.id,
    slug: c.slug,
    moduleId: c.moduleId,
    titleAr: c.titleAr,
    titleEn: c.titleEn || c.titleAr,
    taglineAr: c.taglineAr ?? '',
    taglineEn: c.taglineEn || c.taglineAr || '',
    descriptionAr: c.descriptionAr ?? '',
    descriptionEn: c.descriptionEn || c.descriptionAr || '',
    status: (c.status as Initiative['status']) ?? 'active',
    registrationOpen: Boolean(c.registrationOpen),
    category: c.category ?? '',
    categoryEn: c.categoryEn || c.category || '',
    targetSectors: arr(c.targetSectors).map(str).filter(Boolean),
    targetSectorsEn: arr(raw.targetSectorsEn).map(str).filter(Boolean),
    targetGovernorates: arr(c.targetGovernorates).map(str).filter(Boolean),
    budgetTotalEGP: num(c.budgetTotalEGP),
    budgetAllocatedEGP: num(raw.budgetAllocatedEGP),
    startDate: c.startDate ?? '',
    endDate: c.endDate ?? '',
    coverImage: c.coverImage || '/covers/solar-2026.jpg',
    badgeTextAr: c.badgeTextAr ?? '',
    badgeTextEn: c.badgeTextEn || c.badgeTextAr || '',
    participatingOrgs: arr(c.participatingOrgs).map((o) => (typeof o === 'string' ? o : bilingual(o).textAr)).filter(Boolean),
    customization: raw.customization && typeof raw.customization === 'object' && Object.keys(raw.customization as Obj).length
      ? { ...DEFAULT_CUSTOMIZATION, ...(raw.customization as Partial<Initiative['customization']>) } as Initiative['customization']
      : undefined,
    benefits: arr(c.benefits).map(benefit).filter((b) => b.titleAr || b.descriptionAr),
    faqs: arr(c.faqs).map((f) => {
      const o = (f ?? {}) as Obj;
      const qAr = pick(o, 'questionAr', 'qAr'); const qEn = pick(o, 'questionEn', 'qEn');
      const aAr = pick(o, 'answerAr', 'aAr'); const aEn = pick(o, 'answerEn', 'aEn');
      return { questionAr: qAr || qEn, questionEn: qEn || qAr, answerAr: aAr || aEn, answerEn: aEn || aAr };
    }).filter((f) => f.questionAr),
    preEligibilityQuestions: arr(raw.preEligibilityQuestions) as Initiative['preEligibilityQuestions'],
    requiredDocsList: arr(c.requiredDocsList).map((d, i) => {
      if (typeof d === 'string') return { code: `doc-${i}`, titleAr: d, titleEn: d, mandatory: true };
      const o = (d ?? {}) as Obj;
      const ar = pick(o, 'titleAr', 'textAr', 'labelAr', 'nameAr'); const en = pick(o, 'titleEn', 'textEn', 'labelEn', 'nameEn');
      return { code: str(o.code) || `doc-${i}`, titleAr: ar || en, titleEn: en || ar, mandatory: o.mandatory !== false };
    }).filter((d) => d.titleAr),
    workflow: { id: `wf-${c.id}`, initiativeId: c.id, nameAr: `مسار ${c.titleAr}`, nameEn: `Workflow ${c.titleEn}`, stages },
    impactMetrics: {
      targetFactories: num(m.targetFactories),
      benefitedFactories: num(m.benefitedFactories),
      targetCapacityMW: num(m.targetCapacityMW) || undefined,
      savedEnergyGWh: num(m.savedEnergyGWh) || undefined,
      investmentStimulatedEGP: num(m.investmentStimulatedEGP),
      jobsCreated: num(m.jobsCreated),
    },
    objectives: arr(c.objectives).map(bilingual),
    eligibilityRequirements: arr(c.eligibilityRequirements).map(bilingual),
    selectionCriteria: arr(c.selectionCriteria).map(bilingual),
    financialTerms: (c.financialTerms ?? {}) as Initiative['financialTerms'],
    executionNotesAr: c.executionNotesAr ?? '',
    executionNotesEn: c.executionNotesEn ?? '',
  };
}

// Mapped once per catalog load (the catalog array identity changes only when it reloads).
let mappedFrom: CatalogItem[] | null = null;
let mapped: Initiative[] = [];
function initiativesOf(list: CatalogItem[] | null): Initiative[] {
  if (list !== mappedFrom) { mappedFrom = list; mapped = (list ?? []).map(toInitiative); }
  return mapped;
}

/** The catalog row behind a screen initiative (module, registration form…), by id or slug. */
export function catalogItem(idOrSlug: string | null | undefined): CatalogItem | null {
  if (!idOrSlug) return null;
  return platform.get().initiatives?.find((i) => i.id === idOrSlug || i.slug === idOrSlug) ?? null;
}

// ── the signed-in person ────────────────────────────────────────────────

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
}

function toUser(me: Me | null): User {
  if (!me) return GUEST_USER;
  const u = me.user;
  const first: MembershipItem | undefined = me.memberships[0];
  const staff = Boolean(u.platformRole);
  const name = u.nameAr || u.nameEn || u.email;
  return {
    id: u.id,
    name,
    nameEn: u.nameEn || name,
    email: u.email,
    role: u.platformRole ?? 'member',
    roleTitleAr: staff ? (me.platformRoleLabel?.ar ?? '') : (first?.roleLabelAr ?? 'حساب على المنصة'),
    roleTitleEn: staff ? (me.platformRoleLabel?.en ?? '') : (first?.roleLabelEn ?? 'Platform account'),
    organizationId: '',
    organizationNameAr: staff ? 'وزارة الصناعة' : me.memberships.map((m) => m.titleAr).join(' · '),
    organizationNameEn: staff ? 'Ministry of Industry' : me.memberships.map((m) => m.titleEn || m.titleAr).join(' · '),
    avatar: initials(name),
    mustChangePassword: u.mustChangePassword,
  };
}

// ── navigation ──────────────────────────────────────────────────────────

/** The screens' page names → the platform's hash routes. */
const ROUTES: Record<string, string> = {
  home: 'home', showcase: 'home', initiatives: 'initiatives', compare: 'compare', impact: 'impact', login: 'login',
  'my-initiatives': 'hub', 'factory-portal': 'profile?tab=factories', profile: 'profile', notifications: 'notifications',
  'admin-dashboard': 'admin', 'ministry-overview': 'admin', 'admin-initiatives': 'admin-catalog', 'admin-initiative': 'admin-catalog',
};

export function navigate(view: string, initiativeId?: string): void {
  if (view === 'initiative-detail') {
    const i = catalogItem(initiativeId);
    platform.go(i ? `initiative/${i.slug}` : 'initiatives');
    return;
  }
  platform.go(ROUTES[view] ?? view);
}

/** Where the signed-in person works: one initiative → its dashboard; several (or staff) → «مبادراتي» / the admin. */
export function goToWorkspace(): void {
  const me = platform.get().me;
  if (me?.user.platformRole) platform.go('admin');
  else platform.goHome(me);
}

/** The platform's page under the old page names (active states of the header and the sidebar). */
function legacyView(view: string): string {
  if (view === 'initiative') return 'initiative-detail';
  if (view === 'hub') return 'my-initiatives';
  if (view === 'profile') return 'factory-portal';
  if (view === 'admin') return 'admin-dashboard';
  return view;
}

// ── applying ────────────────────────────────────────────────────────────

export type ApplyState = 'member' | 'open' | 'closed' | 'info';

/** What the «التقديم» buttons of an initiative do for the current visitor. */
export function applyStateOf(i: Pick<Initiative, 'id' | 'moduleId'>, me: Me | null = platform.get().me): ApplyState {
  const c = catalogItem(i.id);
  if (!c) return 'info';
  if (c.moduleId && me?.memberships.some((m) => m.initiativeId === c.moduleId)) return 'member';
  if (!c.hasModule) return 'info';
  return c.status === 'active' && c.registrationOpen ? 'open' : 'closed';
}

/**
 * «التقديم» on an initiative: an enrolled person opens its dashboard; a signed-in person goes to the apply step (only the
 * missing data); a visitor signs in first (the login page offers the initiative's own registration form) and comes back.
 */
export function startApplication(initiativeId: string): void {
  const c = catalogItem(initiativeId);
  if (!c) { platform.go('initiatives'); return; }
  const me = platform.get().me;
  const m = c.moduleId ? me?.memberships.find((x) => x.initiativeId === c.moduleId) : undefined;
  if (m) { platform.go(`i/${m.initiativeId}/${m.card?.view ?? m.defaultView}`); return; }
  if (!me) { platform.rememberReturn(`apply/${c.slug}`); platform.go('login'); return; }
  platform.go(`apply/${c.slug}`);
}

/** The initiative a visitor was applying to before being sent to sign in (from the remembered return route). */
export function pendingApplication(): CatalogItem | null {
  try {
    const back = sessionStorage.getItem('platform_return_to') ?? '';
    const m = /^apply\/([a-z0-9-]+)/.exec(back);
    return m ? catalogItem(m[1]) : null;
  } catch { return null; }
}

// ── the hook ────────────────────────────────────────────────────────────

export function usePlatformStore() {
  const s = usePlatform();
  const currentUser = toUser(s.me);
  const staff = isAdmin(s.me);
  const isLoggedIn = Boolean(s.me);
  const isViewAllowed = (view: string, _user?: User): boolean => {
    const v = view === 'showcase' ? 'home' : view;
    if (['home', 'initiatives', 'initiative-detail', 'compare', 'login'].includes(v)) return true;
    if (v === 'my-initiatives') return isLoggedIn;
    if (v === 'factory-portal') return isLoggedIn && !staff;
    if (v === 'impact' || v === 'admin-dashboard') return staff;
    return false;
  };
  return {
    language: s.lang as Language,
    isLoggedIn,
    currentUser,
    me: s.me,
    booting: s.booting,
    initiatives: initiativesOf(s.initiatives),
    initiativesLoaded: s.initiatives !== null,
    homeBanners: s.banners as Banner[],
    heroSliderInterval: 3000,
    activeView: legacyView(s.view),
    view: s.view,
    selectedInitiativeId: s.view === 'initiative' ? (catalogItem(s.param)?.id ?? s.param) : null,
    isViewAllowed,
    setLanguage: (lang: Language) => platform.setLang(lang),
    navigate,
    logout: () => { void platform.logout(); },
  };
}
