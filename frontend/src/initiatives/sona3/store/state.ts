/**
 * الحالة العامة — نفس نمط المنصة: store يدوي + activeView منعكس على location.hash.
 * الامتداد الوحيد: الـhash يحمل معاملًا (#application/<id>، #verify-email/<token>) لأن روابط الإشعارات تحتاجه.
 * الصلاحيات هنا للتوجيه والعرض فقط — الفحص الحقيقي في السيرفر.
 */
import { useSyncExternalStore } from 'react';
import { api, ApiException, refreshSession, clearTokens, type Meta, type Role, type User } from '../api';
import { validationMessage } from '../utils/validation';

export type Language = 'ar' | 'en';

export type View =
  // عامة
  | 'home' | 'about' | 'faq' | 'contact' | 'terms' | 'notifications' | 'profile' | 'appeals' | 'login' | 'register' | 'verify-email' | 'forgot-password' | 'reset-password'
  // المتقدم (هذا الملف وشاشاته ضمن نطاق وكيل واجهة المتقدم)
  | 'applicant-dashboard' | 'apply' | 'study' | 'my-application'
  // مشتركة للجهات (تفاصيل الطلب لفريق IMC والمقيّم وجهة التمويل)
  | 'application'
  // الجهات (شاشاتها ضمن نطاق وكيل الواجهة الإدارية — تُسجَّل في components/staffScreens.tsx)
  | 'work-queue' | 'ranking' | 'my-evaluations' | 'experts' | 'monitoring'
  | 'admin-dashboard' | 'admin-accounts' | 'admin-organizations' | 'admin-cohorts' | 'admin-audit' | 'admin-integration' | 'admin-outbox' | 'admin-content';

type Access = 'public' | 'guest' | 'auth' | Role[];

const STAFF: Role[] = ['imc_officer', 'evaluator', 'funder_reviewer', 'system_admin'];

export const VIEW_ACCESS: Record<View, Access> = {
  home: 'public', about: 'public', faq: 'public', contact: 'public', terms: 'public', notifications: 'auth', profile: 'auth', appeals: ['imc_officer'], login: 'guest', register: 'guest', 'verify-email': 'public', 'forgot-password': 'guest', 'reset-password': 'public',
  'applicant-dashboard': ['applicant'], apply: ['applicant'], study: ['applicant'], 'my-application': ['applicant'],
  application: STAFF,
  'work-queue': ['imc_officer', 'funder_reviewer', 'system_admin'],
  ranking: ['imc_officer'],
  'my-evaluations': ['evaluator'],
  experts: ['imc_officer'],
  monitoring: ['imc_officer', 'funder_reviewer'],
  'admin-dashboard': ['system_admin'], 'admin-accounts': ['system_admin'], 'admin-organizations': ['system_admin'], 'admin-cohorts': ['system_admin'],
  'admin-audit': ['system_admin'], 'admin-integration': ['system_admin'], 'admin-outbox': ['system_admin'], 'admin-content': ['system_admin'],
};

export const DEFAULT_VIEW: Record<Role, View> = {
  applicant: 'applicant-dashboard', imc_officer: 'work-queue', evaluator: 'my-evaluations', funder_reviewer: 'work-queue', system_admin: 'admin-dashboard',
};

/** مساحات العمل ذات الشريط الجانبي (وضع الجهات). */
export const WORKSPACE_VIEWS: View[] = [
  'application', 'appeals', 'work-queue', 'ranking', 'my-evaluations', 'experts', 'monitoring',
  'admin-dashboard', 'admin-accounts', 'admin-organizations', 'admin-cohorts', 'admin-audit', 'admin-integration', 'admin-outbox', 'admin-content',
];

export function canView(view: View, user: User | null): boolean {
  const a = VIEW_ACCESS[view];
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

const LANG_KEY = 'sona3_lang_v1';
const RETURN_KEY = 'sona3_return_to_v1';
const SAFE_PARAM = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * I1: الوجهة المطلوبة قبل تسجيل الدخول (رابط إشعار مثل #application/<id>).
 * تُقبل فقط إذا كانت شاشة داخلية تتطلب الدخول، ومعاملها معرف بسيط، ومسموحة لدور المستخدم بعد الدخول.
 */
export function safeReturnTarget(raw: unknown, user: User | null): { view: View; param: string | null } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { view, param } = raw as { view?: unknown; param?: unknown };
  if (typeof view !== 'string' || !(view in VIEW_ACCESS)) return null;
  // روابط الإشعارات تستخدم #application/<id> — المتقدم يراها في شاشته الخاصة.
  const target = (view === 'application' && user?.role === 'applicant' ? 'my-application' : view) as View;
  const access = VIEW_ACCESS[target];
  if (access === 'public' || access === 'guest') return null;
  if (param !== null && param !== undefined && (typeof param !== 'string' || !SAFE_PARAM.test(param))) return null;
  if (!canView(target, user)) return null;
  return { view: target, param: (param as string | null | undefined) ?? null };
}

function readLang(): Language {
  try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ar'; } catch { return 'ar'; }
}

/** The module lives under #i/sona3/ on the platform (see initiatives/registry.ts). */
export const MODULE_PREFIX = 'i/sona3/';
/** Account screens are the platform's (one account for every initiative). */
const PLATFORM_VIEWS: Record<string, string> = { login: 'login', 'forgot-password': 'forgot-password', 'reset-password': 'reset-password', 'verify-email': 'verify-email' };

function parseHash(): { view: View; param: string | null } {
  const full = decodeURIComponent(window.location.hash.replace(/^#\/?/, ''));
  const raw = full.startsWith(MODULE_PREFIX) ? full.slice(MODULE_PREFIX.length) : full === MODULE_PREFIX.slice(0, -1) ? '' : full;
  const [v, ...rest] = raw.split('/');
  const view = (v in VIEW_ACCESS ? v : 'home') as View;
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
    this.navigate(u ? DEFAULT_VIEW[u.role] : 'home');
  };

  async boot() {
    const metaP = api.meta().then((meta) => this.set({ meta })).catch(() => undefined);
    try {
      if (await refreshSession()) {
        const user = await api.me();
        this.set({ user });
      }
    } catch { clearTokens(); }
    await metaP;
    this.set({ booting: false });
    const { view } = this.s;
    if (this.s.user && (view === 'home' || view === 'login')) this.goHome();
    else if (this.s.user?.role === 'applicant' && view === 'application') this.navigate('my-application', this.s.param);
  }

  async login(email: string, password: string): Promise<User> {
    const { user } = await api.login(email, password);
    this.set({ user });
    if (!user.mustChangePassword) {
      const target = this.takeReturn(user);
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
