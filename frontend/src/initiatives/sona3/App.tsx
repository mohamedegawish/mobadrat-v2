import React, { useEffect } from 'react';
import { Lock } from 'lucide-react';
import { canView, store, useStore, WORKSPACE_VIEWS, type View } from './store/state';
import { HeaderNavbar } from './components/layout/HeaderNavbar';
import { Footer } from './components/layout/Footer';
import { AdminLayout } from './components/admin/AdminLayout';
import { ToastProvider } from './components/common/ToastSystem';
import { Loading } from './components/common/StateViews';
import { HomeView } from './components/public/HomeView';
import { LoginView, RegisterView, VerifyEmailView, ForgotPasswordView, ResetPasswordView } from './components/auth/AuthViews';
import { ApplicantDashboardView, ApplyView, StudyView, MyApplicationView } from './components/applicant/ApplicantViews';
import { StaffApplicationView, RankingView, MyEvaluationsView, ExpertsView } from './components/staff/StaffViews';
import { WorkQueueDashboard as WorkQueueView, MonitoringDashboard as MonitoringView } from './components/staff/Dashboards';
import { AboutView, FaqView, ContactView, TermsView } from './components/public/PublicPages';
import { NotificationsView, ProfileView } from './components/common/AccountPages';
import { AppealsView } from './components/staff/AppealsView';
import { ContentAdminView } from './components/admin/ContentAdmin';
import { loadSiteContent } from './content/siteContent';
import { AdminDashboardView, CohortsView, AccountsView, OrganizationsView, AuditView, IntegrationView, OutboxView } from './components/admin/AdminViews';

const SCREENS: Record<View, React.FC> = {
  home: HomeView, about: AboutView, faq: FaqView, contact: ContactView, terms: TermsView, notifications: NotificationsView, profile: ProfileView, appeals: AppealsView, login: LoginView, register: RegisterView, 'verify-email': VerifyEmailView, 'forgot-password': ForgotPasswordView, 'reset-password': ResetPasswordView,
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

export const App: React.FC = () => {
  const { view, user, booting, isAr } = useStore();
  useEffect(() => { void store.boot(); void loadSiteContent(); }, []);
  useEffect(() => {
    document.title = isAr ? 'منصة صُنّاع المستقبل | مركز تحديث الصناعة' : 'Future Makers | Industrial Modernization Center';
  }, [isAr]);

  const Screen = SCREENS[view];
  const allowed = canView(view, user);
  const workspace = Boolean(user) && WORKSPACE_VIEWS.includes(view) && allowed;
  const body = booting ? <div className="container-custom page"><Loading /></div> : !allowed ? <Restricted /> : <Screen />;

  return (
    <ToastProvider>
      <div className={`app-container${workspace ? ' admin-mode' : ''}`}>
        <HeaderNavbar />
        <main className="main-content" id="main">
          {workspace ? <AdminLayout>{body}</AdminLayout> : body}
        </main>
        {!workspace ? <Footer /> : null}
      </div>
    </ToastProvider>
  );
};
