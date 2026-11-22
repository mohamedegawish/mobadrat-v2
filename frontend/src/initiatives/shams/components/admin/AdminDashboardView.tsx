import React from 'react';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { api, type ReadinessCheck } from '../../api';
import { store, useStore, type View } from '../../store/state';
import { useAsync, formatDate, formatNumber } from '../../hooks/useAsync';
import { Loading, ErrorState } from '../common/StateViews';
import { AdminPageHeader } from './AdminLayout';
import { StateBadge } from '../ui/StateBadge';
import { Tile } from '../pmu/MonitoringView';

/** أين يُصلح كل شرط غير مستوفى. */
const FIX: Record<string, { view: View; ar: string; en: string } | { ar: string; en: string }> = {
  orgs_without_users: { view: 'admin-accounts', ar: 'إضافة حساب', en: 'Add an account' },
  banks_available: { view: 'admin-organizations', ar: 'الجهات والبنوك', en: 'Organizations & banks' },
  providers_approved: { ar: 'اعتماد مقدمي الخدمة من صلاحية وحدة إدارة المبادرة (PMU).', en: 'Approving providers is a PMU permission.' },
  stuck_applications: { ar: 'فعّل مستخدمًا للجهة، أو تعيد PMU إحالة الطلب.', en: 'Enable a user for the organization, or PMU re-refers the application.' },
  failed_notifications: { view: 'admin-outbox', ar: 'سجل الإشعارات', en: 'Notification log' },
  support_contact: { ar: 'اضبط SUPPORT_EMAIL وSUPPORT_PHONE في إعدادات الخادم.', en: 'Set SUPPORT_EMAIL and SUPPORT_PHONE on the server.' },
};

/** لوحة الأدمن: الجاهزية والتشغيل (لا قرارات على الطلبات، ولا بيانات المصانع). */
export const AdminDashboardView: React.FC = () => {
  const { isAr, t } = useStore();
  const res = useAsync(() => api.adminReadiness(), []);
  const r = res.data;
  return (
    <>
      <AdminPageHeader title={t('الجاهزية والتشغيل', 'Readiness & operations')}
        description={t('الشروط اللازمة حتى لا يصل طلب لجهة لا يعمل فيها أحد، ولا يقف مصنع أمام قائمة فارغة. نفس فحص npm run check:readiness.', 'Conditions that keep applications from reaching nobody and factories from facing empty lists. Same as npm run check:readiness.')}
        actions={<button type="button" className="btn btn-secondary" onClick={() => void res.reload()}><RefreshCw size={15} /> {t('تحديث', 'Refresh')}</button>} />
      {res.loading && !r ? <Loading /> : res.error || !r ? <ErrorState message={res.error} onRetry={res.reload} /> : (
        <div className="stack">
          <div className={`task-card${r.ok ? ' is-waiting' : ''}`} data-testid="readiness-overall">
            <span className="task-card-icon">{r.ok ? <CheckCircle2 size={20} /> : <XCircle size={20} />}</span>
            <div><p className="task-card-title">{r.ok ? t('كل شروط التشغيل مستوفاة', 'All operating conditions are met') : t('شروط تشغيل غير مستوفاة', 'Operating conditions not met')}</p>
              <p className="task-card-sub">{t('آخر فحص', 'Checked')}: {formatDate(r.generatedAt, isAr, true)}</p></div>
          </div>
          <div className="stats-grid">
            <Tile label={t('رسائل فاشلة', 'Failed messages')} value={formatNumber(r.notifications.failed, isAr)} alert={r.notifications.failed > 0} testId="failed-messages" />
            <Tile label={t('رسائل متخطاة (مزود غير مضبوط)', 'Skipped (provider not set)')} value={formatNumber(r.notifications.skipped, isAr)} />
            <Tile label={t('رسائل في الطابور', 'Queued messages')} value={formatNumber(r.notifications.pending, isAr)} />
            <Tile label={t('طلبات عالقة', 'Stuck applications')} value={formatNumber(r.stuck.length, isAr)} alert={r.stuck.length > 0} />
          </div>
          <div className="card" style={{ padding: 0 }}>
            <ul className="doc-list list-flush">
              {r.checks.map((c) => <CheckRow key={c.key} c={c} />)}
            </ul>
          </div>
          {r.stuck.length ? (
            <div className="card" style={{ padding: 0 }}>
              <h3 style={{ margin: '1rem 1rem 0.5rem', fontSize: '1rem' }}>{t('الطلبات العالقة', 'Stuck applications')}</h3>
              <div className="table-responsive">
                <table className="eng-table">
                  <thead><tr><th>{t('رقم الطلب', 'Number')}</th><th>{t('المنشأة', 'Company')}</th><th>{t('الحالة', 'State')}</th><th>{t('السبب', 'Reason')}</th></tr></thead>
                  <tbody>
                    {r.stuck.map((s) => (
                      <tr key={s.id} className="clickable-row" onClick={() => store.navigate('application', s.id)}>
                        <td className="num-ltr">{s.number ?? t('مسودة', 'Draft')}</td><td>{s.companyName}</td>
                        <td><StateBadge state={s.state} labelAr={s.stateLabelAr} labelEn={s.stateLabelEn} /></td><td>{isAr ? s.reasonAr : s.reasonEn}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
};

const CheckRow: React.FC<{ c: ReadinessCheck }> = ({ c }) => {
  const { isAr, t } = useStore();
  const fix = FIX[c.key];
  return (
    <li className="doc-item" data-testid={`check-${c.key}`} data-ok={c.ok ? '1' : '0'} style={{ alignItems: 'flex-start' }}>
      {c.ok ? <CheckCircle2 size={18} style={{ color: 'var(--status-approved)' }} aria-label={t('مستوفى', 'met')} /> : <XCircle size={18} style={{ color: 'var(--status-rejected)' }} aria-label={t('غير مستوفى', 'not met')} />}
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700 }}>{isAr ? c.labelAr : c.labelEn}</div>
        <div className="doc-meta">{isAr ? c.detailAr : c.detailEn}</div>
        {c.items?.length ? <ul className="home-list" style={{ marginTop: '0.3rem' }}>{c.items.map((i) => <li key={i.id}>{isAr ? i.labelAr : i.labelEn}{i.extraAr ? ` — ${isAr ? i.extraAr : i.extraEn}` : ''}</li>)}</ul> : null}
        {!c.ok && fix && !('view' in fix) ? <div className="form-helper">{isAr ? fix.ar : fix.en}</div> : null}
      </div>
      {!c.ok && fix && 'view' in fix ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => store.navigate(fix.view)}>{isAr ? fix.ar : fix.en}</button> : null}
    </li>
  );
};
