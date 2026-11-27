import React, { useState, useEffect, useCallback } from 'react';
import { usePlatformStore, goToWorkspace } from '../../store/state';
import {
  Layers, Globe, Factory, TrendingUp,
  ChevronDown, Search, X, Scale, BarChart3, Home, Bookmark,
  KeyRound, LogOut, LayoutDashboard, UserCheck, LogIn, User
} from 'lucide-react';
import { EgyptianEagle } from '../common/EgyptianEagle';
import { GlobalSearch } from '../common/GlobalSearch';
import { ChangePasswordModal } from '../auth/ChangePasswordModal';
import { AccountNotifications, UnreadBadge } from './HeaderNotifications';

export const HeaderNavbar: React.FC = () => {
  const {
    language, setLanguage, currentUser,
    activeView, navigate, isViewAllowed,
    logout, isLoggedIn,
  } = usePlatformStore();

  const isAr = language === 'ar';
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [showChangePassModal, setShowChangePassModal] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // Navigation — short official labels
  // impact = "الأثر الوطني" ADMIN ONLY — يُفلتر بالأسفل عبر isViewAllowed()
  // فلا يظهر إلا للأدمن (ministry_admin / initiative_manager)
  // my-initiatives للمسجلين فقط — تُفلتر عبر isViewAllowed() فلا تظهر للزائر.
  // صفحات الإدارة السبع تعيش في السايد بار الجانبي (AdminSidebar) —
  // الهيدر العلوي يعرض مدخلاً واحداً «لوحة الإدارة» فقط لتخفيف الزحام.
  const allNavItems = [
    { id: 'home', labelAr: 'الرئيسية', labelEn: 'Home', icon: Home },
    { id: 'initiatives', labelAr: 'المبادرات', labelEn: 'Initiatives', icon: Layers },
    { id: 'my-initiatives', labelAr: 'مبادراتي', labelEn: 'My Initiatives', icon: Bookmark },
    { id: 'compare', labelAr: 'المقارنة', labelEn: 'Compare', icon: Scale },
    { id: 'impact', labelAr: 'الإنجازات', labelEn: 'Achievements', icon: BarChart3 }, // ADMIN ONLY
    // «المصانع» = منشآتي وبياناتي المشتركة (تُستخدم في كل المبادرات) — للحسابات غير الإدارية.
    { id: 'factory-portal', labelAr: 'المصانع', labelEn: 'Factories', icon: Factory },
    { id: 'admin-dashboard', labelAr: 'لوحة الإدارة', labelEn: 'Admin', icon: TrendingUp },
  ];

  const visibleNavItems = allNavItems.filter(item => isViewAllowed(item.id));

  // Active-state يشمل الصفحات الجديدة:
  // home نشطة لـ home/showcase(alias) · initiatives نشطة لـ initiatives/initiative-detail
  const isNavActive = (itemId: string): boolean => {
    if (itemId === 'admin-dashboard') return activeView.startsWith('admin');
    if (itemId === 'home') return activeView === 'home' || activeView === 'showcase';
    if (itemId === 'initiatives') return activeView === 'initiatives' || activeView === 'initiative-detail';
    return activeView === itemId;
  };

  // Keyboard shortcut: Ctrl/Cmd+K opens search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Close mobile nav on resize to desktop
  useEffect(() => {
    const handler = () => { if (window.innerWidth > 992) setShowMobileNav(false); };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const handleNavigate = useCallback((view: string, initId?: string) => {
    navigate(view, initId);
    setShowMobileNav(false);
  }, [navigate]);

  return (
    <>
      <header className="gov-header">
        {/* Top bar */}
        <div className="gov-topbar" style={{ background: '#F8F8F8', borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="container-custom" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0' }}>
            <div className="gov-topbar-title" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <span style={{ fontWeight: 700 }}>{isAr ? 'جمهورية مصر العربية' : 'Arab Republic of Egypt'}</span>
              <span style={{ opacity: 0.5 }}>|</span>
              <span>{isAr ? 'وزارة الصناعة' : 'Ministry of Industry'}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>

              {/* Language Switcher */}
              <button 
                onClick={() => setLanguage(isAr ? 'en' : 'ar')}
                className="btn btn-secondary btn-sm"
                aria-label={isAr ? 'تبديل اللغة إلى الإنجليزية' : 'Switch language to Arabic'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.2rem 0.6rem' }}
              >
                <Globe size={13} />
                <span style={{ fontWeight: 700, fontSize: '0.75rem' }}>{isAr ? 'English' : 'العربية'}</span>
              </button>

              {/* Search Trigger */}
              <button
                onClick={() => setShowSearch(true)}
                className="btn btn-ghost btn-sm"
                title={isAr ? 'بحث (Ctrl+K)' : 'Search (Ctrl+K)'}
                aria-label="Search"
                style={{ padding: '0.35rem 0.5rem' }}
              >
                <Search size={15} />
              </button>

              {/* Mobile Menu Toggle */}
              <button
                className={`mobile-nav-toggle ${showMobileNav ? 'nav-toggle-open' : ''}`}
                onClick={() => setShowMobileNav(v => !v)}
                aria-label={isAr ? 'القائمة' : 'Menu'}
                aria-expanded={showMobileNav}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="7" x2="20" y2="7" className={`toggle-bar bar-top ${showMobileNav ? 'bar-top-open' : ''}`} />
                  <line x1="4" y1="12" x2="20" y2="12" className={`toggle-bar bar-mid ${showMobileNav ? 'bar-mid-open' : ''}`} />
                  <line x1="4" y1="17" x2="20" y2="17" className={`toggle-bar bar-bot ${showMobileNav ? 'bar-bot-open' : ''}`} />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Main Header Bar */}
        <div className="container-custom">
          <div className="header-main">
            {/* Brand Lockup: Ministry Emblem + جمهورية مصر العربية / وزارة الصناعة + منصة المبادرات الصناعية */}
            <div 
              className="gov-brand" 
              onClick={() => (isLoggedIn ? goToWorkspace() : navigate('home'))}
            >
              <div className="gov-brand-cluster">
                <img
                  src="/ministry-industry-logo.png"
                  alt={isAr ? 'شعار وزارة الصناعة' : 'Ministry of Industry logo'}
                  className="gov-brand-img"
                  loading="eager"
                  decoding="async"
                />
                <div className="gov-brand-titles">
                  <span className="gov-brand-sub">
                    {isAr ? 'جمهورية مصر العربية' : 'Arab Republic of Egypt'}
                  </span>
                  <span className="gov-brand-sub">
                    {isAr ? 'وزارة الصناعة' : 'Ministry of Industry'}
                  </span>
                </div>
              </div>

              <div className="gov-brand-main-title">
                {isAr ? 'منصة المبادرات الصناعية' : 'Industrial Initiatives Platform'}
              </div>
            </div>

            {/* Desktop Navigation Links */}
            <nav className="nav-links">
              {visibleNavItems.map(item => {
                const Icon = item.icon;
                const isActive = isNavActive(item.id);
                return (
                  <button 
                    key={item.id}
                    className={`nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => handleNavigate(item.id)}
                  >
                    <Icon size={16} />
                    <span>{isAr ? item.labelAr : item.labelEn}</span>
                  </button>
                );
              })}
            </nav>

            {/* Unified User Account Button & Popover Menu */}
            <div style={{ position: 'relative' }}>
              {!isLoggedIn || currentUser.id === 'guest' ? (
                <button
                  onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                  className="btn btn-secondary header-account-btn"
                  title={isAr ? 'تسجيل الدخول للمنصة' : 'Sign in to platform'}
                  data-testid="account-menu"
                >
                  <span className="header-account-icon">
                    <User size={16} />
                  </span>
                  <div style={{ textAlign: isAr ? 'right' : 'left' }}>
                    <div className="account-btn-main" style={{ fontSize: '0.825rem', fontWeight: 800, color: 'var(--egypt-red)', lineHeight: 1.2 }}>
                      {isAr ? 'تسجيل الدخول' : 'Sign In'}
                    </div>
                    <div className="account-btn-sub" style={{ fontSize: '0.68rem', color: '#64748B', fontWeight: 600 }}>
                      {isAr ? 'منشأة صناعية / جهة' : 'Factory / Official'}
                    </div>
                  </div>
                  <ChevronDown size={14} style={{ opacity: 0.6, marginInlineStart: '0.2rem' }} />
                </button>
              ) : (
                <button 
                  onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                  className="btn btn-secondary header-account-btn"
                  title={isAr ? 'الملف الشخصي والحساب' : 'Profile & Account'}
                  data-testid="account-menu"
                >
                  <span className="header-account-avatar">
                    {currentUser.avatar || 'AM'}
                    {/* عداد الإشعارات غير المقروءة */}
                    <UnreadBadge />
                    <span style={{
                      position: 'absolute',
                      bottom: '-1px',
                      right: '-1px',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#10B981',
                      border: '1.5px solid #FFFFFF'
                    }} />
                  </span>
                  <div style={{ textAlign: isAr ? 'right' : 'left' }}>
                    <div className="account-btn-main" style={{ fontSize: '0.825rem', fontWeight: 700, color: '#101828', lineHeight: 1.2 }}>
                      {isAr ? currentUser.name : currentUser.nameEn}
                    </div>
                    <div className="account-btn-sub" style={{ fontSize: '0.7rem', color: '#667085', fontWeight: 500 }}>
                      {isAr ? currentUser.organizationNameAr : currentUser.organizationNameEn}
                    </div>
                  </div>
                  <ChevronDown size={14} style={{ opacity: 0.6, marginInlineStart: '0.25rem' }} />
                </button>
              )}

              {/* Popover Dropdown (Guest or Logged In) */}
              {showRoleDropdown && (
                <div 
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    left: isAr ? '0' : 'auto',
                    right: isAr ? 'auto' : '0',
                    background: '#FFFFFF',
                    border: '1px solid #EAECF0',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                    minWidth: '290px',
                    zIndex: 200,
                    overflow: 'hidden',
                  }}
                >
                  {!isLoggedIn || currentUser.id === 'guest' ? (
                    // Guest / Login Options
                    <div>
                      <div style={{ padding: '1rem', background: '#F8FAFC', borderBottom: '1px solid #EAECF0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
                          <span style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#F1F5F9', color: '#475569', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #E2E8F0' }}>
                            <User size={18} />
                          </span>
                          <div>
                            <div style={{ fontSize: '0.875rem', fontWeight: 800, color: '#101828' }}>
                              {isAr ? 'حساب زائر — غير مسجل' : 'Guest — Not signed in'}
                            </div>
                            <div style={{ fontSize: '0.725rem', color: '#64748B' }}>
                              {isAr ? 'سجل الدخول للوصول لكافة الصلاحيات' : 'Sign in to access your dashboard'}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div style={{ padding: '0.5rem' }}>
                        <button
                          onClick={() => {
                            setShowRoleDropdown(false);
                            handleNavigate('login');
                          }}
                          style={{
                            width: '100%',
                            padding: '0.7rem 0.85rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.65rem',
                            color: '#FFFFFF',
                            background: 'var(--egypt-red)',
                            borderRadius: 'var(--radius-md)',
                            border: 'none',
                            fontSize: '0.825rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            textAlign: isAr ? 'right' : 'left',
                            marginBottom: '0.35rem',
                          }}
                        >
                          <LogIn size={16} />
                          <span>{isAr ? 'تسجيل الدخول للمنصة' : 'Sign In to Platform'}</span>
                        </button>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <button
                            onClick={() => {
                              setShowRoleDropdown(false);
                              handleNavigate('login');
                            }}
                            style={{
                              width: '100%',
                              padding: '0.55rem 0.85rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.6rem',
                              color: '#334155',
                              borderRadius: 'var(--radius-md)',
                              border: 'none',
                              background: 'transparent',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              textAlign: isAr ? 'right' : 'left',
                            }}
                          >
                            <Factory size={15} style={{ color: '#0E6B65' }} />
                            <span>{isAr ? 'بوابة المنشآت والمصانع' : 'Factory Portal'}</span>
                          </button>

                          <button
                            onClick={() => {
                              setShowRoleDropdown(false);
                              handleNavigate('login');
                            }}
                            style={{
                              width: '100%',
                              padding: '0.55rem 0.85rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.6rem',
                              color: '#334155',
                              borderRadius: 'var(--radius-md)',
                              border: 'none',
                              background: 'transparent',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              textAlign: isAr ? 'right' : 'left',
                            }}
                          >
                            <UserCheck size={15} style={{ color: '#1E40AF' }} />
                            <span>{isAr ? 'بوابة مسؤولي ومراجعي الجهات' : 'Official Portal'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    // Authenticated User Menu
                    <div>
                      <div style={{ padding: '1rem', background: '#F8FAFC', borderBottom: '1px solid #EAECF0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                          <span style={{ width: '38px', height: '38px', borderRadius: '50%', background: '#0F172A', color: '#FFFFFF', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.825rem', fontWeight: 800 }}>
                            {currentUser.avatar || 'AM'}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.875rem', fontWeight: 800, color: '#101828', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {isAr ? currentUser.name : currentUser.nameEn}
                            </div>
                            <div style={{ fontSize: '0.725rem', color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'ltr', textAlign: isAr ? 'right' : 'left' }}>
                              {currentUser.email}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '4px', background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #DBEAFE' }}>
                            {isAr ? currentUser.roleTitleAr : currentUser.roleTitleEn}
                          </span>
                          {currentUser.organizationNameAr && (
                            <span style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 600 }}>
                              {isAr ? currentUser.organizationNameAr : currentUser.organizationNameEn}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* الإشعارات: آخر رسائل مركز المراسلات غير المقروءة (للمسؤولين والجهات فقط) */}
                      <AccountNotifications onNavigate={() => setShowRoleDropdown(false)} />

                      {/* Actions */}
                      <div style={{ padding: '0.4rem' }}>
                        <button
                          onClick={() => {
                            setShowRoleDropdown(false);
                            setShowMobileNav(false);
                            goToWorkspace();
                          }}
                          style={{
                            width: '100%',
                            padding: '0.6rem 0.85rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.6rem',
                            color: '#101828',
                            borderRadius: 'var(--radius-md)',
                            border: 'none',
                            background: 'transparent',
                            fontSize: '0.825rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            textAlign: isAr ? 'right' : 'left',
                          }}
                        >
                          <LayoutDashboard size={15} style={{ color: '#475569' }} />
                          <span>{isAr ? 'مساحة العمل / لوحة التحكم' : 'My Workspace'}</span>
                        </button>

                        <button
                          onClick={() => {
                            setShowRoleDropdown(false);
                            setShowChangePassModal(true);
                          }}
                          style={{
                            width: '100%',
                            padding: '0.6rem 0.85rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.6rem',
                            color: '#101828',
                            borderRadius: 'var(--radius-md)',
                            border: 'none',
                            background: 'transparent',
                            fontSize: '0.825rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            textAlign: isAr ? 'right' : 'left',
                          }}
                        >
                          <KeyRound size={15} style={{ color: 'var(--egypt-red)' }} />
                          <span>{isAr ? 'تغيير كلمة المرور' : 'Change Password'}</span>
                        </button>

                        <div style={{ height: '1px', background: '#F1F5F9', margin: '0.35rem 0' }} />

                        <button
                          onClick={() => {
                            setShowRoleDropdown(false);
                            logout();
                          }}
                          style={{
                            width: '100%',
                            padding: '0.6rem 0.85rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.6rem',
                            color: '#DC2626',
                            borderRadius: 'var(--radius-md)',
                            border: 'none',
                            background: '#FEF2F2',
                            fontSize: '0.825rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            textAlign: isAr ? 'right' : 'left',
                          }}
                        >
                          <LogOut size={15} />
                          <span>{isAr ? 'تسجيل الخروج من الحساب' : 'Logout'}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Navigation Overlay */}
      {showMobileNav && (
        <div className={`mobile-nav-overlay ${showMobileNav ? 'open' : ''}`} onClick={() => setShowMobileNav(false)}>
          <div
            className={`mobile-nav-panel ${showMobileNav ? 'open' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={isAr ? 'القائمة الرئيسية' : 'Main Menu'}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3px' }}>
                  <EgyptianEagle size={22} />
                </div>
                <span style={{ color: 'var(--text-main)', fontWeight: 700, fontSize: '0.85rem' }}>
                  {isAr ? 'القائمة الرئيسية' : 'Main Menu'}
                </span>
              </div>
              <button onClick={() => setShowMobileNav(false)} style={{ color: 'var(--text-muted)', background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)', cursor: 'pointer', borderRadius: 'var(--radius-sm)', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={16} />
              </button>
            </div>

            {visibleNavItems.map(item => {
              const Icon = item.icon;
              const isActive = isNavActive(item.id);
              return (
                <button
                  key={item.id}
                  className={`mobile-nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => handleNavigate(item.id)}
                >
                  <Icon size={16} />
                  <span>{isAr ? item.labelAr : item.labelEn}</span>
                </button>
              );
            })}

            <div className="mobile-nav-footer" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button onClick={() => handleNavigate('login')} className="mobile-nav-item">
                <span>{isAr ? 'تسجيل الدخول' : 'Login'}</span>
              </button>
              <button onClick={() => { setShowMobileNav(false); logout(); }} className="mobile-nav-item">
                <span>{isAr ? 'تسجيل الخروج' : 'Logout'}</span>
              </button>
              <button
                onClick={() => { setShowMobileNav(false); if (isLoggedIn) goToWorkspace(); else navigate('home'); }}
                className="mobile-nav-item"
              >
                <span>{isAr ? 'العودة للبداية' : 'Back to Start'}</span>
              </button>
              <button
                onClick={() => setLanguage(isAr ? 'en' : 'ar')}
                className="mobile-nav-item"
              >
                <Globe size={16} />
                <span>{isAr ? 'English / العربية' : 'Switch Language'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Search Modal */}
      {showSearch && (
        <GlobalSearch
          onNavigate={(view, initId) => handleNavigate(view, initId)}
          onClose={() => setShowSearch(false)}
        />
      )}

      {/* Change Password Modal */}
      {showChangePassModal && (
        <ChangePasswordModal
          isOpen={showChangePassModal}
          user={currentUser}
          onClose={() => setShowChangePassModal(false)}
        />
      )}
    </>
  );
};
