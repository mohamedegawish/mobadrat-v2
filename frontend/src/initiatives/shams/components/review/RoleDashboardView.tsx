import React from 'react';
import { AlertTriangle, Gavel, Wrench } from 'lucide-react';
import { api, type DashboardCard, type RoleDashboard } from '../../api';
import { store, useStore } from '../../store/state';
import { useAsync, formatDate, formatNumber } from '../../hooks/useAsync';
import { Loading, Empty, ErrorState } from '../common/StateViews';
import { AdminPageHeader } from '../admin/AdminLayout';
import { HBarList } from '../admin/StatCharts';

const TONE_CLASS: Record<DashboardCard['tone'], string> = {
  pending: 'badge-pending', correction: 'badge-rework', approved: 'badge-approved', rejected: 'badge-rejected',
  completed: 'badge-teal', closed: 'badge-draft', info: 'badge-info',
};
const TONE_LABEL: Record<DashboardCard['tone'], [string, string]> = {
  pending: ['قيد المراجعة', 'In review'], correction: ['بانتظار المصنع', 'Awaiting factory'], approved: ['مقبول', 'Approved'], rejected: ['مرفوض', 'Rejected'],
  completed: ['مكتمل', 'Completed'], closed: ['مغلق', 'Closed'], info: ['جارٍ', 'In progress'],
};

const ROLE_TEXT: Record<string, { title: [string, string]; sub: [string, string]; waiting: [string, string] }> = {
  imc_reviewer: { title: ['لوحة مراجعة الطلب — IMC', 'IMC application review'], sub: ['الطلبات المرسلة، ما ينتظر قرارك، وما عاد إلى المصنع للاستيفاء.', 'Submitted applications, what awaits your decision and what returned to the factory.'],
    waiting: ['طلبات بانتظار مراجعتك', 'Applications awaiting your review'] },
  encpc_reviewer: { title: ['لوحة المراجعة الفنية — ENCPC', 'ENCPC technical review'], sub: ['الطلبات المقبولة من IMC، ما ينتظر قرارك الفني، ودليل مقدمي الخدمة.', 'Applications accepted by IMC, what awaits your technical decision, and the provider directory.'],
    waiting: ['ملفات فنية بانتظار مراجعتك', 'Technical files awaiting your review'] },
  pmu_reviewer: { title: ['لوحة وحدة إدارة المبادرة', 'Initiative management unit'], sub: ['المراحل، ما يحتاج انتباهًا، وآخر نشاط في دورة العمل.', 'Stages, what needs attention, and the latest workflow activity.'],
    waiting: ['بانتظار قرارك', 'Awaiting your decision'] },
};

const go = (l: { view: 'work-queue' | 'approvals' | 'providers'; param: string | null } | null) => { if (l) store.navigate(l.view, l.param); };

