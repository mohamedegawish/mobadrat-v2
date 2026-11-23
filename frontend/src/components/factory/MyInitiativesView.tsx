import React, { useEffect, useMemo, useState } from 'react';
import { usePlatformStore } from '../../store/state';
import { store as platform } from '../../platform/store';
import { api, type MembershipItem } from '../../platform/api';
import { clearPlatformFlash, peekPlatformFlash, type PlatformFlash } from '../../core/session';
import { Badge } from '../ui/Badge';
import type { StatusTone } from '../../utils/theme';
import { Layers, LogIn, FileText, ArrowLeft, ArrowRight, Building2, Eye, RefreshCw, PlusCircle, AlertCircle, CheckCircle2, Info, ShieldCheck } from 'lucide-react';

/** صياغة عربية سليمة لأعداد الطلبات (طلب واحد / طلبان / طلبات). */
function appsCountLabel(count: number, isAr: boolean): string {
  if (!isAr) return `${count} app${count === 1 ? '' : 's'}`;
  if (count === 0) return 'لا توجد طلبات';
  if (count === 1) return 'طلب واحد';
  if (count === 2) return 'طلبان';
  if (count <= 10) return `${count} طلبات`;
  return `${count} طلباً`;
}

/** لون شارة حالة الطلب كما تحددها المبادرة. */
const CARD_TONE: Record<string, StatusTone> = { success: 'approved', warning: 'rework', danger: 'rejected', info: 'pending', neutral: 'draft' };

/** Staff open the dashboard of their user type on this initiative (one page for every initiative); applicants their file. */
const dashboardOf = (m: MembershipItem) => (m.userType ? `workspace/${m.userType}?i=${m.initiativeId}` : `i/${m.initiativeId}/${m.card?.view ?? m.defaultView}`);
const canOpen = (m: MembershipItem) => m.status === 'active' && m.access.status !== 'blocked';

/** رسالة المبادرة عن الحساب (موقوف / مقيد / محظور) — تظهر داخل بطاقة المبادرة. */
const AccessNotice: React.FC<{ m: MembershipItem; isAr: boolean }> = ({ m, isAr }) => {
  const suspended = m.status !== 'active';
  const text = suspended
    ? (isAr ? 'عضويتك في هذه المبادرة موقوفة.' : 'Your membership in this initiative is suspended.')
    : m.access.status !== 'full' && m.access.messageAr ? (isAr ? m.access.messageAr : (m.access.messageEn || m.access.messageAr)) : '';
  if (!text) return null;
  const err = suspended || m.access.status === 'blocked';
  return (
    <div className={`pf-alert ${err ? 'err' : 'info'}`} role={err ? 'alert' : 'status'}>
      {err ? <AlertCircle size={16} style={{ flexShrink: 0 }} /> : <Info size={16} style={{ flexShrink: 0 }} />}
      <span>{text}</span>
    </div>
  );
};

/**
 * «مبادراتي» — صفحة مسجلة فقط.
 * - صاحب الحساب: المبادرات المسجل فيها (حالة طلبه في كل مبادرة + الدخول للوحتها).
 * - الإدارة/المدقق: كل المبادرات مع عدّادات الطلبات.
 */
