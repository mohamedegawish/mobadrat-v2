/**
 * Platform state: language, hash route, the signed-in person (/me) and the public catalog. Initiative modules have their
 * own stores; routes under #i/<id>/ belong to them (App.tsx mounts the module).
 */
import { useSyncExternalStore } from 'react';
import { api, type Banner, type Initiative, type Lang, type Me } from './api';
import { onTokenChange, refreshSession, getAccessToken } from '../core/session';

export type View =
  | 'home' | 'initiatives' | 'initiative' | 'compare' | 'impact' | 'login' | 'register' | 'verify-email' | 'forgot-password' | 'reset-password'
  | 'hub' | 'profile' | 'apply' | 'notifications' | 'change-password'
  | 'admin' | 'admin-initiative' | 'admin-users' | 'admin-catalog' | 'admin-banners' | 'admin-audit' | 'admin-outbox' | 'admin-readiness' | 'admin-bodies' | 'admin-body';

const VIEWS: View[] = ['home', 'initiatives', 'initiative', 'compare', 'impact', 'login', 'register', 'verify-email', 'forgot-password', 'reset-password',
  'hub', 'profile', 'apply', 'notifications', 'change-password', 'admin', 'admin-initiative', 'admin-users', 'admin-catalog', 'admin-banners', 'admin-audit', 'admin-outbox', 'admin-readiness', 'admin-bodies', 'admin-body'];

export const AUTH_VIEWS: View[] = ['hub', 'profile', 'apply', 'notifications', 'change-password'];
export const ADMIN_VIEWS: View[] = ['admin', 'admin-initiative', 'admin-users', 'admin-catalog', 'admin-banners', 'admin-audit', 'admin-outbox', 'admin-readiness', 'admin-bodies', 'admin-body'];

interface Snapshot {
  lang: Lang; hash: string; view: View; param: string | null; query: URLSearchParams;
  me: Me | null; booting: boolean; initiatives: Initiative[] | null; banners: Banner[]; tick: number;
}

const LANG_KEY = 'mobadrat_lang_v2';
const RETURN_KEY = 'platform_return_to';

function readLang(): Lang { try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ar'; } catch { return 'ar'; } }

function parse(): { hash: string; view: View; param: string | null; query: URLSearchParams } {
  const raw = decodeURIComponent(window.location.hash.replace(/^#\/?/, ''));
  const [pathPart, q = ''] = raw.split('?');
  const [v, ...rest] = pathPart.split('/');
  const view = (VIEWS as string[]).includes(v) ? (v as View) : 'home';
  return { hash: raw, view, param: rest.length ? rest.join('/') : null, query: new URLSearchParams(q) };
}

class Store {
  private listeners = new Set<() => void>();
  private s: Snapshot;

  constructor() {
    this.s = { lang: readLang(), ...parse(), me: null, booting: true, initiatives: null, banners: [], tick: 0 };
    this.applyLang(this.s.lang);
    window.addEventListener('hashchange', () => { this.set(parse()); });
    // A module may sign out or refresh the session: keep /me in step with the shared token.
    onTokenChange((t) => { if (!t && this.s.me) this.set({ me: null }); });
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  get = () => this.s;
  private set(p: Partial<Snapshot>) { this.s = { ...this.s, ...p, tick: this.s.tick + 1 }; this.listeners.forEach((l) => l()); }

  private applyLang(l: Lang) { document.documentElement.lang = l; document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr'; }
  setLang = (lang: Lang) => { try { localStorage.setItem(LANG_KEY, lang); } catch { /* private mode */ } this.applyLang(lang); this.set({ lang }); };

  go = (target: string) => {
    const h = target.startsWith('#') ? target : `#${target}`;
    if (window.location.hash !== h) window.location.hash = h; else this.set(parse());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  rememberReturn(target: string) { try { sessionStorage.setItem(RETURN_KEY, target.replace(/^#/, '')); } catch { /* ignore */ } }
  takeReturn(): string | null {
    try { const v = sessionStorage.getItem(RETURN_KEY); sessionStorage.removeItem(RETURN_KEY); return v && /^[A-Za-z0-9_/?=&.-]{1,200}$/.test(v) ? v : null; } catch { return null; }
  }

  async boot() {
    void this.loadInitiatives();
    void this.loadBanners();
    try { if (getAccessToken() || await refreshSession()) await this.reloadMe(); } catch { /* guest */ }
    this.set({ booting: false });
  }

  async loadInitiatives() { try { this.set({ initiatives: await api.initiatives() }); } catch { this.set({ initiatives: [] }); } }

  /** The home page banners (managed from «بانرات الرئيسية»); reloaded after the admin edits them. */
  async loadBanners() { try { this.set({ banners: await api.banners() }); } catch { this.set({ banners: [] }); } }

  async reloadMe(): Promise<Me | null> {
    try { const me = await api.me(); this.set({ me }); return me; } catch { this.set({ me: null }); return null; }
  }

  async login(email: string, password: string): Promise<Me | null> {
    await api.login(email, password);
    const me = await this.reloadMe();
    const back = this.takeReturn();
    if (me?.user.mustChangePassword) this.go('change-password');
    else if (back) this.go(back);
    else this.goHome(me);
    return me;
  }

  /** Where a signed-in person lands: staff → the administration; one initiative → its dashboard; several → «مبادراتي». */
  goHome(me = this.s.me) {
    if (!me) { this.go('home'); return; }
    if (me.user.platformRole) { this.go('admin'); return; }
    if (!me.user.platformRole && me.memberships.length === 1 && me.memberships[0].status === 'active' && me.memberships[0].access?.status !== 'blocked') {
      const m = me.memberships[0];
      this.go(`i/${m.initiativeId}/${m.card?.view ?? m.defaultView}`);
      return;
    }
    this.go(me.memberships.length || me.user.platformRole ? 'hub' : 'initiatives');
  }

  async logout() { await api.logout().catch(() => undefined); this.set({ me: null }); this.go('home'); }
}

export const store = new Store();

export function usePlatform() {
  const s = useSyncExternalStore(store.subscribe, store.get);
  const isAr = s.lang === 'ar';
  return { ...s, isAr, t: (ar: string, en: string) => (isAr ? ar : en), store };
}

export const isAdmin = (me: Me | null) => Boolean(me?.user.platformRole);
export const canManage = (me: Me | null) => me?.user.platformRole === 'super_admin';
export const canEditContent = (me: Me | null) => me?.user.platformRole === 'super_admin' || me?.user.platformRole === 'catalog_manager';
