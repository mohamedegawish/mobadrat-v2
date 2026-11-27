/**
 * The platform router. #i/<id>/… belongs to an initiative module (lazy chunk with its own screens, header and styles);
 * every other route is a platform screen inside the platform shell: the official header, the page, the official footer.
 */
import React, { Suspense, useEffect, useSyncExternalStore } from 'react';
import { usePlatform, store, isAdmin, AUTH_VIEWS, ADMIN_VIEWS, STAFF_WORK_VIEWS, type View } from './store';
import { Loading, SignInRequired, Forbidden } from './layout';
import { VerifyEmailPage, ForgotPasswordPage, ResetPasswordPage, ChangePasswordPage } from './pages/auth';
import { ProfilePage, ApplyPage, NotificationsPage } from './pages/account';
import { AdminDashboard, AdminInitiative, AdminUsers, AdminCatalog, AdminBanners, AdminAudit, AdminOutbox, AdminReadiness } from './pages/admin';
import { AdminBodies, AdminBody } from './pages/bodies';
import { WorkspacePage, WorkspaceSidebarAuto } from './pages/workspace';
import { moduleOf, type ModuleEntry } from '../initiatives/registry';
import { getShellWorkspace, onShellWorkspace } from '../core/shell';
import { ToastProvider, useToast } from '../components/common/ToastSystem';
import { HeaderNavbar } from '../components/layout/HeaderNavbar';
import { Footer } from '../components/layout/Footer';
import { HomeView } from '../components/showcase/HomeView';
import { InitiativesView } from '../components/showcase/InitiativesView';
import { InitiativeDetailPage } from '../components/showcase/InitiativeDetailPage';
import { CompareView } from '../components/showcase/CompareView';
import { ImpactView } from '../components/showcase/ImpactView';
import { LoginView } from '../components/auth/LoginView';
import { MyInitiativesView } from '../components/factory/MyInitiativesView';
import { AdminLayout } from '../components/admin/AdminLayout';
import { ChatWidget } from '../components/chatbot/ChatWidget';

const SCREENS: Record<View, React.FC> = {
  home: HomeView, initiatives: InitiativesView, initiative: InitiativeDetailPage, compare: CompareView, impact: ImpactView,
  login: LoginView, register: LoginView, 'verify-email': VerifyEmailPage, 'forgot-password': ForgotPasswordPage, 'reset-password': ResetPasswordPage,
  'change-password': ChangePasswordPage, hub: MyInitiativesView, workspace: WorkspacePage, profile: ProfilePage, apply: ApplyPage, notifications: NotificationsPage,
  admin: AdminDashboard, 'admin-initiative': AdminInitiative, 'admin-users': AdminUsers, 'admin-catalog': AdminCatalog, 'admin-banners': AdminBanners,
  'admin-audit': AdminAudit, 'admin-outbox': AdminOutbox, 'admin-readiness': AdminReadiness, 'admin-bodies': AdminBodies, 'admin-body': AdminBody,
};

/** «الإنجازات» (الأثر الوطني) — صفحة سيادية للإدارة فقط. */
const STAFF_VIEWS: View[] = ['impact'];

function useHash(): string {
  return useSyncExternalStore((cb) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); }, () => window.location.hash);
}

function useWorkspace(): boolean {
  return useSyncExternalStore(onShellWorkspace, getShellWorkspace);
}

/** One page for the platform and every initiative: the official header, the page (a platform screen or an initiative's), the footer. */
const PlatformShell: React.FC<{ module: ModuleEntry | null }> = ({ module }) => {
  const { view, booting, me, isAr } = usePlatform();
  const moduleWorkspace = useWorkspace();
  const { toast } = useToast();
  useEffect(() => { if (!module) document.title = isAr ? 'بوابة مبادرات وزارة الصناعة | جمهورية مصر العربية' : 'Ministry of Industry Initiatives Portal | Arab Republic of Egypt'; }, [isAr, view, module]);

  // Show a welcome toast on first load
  useEffect(() => {
    let welcomed = true;
    try { welcomed = Boolean(localStorage.getItem('egypt_ind_welcomed')); if (!welcomed) localStorage.setItem('egypt_ind_welcomed', '1'); } catch { /* private mode */ }
    if (welcomed) return;
    const id = window.setTimeout(() => {
      toast('info', isAr ? 'مرحباً بك في بوابة مبادرات وزارة الصناعة — جمهورية مصر العربية' : 'Welcome to the Ministry of Industry Initiatives Portal — Arab Republic of Egypt');
    }, 800);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Screen = SCREENS[view];
  const isAdminView = module ? moduleWorkspace : ADMIN_VIEWS.includes(view);
  // The staff dashboards are work pages too (compact header, no footer), open to initiative staff (not platform roles only).
  const isWorkView = !module && STAFF_WORK_VIEWS.includes(view);
  const needsAuth = AUTH_VIEWS.includes(view) || isAdminView || STAFF_VIEWS.includes(view);
  let body: React.ReactNode;
  if (module) {
    // An initiative's screens (its own routes, guards and stylesheet) inside the platform page.
    const Module = module.load;
    const page = me?.user.mustChangePassword ? <ChangePasswordPage /> : <Suspense fallback={<Loading />}><Module /></Suspense>;
    // Every page of an initiative's staff area gets the dashboard's own sidebar (one menu, whichever page is open).
    body = moduleWorkspace && me ? (
      <div className="admin-layout">
        <WorkspaceSidebarAuto initiativeId={module.id} />
        <div className="admin-content" lang={isAr ? 'ar' : 'en'}>{page}</div>
      </div>
    ) : page;
  } else if (booting && needsAuth) body = <Loading />;
  else if (view === 'hub' && !me) body = <MyInitiativesView />; // its own «sign in» card
  else if (needsAuth && !me) body = <SignInRequired />;
  else if (me?.user.mustChangePassword && view !== 'change-password') body = <ChangePasswordPage />;
  else if ((isAdminView || STAFF_VIEWS.includes(view)) && !isAdmin(me)) body = <Forbidden />;
  else if (isAdminView) body = <AdminLayout><Screen /></AdminLayout>;
  else body = <Screen key={view} />;
  return (
    <div className={`app-container${isAdminView || isWorkView ? ' admin-mode' : ''}`}>
        {/* 1. Official Government Header */}
        <HeaderNavbar />
        {/* 2. Main View Router with Access Control Guard */}
        <main className="main-content" id="main">{body}</main>
        {/* 3. Official Government Footer — مخفي في وضع الإدارة لتوفير المساحة */}
        {isAdminView || isWorkView ? null : <Footer />}
        {/* 4. Floating platform assistant */}
        <ChatWidget />
    </div>
  );
};

export const App: React.FC = () => {
  const hash = useHash();
  useEffect(() => { void store.boot(); }, []);
  const mod = moduleOf(hash);
  // The toasts render next to the page, so they sit inside .platform-root too (the platform's stylesheet is scoped to it).
  return <div className="platform-root"><ToastProvider><PlatformShell module={mod} /></ToastProvider></div>;
};
