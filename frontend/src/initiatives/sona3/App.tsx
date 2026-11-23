import React, { useEffect } from 'react';
import { Activity, Home, LayoutDashboard, ListChecks, Lock, Rocket, UserPlus } from 'lucide-react';
import { canView, store, useStore, WORKSPACE_VIEWS, DEFAULT_VIEW, type View } from './store/state';
import { InitiativeBar, type InitiativeBarItem } from '../InitiativeBar';
import { setShellWorkspace } from '../../core/shell';
import { AdminLayout } from './components/admin/AdminLayout';
import { ToastProvider } from './components/common/ToastSystem';
import { Loading } from './components/common/StateViews';
import { LoginView, RegisterView, VerifyEmailView, ForgotPasswordView, ResetPasswordView } from './components/auth/AuthViews';
import { ApplicantDashboardView, ApplyView, StudyView, MyApplicationView } from './components/applicant/ApplicantViews';
import { StaffApplicationView, RankingView, MyEvaluationsView, ExpertsView } from './components/staff/StaffViews';
import { WorkQueueDashboard as WorkQueueView, MonitoringDashboard as MonitoringView } from './components/staff/Dashboards';
import { NotificationsView, ProfileView } from './components/common/AccountPages';
import { AppealsView } from './components/staff/AppealsView';
import { ContentAdminView } from './components/admin/ContentAdmin';
import { loadSiteContent } from './content/siteContent';
import { AdminDashboardView, CohortsView, AccountsView, OrganizationsView, AuditView, IntegrationView, OutboxView } from './components/admin/AdminViews';

/** The public pages are the initiative's page on the platform (App redirects there). */
const PlatformPageRedirect: React.FC = () => null;

const SCREENS: Record<View, React.FC> = {
  home: PlatformPageRedirect, about: PlatformPageRedirect, faq: PlatformPageRedirect, contact: PlatformPageRedirect, terms: PlatformPageRedirect, notifications: NotificationsView, profile: ProfileView, appeals: AppealsView, login: LoginView, register: RegisterView, 'verify-email': VerifyEmailView, 'forgot-password': ForgotPasswordView, 'reset-password': ResetPasswordView,
  'applicant-dashboard': ApplicantDashboardView, apply: ApplyView, study: StudyView, 'my-application': MyApplicationView,
  application: StaffApplicationView, 'work-queue': WorkQueueView, ranking: RankingView, 'my-evaluations': MyEvaluationsView, experts: ExpertsView, monitoring: MonitoringView,
  'admin-dashboard': AdminDashboardView, 'admin-accounts': AccountsView, 'admin-organizations': OrganizationsView, 'admin-cohorts': CohortsView,
  'admin-audit': AuditView, 'admin-integration': IntegrationView, 'admin-outbox': OutboxView, 'admin-content': ContentAdminView,
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

/** The initiative's page on the platform: its public details (the former home / about / FAQ / contact / terms pages). */
const PLATFORM_PAGE = '#initiative/sona3';
const PUBLIC_PAGES: View[] = ['home', 'about', 'faq', 'contact', 'terms'];

/** The initiative's tabs in the bar under the platform header (the account menu, language and sign-out are the platform's). */
const TABS: Array<{ view: View; ar: string; en: string; icon: React.ReactNode }> = [
  { view: 'applicant-dashboard', ar: 'صفحتي', en: 'My page', icon: <LayoutDashboard size={15} /> },
  { view: 'monitoring', ar: 'المتابعة', en: 'Monitoring', icon: <Activity size={15} /> },
  { view: 'work-queue', ar: 'قائمة العمل', en: 'Work queue', icon: <ListChecks size={15} /> },
  { view: 'register', ar: 'تسجيل متقدم', en: 'Register', icon: <UserPlus size={15} /> },
];

export const App: React.FC = () => {
  const { view, user, booting, isAr, t, meta } = useStore();
  useEffect(() => { void store.boot(); void loadSiteContent(); }, []);
  useEffect(() => {
    document.title = isAr ? 'مبادرة صُنّاع المستقبل | المنصة الوطنية للتمويل والمبادرات الصناعية' : 'Future Makers | National Platform for Industrial Financing & Initiatives';
  }, [isAr]);

  // The public pages are the initiative's page on the platform; a signed-in person's home is their workspace.
  const toPlatformPage = !booting && PUBLIC_PAGES.includes(view) && (view !== 'home' || !user || DEFAULT_VIEW[user.role] === 'home');
  useEffect(() => { if (toPlatformPage) window.location.replace(PLATFORM_PAGE); }, [toPlatformPage]);

  const Screen = SCREENS[view];
  const allowed = canView(view, user);
  const workspace = Boolean(user) && WORKSPACE_VIEWS.includes(view) && allowed;
  useEffect(() => { setShellWorkspace(workspace); }, [workspace]);
  useEffect(() => () => setShellWorkspace(false), []);
  const body = booting || toPlatformPage ? <div className="container-custom page"><Loading /></div> : !allowed ? <Restricted /> : <Screen />;

  const items: InitiativeBarItem[] = [
    { key: 'about', label: t('عن المبادرة', 'About'), icon: <Home size={15} />, href: PLATFORM_PAGE },
    ...TABS.filter((n) => canView(n.view, user)).map((n) => ({
      key: n.view, label: isAr ? n.ar : n.en, icon: n.icon, active: view === n.view, onClick: () => store.navigate(n.view),
    })),
  ];
  const roleLabel = user && meta ? (isAr ? meta.roles[user.role].ar : meta.roles[user.role].en) : '';

  return (
    <ToastProvider>
      <InitiativeBar
        isAr={isAr} slug="sona3" titleAr="صُنّاع المستقبل" titleEn="Future Makers" icon={<Rocket size={15} aria-hidden />}
        roleLabel={roleLabel} items={items} workspace={workspace}
      />
      {workspace ? <AdminLayout>{body}</AdminLayout> : body}
    </ToastProvider>
  );
};
