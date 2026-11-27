import React, { useEffect } from 'react';
import { Home, LayoutDashboard, Lock, Sun, UserPlus } from 'lucide-react';
import { canView, isLockedFactory, isRestrictedFactory, store, useStore, VIEW_ACCESS, WORKSPACE_VIEWS, DEFAULT_VIEW, workspaceHash, type View } from './store/state';
import { InitiativeBar, type InitiativeBarItem } from '../InitiativeBar';
import { setShellWorkspace } from '../../core/shell';
import { NotificationBell } from './components/common/NotificationBell';
import { AdminLayout } from './components/admin/AdminLayout';
import { ToastProvider } from './components/common/ToastSystem';
import { Loading } from './components/common/StateViews';
import { LoginView, RegisterView, VerifyEmailView, ForgotPasswordView, ResetPasswordView, CancelRecoveryView } from './components/auth/AuthViews';
import { FactoryDashboardView } from './components/factory/FactoryDashboardView';
import { ApplicationWizard } from './components/factory/ApplicationWizard';
import { FactoryTaskView } from './components/factory/FactoryTaskView';
import { ApplicationDetailView } from './components/review/ApplicationDetailView';
import { ApprovalsView } from './components/review/ApprovalsView';
import { NotificationsView } from './components/common/NotificationsView';
import { AccountsView, OrganizationsView } from './components/admin/AccountsViews';
import { AuditLogsView, IntegrationKeysView, OutboxView } from './components/admin/SystemViews';

/** «عن المبادرة» is the initiative's page on the platform (App redirects there). */
const PlatformPageRedirect: React.FC = () => null;

/**
 * The role's dashboard, work queue, monitoring and readiness screens are one platform page per user type, for every
 * initiative (#workspace/<type>). Old links (bookmarks, e-mails, notifications) land on the same filter there:
 * work-queue/<mine|overdue|all|A-B> → the tab / the states; an unknown state is dropped (no invented filter).
 */
const WorkspaceRedirect: React.FC = () => {
  const { user, view, param, meta } = useStore();
  useEffect(() => {
    if (!user) return;
    const known: string[] | undefined = meta?.states.map((s) => s.state);
    let preset: { tab?: string; state?: string } = {};
    if (view === 'admin-dashboard') preset = { tab: 'readiness' };
    else if (view === 'work-queue') {
      if (param === 'mine' || param === 'overdue' || param === 'all') preset = { tab: param };
      else if (param && param.split('-').every((x) => /^[A-Z_]+$/.test(x) && (!known || known.includes(x)))) preset = { tab: 'all', state: param.split('-').join(',') };
      else if (user.role === 'system_admin') preset = { tab: 'all' };
    }
    const target = workspaceHash(user.role, preset);
    if (target) window.location.replace(`#${target}`);
  }, [user, view, param, meta]);
  return <div className="container-custom page"><Loading /></div>;
};

const SCREENS: Record<View, React.FC> = {
  home: PlatformPageRedirect, login: LoginView, register: RegisterView, 'verify-email': VerifyEmailView, 'forgot-password': ForgotPasswordView, 'reset-password': ResetPasswordView, 'cancel-recovery': CancelRecoveryView, notifications: NotificationsView,
  'factory-dashboard': FactoryDashboardView, apply: ApplicationWizard, task: FactoryTaskView, application: ApplicationDetailView,
  dashboard: WorkspaceRedirect, 'work-queue': WorkspaceRedirect, 'pmu-monitor': WorkspaceRedirect, approvals: ApprovalsView,
  'admin-dashboard': WorkspaceRedirect, 'admin-accounts': AccountsView, 'admin-organizations': OrganizationsView, 'admin-audit': AuditLogsView, 'admin-integration': IntegrationKeysView, 'admin-outbox': OutboxView,
};

