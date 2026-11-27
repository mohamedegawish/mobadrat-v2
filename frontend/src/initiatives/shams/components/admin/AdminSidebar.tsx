import React, { useState } from 'react';
import { Building2, LayoutDashboard, ChevronsLeft, ChevronsRight, FileClock, KeyRound, Mail, ShieldCheck, Users } from 'lucide-react';
import { useStore, canView, workspaceHash, type View } from '../../store/state';

interface Item { view: View; ar: string; en: string; icon: React.ReactNode }
interface Group { ar: string; en: string; items: Item[] }

const GROUPS: Group[] = [
  { ar: 'الطلبات', en: 'Applications', items: [
    { view: 'approvals', ar: 'الموافقات', en: 'Approvals', icon: <ShieldCheck size={17} /> },
  ] },
  { ar: 'إدارة النظام', en: 'Administration', items: [
    { view: 'admin-accounts', ar: 'الحسابات', en: 'Accounts', icon: <Users size={17} /> },
    { view: 'admin-organizations', ar: 'الجهات والبنوك', en: 'Organizations & banks', icon: <Building2 size={17} /> },
    { view: 'admin-audit', ar: 'سجل التدقيق', en: 'Audit log', icon: <FileClock size={17} /> },
    { view: 'admin-integration', ar: 'مفاتيح الربط', en: 'Integration keys', icon: <KeyRound size={17} /> },
    { view: 'admin-outbox', ar: 'سجل الإشعارات', en: 'Notification log', icon: <Mail size={17} /> },
  ] },
];

const KEY = 'shams_sidebar_collapsed';

export const AdminSidebar: React.FC = () => {
  const { isAr, t, user, view, store } = useStore();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } });
  const toggle = () => { const v = !collapsed; setCollapsed(v); try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ } };
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canView(i.view, user)) })).filter((g) => g.items.length);
  const Chevron = (isAr ? !collapsed : collapsed) ? ChevronsRight : ChevronsLeft;

  return (
    <aside className={`admin-sidebar${collapsed ? ' collapsed' : ''}`} aria-label={t('قائمة مساحة العمل', 'Workspace menu')}>
      <div className="admin-side-head">
        {!collapsed ? (
          <div className="admin-side-brand">
            {/* موظفو IMC يرون شعار جهتهم أعلى مساحة العمل */}
            {user?.role === 'imc_reviewer' ? <img src="/imc-logo.png" alt={t('شعار مركز تحديث الصناعة (IMC)', 'Industrial Modernisation Centre (IMC) logo')} className="admin-side-org-logo" width={38} height={34} data-testid="sidebar-imc-logo" /> : null}
            <span>{t('مساحة العمل', 'Workspace')}</span>
          </div>
        ) : null}
        <button type="button" className="admin-side-toggle" onClick={toggle} aria-label={t('طي القائمة', 'Collapse menu')}><Chevron size={16} /></button>
      </div>
      <nav className="admin-side-nav">
        {/* The role's dashboard is the platform's: one page per user type for every initiative. */}
        {user && workspaceHash(user.role) ? (
          <div className="admin-side-group">
            <a href={`#${workspaceHash(user.role)}`} className="admin-side-item" title={t('لوحتي', 'My dashboard')} data-testid="side-workspace" style={{ textDecoration: 'none' }}>
              <LayoutDashboard size={17} />{!collapsed ? <span className="admin-side-label">{t('لوحتي', 'My dashboard')}</span> : null}
            </a>
          </div>
        ) : null}
        {groups.map((g) => (
          <div key={g.en} className="admin-side-group">
            {!collapsed ? <div className="admin-side-group-title">{isAr ? g.ar : g.en}</div> : null}
            {g.items.map((i) => (
              <button key={i.view} type="button" className={`admin-side-item${view === i.view ? ' active' : ''}`} onClick={() => store.navigate(i.view)} title={isAr ? i.ar : i.en}>
                {i.icon}{!collapsed ? <span className="admin-side-label">{isAr ? i.ar : i.en}</span> : null}
              </button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
};
