import React, { useEffect } from 'react';
import { Lock } from 'lucide-react';
import { canView, store, useStore, WORKSPACE_VIEWS, type View } from './store/state';
import { HeaderNavbar } from './components/layout/HeaderNavbar';
import { Footer } from './components/layout/Footer';
import { AdminLayout } from './components/admin/AdminLayout';
import { ToastProvider } from './components/common/ToastSystem';
import { Loading } from './components/common/StateViews';
import { HomeView } from './components/public/HomeView';
import { LoginView, RegisterView, VerifyEmailView, ForgotPasswordView, ResetPasswordView, CancelRecoveryView } from './components/auth/AuthViews';
import { FactoryDashboardView } from './components/factory/FactoryDashboardView';
import { ApplicationWizard } from './components/factory/ApplicationWizard';
import { FactoryTaskView } from './components/factory/FactoryTaskView';
import { ApplicationDetailView } from './components/review/ApplicationDetailView';
import { WorkQueueView } from './components/review/WorkQueueView';
import { RoleDashboardView } from './components/review/RoleDashboardView';
import { MonitoringView } from './components/pmu/MonitoringView';
import { ProvidersView } from './components/providers/ProvidersView';
import { ApprovalsView } from './components/review/ApprovalsView';
import { NotificationsView } from './components/common/NotificationsView';
import { AccountsView, OrganizationsView } from './components/admin/AccountsViews';
import { AuditLogsView, IntegrationKeysView, OutboxView } from './components/admin/SystemViews';
import { AdminDashboardView } from './components/admin/AdminDashboardView';

const SCREENS: Record<View, React.FC> = {
  home: HomeView, login: LoginView, register: RegisterView, 'verify-email': VerifyEmailView, 'forgot-password': ForgotPasswordView, 'reset-password': ResetPasswordView, 'cancel-recovery': CancelRecoveryView, notifications: NotificationsView,
  'factory-dashboard': FactoryDashboardView, apply: ApplicationWizard, task: FactoryTaskView, application: ApplicationDetailView,
  dashboard: RoleDashboardView, 'work-queue': WorkQueueView, 'pmu-monitor': MonitoringView, providers: ProvidersView, approvals: ApprovalsView,
  'admin-dashboard': AdminDashboardView, 'admin-accounts': AccountsView, 'admin-organizations': OrganizationsView, 'admin-audit': AuditLogsView, 'admin-integration': IntegrationKeysView, 'admin-outbox': OutboxView,
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
  useEffect(() => { void store.boot(); }, []);
  useEffect(() => {
    document.title = isAr ? 'مبادرة شمس الصناعة | وزارة الصناعة' : 'Shams El-Senaa Initiative | Ministry of Industry';
  }, [isAr]);

  const Screen = SCREENS[view];
  const allowed = canView(view, user);
  const workspace = Boolean(user) && allowed && (WORKSPACE_VIEWS.includes(view) || (view === 'application' && user?.role !== 'factory_owner'));
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
