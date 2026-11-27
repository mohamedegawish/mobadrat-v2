/**
 * One dashboard per user type, for every initiative together (#workspace/<type>): IMC in Shams and in Sona3 is one «لوحة
 * IMC». Fixed key figures on top (summed, with each initiative's share), each initiative's stage cards, then tabs: awaiting
 * my decision · all applications · overdue · monitoring (and readiness for the system admin). Decisions and tool screens
 * stay in each initiative (a row opens its application page there). Data: GET /me/workspace/<type>.
 */
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  AlertTriangle, BarChart3, Bell, CheckCircle2, ChevronsLeft, ChevronsRight, ClipboardCheck, Clock, Gavel, Globe, Inbox, Layers,
  LayoutDashboard, ListChecks, RefreshCw, Search, Wrench, XCircle,
} from 'lucide-react';
import {
  api, errText, type Me, type ModuleWorkspace, type UserType, type Workspace, type WorkspaceInitiative, type WorkspaceLink,
  type WorkspaceRow, type WorkspaceTab, type WorkspaceBlock,
} from '../api';
import { usePlatform, store } from '../store';
import { Loading } from '../layout';
import { formatEGP } from '../../utils/format';
import { setShellLang } from '../../core/shell';

// ── user types ──────────────────────────────────────────────────────────

export const TYPE_ORDER: UserType[] = ['imc', 'pmu', 'encpc', 'electricity', 'funder', 'evaluator', 'system_admin'];

export const TYPE_TEXT: Record<UserType, { ar: string; en: string; shortAr: string; shortEn: string; subAr: string; subEn: string }> = {
  imc: {
    ar: 'لوحة مركز تحديث الصناعة (IMC)', en: 'Industrial Modernisation Centre (IMC) dashboard', shortAr: 'لوحة IMC', shortEn: 'IMC dashboard',
    subAr: 'ما ينتظر قرارك في كل المبادرات، وما عاد إلى المتقدمين للاستيفاء، ومتابعة كل مبادرة — في صفحة واحدة.',
    subEn: 'What awaits your decision in every initiative, what went back to applicants, and each initiative\'s follow-up — on one page.',
  },
  pmu: {
    ar: 'لوحة وحدة إدارة المبادرة (PMU)', en: 'Initiative management unit (PMU) dashboard', shortAr: 'لوحة PMU', shortEn: 'PMU dashboard',
    subAr: 'المراحل، وما ينتظر قرارك، وما يحتاج انتباهًا، وآخر النشاط في دورة العمل.', subEn: 'Stages, what awaits your decision, what needs attention and the latest activity.',
  },
  encpc: {
    ar: 'لوحة المراجعة الفنية (ENCPC)', en: 'Technical review (ENCPC) dashboard', shortAr: 'لوحة ENCPC', shortEn: 'ENCPC dashboard',
    subAr: 'الملفات الفنية بانتظار قرارك، وما عاد للمصانع للرد على الرفض الفني.', subEn: 'Technical files awaiting your decision and rejections the factories are answering.',
  },
  electricity: {
    ar: 'بوابة وزارة الكهرباء', en: 'Ministry of Electricity portal', shortAr: 'بوابة الكهرباء', shortEn: 'Electricity portal',
    subAr: 'العروض الفنية المعتمدة بانتظار قرارك: اطّلع على الطلب كاملًا ثم ارفع الموافقة أو ارفض بملاحظات.', subEn: 'Accepted technical offers awaiting your decision: review the application, then upload the approval or reject with notes.',
  },
  funder: {
    ar: 'لوحة جهة التمويل', en: 'Funder dashboard', shortAr: 'لوحة التمويل', shortEn: 'Funder dashboard',
    subAr: 'المشروعات المحالة إليك، وما ينتظر قرارك، ومتابعة التنفيذ والصرف.', subEn: 'Projects referred to you, what awaits your decision, and delivery follow-up.',
  },
  evaluator: {
    ar: 'لوحة المقيّم', en: 'Evaluator dashboard', shortAr: 'لوحة التقييم', shortEn: 'Evaluation dashboard',
    subAr: 'الدراسات المسندة إليك في لجنة التقييم — افتح الطلب لإقرار تضارب المصالح ثم التقييم.', subEn: 'Studies assigned to you on the evaluation committee — open one to declare conflicts and score it.',
  },
  system_admin: {
    ar: 'إدارة المبادرات', en: 'Initiatives administration', shortAr: 'إدارة المبادرات', shortEn: 'Administration',
    subAr: 'جاهزية التشغيل، وكل الطلبات (اطلاع فقط)، والمتابعة، وأدوات الإدارة لكل مبادرة.', subEn: 'Operating readiness, every application (read-only), monitoring and each initiative\'s administration tools.',
  },
};

/** The dashboards of the signed-in person (a platform super admin is the system admin of every initiative). */
export function workspaceTypesOf(me: Me | null): UserType[] {
  if (!me) return [];
  const set = new Set<UserType>();
  for (const m of me.memberships) if (m.userType && m.status === 'active' && m.access?.status !== 'blocked') set.add(m.userType);
  if (me.adminEntries?.length) set.add('system_admin');
  return TYPE_ORDER.filter((t) => set.has(t));
}

// ── the page's URL: #workspace/<type>?i=&tab=&state=&q=&page=&sort=&from=&to=&<module filters> ──

interface WsQuery { i: string; tab: string; state: string; q: string; page: number; sort: string; from: string; to: string; f: Record<string, string> }
const KNOWN = new Set(['i', 'tab', 'state', 'q', 'page', 'sort', 'from', 'to']);

function readQuery(q: URLSearchParams): WsQuery {
  const f: Record<string, string> = {};
  q.forEach((v, k) => { if (!KNOWN.has(k) && /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k) && v) f[k] = v; });
  return { i: q.get('i') ?? '', tab: q.get('tab') ?? '', state: q.get('state') ?? '', q: q.get('q') ?? '', page: Math.max(1, Number(q.get('page')) || 1), sort: q.get('sort') ?? '', from: q.get('from') ?? '', to: q.get('to') ?? '', f };
}

