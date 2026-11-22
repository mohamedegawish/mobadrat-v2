/**
 * الحالة العامة — نفس نمط المنصة: store يدوي + activeView منعكس على location.hash.
 * الامتداد الوحيد: الـhash يحمل معاملًا (#application/<id>، #verify-email/<token>) لأن روابط الإشعارات تحتاجه.
 * الصلاحيات هنا للتوجيه والعرض فقط — الفحص الحقيقي في السيرفر.
 */
import { useSyncExternalStore } from 'react';
import { api, ApiException, refreshSession, clearTokens, type Meta, type Role, type User } from '../api';
import { getAccessToken } from '../../../core/session';
import { validationMessage } from '../utils/validation';

export type Language = 'ar' | 'en';

export type View =
  | 'home' | 'login' | 'register' | 'verify-email' | 'forgot-password' | 'reset-password' | 'cancel-recovery' | 'notifications'
  | 'factory-dashboard' | 'apply' | 'task' | 'application'
  | 'dashboard' | 'work-queue' | 'pmu-monitor' | 'providers' | 'approvals'
  | 'admin-dashboard' | 'admin-accounts' | 'admin-organizations' | 'admin-audit' | 'admin-integration' | 'admin-outbox';

type Access = 'public' | 'guest' | 'auth' | Role[];

export const VIEW_ACCESS: Record<View, Access> = {
  home: 'public', login: 'guest', register: 'guest', 'verify-email': 'public', 'forgot-password': 'guest', 'reset-password': 'public', 'cancel-recovery': 'public', notifications: 'auth',
  'factory-dashboard': ['factory_owner'], apply: ['factory_owner'], task: ['factory_owner'], application: 'auth',
  // لوحة الدور: IMC وENCPC (PMU تدمجها في «المتابعة»، والأدمن له لوحة الجاهزية). لا حساب للبنك (G-02).
  dashboard: ['imc_reviewer', 'encpc_reviewer'],
  'work-queue': ['imc_reviewer', 'encpc_reviewer', 'pmu_reviewer', 'system_admin'],
  'pmu-monitor': ['pmu_reviewer'],
  // الموافقات (H1/H2/H4): جهات القرار فقط — الأدمن مقدم الطلب لا موافق.
  approvals: ['imc_reviewer', 'encpc_reviewer', 'pmu_reviewer'],
  // دليل مقدمي الخدمة: ENCPC تديره (providerManagerRoles) وPMU تعتمده (providerApproverRoles ★).
  providers: ['encpc_reviewer', 'pmu_reviewer'],
  'admin-dashboard': ['system_admin'], 'admin-accounts': ['system_admin'], 'admin-organizations': ['system_admin'], 'admin-audit': ['system_admin'],
  'admin-integration': ['system_admin'], 'admin-outbox': ['system_admin'],
};

export const DEFAULT_VIEW: Record<Role, View> = {
  // bank_reviewer: دور ملغى (G-02) — لا يحصل على جلسة أصلًا؛ القيمة موجودة فقط لاكتمال النوع.
  factory_owner: 'factory-dashboard', imc_reviewer: 'dashboard', encpc_reviewer: 'dashboard', bank_reviewer: 'home',
  pmu_reviewer: 'pmu-monitor', system_admin: 'admin-dashboard',
};

/** مساحات العمل ذات الشريط الجانبي (وضع الإدارة). */
export const WORKSPACE_VIEWS: View[] = ['dashboard', 'work-queue', 'pmu-monitor', 'providers', 'approvals', 'admin-dashboard', 'admin-accounts', 'admin-organizations', 'admin-audit', 'admin-integration', 'admin-outbox'];

/** مصنع لم يُقبل حسابه بعد (طلب تعديل بيانات، أو تعذر إرسال طلب التسجيل): دخول مقيّد بمعالج طلبه فقط — القيد الحقيقي في السيرفر. */
export function isRestrictedFactory(user: User | null): boolean {
  return Boolean(user && user.role === 'factory_owner' && user.accountStatus && user.accountStatus !== 'approved');
}

/** Under IMC review or not accepted: the initiative is locked for this account (the platform account itself stays valid). */
export function isLockedFactory(user: User | null): boolean {
  return Boolean(user && user.role === 'factory_owner' && (user.accountStatus === 'under_review' || user.accountStatus === 'rejected'));
}

