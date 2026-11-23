/** Small shared UI pieces of the platform screens (the header and footer are components/layout/*). */
import React from 'react';
import { LayoutGrid, LogIn, ShieldAlert, ArrowLeft, ArrowRight } from 'lucide-react';
import { usePlatform, store } from './store';

export const Loading: React.FC = () => {
  const { t } = usePlatform();
  return <div className="pf-empty">{t('جارٍ التحميل…', 'Loading…')}</div>;
};

export const Alert: React.FC<{ tone: 'ok' | 'err' | 'warn' | 'info'; children: React.ReactNode }> = ({ tone, children }) => (
  <div className={`pf-alert ${tone}`} role={tone === 'err' ? 'alert' : 'status'}>{children}</div>
);

/** The original «access restricted» card. */
const GateCard: React.FC<{ title: string; text: string; action: React.ReactNode }> = ({ title, text, action }) => (
  <div className="container-custom" style={{ padding: '4rem 1.5rem', textAlign: 'center' }}>
    <div className="card" style={{ maxWidth: '600px', margin: '0 auto', padding: '2.5rem' }}>
      <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--status-rejected-bg)', color: 'var(--status-rejected)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
        <ShieldAlert size={32} />
      </div>
      <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '0.75rem' }}>{title}</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>{text}</p>
      {action}
    </div>
  </div>
);

export const SignInRequired: React.FC = () => {
  const { t, hash } = usePlatform();
  return (
    <GateCard
      title={t('يجب تسجيل الدخول', 'Please sign in')}
      text={t('سجل الدخول للوصول لهذه الصفحة — حساب واحد على المنصة يكفيك لكل المبادرات.', 'Sign in to open this page — one platform account works for every initiative.')}
      action={
        <button type="button" className="btn btn-primary" onClick={() => { store.rememberReturn(hash); store.go('login'); }}>
          <LogIn size={16} /><span>{t('تسجيل الدخول', 'Sign in')}</span>
        </button>
      }
    />
  );
};

export const Forbidden: React.FC = () => {
  const { t, isAr } = usePlatform();
  return (
    <GateCard
      title={t('الوصول مقيد', 'Access Restricted')}
      text={t('دورك الحالي لا يملك صلاحية للوصول إلى هذا القسم.', 'Your current role does not have permission to access this view.')}
      action={
        <button type="button" className="btn btn-primary" onClick={() => store.goHome()}>
          <span>{t('الانتقال إلى مساحة العمل المصرح لك بها', 'Go to Authorized Workspace')}</span>
          {isAr ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
        </button>
      }
    />
  );
};

export function statusLabel(status: string, isAr: boolean): { label: string; tone: string } {
  const m: Record<string, [string, string, string]> = {
    active: ['التسجيل متاح', 'Open', 'ok'], coming_soon: ['قريبًا', 'Coming soon', 'info'], closed: ['مغلقة', 'Closed', 'warn'],
    completed: ['مكتملة', 'Completed', 'info'], draft: ['مسودة', 'Draft', 'warn'], archived: ['مؤرشفة', 'Archived', 'bad'],
  };
  const [ar, en, tone] = m[status] ?? [status, status, 'info'];
  return { label: isAr ? ar : en, tone };
}

export const Icon = { LayoutGrid };