function currentQuery(): URLSearchParams {
  const raw = decodeURIComponent(window.location.hash.replace(/^#\/?/, ''));
  return new URLSearchParams(raw.split('?')[1] ?? '');
}

function toHash(base: string, q: WsQuery): string {
  const p = new URLSearchParams();
  if (q.i) p.set('i', q.i);
  if (q.tab) p.set('tab', q.tab);
  if (q.state) p.set('state', q.state);
  if (q.q) p.set('q', q.q);
  if (q.page > 1) p.set('page', String(q.page));
  if (q.sort) p.set('sort', q.sort);
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  for (const [k, v] of Object.entries(q.f)) if (v) p.set(k, v);
  const s = p.toString();
  return `${base}${s ? `?${s}` : ''}`;
}

/** The link of a card or an attention line of one initiative. */
export function workspaceHref(type: UserType, initiativeId: string, l: WorkspaceLink): string {
  if (l.view) return `i/${initiativeId}/${l.view}`;
  return toHash(`workspace/${type}`, { i: initiativeId, tab: l.tab ?? 'all', state: l.state ?? '', q: '', page: 1, sort: '', from: '', to: '', f: {} });
}

// ── small pieces ────────────────────────────────────────────────────────

const num = (n: number | null | undefined, isAr: boolean) => (n ?? 0).toLocaleString(isAr ? 'ar-EG' : 'en-US');
const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
const dayEnd = (d: string) => (d ? new Date(`${d}T23:59:59`).toISOString() : undefined);
const fmtDate = (iso: string, isAr: boolean, time = false) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return time ? d.toLocaleString(isAr ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString(isAr ? 'ar-EG' : 'en-GB', { dateStyle: 'medium' });
};
type OkPart = WorkspaceInitiative & { ok: true; data: ModuleWorkspace };

const TONE_LABEL: Record<string, [string, string]> = {
  pending: ['قيد المراجعة', 'In review'], correction: ['بانتظار المتقدم', 'With the applicant'], approved: ['مقبول', 'Accepted'], rejected: ['مرفوض', 'Rejected'],
  completed: ['مكتمل', 'Completed'], closed: ['مغلق', 'Closed'], info: ['جارٍ', 'In progress'],
};

/** Where each failed readiness check is fixed (a screen of the initiative). */
const FIX: Record<string, { view: string; ar: string; en: string }> = {
  orgs_without_users: { view: 'admin-accounts', ar: 'إضافة حساب', en: 'Add an account' },
  banks_available: { view: 'admin-organizations', ar: 'الجهات والبنوك', en: 'Organizations & banks' },
  funders_available: { view: 'admin-organizations', ar: 'جهات التمويل', en: 'Funders' },
  open_cohort: { view: 'admin-cohorts', ar: 'الدورات', en: 'Cohorts' },
  failed_notifications: { view: 'admin-outbox', ar: 'سجل الإشعارات', en: 'Notifications log' },
};

const ToolIcon: React.FC<{ view: string }> = ({ view }) => {
  if (view === 'approvals' || view === 'appeals') return <Gavel size={16} />;
  if (view === 'ranking') return <BarChart3 size={16} />;
  if (view.startsWith('admin-')) return <Layers size={16} />;
  return <ListChecks size={16} />;
};

/**
 * The notifications of the dashboard's initiatives: one initiative → its inbox; several → the platform inbox (every
 * initiative). The count is the person's unread messages of those initiatives (/me, reloaded when the page opens).
 */
const WorkspaceBell: React.FC<{ initiativeIds: string[] }> = ({ initiativeIds }) => {
  const { me, isAr, t } = usePlatform();
  const unread = (me?.memberships ?? []).filter((m) => initiativeIds.includes(m.initiativeId)).reduce((sum, m) => sum + (m.unread || 0), 0);
  const href = initiativeIds.length === 1 ? `#i/${initiativeIds[0]}/notifications` : '#notifications';
  return (
    <a href={href} className="btn btn-secondary btn-sm ws-bell" aria-label={unread ? t(`الإشعارات (${unread} غير مقروء)`, `Notifications (${unread} unread)`) : t('الإشعارات', 'Notifications')} data-testid="bell">
      <Bell size={15} /> {t('الإشعارات', 'Notifications')}
      {unread ? <span className="ws-bell-badge" data-testid="bell-badge">{unread > 99 ? '99+' : num(unread, isAr)}</span> : null}
    </a>
  );
};

// ── the sidebar of the staff workspace ──────────────────────────────────

const SIDEBAR_KEY = 'mobadrat_ws_sidebar_v1';

const WorkspaceSidebar: React.FC<{ type: UserType; types: UserType[]; parts: OkPart[]; onDashboard?: boolean }> = ({ type, types, parts, onDashboard = true }) => {
  const { isAr, t, me } = usePlatform();
  const hash = useSyncExternalStore((cb) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); }, () => window.location.hash);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; } });
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem(SIDEBAR_KEY, c ? '0' : '1'); } catch { /* private mode */ } return !c; });
  const Collapse = collapsed ? (isAr ? ChevronsLeft : ChevronsRight) : (isAr ? ChevronsRight : ChevronsLeft);
  const name = me ? (isAr ? me.user.nameAr : me.user.nameEn || me.user.nameAr) : '';
  const roles = [...new Set(parts.map((p) => (isAr ? p.roleLabelAr : p.roleLabelEn)))].join(' · ');
  const tools = parts.filter((p) => p.data.tools.length);
  const hasApplicant = Boolean(me?.memberships.some((m) => !m.userType));
  const Item: React.FC<{ href: string; label: string; icon: React.ReactNode; active?: boolean; sub?: string }> = ({ href, label, icon, active, sub }) => (
    <a href={`#${href}`} className={`admin-side-item${active ? ' active' : ''}`} title={label} aria-current={active ? 'page' : undefined}>
      {icon}{!collapsed && <span className="admin-side-label">{label}{sub ? <small className="ws-side-sub">{sub}</small> : null}</span>}
    </a>
  );
  return (
    <aside className={`admin-sidebar${collapsed ? ' collapsed' : ''}`} aria-label={t('قائمة مساحة العمل', 'Workspace menu')} data-testid="workspace-sidebar">
      <div className="admin-side-head">
        <span className="admin-side-brand"><LayoutDashboard size={16} />{!collapsed && <span>{t('مساحة العمل', 'Workspace')}</span>}</span>
        <button type="button" className="btn btn-secondary btn-sm admin-side-toggle" onClick={toggle} aria-label={t('طي/توسيع القائمة', 'Collapse/expand')}><Collapse size={14} /></button>
      </div>
      {!collapsed && name ? (
        <div className="admin-side-user">
          <span className="admin-side-avatar">{name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('')}</span>
          <span className="admin-side-user-meta"><strong>{name}</strong><small>{roles}</small></span>
        </div>
      ) : null}
      <nav className="admin-side-nav">
        <div className="admin-side-group">
          {!collapsed && <div className="admin-side-group-title">{t('لوحاتي', 'My dashboards')}</div>}
          {types.map((x) => <Item key={x} href={`workspace/${x}`} label={isAr ? TYPE_TEXT[x].shortAr : TYPE_TEXT[x].shortEn} icon={<LayoutDashboard size={17} />} active={onDashboard && x === type} />)}
          {hasApplicant ? <Item href="hub" label={t('مبادراتي', 'My initiatives')} icon={<Inbox size={17} />} /> : null}
        </div>
        {tools.map((p) => (
          <div key={p.initiativeId} className="admin-side-group">
            {!collapsed && <div className="admin-side-group-title">{isAr ? p.titleAr : p.titleEn}</div>}
            {p.data.tools.map((tool) => <Item key={tool.view} href={`i/${p.initiativeId}/${tool.view}`} label={isAr ? tool.labelAr : tool.labelEn} icon={<ToolIcon view={tool.view} />} active={hash.replace(/^#\/?/, '').split('?')[0] === `i/${p.initiativeId}/${tool.view}`} />)}
          </div>
        ))}
      </nav>
      {!collapsed && <div className="admin-side-foot">{t('القرارات تُتخذ من صفحة كل طلب داخل مبادرته.', 'Decisions are taken on each application\'s page in its initiative.')}</div>}
    </aside>
  );
};

/**
 * The same sidebar for the pages of an initiative's staff workspace (approvals, accounts, audit…): it loads the dashboard's
 * tools itself, so every page of the staff area shows exactly the menu of the dashboard.
 */
export const WorkspaceSidebarAuto: React.FC<{ initiativeId: string }> = ({ initiativeId }) => {
  const { me } = usePlatform();
  const types = workspaceTypesOf(me);
  const own = me?.memberships.find((m) => m.initiativeId === initiativeId && m.userType)?.userType
    ?? me?.adminEntries.find((a) => a.initiativeId === initiativeId && a.userType)?.userType;
  const type = (own && types.includes(own) ? own : types[0]) as UserType | undefined;
  const [parts, setParts] = useState<OkPart[]>([]);
  useEffect(() => {
    if (!type) return;
    let alive = true;
    api.workspace(type, { tab: 'mine', pageSize: 1 }).then((d) => { if (alive) setParts(d.parts.filter((p): p is OkPart => p.ok)); }).catch(() => { /* the sidebar still lists the dashboards */ });
    return () => { alive = false; };
  }, [type]);
  if (!type) return null;
  return <WorkspaceSidebar type={type} types={types} parts={parts} onDashboard={false} />;
};

// ── the board (also embedded in the platform administration for the super admin) ──

export const WorkspaceBoard: React.FC<{
  type: UserType;
  /** The route the page lives on (its URL keeps the filters): «workspace/<type>» or «admin». */
  base: string;
  /** Only these tabs (the administration shows its own tab bar and fixes the tab). */
  fixedTab?: WorkspaceTab;
  /** Called with each loaded response (the page's sidebar lists the tools of the initiatives). */
  onData?: (d: Workspace) => void;
  header?: boolean;
}> = ({ type, base, fixedTab, onData, header = true }) => {
  const { isAr, t } = usePlatform();
  const [wq, setWq] = useState<WsQuery>(() => readQuery(currentQuery()));
  const [data, setData] = useState<Workspace | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState(wq.q);

  // A navigation (a link, the sidebar, back/forward) resets the page to its URL; the page's own changes replace the URL.
  useEffect(() => {
    const on = () => { const next = readQuery(currentQuery()); setWq(next); setSearch(next.q); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const update = (patch: Partial<WsQuery>) => {
    const next = { ...wq, page: 1, ...patch };
    setWq(next);
    try { window.history.replaceState(null, '', `#${toHash(base, next)}`); } catch { /* sandboxed */ }
  };
  useEffect(() => { const id = window.setTimeout(() => { if (search !== wq.q) update({ q: search }); }, 350); return () => window.clearTimeout(id); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabWanted = fixedTab ?? wq.tab;
  const key = JSON.stringify([type, tabWanted, wq]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.workspace(type, {
      i: wq.i || undefined, tab: tabWanted || undefined, state: wq.state || undefined, q: wq.q || undefined, page: wq.page, pageSize: 20,
      sort: wq.sort || undefined, from: dayStart(wq.from), to: dayEnd(wq.to), ...wq.f,
    }).then((d) => { if (!alive) return; setData(d); setErr(''); onData?.(d); })
      .catch((e) => { if (alive) setErr(errText(e, isAr)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [key, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return err ? <div className="pf-alert err" role="alert">{err} <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReload((x) => x + 1)}>{t('إعادة المحاولة', 'Retry')}</button></div> : <Loading />;

  const txt = TYPE_TEXT[type];
  const parts = data.parts.filter((p): p is OkPart => p.ok);
  const failed = data.parts.filter((p) => !p.ok);
  const tab = data.tab;
  const decides = parts.some((p) => p.data.decides);
  const sla = parts.some((p) => p.data.slaConfigured);
  const single = data.merged ? null : parts[0] ?? null;
  const drafts = parts.reduce<number | undefined>((s, p) => (typeof p.data.draftsCount === 'number' ? (s ?? 0) + p.data.draftsCount : s), undefined);
  const color = (id: string) => data.initiatives.find((i) => i.initiativeId === id)?.themeColor ?? '#0B2545';
  const title = (id: string) => { const i = data.initiatives.find((x) => x.initiativeId === id); return i ? (isAr ? i.titleAr : i.titleEn) : id; };
  const split = (pick: (d: ModuleWorkspace) => number) => (data.merged ? (
    <span className="ws-kpi-split">{parts.map((p) => <i key={p.initiativeId} style={{ ['--dot' as string]: p.themeColor }}>{isAr ? p.titleAr : p.titleEn}: {num(pick(p.data), isAr)}</i>)}</span>
  ) : null);
  const go = (initiativeId: string, l: WorkspaceLink | null) => {
    if (!l) return;
    if (l.view) store.go(`i/${initiativeId}/${l.view}`);
    else update({ i: initiativeId, tab: l.tab ?? 'all', state: l.state ?? '' });
  };
  const tabs: Array<{ key: WorkspaceTab; label: string; icon: React.ReactNode; disabled?: boolean; count?: number; title?: string }> = [
    ...(type === 'system_admin' ? [{ key: 'readiness' as const, label: t('الجاهزية والتشغيل', 'Readiness & operations'), icon: <ClipboardCheck size={15} /> }] : []),
    ...(decides ? [{ key: 'mine' as const, label: type === 'evaluator' ? t('بانتظار تقييمي', 'Awaiting my evaluation') : t('بانتظار قراري', 'Awaiting my decision'), icon: <Gavel size={15} />, count: data.totals.awaitingMe }] : []),
    { key: 'all', label: type === 'system_admin' ? t('كل الطلبات (اطلاع)', 'All applications (read-only)') : type === 'evaluator' ? t('كل إسناداتي', 'All my assignments') : t('كل الطلبات', 'All applications'), icon: <ListChecks size={15} /> },
    ...(type !== 'evaluator' ? [{ key: 'overdue' as const, label: sla ? t('المتأخرة', 'Overdue') : t('المتأخرة (لم تُحدد مهل)', 'Overdue (no deadlines set)'), icon: <Clock size={15} />, disabled: !sla, count: sla ? data.totals.overdue : undefined, title: sla ? undefined : t('لم تُحدد مهل للمراحل بعد', 'No stage deadlines have been set') }] : []),
    ...(type !== 'evaluator' ? [{ key: 'monitoring' as const, label: t('المتابعة والتقارير', 'Monitoring & reports'), icon: <BarChart3 size={15} /> }] : []),
  ];

  return (
    <div className="ws" data-testid="role-dashboard" aria-busy={loading}>
      {header ? (
        <div className="ws-head">
          <div>
            <h1>{isAr ? txt.ar : txt.en}</h1>
            <p>{isAr ? txt.subAr : txt.subEn}</p>
          </div>
          <div className="ws-head-actions">
            {data.initiatives.some((i) => !i.viaPlatformAdmin) ? <WorkspaceBell initiativeIds={data.initiatives.filter((i) => !i.viaPlatformAdmin).map((i) => i.initiativeId)} /> : null}
            <span className="pf-muted ws-updated">{t('آخر تحديث', 'Updated')}: {fmtDate(data.generatedAt, isAr, true)}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setReload((x) => x + 1); void store.reloadMe(); }} disabled={loading}><RefreshCw size={14} /> {t('تحديث', 'Refresh')}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShellLang(isAr ? 'en' : 'ar')} aria-label={isAr ? 'تبديل اللغة إلى الإنجليزية' : 'Switch language to Arabic'}><Globe size={14} /> {isAr ? 'English' : 'العربية'}</button>
          </div>
        </div>
      ) : null}

      {data.initiatives.length > 1 ? (
        <div className="ws-scope" role="tablist" aria-label={t('المبادرات', 'Initiatives')} data-testid="initiative-scope">
          <button type="button" role="tab" aria-selected={data.merged} className={data.merged ? 'active' : ''} onClick={() => update({ i: '', state: '', f: {} })} data-testid="scope-all">
            <Layers size={14} /> {t('كل المبادرات', 'All initiatives')}
          </button>
          {data.initiatives.map((i) => (
            <button key={i.initiativeId} type="button" role="tab" aria-selected={data.initiative === i.initiativeId} className={data.initiative === i.initiativeId ? 'active' : ''}
              onClick={() => update({ i: i.initiativeId, state: '', f: {} })} data-testid={`scope-${i.initiativeId}`}>
              <span className="dot" style={{ background: i.themeColor }} aria-hidden /> {isAr ? i.titleAr : i.titleEn}
            </button>
          ))}
        </div>
      ) : null}

      {failed.map((p) => (
        <div key={p.initiativeId} className="pf-alert err" role="alert" data-testid={`part-error-${p.initiativeId}`}>
          <AlertTriangle size={16} /> {isAr ? p.titleAr : p.titleEn}: {!p.ok ? (isAr ? p.error.messageAr : p.error.messageEn) : ''}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReload((x) => x + 1)}>{t('إعادة المحاولة', 'Retry')}</button>
        </div>
      ))}

      <div className="ws-kpis" data-testid="dash-kpis">
        {decides ? (
          <button type="button" className={`ws-kpi${tab === 'mine' ? ' active' : ''}`} style={{ ['--kpi-accent' as string]: 'var(--egypt-gold, #C9A227)' }} onClick={() => update({ tab: 'mine', state: '' })} data-testid="awaiting-me">
            <span className="ws-kpi-label"><Gavel size={15} /> {type === 'evaluator' ? t('بانتظار تقييمي', 'Awaiting my evaluation') : t('بانتظار قراري', 'Awaiting my decision')}</span>
            <b className="ws-kpi-value" data-testid="awaiting-count">{num(data.totals.awaitingMe, isAr)}</b>
            {split((d) => d.awaitingMe) ?? <span className="ws-kpi-split">{data.totals.awaitingMe ? t('الأقدم انتظارًا أولًا', 'Longest-waiting first') : t('لا شيء ينتظر قرارك الآن', 'Nothing awaits you right now')}</span>}
          </button>
        ) : null}
        {type !== 'evaluator' ? (
          <button type="button" className={`ws-kpi${tab === 'overdue' ? ' active' : ''}`} style={{ ['--kpi-accent' as string]: 'var(--status-rejected, #DC2626)' }} onClick={() => sla && update({ tab: 'overdue', state: '' })} disabled={!sla} data-testid="kpi-overdue">
            <span className="ws-kpi-label"><Clock size={15} /> {t('متأخرة عن المهلة', 'Past the deadline')}</span>
            <b className="ws-kpi-value">{sla ? num(data.totals.overdue, isAr) : '—'}</b>
            {sla ? split((d) => d.overdue) : <span className="ws-kpi-split" data-testid="sla-not-set">{t('لم تُحدد مهل للمراحل بعد', 'No stage deadlines have been set yet')}</span>}
          </button>
        ) : null}
        <button type="button" className={`ws-kpi${tab === 'all' && !wq.state ? ' active' : ''}`} style={{ ['--kpi-accent' as string]: 'var(--gov-primary-900, #0B2545)' }} onClick={() => update({ tab: 'all', state: '' })} data-testid="kpi-open">
          <span className="ws-kpi-label"><ListChecks size={15} /> {type === 'evaluator' ? t('تقييمات مفتوحة', 'Open evaluations') : t('طلبات مفتوحة قيد العمل', 'Open applications in progress')}</span>
          <b className="ws-kpi-value">{num(data.totals.open, isAr)}</b>
          {split((d) => d.open)}
        </button>
        <div className="ws-kpi" style={{ ['--kpi-accent' as string]: 'var(--text-muted, #64748B)' }} data-testid="kpi-total">
          <span className="ws-kpi-label"><Layers size={15} /> {type === 'evaluator' ? t('كل إسناداتي', 'All my assignments') : t('كل الطلبات في نطاقك', 'All applications in your scope')}</span>
          <b className="ws-kpi-value">{num(data.totals.total, isAr)}</b>
          {drafts !== undefined ? <span className="ws-kpi-split" data-testid="drafts-count">{t('مسودات لم تُرسل (خارج الأرقام)', 'Unsubmitted drafts (not counted)')}: {num(drafts, isAr)}</span> : split((d) => d.total)}
        </div>
      </div>

      <Attention type={type} parts={parts} merged={data.merged} onOpen={go} />

      <div className="ws-initiatives">
        {parts.map((p) => <InitiativeOverview key={p.initiativeId} part={p} merged={data.merged} onOpen={(l) => go(p.initiativeId, l)} />)}
      </div>

      {fixedTab ? null : (
        <div className="ws-tabs" role="tablist" aria-label={t('أقسام اللوحة', 'Dashboard sections')}>
          {tabs.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} className={tab === x.key ? 'active' : ''} disabled={x.disabled} title={x.title}
              onClick={() => update({ tab: x.key, state: x.key === tab ? wq.state : '' })} data-testid={`tab-${x.key}`}>
              {x.icon}{x.label}{typeof x.count === 'number' ? <span className="count">{num(x.count, isAr)}</span> : null}
            </button>
          ))}
        </div>
      )}

      {/* D17: Shams has the reminder; other initiatives do not offer it yet. */}
      {type === 'pmu' && tab === 'overdue' && parts.some((p) => p.initiativeId === 'shams' && p.data.overdue > 0) ? <RemindOverdue initiativeId="shams" /> : null}

      {tab === 'readiness' ? <ReadinessTab parts={parts} merged={data.merged} />
        : tab === 'monitoring' ? <MonitoringTab parts={parts} merged={data.merged} onOpen={go} color={color} title={title} />
          : <QueueTab type={type} data={data} single={single} wq={wq} search={search} setSearch={setSearch} update={update} loading={loading} color={color} title={title} />}
    </div>
  );
};

const Attention: React.FC<{ type: UserType; parts: OkPart[]; merged: boolean; onOpen: (id: string, l: WorkspaceLink | null) => void }> = ({ parts, merged, onOpen }) => {
  const { isAr, t } = usePlatform();
  const items = parts.flatMap((p) => p.data.attention.map((a) => ({ ...a, p })));
  if (!items.length) return null;
  return (
    <section className="pf-box ws-attention" aria-labelledby="ws-attention" data-testid="dash-attention">
      <h3 id="ws-attention"><AlertTriangle size={16} /> {t('يحتاج انتباهك', 'Needs your attention')}</h3>
      <ul>
        {items.map((a) => (
          <li key={`${a.p.initiativeId}-${a.key}`}>
            <span><b>{num(a.count, isAr)}</b> {isAr ? a.labelAr : a.labelEn}{merged ? <span className="ws-row-ini" style={{ ['--dot' as string]: a.p.themeColor }}>{isAr ? a.p.titleAr : a.p.titleEn}</span> : null}</span>
            {a.link ? <button type="button" className="btn btn-outline btn-sm" onClick={() => onOpen(a.p.initiativeId, a.link)} data-testid={`attention-${a.key}`}>{t('فتح', 'Open')}</button> : null}
          </li>
        ))}
      </ul>
    </section>
  );
};

/** D17: one click reminds every party an overdue application is waiting for (once a day per application). */
const RemindOverdue: React.FC<{ initiativeId: string }> = ({ initiativeId }) => {
  const { isAr, t } = usePlatform();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const send = async () => {
    setBusy(true); setMessage(null);
    try {
      const r = await api.remindOverdue(initiativeId);
      setMessage({ tone: 'ok', text: t(`أُرسل التنبيه لـ ${num(r.sent, true)} طلب متأخر${r.alreadyReminded ? ` — ${num(r.alreadyReminded, true)} نُبّهوا اليوم بالفعل` : ''}${r.noRecipients ? ` — ${num(r.noRecipients, true)} بلا مستلم` : ''}.`, `Reminded ${r.sent} overdue application(s).`) });
    } catch (e) { setMessage({ tone: 'err', text: errText(e, isAr) }); } finally { setBusy(false); }
  };
  return (
    <div className="row" style={{ marginBottom: '0.75rem', gap: '0.75rem' }}>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => void send()} disabled={busy} data-testid="remind-overdue"><Bell size={14} /> {t('تنبيه كل الجهات المتأخرة', 'Remind every late party')}</button>
      {message ? <span className={`pf-alert ${message.tone}`} role="status" data-testid="remind-result">{message.text}</span> : null}
    </div>
  );
};

/** One initiative's stage cards, side panels and tools. */
const InitiativeOverview: React.FC<{ part: OkPart; merged: boolean; onOpen: (l: WorkspaceLink | null) => void }> = ({ part, merged, onOpen }) => {
  const { isAr, t } = usePlatform();
  const d = part.data;
  if (!d.cards.length && !d.panels.length && !merged) return null;
  return (
    <section className="pf-box ws-ini" style={{ ['--ini' as string]: part.themeColor }} data-testid={`ini-${part.initiativeId}`}>
      <div className="ws-ini-title">
        <h3>{isAr ? part.titleAr : part.titleEn}</h3>
        <span className="pf-chip">{isAr ? part.roleLabelAr : part.roleLabelEn}</span>
      </div>
      {d.cards.length ? (
        <div className="ws-stages" data-testid="dash-cards">
          {d.cards.map((c) => {
            const body = (
              <>
                <span className="ws-stage-label">{isAr ? c.labelAr : c.labelEn}</span>
                <span className="ws-stage-row">
                  <b data-testid={`card-count-${c.key}`}>{num(c.value, isAr)}</b>
                  <span className={`ws-tone tone-${c.tone}`}>{isAr ? TONE_LABEL[c.tone]?.[0] : TONE_LABEL[c.tone]?.[1]}</span>
                </span>
                {c.hintAr ? <small>{isAr ? c.hintAr : c.hintEn}</small> : null}
              </>
            );
            return c.link
              ? <button key={c.key} type="button" className={`ws-stage tone-${c.tone}`} onClick={() => onOpen(c.link)} data-testid={`card-${c.key}`}>{body}</button>
              : <div key={c.key} className={`ws-stage tone-${c.tone}`} data-testid={`card-${c.key}`}>{body}</div>;
          })}
        </div>
      ) : null}
      {d.panels.map((p) => (
        <div key={p.key} className="ws-panel" data-testid={`dash-${p.key}`}>
          <div className="ws-panel-head">
            <b><Wrench size={15} /> {isAr ? p.titleAr : p.titleEn}</b>
            {p.action ? <a className="btn btn-secondary btn-sm" href={`#i/${part.initiativeId}/${p.action.view}`} data-testid={`open-${p.key}`}>{isAr ? p.action.labelAr : p.action.labelEn}</a> : null}
          </div>
          <div className="ws-mini">
            {p.tiles.map((x) => <div key={x.key}><span>{isAr ? x.labelAr : x.labelEn}</span><b>{num(x.value, isAr)}</b></div>)}
          </div>
          {p.warnAr ? <p className="ws-warn">{isAr ? p.warnAr : p.warnEn}</p> : null}
        </div>
      ))}
      {d.tools.length ? (
        <div className="ws-tools">
          {d.tools.map((tool) => <a key={tool.view} className="btn btn-outline btn-sm" href={`#i/${part.initiativeId}/${tool.view}`}><ToolIcon view={tool.view} /> {isAr ? tool.labelAr : tool.labelEn}</a>)}
        </div>
      ) : !d.cards.length ? <p className="pf-muted">{t('لا توجد مؤشرات لهذا الدور.', 'No figures for this role.')}</p> : null}
    </section>
  );
};

const QueueTab: React.FC<{
  type: UserType; data: Workspace; single: OkPart | null; wq: WsQuery; search: string; setSearch: (s: string) => void;
  update: (p: Partial<WsQuery>) => void; loading: boolean; color: (id: string) => string; title: (id: string) => string;
}> = ({ type, data, single, wq, search, setSearch, update, loading, color, title }) => {
  const { isAr, t } = usePlatform();
  const queue = data.queue;
  const tab = data.tab;
  const states = single?.data.states ?? [];
  const stateLabel = (v: string) => { const s = states.find((x) => x.key === v); return s ? (isAr ? s.labelAr : s.labelEn) : v; };
  const filtered = Boolean(wq.state || wq.q || wq.from || wq.to || Object.values(wq.f).some(Boolean));
  const empty = tab === 'mine'
    ? (type === 'evaluator' ? t('لا تقييمات بانتظارك الآن', 'No evaluations awaiting you') : t('لا توجد طلبات بانتظار قرارك', 'Nothing awaiting your decision'))
    : tab === 'overdue' ? t('لا توجد طلبات متأخرة', 'No overdue applications') : t('لا توجد طلبات مطابقة', 'No matching applications');
  return (
    <section aria-label={t('قائمة الطلبات', 'Applications list')}>
      <div className="ws-toolbar">
        <label className="ws-search">
          <Search size={16} aria-hidden />
          <input className="form-control" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('بحث برقم الطلب أو الاسم', 'Search by number or name')} aria-label={t('بحث', 'Search')} data-testid="filter-q" />
        </label>
        {single ? (
          <select className="form-control" value={wq.state} onChange={(e) => update({ state: e.target.value })} aria-label={t('الحالة', 'State')} data-testid="filter-state">
            <option value="">{t('كل الحالات', 'All states')}</option>
            {wq.state.includes(',') ? <option value={wq.state}>{wq.state.split(',').map(stateLabel).join(' + ')}</option> : null}
            {states.map((s) => <option key={s.key} value={s.key}>{isAr ? s.labelAr : s.labelEn}</option>)}
          </select>
        ) : null}
        {single?.data.filters.map((f) => (
          <select key={f.key} className="form-control" value={wq.f[f.key] ?? ''} onChange={(e) => update({ f: { ...wq.f, [f.key]: e.target.value } })} aria-label={isAr ? f.labelAr : f.labelEn}
            data-testid={`filter-${f.key === 'bankOrgId' ? 'bank' : f.key}`}>
            <option value="">{isAr ? `كل ${f.labelAr === 'المحافظة' ? 'المحافظات' : f.labelAr === 'البنك' ? 'البنوك' : f.labelAr === 'القطاع' ? 'القطاعات' : f.labelAr === 'الدورة' ? 'الدورات' : 'الجهات'}` : `All (${f.labelEn})`}</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{isAr ? o.labelAr : o.labelEn}</option>)}
          </select>
        ))}
        <label className="ws-date">{t('من', 'From')}
          <input type="date" className="form-control" value={wq.from} max={wq.to || undefined} onChange={(e) => update({ from: e.target.value })} aria-label={t('من تاريخ', 'From date')} data-testid="filter-from" /></label>
        <label className="ws-date">{t('إلى', 'To')}
          <input type="date" className="form-control" value={wq.to} min={wq.from || undefined} onChange={(e) => update({ to: e.target.value })} aria-label={t('إلى تاريخ', 'To date')} data-testid="filter-to" /></label>
        <select className="form-control" value={tab === 'mine' ? 'oldest' : wq.sort} onChange={(e) => update({ sort: e.target.value })} disabled={tab !== 'all'} aria-label={t('الترتيب', 'Sort')} data-testid="filter-sort"
          title={tab === 'all' ? undefined : t('مرتبة بالأقدم انتظارًا دائمًا', 'Always longest-waiting first')}>
          <option value="">{t('الأحدث أولًا', 'Newest first')}</option>
          <option value="oldest">{t('الأقدم أولًا', 'Oldest first')}</option>
          {single?.initiativeId === 'sona3' && type !== 'evaluator' ? <option value="score">{t('الأعلى درجة', 'Highest score')}</option> : null}
        </select>
        {filtered ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); update({ state: '', q: '', from: '', to: '', sort: '', f: {} }); }} data-testid="filters-clear">{t('مسح الفلاتر', 'Clear filters')}</button> : null}
      </div>
      {!single && data.merged ? <p className="ws-note">{t('اختر مبادرة من الأعلى للتصفية بالحالة والمحافظة وغيرها.', 'Choose an initiative above to filter by state, governorate and more.')}</p> : null}
      {queue?.capped.length ? (
        <div className="pf-alert info" data-testid="queue-capped">
          {t('تُعرض أول ٥٠ طلبًا من كل مبادرة مرتبة معًا. لعرض الباقي اختر المبادرة:', 'The first 50 applications of each initiative are shown together. To see the rest, choose the initiative:')}
          {queue.capped.map((id) => <button key={id} type="button" className="btn btn-ghost btn-sm" onClick={() => update({ i: id })}>{title(id)}</button>)}
        </div>
      ) : null}
      <div className="pf-table-wrap" aria-busy={loading}>
        {!queue?.items.length ? <div className="pf-empty">{loading ? t('جارٍ التحميل…', 'Loading…') : empty}</div> : (
          <table className="pf-table ws-table" data-testid="queue-table">
            <thead>
              <tr>
                <th>{t('رقم الطلب', 'Number')}</th>
                {data.merged ? <th>{t('المبادرة', 'Initiative')}</th> : null}
                <th>{t('الاسم', 'Name')}</th><th>{t('المحافظة', 'Governorate')}</th><th>{t('الحالة', 'State')}</th>
                <th>{t('الجهة المسؤولة', 'Responsible')}</th><th>{t('في المرحلة منذ', 'In stage since')}</th><th>{t('أيام الانتظار', 'Days waiting')}</th><th aria-label={t('علامات', 'Flags')} />
              </tr>
            </thead>
            <tbody>
              {queue.items.map((r: WorkspaceRow) => (
                <tr key={`${r.initiativeId}-${r.id}`} onClick={() => store.go(`i/${r.initiativeId}/${r.view}`)} data-testid={`row-${r.number ?? r.id}`}
                  tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') store.go(`i/${r.initiativeId}/${r.view}`); }}>
                  <td className="num num-ltr"><b>{r.number ?? t('مسودة', 'Draft')}</b></td>
                  {data.merged ? <td><span className="ws-row-ini" style={{ ['--dot' as string]: color(r.initiativeId) }}>{title(r.initiativeId)}</span></td> : null}
                  <td><b>{r.title || '—'}</b>{r.subtitle ? <div className="pf-muted ws-sub">{r.subtitle}</div> : null}</td>
                  <td>{(isAr ? r.governorateAr : r.governorateEn) || '—'}</td>
                  <td><span className="pf-chip info">{isAr ? r.stateLabelAr : r.stateLabelEn}</span>{typeof r.score === 'number' ? <span className="pf-muted ws-sub"> · {t('الدرجة', 'Score')} {num(r.score, isAr)}</span> : null}</td>
                  <td>{isAr ? r.responsibleAr : r.responsibleEn}</td>
                  <td>{fmtDate(r.enteredAt, isAr)} {r.overdue ? <span className="ws-overdue"><Clock size={12} /> {t('متأخر', 'Overdue')}</span> : null}</td>
                  <td className="num" data-testid="days-waiting">{num(r.daysInState, isAr)}</td>
                  <td>{r.isMine ? <span className="badge badge-gold">{t('بانتظارك', 'Yours')}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {queue && queue.totalPages > 1 ? (
        <div className="ws-pager">
          <button type="button" className="btn btn-secondary btn-sm" disabled={wq.page <= 1} onClick={() => update({ page: wq.page - 1 })}>{t('السابق', 'Previous')}</button>
          <span>{num(wq.page, isAr)} / {num(queue.totalPages, isAr)} · {t(`${num(queue.total, true)} طلب`, `${queue.total} applications`)}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={wq.page >= queue.totalPages} onClick={() => update({ page: wq.page + 1 })}>{t('التالي', 'Next')}</button>
        </div>
      ) : queue?.items.length ? <p className="ws-note">{t(`${num(queue.total, true)} طلب`, `${queue.total} applications`)}</p> : null}
    </section>
  );
};

const Block: React.FC<{ b: WorkspaceBlock; color: string; onOpen: (l: WorkspaceLink) => void }> = ({ b, color, onOpen }) => {
  const { isAr, t } = usePlatform();
  const value = (v: number, unit?: string) => (unit === 'EGP' ? formatEGP(v, isAr) : unit === 'days' ? `${num(v, isAr)} ${t('يوم', 'days')}` : num(v, isAr));
  const max = Math.max(1, ...b.rows.map((r) => r.value));
  return (
    <div className="pf-box" data-testid={`block-${b.key}`}>
      <h3>{isAr ? b.titleAr : b.titleEn}</h3>
      {!b.rows.length ? <p className="pf-muted">{t('لا بيانات بعد.', 'No data yet.')}</p>
        : b.kind === 'bars' ? (
          <div className="pf-bars">
            {b.rows.map((r) => (
              <div key={r.key} className={`pf-bar${r.link ? ' ws-link' : ''}`} onClick={r.link ? () => onOpen(r.link!) : undefined} role={r.link ? 'button' : undefined} tabIndex={r.link ? 0 : undefined}>
                <span>{isAr ? r.labelAr : r.labelEn}</span><div className="track"><div className="fill" style={{ width: `${(r.value / max) * 100}%`, background: color }} /></div><b>{value(r.value, r.unit)}</b>
              </div>
            ))}
          </div>
        ) : b.kind === 'tiles' ? (
          <div className="ws-mini">{b.rows.map((r) => <div key={r.key}><span>{isAr ? r.labelAr : r.labelEn}</span><b>{value(r.value, r.unit)}</b></div>)}</div>
        ) : (
          <table className="pf-table"><tbody>{b.rows.map((r) => <tr key={r.key}><td>{isAr ? r.labelAr : r.labelEn}</td><td className="num">{value(r.value, r.unit)}</td></tr>)}</tbody></table>
        )}
      {b.noteAr ? <p className="pf-muted ws-sub">{isAr ? b.noteAr : b.noteEn}</p> : null}
    </div>
  );
};

const MonitoringTab: React.FC<{ parts: OkPart[]; merged: boolean; onOpen: (id: string, l: WorkspaceLink | null) => void; color: (id: string) => string; title: (id: string) => string }> = ({ parts, merged, onOpen, color, title }) => {
  const { isAr, t } = usePlatform();
  const recent = useMemo(() => parts.flatMap((p) => p.data.recent.map((r) => ({ ...r, initiativeId: p.initiativeId })))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 12), [parts]);
  return (
    <div className="pf-gap" data-testid="monitoring">
      {parts.map((p) => (
        <section key={p.initiativeId} className="pf-gap">
          {merged ? <h2 className="ws-h2" style={{ ['--ini' as string]: p.themeColor }}>{isAr ? p.titleAr : p.titleEn}</h2> : null}
          <div className="pf-grid">{(p.data.monitoring ?? []).map((b) => <Block key={b.key} b={b} color={p.themeColor} onOpen={(l) => onOpen(p.initiativeId, l)} />)}</div>
        </section>
      ))}
      <section className="pf-box" aria-labelledby="ws-recent" data-testid="dash-recent">
        <h3 id="ws-recent">{t('آخر النشاط', 'Recent activity')}</h3>
        {!recent.length ? <p className="pf-muted">{t('لا يوجد نشاط بعد.', 'No activity yet.')}</p> : (
          <div className="pf-table-wrap">
            <table className="pf-table ws-table">
              <thead><tr><th>{t('الطلب', 'Application')}</th>{merged ? <th>{t('المبادرة', 'Initiative')}</th> : null}<th>{t('الحدث', 'Event')}</th><th>{t('الحالة بعده', 'State after')}</th><th>{t('الوقت', 'When')}</th></tr></thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={`${r.initiativeId}-${r.applicationId}-${r.at}-${i}`} onClick={() => store.go(`i/${r.initiativeId}/application/${r.applicationId}`)}>
                    <td><b className="num-ltr">{r.number ?? '—'}</b><div className="pf-muted ws-sub">{r.title}</div></td>
                    {merged ? <td><span className="ws-row-ini" style={{ ['--dot' as string]: color(r.initiativeId) }}>{title(r.initiativeId)}</span></td> : null}
                    <td>{isAr ? r.labelAr : r.labelEn}</td><td>{isAr ? r.toLabelAr : r.toLabelEn}</td><td>{fmtDate(r.at, isAr, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

const ReadinessTab: React.FC<{ parts: OkPart[]; merged: boolean }> = ({ parts }) => {
  const { isAr, t } = usePlatform();
  return (
    <div className="pf-gap" data-testid="readiness">
      {parts.map((p) => {
        const r = p.data.readiness;
        if (!r) return null;
        return (
          <section key={p.initiativeId} className="pf-box ws-ini" style={{ ['--ini' as string]: p.themeColor }}>
            <div className="ws-ini-title">
              <h3>{isAr ? p.titleAr : p.titleEn}</h3>
              <span className={`pf-chip ${r.ok ? 'ok' : 'bad'}`} data-testid="readiness-overall" data-ok={r.ok ? '1' : '0'}>
                {r.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {r.ok ? t('كل شروط التشغيل مستوفاة', 'All operating conditions are met') : t('شروط تشغيل غير مستوفاة', 'Operating conditions not met')}
              </span>
            </div>
            <div className="ws-mini">
              <div className={r.notifications.failed ? 'bad' : ''} data-testid="failed-messages"><span>{t('رسائل فاشلة', 'Failed messages')}</span><b>{num(r.notifications.failed, isAr)}</b></div>
              <div><span>{t('رسائل متخطاة (مزود غير مضبوط)', 'Skipped (provider not set)')}</span><b>{num(r.notifications.skipped, isAr)}</b></div>
              <div><span>{t('رسائل في الطابور', 'Queued messages')}</span><b>{num(r.notifications.pending, isAr)}</b></div>
            </div>
            <ul className="ws-checks">
              {r.checks.map((c) => {
                const fix = FIX[c.key];
                return (
                  <li key={c.key} className="ws-check" data-testid={`check-${c.key}`} data-ok={c.ok ? '1' : '0'}>
                    {c.ok ? <CheckCircle2 size={18} className="ok" aria-label={t('مستوفى', 'met')} /> : <XCircle size={18} className="bad" aria-label={t('غير مستوفى', 'not met')} />}
                    <div>
                      <b>{isAr ? c.labelAr : c.labelEn}</b>
                      <div className="pf-muted ws-sub">{isAr ? c.detailAr : c.detailEn}</div>
                      {c.items?.length ? <ul className="ws-check-items">{c.items.map((i) => <li key={i.id}>{isAr ? i.labelAr : i.labelEn}{i.extraAr ? ` — ${isAr ? i.extraAr : i.extraEn}` : ''}</li>)}</ul> : null}
                    </div>
                    {!c.ok && fix ? <a className="btn btn-secondary btn-sm" href={`#i/${p.initiativeId}/${fix.view}`}>{isAr ? fix.ar : fix.en}</a> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
};

// ── the page (#workspace/<type>) ────────────────────────────────────────

export const WorkspacePage: React.FC = () => {
  const { me, param, isAr, t } = usePlatform();
  const types = workspaceTypesOf(me);
  const type = (param ?? '').split('?')[0] as UserType;
  const [parts, setParts] = useState<OkPart[]>([]);
  const valid = types.includes(type);
  // Fresh unread counts (the bell) and memberships each time the dashboard opens.
  useEffect(() => { void store.reloadMe(); }, []);
  // The platform super admin's operations dashboard is its administration (#admin), with the same tabs.
  const adminHome = Boolean(me?.user.platformRole) && type === 'system_admin';
  useEffect(() => {
    if (adminHome) {
      const q = currentQuery();
      const tab = q.get('tab');
      store.go(`admin?tab=${tab === 'all' || tab === 'monitoring' || tab === 'overdue' ? (tab === 'overdue' ? 'all' : tab) : 'readiness'}${q.get('i') ? `&i=${q.get('i')}` : ''}`);
    }
    else if (!valid && types.length) store.go(`workspace/${types[0]}`);
  }, [adminHome, valid, types.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!types.length) {
    return (
      <div className="container-custom" style={{ padding: '2rem 0' }}>
        <div className="pf-empty" data-testid="no-workspace">{t('لا توجد لوحة عمل لحسابك — صفحتك هي «مبادراتي».', 'Your account has no work dashboard — your page is «My initiatives».')} <a href="#hub">{t('مبادراتي', 'My initiatives')}</a></div>
      </div>
    );
  }
  if (!valid || adminHome) return <Loading />;
  return (
    <div className="admin-layout">
      <WorkspaceSidebar type={type} types={types} parts={parts} />
      <div className="admin-content" lang={isAr ? 'ar' : 'en'}>
        <WorkspaceBoard key={type} type={type} base={`workspace/${type}`} onData={(d) => setParts((prev) => {
          // The sidebar keeps every initiative's tools while the page shows one of them.
          const all = new Map(prev.map((p) => [p.initiativeId, p]));
          for (const p of d.parts) if (p.ok) all.set(p.initiativeId, p);
          return d.initiatives.map((i) => all.get(i.initiativeId)).filter((p): p is OkPart => Boolean(p));
        })} />
      </div>
    </div>
  );
};
