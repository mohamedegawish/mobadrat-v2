/** Platform header, footer and small shared UI pieces. */
import React from 'react';
import { Bell, Globe, LogIn, LogOut, LayoutGrid, UserRound, ShieldCheck } from 'lucide-react';
import { usePlatform, store, isAdmin } from './store';

export const Header: React.FC = () => {
  const { t, isAr, me, view, lang } = usePlatform();
  const nav: Array<{ to: string; label: string; active: boolean }> = [
    { to: 'home', label: t('الرئيسية', 'Home'), active: view === 'home' },
    { to: 'initiatives', label: t('المبادرات', 'Initiatives'), active: view === 'initiatives' || view === 'initiative' },
    { to: 'impact', label: t('الأثر', 'Impact'), active: view === 'impact' },
  ];
  if (me) {
    nav.push({ to: 'hub', label: t('مبادراتي', 'My initiatives'), active: view === 'hub' });
    nav.push({ to: 'profile', label: t('بياناتي', 'My data'), active: view === 'profile' });
  }
  if (isAdmin(me)) nav.push({ to: 'admin', label: t('لوحة الإدارة', 'Administration'), active: view.startsWith('admin') });
  return (
    <header className="pf-header">
      <div className="pf-flag" />
      <div className="pf-container pf-header-row">
        <a className="pf-brand" href="#home">
          <img src="/ministry-industry-logo.png" alt={t('وزارة الصناعة', 'Ministry of Industry')} />
          <span>
            <span className="pf-brand-title">{t('المنصة الوطنية للمبادرات الصناعية', 'National Industrial Initiatives Platform')}</span>
            <span className="pf-brand-sub" style={{ display: 'block' }}>{t('جمهورية مصر العربية — وزارة الصناعة', 'Arab Republic of Egypt — Ministry of Industry')}</span>
          </span>
        </a>
        <nav className="pf-nav" aria-label={t('القائمة الرئيسية', 'Main menu')}>
          {nav.map((n) => <a key={n.to} href={`#${n.to}`} className={n.active ? 'active' : ''}>{n.label}</a>)}
        </nav>
        <div className="pf-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => store.setLang(lang === 'ar' ? 'en' : 'ar')} aria-label="language">
            <Globe size={16} /> {isAr ? 'EN' : 'ع'}
          </button>
          {me ? (
            <>
              <a href="#notifications" className="btn btn-ghost btn-sm pf-bell" aria-label={t('الإشعارات', 'Notifications')}>
                <Bell size={18} />{me.unreadTotal ? <span className="pf-count">{me.unreadTotal}</span> : null}
              </a>
              <span className="pf-user"><UserRound size={16} /><b>{isAr ? me.user.nameAr : (me.user.nameEn || me.user.nameAr)}</b></span>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => void store.logout()}><LogOut size={15} /> {t('خروج', 'Sign out')}</button>
            </>
          ) : (
            <>
              <a href="#login" className="btn btn-outline btn-sm"><LogIn size={15} /> {t('دخول', 'Sign in')}</a>
              <a href="#register" className="btn btn-primary btn-sm">{t('حساب جديد', 'Create account')}</a>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export const Footer: React.FC = () => {
  const { t } = usePlatform();
  return (
    <footer className="pf-footer">
      <div className="pf-container" style={{ display: 'flex', gap: 16, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span>© {new Date().getFullYear()} {t('وزارة الصناعة — جمهورية مصر العربية', 'Ministry of Industry — Arab Republic of Egypt')}</span>
        <span>{t('حساب واحد لكل المبادرات · بياناتك تُستخدم مرة واحدة', 'One account for every initiative · your data entered once')}</span>
      </div>
    </footer>
  );
};

export const Loading: React.FC = () => {
  const { t } = usePlatform();
  return <div className="pf-empty">{t('جارٍ التحميل…', 'Loading…')}</div>;
};

export const Alert: React.FC<{ tone: 'ok' | 'err' | 'warn' | 'info'; children: React.ReactNode }> = ({ tone, children }) => (
  <div className={`pf-alert ${tone}`} role={tone === 'err' ? 'alert' : 'status'}>{children}</div>
);

export const SignInRequired: React.FC = () => {
  const { t, hash } = usePlatform();
  return (
    <div className="pf-container pf-page">
      <div className="pf-box pf-auth" style={{ textAlign: 'center' }}>
        <ShieldCheck size={36} />
        <h3 style={{ marginTop: 10 }}>{t('يجب تسجيل الدخول', 'Please sign in')}</h3>
        <p className="pf-muted" style={{ margin: '8px 0 16px' }}>{t('حساب واحد على المنصة يكفيك لكل المبادرات.', 'One platform account works for every initiative.')}</p>
        <button type="button" className="btn btn-primary" onClick={() => { store.rememberReturn(hash); store.go('login'); }}>{t('تسجيل الدخول', 'Sign in')}</button>
      </div>
    </div>
  );
};

export const Forbidden: React.FC = () => {
  const { t } = usePlatform();
  return <div className="pf-container pf-page"><Alert tone="err">{t('ليست لديك صلاحية لهذه الصفحة.', 'You are not allowed to open this page.')}</Alert></div>;
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
