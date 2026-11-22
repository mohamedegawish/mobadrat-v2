import React, { useState } from 'react';
import { FileSpreadsheet, Gavel } from 'lucide-react';
import { api, type ApplicationState } from '../../api';
import { errorText, store, useStore } from '../../store/state';
import { useAsync, formatNumber } from '../../hooks/useAsync';
import { Loading, ErrorState } from '../common/StateViews';
import { AdminPageHeader } from '../admin/AdminLayout';
import { HBarList } from '../admin/StatCharts';
import { downloadExcel } from '../../utils/reports';
import { useToast } from '../common/ToastSystem';
import { DashboardPanels } from '../review/RoleDashboardView';

/** متابعة PMU: ما ينتظر قرارها أولًا، ثم كل الطلبات وتوزيعها والإرجاعات ومتوسط الزمن، وتقرير Excel. */
export const MonitoringView: React.FC = () => {
  const { isAr, t, meta } = useStore();
  const { toast } = useToast();
  const res = useAsync(() => api.reportSummary(), []);
  // I6: ما ينتظر قرار PMU (العرض الفني وموافقة الكهرباء وإعادة الإحالة) — أول ما يظهر.
  const mine = useAsync(() => api.listApplications({ mine: '1', pageSize: 1 }), []);
  const dash = useAsync(() => api.roleDashboard(), []);
  const [exporting, setExporting] = useState(false);
  const s = res.data;
  const stateLabel = (st: string) => { const m = s?.stateLabels[st as ApplicationState]; return m ? (isAr ? m.ar : m.en) : st; };
  const govLabel = (v: string) => { const g = meta?.governorates.find((x) => x.value === v); return g ? (isAr ? g.labelAr : g.labelEn) : v; };

  const exportExcel = async () => {
    setExporting(true);
    try {
      // I7: الورقة جاهزة من السيرفر — رؤوس عربية، أسماء لا أكواد، توقيت القاهرة، نعم/لا.
      const { sheet } = await api.reportApplications();
      if (!sheet.rows.length) { toast('info', t('لا توجد بيانات للتصدير.', 'Nothing to export.')); return; }
      await downloadExcel(`shams-applications-${new Date().toISOString().slice(0, 10)}.xlsx`, sheet.headers, sheet.rows, 'الطلبات');
    } catch (e) { toast('error', errorText(e, isAr)); } finally { setExporting(false); }
  };

  const awaiting = mine.data?.total ?? null;

  return (
    <>
      <AdminPageHeader
        title={t('متابعة المبادرة', 'Initiative monitoring')}
        description={t('ما ينتظر قرارك، ثم كل الطلبات وتوزيعها على المراحل.', 'What awaits your decision, then all applications by stage.')}
        actions={<button type="button" className="btn btn-primary" onClick={exportExcel} disabled={exporting} data-testid="export-excel"><FileSpreadsheet size={16} /> {exporting ? t('جارٍ التصدير…', 'Exporting…') : t('تقرير Excel', 'Excel report')}</button>}
      />
      <button type="button" className="task-card" style={{ width: '100%', textAlign: 'start', marginBottom: '1rem', cursor: 'pointer' }} onClick={() => store.navigate('work-queue')} data-testid="awaiting-me">
        <span className="task-card-icon"><Gavel size={20} /></span>
        <div style={{ flex: 1 }}>
          <p className="task-card-title">{t('بانتظار قرارك', 'Awaiting your decision')} ({awaiting === null ? '…' : formatNumber(awaiting, isAr)})</p>
          <p className="task-card-sub">{t('مراجعة العرض الفني، ومراجعة موافقة الكهرباء، وإعادة إحالة الطلبات العالقة لدى البنوك — الأقدم أولًا.', 'Offer reviews, electricity-approval reviews and stuck bank referrals — oldest first.')}</p>
        </div>
      </button>
      {dash.data ? <div style={{ marginBottom: '1rem' }}><DashboardPanels data={dash.data} hideHeadline /></div> : dash.error ? <ErrorState message={dash.error} onRetry={dash.reload} /> : <Loading />}
      {res.loading && !s ? <Loading /> : res.error || !s ? <ErrorState message={res.error} onRetry={res.reload} /> : (
        <div className="stack">
          <div className="stats-grid">
            <Tile label={t('إجمالي الطلبات', 'Total applications')} value={formatNumber(s.total, isAr)} />
            <Tile label={t('مسودات لم تُرسل', 'Unsubmitted drafts')} value={formatNumber(s.drafts, isAr)} />
            <Tile label={t('طلبات مفتوحة', 'Open')} value={formatNumber(s.open, isAr)} />
            {/* I5: بلا مهل محددة لا يُعرض «متأخرة: 0» */}
            {s.slaConfigured
              ? <Tile label={t('متأخرة', 'Overdue')} value={formatNumber(s.overdue, isAr)} alert={s.overdue > 0} />
              : <Tile label={t('المتأخرة', 'Overdue')} value={t('لم تُحدد مهل', 'No deadlines set')} small testId="sla-not-set" />}
            {s.contracted ? <Tile label={t('تم التعاقد', 'Contracted')} value={formatNumber(s.contracted.count, isAr)}
              hint={t(`بنك: ${formatNumber(s.contracted.byPath.bank, true)} · شركة توزيع الكهرباء: ${formatNumber(s.contracted.byPath.distribution, true)}`, `Bank: ${s.contracted.byPath.bank} · Distribution company: ${s.contracted.byPath.distribution}`)} /> : null}
            {s.contracted ? (
              <Tile label={t('إجمالي التمويل المتعاقد (جنيه) — مسار البنك، مسجل من المصنع', 'Contracted financing (EGP) — bank path, recorded by the factory')} value={formatNumber(s.contracted.totalAmount, isAr)}
                hint={s.contracted.aboveAlertCount ? t(`${formatNumber(s.contracted.aboveAlertCount, true)} تعاقد أعلى من ${formatNumber(s.contracted.alertThresholdEGP, true)} جنيه — للمراجعة`, `${s.contracted.aboveAlertCount} above ${s.contracted.alertThresholdEGP.toLocaleString('en-US')} EGP — review`) : undefined}
                alert={s.contracted.aboveAlertCount > 0} />
            ) : null}
          </div>
          <div className="grid-2">
            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: '1rem' }}>{t('التوزيع على المراحل', 'Distribution by stage')}</h3>
              <HBarList data={Object.entries(s.byState).filter(([, n]) => (n ?? 0) > 0).map(([st, n]) => ({ label: stateLabel(st), count: n ?? 0 }))} emptyLabel={t('لا توجد بيانات', 'No data')} />
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: '1rem' }}>{t('متوسط زمن كل مرحلة (أيام)', 'Average time per stage (days)')}</h3>
              <HBarList data={Object.entries(s.avgDaysPerState).map(([st, v]) => ({ label: stateLabel(st), count: Math.round((v?.avgDays ?? 0) * 10) / 10, sub: `${formatNumber(v?.samples ?? 0, isAr)} ${t('حالة', 'cases')}` }))} emptyLabel={t('لا توجد مراحل مكتملة بعد', 'No completed stages yet')} />
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: '1rem' }}>{t('عدد مرات الإرجاع لكل مرحلة', 'Returns per stage')}</h3>
              <HBarList data={Object.entries(s.returnsByStage).map(([st, n]) => ({ label: stateLabel(st), count: n ?? 0 }))} emptyLabel={t('لا توجد إرجاعات', 'No returns')} />
              <p className="form-helper">{t('لا يوجد حد لمرات الإرجاع حاليًا (قرار مفتوح).', 'There is currently no limit on returns (open decision).')}</p>
            </div>
            {s.byGovernorate ? (
              <div className="card">
                <h3 style={{ marginTop: 0, fontSize: '1rem' }}>{t('التوزيع الجغرافي', 'Geographic distribution')}</h3>
                <HBarList data={s.byGovernorate.map((g) => ({ label: govLabel(g.governorate), count: g.count }))} emptyLabel={t('لا توجد بيانات', 'No data')} />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
};

export const Tile: React.FC<{ label: string; value: string; alert?: boolean; small?: boolean; hint?: string; testId?: string }> = ({ label, value, alert, small, hint, testId }) => (
  <div className={`stat-tile${alert ? ' is-alert' : ''}`} data-testid={testId}>
    <div className="stat-tile-label">{label}</div>
    <div className="stat-tile-value" style={small ? { fontSize: '1rem' } : undefined}>{value}</div>
    {hint ? <div className="form-helper">{hint}</div> : null}
  </div>
);
