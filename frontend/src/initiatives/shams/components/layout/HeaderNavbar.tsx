import React, { useState } from 'react';
import { Globe, LayoutDashboard, ListChecks, LogIn, LogOut, Menu, KeyRound, Sun, UserPlus, X, Home, Activity } from 'lucide-react';
import { useStore, canView, isRestrictedFactory, type View } from '../../store/state';
import { EgyptianEagle } from '../common/EgyptianEagle';
import { ChangePasswordModal } from '../auth/ChangePasswordModal';
import { NotificationBell } from '../common/NotificationBell';
import { SITE_NAME, MINISTRY } from '../../content/shams';

interface NavItem { view: View; ar: string; en: string; icon: React.ReactNode }

const NAV: NavItem[] = [
  { view: 'home', ar: 'عن المبادرة', en: 'About', icon: <Home size={15} /> },
  { view: 'factory-dashboard', ar: 'لوحتي', en: 'My dashboard', icon: <LayoutDashboard size={15} /> },
  { view: 'pmu-monitor', ar: 'المتابعة', en: 'Monitoring', icon: <Activity size={15} /> },
  { view: 'dashboard', ar: 'اللوحة', en: 'Dashboard', icon: <LayoutDashboard size={15} /> },
  { view: 'work-queue', ar: 'قائمة العمل', en: 'Work queue', icon: <ListChecks size={15} /> },
  { view: 'login', ar: 'تسجيل الدخول', en: 'Sign in', icon: <LogIn size={15} /> },
  { view: 'register', ar: 'تسجيل مصنع', en: 'Register a factory', icon: <UserPlus size={15} /> },
];

export const HeaderNavbar: React.FC = () => {
  const { isAr, t, user, view, meta, store } = useStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const items = NAV.filter((n) => canView(n.view, user));
  const roleLabel = user && meta ? (isAr ? meta.roles[user.role].ar : meta.roles[user.role].en) : '';

  const go = (v: View) => { setMobileOpen(false); store.navigate(v); };

  return (
    <header className="gov-header">
      <div style={{ background: 'var(--gov-primary-950, #142A4A)', color: '#E2E8F0', fontSize: '0.74rem' }}>
        <div className="container-custom" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.3rem 1rem', gap: '0.6rem' }}>
          <span>{isAr ? MINISTRY.ar : MINISTRY.en}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm lang-toggle"
            style={{ color: '#E2E8F0', padding: '0.15rem 0.55rem' }}
            onClick={() => store.setLanguage(isAr ? 'en' : 'ar')}
            aria-label={t('تبديل اللغة إلى الإنجليزية', 'Switch language to Arabic')}
          >
            <Globe size={13} /> {isAr ? 'English' : 'العربية'}
          </button>
        </div>
      </div>
      <div className="container-custom">
        <div className="header-main">
          <div className="gov-brand" role="link" tabIndex={0} onClick={() => store.goHome()} onKeyDown={(e) => { if (e.key === 'Enter') store.goHome(); }}>
            <img src="/ministry-industry-logo.png" alt={t('شعار وزارة الصناعة', 'Ministry of Industry logo')} width={42} height={42} className="ministry-emblem" style={{ borderRadius: 10 }} />
            <div className="gov-emblem"><EgyptianEagle size={26} /></div>
            <div>
              <div className="gov-brand-title"><Sun size={15} style={{ color: 'var(--egypt-red)', verticalAlign: '-2px', marginInlineEnd: 4 }} />{isAr ? `مبادرة ${SITE_NAME.ar}` : `${SITE_NAME.en} Initiative`}</div>
              <div className="gov-brand-sub">{t('الطاقة الشمسية للاستهلاك الذاتي في القطاع الصناعي', 'Self-consumption solar for industry')}</div>
            </div>
          </div>

          <nav className="nav-links" aria-label={t('التنقل الرئيسي', 'Main navigation')} style={{ display: 'flex' }}>
            <div className="nav-desktop" style={{ display: 'flex', gap: '0.28rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {items.map((n) => (
                <button key={n.view} type="button" className={`nav-item${view === n.view ? ' active' : ''}`} onClick={() => go(n.view)}>
                  {n.icon}{isAr ? n.ar : n.en}
                </button>
              ))}
              {user ? (
                <>
                  {!isRestrictedFactory(user) ? <NotificationBell /> : null}
                  <span className="nav-item" style={{ cursor: 'default', background: 'var(--bg-muted)' }} title={user.email}>
                    {isAr ? user.nameAr : (user.nameEn || user.nameAr)}{roleLabel ? ` · ${roleLabel}` : ''}
                  </span>
                  <button type="button" className="nav-item" onClick={() => setPwOpen(true)} aria-label={t('تغيير كلمة المرور', 'Change password')}><KeyRound size={15} /></button>
                  <button type="button" className="nav-item" onClick={() => void store.logout()} data-testid="logout"><LogOut size={15} />{t('خروج', 'Sign out')}</button>
                </>
              ) : null}
            </div>
            <button type="button" className="mobile-nav-toggle" onClick={() => setMobileOpen(true)} aria-label={t('القائمة', 'Menu')}><Menu size={20} /></button>
          </nav>
          {/* شعار IMC في أقصى الطرف المقابل لشعارات الدولة (يسار الهيدر في العربية) */}
          <img src="/imc-logo.png" alt={t('شعار مركز تحديث الصناعة (IMC)', 'Industrial Modernisation Centre (IMC) logo')} width={47} height={42} className="imc-emblem" />
        </div>
      </div>

      {mobileOpen ? (
        <>
          <div className="mobile-nav-overlay" style={{ display: 'block' }} onClick={() => setMobileOpen(false)} />
          <div className="mobile-nav-panel" style={{ display: 'flex' }} role="dialog" aria-modal="true">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMobileOpen(false)} aria-label={t('إغلاق', 'Close')} style={{ alignSelf: 'flex-end' }}><X size={18} /></button>
            {items.map((n) => (
              <button key={n.view} type="button" className={`mobile-nav-item${view === n.view ? ' active' : ''}`} onClick={() => go(n.view)}>
                {n.icon}{isAr ? n.ar : n.en}
              </button>
            ))}
            {user && !isRestrictedFactory(user) ? <NotificationBell className={`mobile-nav-item`} onNavigate={() => setMobileOpen(false)} /> : null}
            {user ? (
              <div className="mobile-nav-footer">
                <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>{user.nameAr}</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{roleLabel}</div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setMobileOpen(false); setPwOpen(true); }}>{t('تغيير كلمة المرور', 'Change password')}</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => void store.logout()}>{t('خروج', 'Sign out')}</button>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {user && (pwOpen || user.mustChangePassword) ? (
        <ChangePasswordModal isForced={user.mustChangePassword} onClose={() => setPwOpen(false)} />
      ) : null}
    </header>
  );
};