export const MyInitiativesView: React.FC = () => {
  const { language, navigate, currentUser, isLoggedIn, me, initiatives } = usePlatformStore();
  const isAr = language === 'ar';
  const Arrow = isAr ? ArrowLeft : ArrowRight;
  const [flash] = useState<PlatformFlash | null>(() => peekPlatformFlash());

  // تحديث حالة الطلبات تلقائياً: عند الفتح + كل دقيقة + عند العودة للتبويب.
  useEffect(() => {
    clearPlatformFlash();
    if (!isLoggedIn) return;
    void platform.reloadMe();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void platform.reloadMe();
    }, 60000);
    const onVis = () => {
      if (document.visibilityState === 'visible') void platform.reloadMe();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [isLoggedIn]);

  const isOversight = Boolean(me?.user.platformRole);
  const memberships = useMemo(() => me?.memberships ?? [], [me]);

  // المبادرة المختارة: الأولى تلقائياً، وتبقى باختيار المستخدم بعدها.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedId && memberships.some((m) => m.initiativeId === selectedId)) return;
    const auto = memberships.find((m) => m.card?.applicationNumber)?.initiativeId ?? memberships[0]?.initiativeId ?? null;
    if (auto !== selectedId) setSelectedId(auto);
  }, [memberships, selectedId]);
  const selected = memberships.find((m) => m.initiativeId === selectedId) ?? null;

  const [refreshing, setRefreshing] = useState(false);
  const manualRefresh = async () => {
    setRefreshing(true);
    try { await platform.reloadMe(); } catch { /* ignore */ }
    setRefreshing(false);
  };

  // عدّادات الأدمن/المدقق: كل المبادرات (حتى الصفرية) مع عدد الطلبات.
  const [impact, setImpact] = useState<Awaited<ReturnType<typeof api.impact>> | null>(null);
  useEffect(() => { if (isOversight) api.impact().then(setImpact).catch(() => undefined); }, [isOversight]);
  const oversightRows = useMemo(() => {
    if (!isOversight) return [];
    return initiatives.map(init => ({
      id: init.id,
      titleAr: init.titleAr,
      titleEn: init.titleEn,
      count: impact?.initiatives.find(x => x.initiativeId === init.moduleId)?.applications ?? 0,
      admin: me?.adminEntries.find(a => a.initiativeId === init.moduleId) ?? null,
    }));
  }, [isOversight, initiatives, impact, me]);

  const slugOf = (initiativeId: string) => initiatives.find(i => i.moduleId === initiativeId)?.id ?? initiativeId;

  // 1) الزائر: دعوة تسجيل دخول.
  if (!isLoggedIn || !currentUser || currentUser.id === 'guest') {
    return (
      <div className="container-custom" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
        <div className="card" style={{ maxWidth: '560px', margin: '0 auto', padding: '2.5rem' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--bg-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem auto' }}>
            <Layers size={30} style={{ color: 'var(--egypt-red)' }} />
          </div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '0.6rem' }}>
            {isAr ? 'مبادراتي' : 'My Initiatives'}
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.7, marginBottom: '1.5rem' }}>
            {isAr
              ? 'سجل الدخول لعرض المبادرات المرتبطة بحسابك ومتابعة طلباتك وحالاتها.'
              : 'Sign in to see the initiatives linked to your account and track your applications.'}
          </p>
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => { platform.rememberReturn('hub'); navigate('login'); }}>
              <LogIn size={16} />
              <span>{isAr ? 'تسجيل الدخول' : 'Sign In'}</span>
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('initiatives')}>
              <span>{isAr ? 'استعرض المبادرات' : 'Browse Initiatives'}</span>
              <Arrow size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const subtitle = isAr
    ? (isOversight ? 'نظرة شاملة على المبادرات وحجم الطلبات عليها' : 'المبادرات التي سجلت فيها بحسابك على المنصة')
    : (isOversight ? 'Overview of initiatives and application volumes' : 'Initiatives you registered in with your platform account');

  const flashBox = flash ? (
    <div data-testid={flash.testId} role="status" className="card" style={{ padding: '0.9rem 1.1rem', marginBottom: '1.25rem', display: 'flex', gap: '0.6rem', alignItems: 'flex-start', borderInlineStart: `4px solid ${flash.tone === 'warn' ? 'var(--gov-gold-bright)' : flash.tone === 'ok' ? 'var(--status-approved)' : 'var(--gov-primary-700)'}` }}>
      <CheckCircle2 size={18} style={{ color: flash.tone === 'ok' ? 'var(--status-approved)' : 'var(--gov-primary-700)', flexShrink: 0, marginTop: '0.15rem' }} />
      <div>
        <div style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--text-main)' }}>{isAr ? flash.titleAr : flash.titleEn}</div>
        {flash.textAr && <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem', lineHeight: 1.6 }}>{isAr ? flash.textAr : flash.textEn}</div>}
      </div>
    </div>
  ) : null;

  // 2) قائمة فارغة: رسالة + زر استعراض المبادرات.
  const isEmpty = isOversight ? oversightRows.length === 0 && memberships.length === 0 : memberships.length === 0;
  if (isEmpty) {
    return (
      <div className="container-custom" style={{ padding: '2rem 1.5rem 3rem 1.5rem' }}>
        <PageHeader isAr={isAr} subtitle={subtitle} />
        {flashBox}
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem' }}>
          <FileText size={36} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }} />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginBottom: '1.25rem' }}>
            {isAr ? 'لا توجد مبادرات مرتبطة بحسابك بعد.' : 'No initiatives linked to your account yet.'}
          </p>
          <button className="btn btn-gold" onClick={() => navigate('initiatives')}>
            <span>{isAr ? 'استعرض المبادرات' : 'Browse Initiatives'}</span>
            <Arrow size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container-custom" style={{ padding: '2rem 1.5rem 3rem 1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
        <PageHeader isAr={isAr} subtitle={subtitle} />
        {!isOversight && (
          <button className="btn btn-secondary btn-sm" onClick={manualRefresh} disabled={refreshing} title={isAr ? 'تحديث الحالات الآن' : 'Refresh statuses now'} style={{ marginBottom: '1.5rem', flexShrink: 0 }}>
            <RefreshCw size={14} style={refreshing ? { animation: 'spin 1s linear infinite' } : undefined} />
            <span>{isAr ? (refreshing ? 'جارٍ التحديث…' : 'تحديث الحالات') : (refreshing ? 'Refreshing…' : 'Refresh')}</span>
          </button>
        )}
      </div>

      {flashBox}

      {/* الإدارة: مدخل لوحة الإدارة الموحدة */}
      {isOversight && (
        <section className="card" style={{ padding: '1.1rem 1.35rem', marginBottom: '1.25rem', borderInlineStart: '4px solid var(--egypt-red)', borderRadius: 'var(--radius-lg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <ShieldCheck size={20} style={{ color: 'var(--egypt-red)' }} />
            <div>
              <div style={{ fontWeight: 800, color: 'var(--text-main)' }}>{isAr ? me?.platformRoleLabel?.ar : me?.platformRoleLabel?.en}</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{isAr ? 'لوحة الإدارة الموحدة لكل المبادرات' : 'The unified administration of every initiative'}</div>
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => navigate('admin-dashboard')}>
            <span>{isAr ? 'لوحة الإدارة' : 'Administration'}</span>
            <Arrow size={15} />
          </button>
        </section>
      )}

      {/* آخر تسجيل: يُفتح تلقائياً مع زر عرض حالتي */}
      {!isOversight && selected && (
        <section className="card" style={{ padding: '1.35rem 1.5rem', marginBottom: '1.25rem', borderInlineStart: '4px solid var(--egypt-red)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em', color: 'var(--egypt-red)', marginBottom: '0.25rem' }}>
                {isAr ? 'آخر مبادرة سجلت فيها' : 'Your latest registration'}
              </div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', margin: '0 0 0.35rem 0', lineHeight: 1.4 }}>
                {isAr ? selected.titleAr : selected.titleEn}
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                {selected.card && <Badge tone={CARD_TONE[selected.card.tone ?? ''] ?? 'draft'}>{isAr ? selected.card.statusAr : selected.card.statusEn}</Badge>}
                {selected.card?.applicationNumber && <span className="num-ltr">{selected.card.applicationNumber}</span>}
                {selected.card?.nextActionAr && (
                  <span>· {isAr ? 'المطلوب الآن' : 'Next step'}: {isAr ? selected.card.nextActionAr : selected.card.nextActionEn}</span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {canOpen(selected) && (
                <button className="btn btn-primary" onClick={() => platform.go(dashboardOf(selected))}>
                  <Eye size={15} />
                  <span>{isAr ? 'عرض حالتي' : 'View My Status'}</span>
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => navigate('initiatives')}>
                <PlusCircle size={15} />
                <span>{isAr ? 'التسجيل في مبادرة أخرى' : 'Apply to Another'}</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* الأدمن/المدقق: كل المبادرات مع عدّادات */}
      {isOversight && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem', marginBottom: memberships.length > 0 ? '2rem' : undefined }}>
          {oversightRows.map(row => (
            <div key={row.id} className="card" style={{ padding: '1.15rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)', lineHeight: 1.5, margin: 0 }}>
                  {isAr ? row.titleAr : row.titleEn}
                </h3>
                <span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--egypt-red)', whiteSpace: 'nowrap' }}>
                  {appsCountLabel(row.count, isAr)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('initiative-detail', row.id)}>
                  <span>{isAr ? 'عرض صفحة المبادرة' : 'View Initiative'}</span>
                  <Arrow size={14} />
                </button>
                {row.admin && (
                  <button className="btn btn-gold btn-sm" onClick={() => platform.go(`i/${row.admin!.initiativeId}/${row.admin!.defaultView}`)}>
                    <span>{isAr ? 'إدارة المبادرة' : 'Manage the initiative'}</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* صاحب الحساب: بطاقة لكل مبادرة */}
      {memberships.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
          {memberships.map(m => (
            <div
              key={m.initiativeId}
              className="card pf-hub-card"
              onClick={() => setSelectedId(m.initiativeId)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(m.initiativeId); } }}
              title={isAr ? 'اضغط لعرض هذه المبادرة كآخر تسجيل' : 'Click to preview as latest'}
              style={{
                padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', cursor: 'pointer',
                borderColor: m.initiativeId === selectedId ? 'var(--egypt-red)' : undefined,
                boxShadow: m.initiativeId === selectedId ? '0 0 0 2px var(--egypt-red-soft)' : undefined,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.5, margin: 0 }}>
                  {isAr ? m.titleAr : m.titleEn}
                </h3>
                {m.card && <Badge tone={CARD_TONE[m.card.tone ?? ''] ?? 'draft'}>{isAr ? m.card.statusAr : m.card.statusEn}</Badge>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                <Building2 size={14} />
                <span>
                  {isAr ? m.roleLabelAr : m.roleLabelEn}
                  {m.card?.nextActionAr ? (isAr ? ` — المطلوب الآن: ${m.card.nextActionAr}` : ` — next: ${m.card.nextActionEn}`) : ''}
                </span>
              </div>
              {(m.card?.applicationNumber || m.unread > 0) && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {[m.card?.applicationNumber, m.unread ? (isAr ? `${m.unread} إشعار غير مقروء` : `${m.unread} unread notification(s)`) : ''].filter(Boolean).join(' · ')}
                </div>
              )}
              <AccessNotice m={m} isAr={isAr} />
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: 'auto' }} onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('initiative-detail', slugOf(m.initiativeId))}>
                  <span>{isAr ? 'عرض صفحة المبادرة' : 'View Initiative'}</span>
                  <Arrow size={14} />
                </button>
                {canOpen(m) && (
                  <button className="btn btn-gold btn-sm" onClick={() => platform.go(dashboardOf(m))}>
                    <span>{isAr ? 'ادخل لوحة المبادرة' : 'Open the dashboard'}</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const PageHeader: React.FC<{ isAr: boolean; subtitle: string }> = ({ isAr, subtitle }) => (
  <div style={{ marginBottom: '1.5rem' }}>
    <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '0.35rem' }}>
      {isAr ? 'مبادراتي' : 'My Initiatives'}
    </h1>
    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>{subtitle}</p>
  </div>
);
