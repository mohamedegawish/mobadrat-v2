import React, { useEffect, useState } from 'react';
import { usePlatformStore } from '../../store/state';
import { usePlatform, store as platform, canManage, canEditContent } from '../../platform/store';
import { api } from '../../platform/api';
import {
  TrendingUp,
  FileText,
  Building2,
  Users,
  ShieldAlert,
  ChevronsRight,
  ChevronsLeft,
  LayoutDashboard,
  Layers,
  Megaphone,
  Mail,
  ClipboardCheck,
} from 'lucide-react';

interface Item {
  id: string;
  /** The platform route the item opens (#admin, #admin-initiative/<id>…). */
  to: string;
  labelAr: string;
  labelEn: string;
  icon: React.ElementType;
  active: boolean;
  badge?: number;
}

const STORAGE_KEY = 'egypt_ind_admin_sidebar_v1';

/** الشريط الجانبي للأدمن — تنقل عمودي مجمع بدل الزحام العلوي */
export const AdminSidebar: React.FC = () => {
  const { language, currentUser, initiatives } = usePlatformStore();
  const { me, view, param } = usePlatform();
  const isAr = language === 'ar';
  const role = me?.user.platformRole ?? '';

  const [mods, setMods] = useState<Awaited<ReturnType<typeof api.adminModules>>['items']>([]);
  useEffect(() => { api.adminModules().then(d => setMods(d.items)).catch(() => undefined); }, []);

  // كل جهة ترى الصفحات المسموحة لدورها فقط — والمجموعة الفارغة تختفي.
  const groups: { titleAr: string; titleEn: string; items: Item[] }[] = [
    {
      titleAr: 'إدارة المبادرات', titleEn: 'Initiatives',
      items: [
        ...(canEditContent(me) ? [{ id: 'admin-catalog', to: 'admin-catalog', labelAr: 'المبادرات', labelEn: 'Initiatives', icon: Layers, active: view === 'admin-catalog', badge: initiatives.length || undefined }] : []),
        { id: 'admin', to: 'admin', labelAr: 'لوحة القيادة', labelEn: 'Dashboard', icon: TrendingUp, active: view === 'admin' },
      ],
    },
    {
      titleAr: 'الطلبات والمراجعة', titleEn: 'Review',
      items: mods.map(m => ({ id: `ini-${m.id}`, to: `admin-initiative/${m.id}`, labelAr: m.titleAr, labelEn: m.titleEn, icon: FileText, active: view === 'admin-initiative' && param === m.id })),
    },
    {
      titleAr: 'واجهة المنصة', titleEn: 'Site content',
      items: canEditContent(me) ? [{ id: 'admin-banners', to: 'admin-banners', labelAr: 'بانرات الرئيسية', labelEn: 'Home banners', icon: Megaphone, active: view === 'admin-banners' }] : [],
    },
    {
      titleAr: 'الجهات والحسابات', titleEn: 'Directory',
      items: [
        ...(role !== 'catalog_manager' ? [{ id: 'admin-bodies', to: 'admin-bodies', labelAr: 'الجهات المسؤولة', labelEn: 'Organizations', icon: Building2, active: view === 'admin-bodies' || view === 'admin-body' }] : []),
        { id: 'admin-users', to: 'admin-users', labelAr: 'حسابات الجهات', labelEn: 'Accounts', icon: Users, active: view === 'admin-users' },
      ],
    },
    {
      titleAr: 'التقارير والتدقيق', titleEn: 'Oversight',
      items: [
        ...(role === 'super_admin' || role === 'auditor' ? [{ id: 'admin-audit', to: 'admin-audit', labelAr: 'سجل التدقيق', labelEn: 'Audit Log', icon: ShieldAlert, active: view === 'admin-audit' }] : []),
        ...(canManage(me) ? [
          { id: 'admin-outbox', to: 'admin-outbox', labelAr: 'سجل الرسائل', labelEn: 'Messages log', icon: Mail, active: view === 'admin-outbox' },
          { id: 'admin-readiness', to: 'admin-readiness', labelAr: 'جاهزية التشغيل', labelEn: 'Readiness', icon: ClipboardCheck, active: view === 'admin-readiness' },
        ] : []),
      ],
    },
  ].filter(g => g.items.length > 0);

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  });

  const toggle = () => {
    setCollapsed(c => {
      try { localStorage.setItem(STORAGE_KEY, c ? '0' : '1'); } catch { /* ignore */ }
      return !c;
    });
  };

  const CollapseIcon = collapsed
    ? (isAr ? ChevronsLeft : ChevronsRight)
    : (isAr ? ChevronsRight : ChevronsLeft);

  return (
    <aside className={`admin-sidebar${collapsed ? ' collapsed' : ''}`} aria-label={isAr ? 'القائمة الجانبية للإدارة' : 'Admin sidebar'}>
      <div className="admin-side-head">
        <span className="admin-side-brand">
          <LayoutDashboard size={16} />
          {!collapsed && <span>{isAr ? 'الإدارة' : 'Admin'}</span>}
        </span>
        <button type="button" className="btn btn-secondary btn-sm admin-side-toggle" onClick={toggle}
          title={collapsed ? (isAr ? 'توسيع' : 'Expand') : (isAr ? 'طي' : 'Collapse')} aria-label={isAr ? 'طي/توسيع القائمة' : 'Collapse/expand'}>
          <CollapseIcon size={14} />
        </button>
      </div>

      {!collapsed && (
        <div className="admin-side-user">
          <span className="admin-side-avatar">{currentUser.avatar || 'AM'}</span>
          <span className="admin-side-user-meta">
            <strong>{isAr ? currentUser.name : currentUser.nameEn}</strong>
            <small>{isAr ? currentUser.roleTitleAr : currentUser.roleTitleEn}</small>
          </span>
        </div>
      )}

      <nav className="admin-side-nav">
        {groups.map(g => (
          <div key={g.titleEn} className="admin-side-group">
            {!collapsed && <div className="admin-side-group-title">{isAr ? g.titleAr : g.titleEn}</div>}
            {g.items.map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`admin-side-item${item.active ? ' active' : ''}`}
                  onClick={() => platform.go(item.to)}
                  title={isAr ? item.labelAr : item.labelEn}
                  aria-current={item.active ? 'page' : undefined}
                >
                  <Icon size={17} />
                  {!collapsed && <span className="admin-side-label">{isAr ? item.labelAr : item.labelEn}</span>}
                  {item.badge !== undefined && (
                    <span className="admin-side-badge">{item.badge}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {!collapsed && (
        <div className="admin-side-foot">
          {isAr ? 'تظهر هنا الصفحات المتاحة لدورك فقط.' : 'Only pages your role can access appear here.'}
        </div>
      )}
    </aside>
  );
};

