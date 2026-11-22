/**
 * The platform router. #i/<id>/… belongs to an initiative module (lazy chunk with its own screens, header and styles);
 * every other route is a platform screen inside the platform shell.
 */
import React, { Suspense, useEffect, useSyncExternalStore } from 'react';
import { usePlatform, store, AUTH_VIEWS, ADMIN_VIEWS, type View } from './store';
import { Header, Footer, Loading, SignInRequired } from './layout';
import { HomePage, InitiativesPage, InitiativePage, ImpactPage } from './pages/public';
import { LoginPage, RegisterPage, VerifyEmailPage, ForgotPasswordPage, ResetPasswordPage, ChangePasswordPage } from './pages/auth';
import { HubPage, ProfilePage, ApplyPage, NotificationsPage } from './pages/account';
import { AdminLayout, AdminDashboard, AdminInitiative, AdminUsers, AdminCatalog, AdminBanners, AdminAudit, AdminOutbox, AdminReadiness } from './pages/admin';
import { AdminBodies, AdminBody } from './pages/bodies';
import { moduleOf } from '../initiatives/registry';

const SCREENS: Record<View, React.FC> = {
  home: HomePage, initiatives: InitiativesPage, initiative: InitiativePage, impact: ImpactPage,
  login: LoginPage, register: RegisterPage, 'verify-email': VerifyEmailPage, 'forgot-password': ForgotPasswordPage, 'reset-password': ResetPasswordPage,
  'change-password': ChangePasswordPage, hub: HubPage, profile: ProfilePage, apply: ApplyPage, notifications: NotificationsPage,
  admin: AdminDashboard, 'admin-initiative': AdminInitiative, 'admin-users': AdminUsers, 'admin-catalog': AdminCatalog, 'admin-banners': AdminBanners,
  'admin-audit': AdminAudit, 'admin-outbox': AdminOutbox, 'admin-readiness': AdminReadiness, 'admin-bodies': AdminBodies, 'admin-body': AdminBody,
};

function useHash(): string {
  return useSyncExternalStore((cb) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); }, () => window.location.hash);
}

const PlatformShell: React.FC = () => {
  const { view, booting, me, isAr } = usePlatform();
  useEffect(() => { document.title = isAr ? 'المنصة الوطنية للمبادرات الصناعية | وزارة الصناعة' : 'National Industrial Initiatives Platform | Ministry of Industry'; }, [isAr, view]);
  const Screen = SCREENS[view];
  const needsAuth = AUTH_VIEWS.includes(view) || ADMIN_VIEWS.includes(view);
  let body: React.ReactNode;
  if (booting && needsAuth) body = <Loading />;
  else if (needsAuth && !me) body = <SignInRequired />;
  else if (me?.user.mustChangePassword && view !== 'change-password') body = <ChangePasswordPage />;
  else if (ADMIN_VIEWS.includes(view)) body = <AdminLayout><Screen /></AdminLayout>;
  else body = <Screen />;
  return (
    <div className="platform-root">
      <Header />
      <main className="pf-main" id="main">{body}</main>
      {ADMIN_VIEWS.includes(view) ? null : <Footer />}
    </div>
  );
};

export const App: React.FC = () => {
  const hash = useHash();
  useEffect(() => { void store.boot(); }, []);
  const mod = moduleOf(hash);
  if (mod) {
    const Module = mod.load;
    return <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>…</div>}><Module /></Suspense>;
  }
  return <PlatformShell />;
};