/** لوحة الدور: أرقام حقيقية من السيرفر (GET /dashboard)، وكل بطاقة بها رابط تفتح قائمة العمل بالفلتر نفسه الذي حُسب به رقمها. */
export const DashboardPanels: React.FC<{ data: RoleDashboard; hideHeadline?: boolean }> = ({ data, hideHeadline }) => {
  const { isAr, t } = useStore();
  const txt = ROLE_TEXT[data.role];
  return (
    <div className="stack" data-testid="role-dashboard">
      {!hideHeadline ? (
        <button type="button" className="task-card" style={{ width: '100%', textAlign: 'start', cursor: 'pointer' }} onClick={() => go(data.awaitingMe.link)} data-testid="dash-awaiting-me">
          <span className="task-card-icon"><Gavel size={20} /></span>
          <div style={{ flex: 1 }}>
            <p className="task-card-title">{isAr ? txt.waiting[0] : txt.waiting[1]} ({formatNumber(data.awaitingMe.count, isAr)})</p>
            <p className="task-card-sub">{data.awaitingMe.count ? t('اضغط لفتح قائمتك — الأقدم انتظارًا أولًا.', 'Open your list — longest-waiting first.') : t('لا شيء ينتظر قرارك الآن.', 'Nothing awaits your decision right now.')}</p>
          </div>
        </button>
      ) : null}

      {data.attention.length ? (
        <section className="card" aria-labelledby="dash-attention" data-testid="dash-attention">
          <h2 id="dash-attention" className="section-title" style={{ marginTop: 0 }}><AlertTriangle size={16} style={{ verticalAlign: '-3px' }} /> {t('يحتاج انتباهك', 'Needs attention')}</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.4rem' }}>
            {data.attention.map((a) => (
              <li key={a.key} className="row" style={{ justifyContent: 'space-between', gap: '0.6rem' }}>
                <span><b>{formatNumber(a.count, isAr)}</b> {isAr ? a.labelAr : a.labelEn}</span>
                {a.link ? <button type="button" className="btn btn-outline btn-sm" onClick={() => go(a.link)} data-testid={`attention-${a.key}`}>{t('فتح', 'Open')}</button> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="stats-grid" data-testid="dash-cards">
        {data.cards.map((c) => {
          const body = (
            <>
              <div className="stat-tile-label">{isAr ? c.labelAr : c.labelEn}</div>
              <div className="stat-tile-value" data-testid={`card-count-${c.key}`}>{formatNumber(c.count, isAr)}</div>
              <span className={`badge ${TONE_CLASS[c.tone]}`}>{isAr ? TONE_LABEL[c.tone][0] : TONE_LABEL[c.tone][1]}</span>
              {c.hintAr ? <div className="form-helper">{isAr ? c.hintAr : c.hintEn}</div> : null}
            </>
          );
          return c.link
            ? <button key={c.key} type="button" className="stat-tile" style={{ textAlign: 'start', cursor: 'pointer', width: '100%' }} onClick={() => go(c.link)} data-testid={`card-${c.key}`}>{body}</button>
            : <div key={c.key} className="stat-tile" data-testid={`card-${c.key}`}>{body}</div>;
        })}
      </div>

      {data.providers ? (
        <section className="card" aria-labelledby="dash-providers" data-testid="dash-providers">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 id="dash-providers" className="section-title" style={{ margin: 0 }}><Wrench size={16} style={{ verticalAlign: '-3px' }} /> {t('دليل مقدمي الخدمة', 'Service provider directory')}</h2>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => store.navigate('providers')} data-testid="open-providers">{t('إدارة مقدمي الخدمة', 'Manage providers')}</button>
          </div>
          <div className="stats-grid" style={{ marginTop: '0.8rem' }}>
            <div className="stat-tile"><div className="stat-tile-label">{t('الإجمالي', 'Total')}</div><div className="stat-tile-value">{formatNumber(data.providers.total, isAr)}</div></div>
            <div className="stat-tile"><div className="stat-tile-label">{t('ظاهرون للمصانع', 'Visible to factories')}</div><div className="stat-tile-value">{formatNumber(data.providers.visible, isAr)}</div></div>
            <div className="stat-tile"><div className="stat-tile-label">{t('غير مفعّلين', 'Not activated')}</div><div className="stat-tile-value">{formatNumber(data.providers.inactive, isAr)}</div></div>
            {data.providers.approvalRequired ? <div className="stat-tile"><div className="stat-tile-label">{t('بانتظار اعتماد PMU', 'Awaiting PMU approval')}</div><div className="stat-tile-value">{formatNumber(data.providers.awaitingApproval, isAr)}</div></div> : null}
          </div>
          {!data.providers.visible ? <p className="form-helper" style={{ color: 'var(--egypt-red)' }}>{t('لا يوجد مقدم خدمة ظاهر للمصانع — لن يستطيع مصنع تجاوز مرحلة الاختيار.', 'No provider is visible to factories — no factory can pass the selection step.')}</p> : null}
        </section>
      ) : null}

      {data.byStage || data.stuck?.length ? (
        <div className="grid-2">
          {data.byStage ? (
            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: '1rem' }}>{t('الطلبات حسب المرحلة الحالية', 'Applications by current stage')}</h3>
              <HBarList data={data.byStage.filter((s) => s.count > 0).map((s) => ({ label: isAr ? s.labelAr : s.labelEn, count: s.count }))} emptyLabel={t('لا توجد بيانات', 'No data')} />
              {typeof data.drafts === 'number' ? <p className="form-helper">{t(`مسودات لم تُرسل (خارج الأرقام): ${formatNumber(data.drafts, isAr)}`, `Unsubmitted drafts (not counted): ${data.drafts}`)}</p> : null}
            </div>
          ) : null}
          {data.stuck?.length ? (
            <div className="card" data-testid="dash-stuck">
              <h3 style={{ marginTop: 0, fontSize: '1rem' }}>{t('طلبات عالقة', 'Stuck applications')}</h3>
              <ul style={{ margin: 0, paddingInlineStart: '1.1rem', lineHeight: 1.9 }}>
                {data.stuck.map((s) => (
                  <li key={s.id}><button type="button" className="btn btn-ghost btn-sm" onClick={() => store.navigate('application', s.id)}>{s.number ?? s.companyName}</button> — {isAr ? s.reasonAr : s.reasonEn}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <section className="card" aria-labelledby="dash-recent" data-testid="dash-recent">
        <h2 id="dash-recent" className="section-title" style={{ marginTop: 0 }}>{t('آخر النشاط', 'Recent activity')}</h2>
        {!data.recent.length ? <Empty title={t('لا يوجد نشاط بعد', 'No activity yet')} /> : (
          <div className="table-responsive">
            <table className="eng-table">
              <thead><tr><th>{t('الطلب', 'Application')}</th><th>{t('الحدث', 'Event')}</th><th>{t('الحالة بعده', 'State after')}</th><th>{t('الوقت', 'When')}</th></tr></thead>
              <tbody>
                {data.recent.map((r, i) => (
                  <tr key={`${r.applicationId}-${r.at}-${i}`} className="clickable-row" onClick={() => store.navigate('application', r.applicationId)}>
                    <td><b className="num-ltr">{r.number ?? '—'}</b><div className="doc-meta">{r.companyName}</div></td>
                    <td>{isAr ? r.labelAr : r.labelEn}</td>
                    <td>{isAr ? r.toLabelAr : r.toLabelEn}</td>
                    <td>{formatDate(r.at, isAr, true)}</td>
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

/** صفحة اللوحة لأدوار IMC وENCPC والبنك. (PMU تدمج نفس الأقسام في صفحة المتابعة.) */
export const RoleDashboardView: React.FC = () => {
  const { t, user } = useStore();
  const res = useAsync(() => api.roleDashboard(), []);
  const txt = ROLE_TEXT[user?.role ?? ''];
  return (
    <>
      <AdminPageHeader title={txt ? t(txt.title[0], txt.title[1]) : t('اللوحة', 'Dashboard')} description={txt ? t(txt.sub[0], txt.sub[1]) : undefined} />
      {res.loading && !res.data ? <Loading /> : res.error || !res.data ? <ErrorState message={res.error} onRetry={res.reload} /> : <DashboardPanels data={res.data} />}
    </>
  );
};