export function canView(view: View, user: User | null): boolean {
  const a = VIEW_ACCESS[view];
  if (isRestrictedFactory(user) && a !== 'public') return view === 'apply';
  if (a === 'public') return true;
  if (a === 'guest') return !user;
  if (a === 'auth') return Boolean(user);
  return Boolean(user && a.includes(user.role));
}

interface Snapshot {
  language: Language;
  user: User | null;
  meta: Meta | null;
  view: View;
  param: string | null;
  booting: boolean;
  tick: number;
}

const LANG_KEY = 'shams_lang_v1';
const RETURN_KEY = 'shams_return_to_v1';
const SAFE_PARAM = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * I1: الوجهة المطلوبة قبل تسجيل الدخول (رابط إشعار مثل #application/<id>).
 * تُقبل فقط إذا كانت شاشة داخلية تتطلب الدخول، ومعاملها معرف بسيط، ومسموحة لدور المستخدم بعد الدخول.
 */
export function safeReturnTarget(raw: unknown, user: User | null): { view: View; param: string | null } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { view, param } = raw as { view?: unknown; param?: unknown };
  if (typeof view !== 'string' || !Object.prototype.hasOwnProperty.call(VIEW_ACCESS, view)) return null;
  const access = VIEW_ACCESS[view as View];
  if (access === 'public' || access === 'guest') return null;
  if (param !== null && param !== undefined && (typeof param !== 'string' || !SAFE_PARAM.test(param))) return null;
  if (!canView(view as View, user)) return null;
  return { view: view as View, param: (param as string | null | undefined) ?? null };
}

function readLang(): Language {
  try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ar'; } catch { return 'ar'; }
}

/** The module lives under #i/shams/ on the platform (see initiatives/registry.ts). */
export const MODULE_PREFIX = 'i/shams/';
/** Account screens are the platform's (one account for every initiative). */
const PLATFORM_VIEWS: Record<string, string> = { login: 'login', 'forgot-password': 'forgot-password', 'reset-password': 'reset-password', 'verify-email': 'verify-email' };

