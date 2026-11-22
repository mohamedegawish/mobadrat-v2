import React, { useState } from 'react';
import { Activity, Building2, Gauge, LayoutDashboard, ChevronsLeft, ChevronsRight, FileClock, KeyRound, ListChecks, Mail, ShieldCheck, Users, Wrench } from 'lucide-react';
import { useStore, canView, type View } from '../../store/state';

interface Item { view: View; ar: string; en: string; icon: React.ReactNode }
interface Group { ar: string; en: string; items: Item[] }

const GROUPS: Group[] = [
  { ar: 'الطلبات', en: 'Applications', items: [
    { view: 'dashboard', ar: 'اللوحة', en: 'Dashboard', icon: <LayoutDashboard size={17} /> },
    { view: 'work-queue', ar: 'قائمة العمل', en: 'Work queue', icon: <ListChecks size={17} /> },
    { view: 'pmu-monitor', ar: 'المتابعة والتقارير', en: 'Monitoring & reports', icon: <Activity size={17} /> },
    { view: 'providers', ar: 'مقدمو الخدمة', en: 'Service providers', icon: <Wrench size={17} /> },
    { view: 'approvals', ar: 'الموافقات', en: 'Approvals', icon: <ShieldCheck size={17} /> },
  ] },
  { ar: 'إدارة النظام', en: 'Administration', items: [
    { view: 'admin-dashboard', ar: 'الجاهزية والتشغيل', en: 'Readiness & operations', icon: <Gauge size={17} /> },
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
  /** الدليل نفسه بعنوانين: ENCPC «إدارة مقدمي الخدمة» وPMU «اعتماد مقدمي الخدمة». */
  const label = (i: Item) => (i.view === 'providers' && user?.role === 'encpc_reviewer' ? t('إدارة مقدمي الخدمة', 'Manage service providers')
    : i.view === 'providers' ? t('اعتماد مقدمي الخدمة', 'Approve service providers') : isAr ? i.ar : i.en);
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
        {groups.map((g) => (
          <div key={g.en} className="admin-side-group">
            {!collapsed ? <div className="admin-side-group-title">{isAr ? g.ar : g.en}</div> : null}
            {g.items.map((i) => (
              <button key={i.view} type="button" className={`admin-side-item${view === i.view ? ' active' : ''}`} onClick={() => store.navigate(i.view)} title={label(i)}>
                {i.icon}{!collapsed ? <span className="admin-side-label">{label(i)}</span> : null}
              </button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
};