const Restricted: React.FC = () => {
  const { t, user } = useStore();
  // I1: احفظ الوجهة (مثل رابط الإشعار) للعودة إليها بعد تسجيل الدخول.
  useEffect(() => { if (!user) store.rememberReturn(); }, [user]);
  return (
    <div className="container-custom page">
      <div className="card state-box">
        <Lock size={36} aria-hidden />
        <div className="state-box-title">{user ? t('هذه الصفحة غير متاحة لدورك', 'This page is not available for your role') : t('يجب تسجيل الدخول', 'Please sign in')}</div>
        <button type="button" className="btn btn-primary" onClick={() => (user ? store.goHome() : store.navigate('login'))}>{user ? t('الصفحة الرئيسية لدورك', 'Go to your home page') : t('تسجيل الدخول', 'Sign in')}</button>
      </div>
    </div>
  );
};

/** The initiative's page on the platform: its public details (the former «عن المبادرة» page) live there. */
const PLATFORM_PAGE = '#initiative/shams';

/** The initiative's tabs in the bar under the platform header (the account menu, language and sign-out are the platform's). */
const TABS: Array<{ view: View; ar: string; en: string; icon: React.ReactNode }> = [
  { view: 'factory-dashboard', ar: 'لوحتي', en: 'My dashboard', icon: <LayoutDashboard size={15} /> },
  { view: 'register', ar: 'تسجيل مصنع', en: 'Register a factory', icon: <UserPlus size={15} /> },
];

export const App: React.FC = () => {
  const { view, user, booting, isAr, t, meta } = useStore();
  useEffect(() => { void store.boot(); }, []);
  useEffect(() => {
    document.title = isAr ? 'مبادرة شمس الصناعة | بوابة مبادرات وزارة الصناعة' : 'Shams El-Senaa | Ministry of Industry Initiatives Portal';
  }, [isAr]);

  // A factory under IMC review (or not accepted) has no Shams screen: back to the platform chooser, which says why.
  useEffect(() => {
    if (!booting && isLockedFactory(user) && VIEW_ACCESS[view] !== 'public') window.location.hash = '#hub';
  }, [booting, user, view]);

  // «عن المبادرة» is the initiative's page on the platform; a signed-in person's home is their workspace.
  const toPlatformPage = !booting && view === 'home' && (!user || DEFAULT_VIEW[user.role] === 'home');
  useEffect(() => { if (toPlatformPage) window.location.replace(PLATFORM_PAGE); }, [toPlatformPage]);

  const Screen = SCREENS[view];
  const allowed = canView(view, user);
  const workspace = Boolean(user) && allowed && (WORKSPACE_VIEWS.includes(view) || (view === 'application' && user?.role !== 'factory_owner'));
  useEffect(() => { setShellWorkspace(workspace); }, [workspace]);
  useEffect(() => () => setShellWorkspace(false), []);
  const body = booting || toPlatformPage ? <div className="container-custom page"><Loading /></div> : !allowed ? <Restricted /> : <Screen />;

  const items: InitiativeBarItem[] = [
    { key: 'about', label: t('عن المبادرة', 'About'), icon: <Home size={15} />, href: PLATFORM_PAGE },
    ...TABS.filter((n) => canView(n.view, user)).map((n) => ({
      key: n.view, label: isAr ? n.ar : n.en, icon: n.icon, active: view === n.view, onClick: () => store.navigate(n.view),
    })),
    // Staff: their dashboard is the platform's (one page for every initiative), on this initiative.
    ...(user && workspaceHash(user.role) ? [{ key: 'workspace', label: t('لوحتي', 'My dashboard'), icon: <LayoutDashboard size={15} />, href: `#${workspaceHash(user.role)}` }] : []),
  ];
  const roleLabel = user && meta ? (isAr ? meta.roles[user.role].ar : meta.roles[user.role].en) : '';

  return (
    <ToastProvider>
      <InitiativeBar
        isAr={isAr} slug="shams" titleAr="شمس الصناعة" titleEn="Shams El-Senaa" icon={<Sun size={15} aria-hidden />}
        roleLabel={roleLabel} items={items} workspace={workspace}
        extra={user && !isRestrictedFactory(user) ? <NotificationBell className="ini-tab" /> : null}
      />
      {workspace ? <AdminLayout>{body}</AdminLayout> : body}
    </ToastProvider>
  );
};