function parseHash(): { view: View; param: string | null } {
  const full = decodeURIComponent(window.location.hash.replace(/^#\/?/, ''));
  const raw = full.startsWith(MODULE_PREFIX) ? full.slice(MODULE_PREFIX.length) : full === MODULE_PREFIX.slice(0, -1) ? '' : full;
  const [v, ...rest] = raw.split('/');
  const view = (Object.prototype.hasOwnProperty.call(VIEW_ACCESS, v) ? v : 'home') as View;
  return { view, param: rest.length ? rest.join('/') : null };
}

class Store {
  private listeners = new Set<() => void>();
  private s: Snapshot;

  constructor() {
    const { view, param } = parseHash();
    this.s = { language: readLang(), user: null, meta: null, view, param, booting: true, tick: 0 };
    this.applyLanguage(this.s.language);
    window.addEventListener('hashchange', () => {
      if (!decodeURIComponent(window.location.hash).replace(/^#\/?/, '').startsWith(MODULE_PREFIX)) return;
      const r = parseHash();
      if (r.view !== this.s.view || r.param !== this.s.param) this.set({ view: r.view, param: r.param });
    });
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  get = () => this.s;

  private set(patch: Partial<Snapshot>) {
    this.s = { ...this.s, ...patch, tick: this.s.tick + 1 };
    this.listeners.forEach((l) => l());
  }

  private applyLanguage(lang: Language) {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }

  setLanguage = (language: Language) => {
    try { localStorage.setItem(LANG_KEY, language); } catch { /* private mode */ }
    this.applyLanguage(language);
    this.set({ language });
  };

  navigate = (view: View, param?: string | null) => {
    if (PLATFORM_VIEWS[view]) {
      // Sign-in and account links are platform screens; come back here afterwards.
      try { sessionStorage.setItem('platform_return_to', window.location.hash.replace(/^#/, '')); } catch { /* storage unavailable */ }
      window.location.hash = param ? `#${PLATFORM_VIEWS[view]}/${encodeURIComponent(param)}` : `#${PLATFORM_VIEWS[view]}`;
      return;
    }
    const hash = param ? `#${MODULE_PREFIX}${view}/${encodeURIComponent(param)}` : `#${MODULE_PREFIX}${view}`;
    if (window.location.hash !== hash) window.location.hash = hash;
    this.set({ view, param: param ?? null });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** يحفظ الشاشة المطلوبة عندما يصلها زائر غير مسجل (تُستخدم مرة واحدة بعد الدخول). */
  rememberReturn = () => {
    const { view, param } = this.s;
    const a = VIEW_ACCESS[view];
    if (this.s.user || a === 'public' || a === 'guest') return;
    if (param && !SAFE_PARAM.test(param)) return;
    try { sessionStorage.setItem(RETURN_KEY, JSON.stringify({ view, param })); } catch { /* storage unavailable */ }
  };

  private takeReturn(user: User): { view: View; param: string | null } | null {
    let raw: unknown = null;
    try { raw = JSON.parse(sessionStorage.getItem(RETURN_KEY) ?? 'null'); sessionStorage.removeItem(RETURN_KEY); } catch { /* ignore */ }
    return safeReturnTarget(raw, user);
  }

  goHome = () => {
    const u = this.s.user;
    if (isRestrictedFactory(u)) { void this.goRestrictedHome(); return; }
    this.navigate(u ? DEFAULT_VIEW[u.role] : 'home');
  };

  /** الحساب المقيّد: الصفحة الوحيدة هي معالج طلب التسجيل المفتوح. */
  private async goRestrictedHome() {
    // Under IMC review / not approved: the initiative is locked — the platform chooser shows why (the account stays valid).
    const status = this.s.user?.accountStatus;
    if (status === 'under_review' || status === 'rejected') { window.location.hash = '#hub'; return; }
    try {
      const p = await api.factoryProfile();
      if (p.openApplicationId) { this.navigate('apply', p.openApplicationId); return; }
    } catch { /* fall through */ }
    this.navigate('home');
  }

  async boot() {
    const metaP = api.meta().then((meta) => this.set({ meta })).catch(() => undefined);
    try {
      // Already signed in on the platform in this page (token in memory) → no extra refresh: every refresh rotates the
      // session token, and a reload racing a rotation would look like a stolen token (the session is then ended).
      if (getAccessToken() || await refreshSession()) {
        const user = await api.me();
        this.set({ user });
      }
    } catch { clearTokens(); }
    await metaP;
    this.set({ booting: false });
    const { view } = this.s;
    if (this.s.user && (view === 'home' || view === 'login')) this.goHome();
  }

  async login(email: string, password: string): Promise<User> {
    const { user } = await api.login(email, password);
    this.set({ user });
    if (!user.mustChangePassword) {
      const target = isRestrictedFactory(user) ? null : this.takeReturn(user);
      if (target) this.navigate(target.view, target.param); else this.goHome();
    }
    return user;
  }

  setUser(user: User | null) {
    this.set({ user });
  }

  async logout() {
    await api.logout().catch(() => undefined);
    this.set({ user: null });
    window.location.hash = '#home';
  }

  async reloadMeta() {
    try { this.set({ meta: await api.meta() }); } catch { /* keep old */ }
  }

  /** يُستدعى بعد أي تغيير يجب أن يعيد تحميل الشاشات (مثل إجراء على طلب). */
  bump() { this.set({}); }
}

export const store = new Store();

export function useStore() {
  const s = useSyncExternalStore(store.subscribe, store.get);
  const isAr = s.language === 'ar';
  return { ...s, isAr, t: (ar: string, en: string) => (isAr ? ar : en), store };
}

/** رسالة خطأ ثنائية اللغة من ApiException. */
export function errorText(e: unknown, isAr: boolean): string {
  if (e instanceof ApiException) return isAr ? e.apiError.messageAr : e.apiError.messageEn;
  return isAr ? 'حدث خطأ غير متوقع.' : 'Unexpected error.';
}

/** أخطاء الحقول من ApiError.details — الرسالة من قاموس الأكواد (I2)، لا نص السيرفر الخام. */
export function errorDetails(e: unknown, isAr = true): Record<string, string> {
  const out: Record<string, string> = {};
  if (e instanceof ApiException) for (const d of e.apiError.details ?? []) out[d.field] = validationMessage(d.issue, isAr);
  return out;
}
