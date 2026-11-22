import React, { useRef, useState } from 'react';
import { Clock, Search } from 'lucide-react';
import { api, type ApplicationQuery } from '../../api';
import { store, useStore } from '../../store/state';
import { useAsync, formatDate, formatNumber } from '../../hooks/useAsync';
import { Loading, Empty, ErrorState } from '../common/StateViews';
import { StateBadge } from '../ui/StateBadge';
import { AdminPageHeader } from '../admin/AdminLayout';

type QuickTab = 'mine' | 'all' | 'overdue';

/**
 * معامل الرابط الآتي من لوحة الدور: mine | overdue | all، أو حالات مفصولة بـ«-» (مثل OFFER_REVIEW أو REJECTED-WITHDRAWN).
 * قيمة غير معروفة تُتجاهل (لا فلتر مختلق). يُحوَّل إلى state=A,B كما يتوقع السيرفر.
 */
function readPreset(param: string | null, known: string[], isAdmin: boolean): { tab: QuickTab; states: string } {
  const dflt: QuickTab = isAdmin ? 'all' : 'mine';
  if (!param) return { tab: dflt, states: '' };
  if (param === 'mine' || param === 'overdue' || param === 'all') return { tab: param, states: '' };
  const list = param.split('-');
  if (list.length && list.every((x) => known.includes(x))) return { tab: 'all', states: list.join(',') };
  return { tab: dflt, states: '' };
}

/** قائمة العمل: طلبات الجهة مع البحث والفلاتر وعلامة التأخر. */
export const WorkQueueView: React.FC = () => {
  const { isAr, t, user, meta, param } = useStore();
  const preset = useRef(readPreset(param, (meta?.states ?? []).map((s) => s.state), user?.role === 'system_admin')).current;
  const [tab, setTab] = useState<QuickTab>(preset.tab);
  const [q, setQ] = useState('');
  const [state, setState] = useState(preset.states);
  const [governorate, setGovernorate] = useState('');
  const [bank, setBank] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<'' | 'oldest'>('');
  const [page, setPage] = useState(1);
  const sees = user?.role === 'pmu_reviewer' || user?.role === 'system_admin';
  const stateLabel = (v: string) => { const m = meta?.states.find((x) => x.state === v); return m ? (isAr ? m.labelAr : m.labelEn) : v; };
  const query: ApplicationQuery = { page, pageSize: 20, q: q.trim() || undefined, state: state || undefined, governorate: governorate || undefined,
    bankOrgId: bank || undefined, from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined, to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined, sort: sort || undefined,
    ...(tab === 'mine' ? { mine: '1' as const } : {}), ...(tab === 'overdue' ? { overdue: '1' as const } : {}) };
  const res = useAsync(() => api.listApplications(query), [JSON.stringify(query)]);
  const govLabel = (v: string) => { const g = meta?.governorates.find((x) => x.value === v); return g ? (isAr ? g.labelAr : g.labelEn) : v || '—'; };
  const canDecide = user?.role !== 'system_admin';
  const slaSet = Boolean(meta?.policy.slaConfigured);

  return (
    <>
      <AdminPageHeader title={t('قائمة العمل', 'Work queue')} description={t('الطلبات التي وصلت لجهتك — القرار متاح فقط في مرحلتك. «بانتظار قراري» مرتبة بالأقدم انتظارًا أولًا.', 'Applications that reached your organization — you decide only in your stage. “Awaiting my decision” lists the longest-waiting first.')} />
      <div className="tabs" role="tablist">
        {canDecide ? <button type="button" className={`tab${tab === 'mine' ? ' active' : ''}`} onClick={() => { setTab('mine'); setPage(1); }} data-testid="tab-mine">{t('بانتظار قراري', 'Awaiting my decision')}</button> : null}
        <button type="button" className={`tab${tab === 'all' ? ' active' : ''}`} onClick={() => { setTab('all'); setPage(1); }} data-testid="tab-all">{t('كل طلبات جهتي', 'All my organization’s')}</button>
        {/* I5: بلا مهل محددة لا يوجد «متأخر» — التبويب يقول ذلك بدل قائمة فارغة توحي بالالتزام */}
        <button type="button" className={`tab${tab === 'overdue' ? ' active' : ''}`} onClick={() => { setTab('overdue'); setPage(1); }} disabled={!slaSet} title={slaSet ? undefined : t('لم تُحدد مهل للمراحل بعد', 'No stage deadlines have been set')} data-testid="tab-overdue">
          {slaSet ? t('المتأخرة', 'Overdue') : t('المتأخرة (لم تُحدد مهل)', 'Overdue (no deadlines set)')}
        </button>
        {res.data?.draftsCount !== undefined ? <span className="form-helper" style={{ alignSelf: 'center' }} data-testid="drafts-count">{t('مسودات لم تُرسل (خارج القائمة)', 'Unsubmitted drafts (not listed)')}: {formatNumber(res.data.draftsCount, isAr)}</span> : null}
      </div>
      <div className="toolbar">
        <div className="row" style={{ flex: '2 1 220px' }}>
          <Search size={16} aria-hidden />
          <input className="form-control" placeholder={t('بحث برقم الطلب أو اسم الشركة أو رقم السجل', 'Search by number, company or registry number')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label={t('بحث', 'Search')} />
        </div>
        <select className="form-control" value={state} onChange={(e) => { setState(e.target.value); setPage(1); }} aria-label={t('الحالة', 'State')} data-testid="filter-state">
          <option value="">{t('كل الحالات', 'All states')}</option>
          {state.includes(',') ? <option value={state}>{state.split(',').map(stateLabel).join(' + ')}</option> : null}
          {meta?.states.filter((s) => s.state !== 'DRAFT').map((s) => <option key={s.state} value={s.state}>{isAr ? s.labelAr : s.labelEn}</option>)}
        </select>
        <select className="form-control" value={governorate} onChange={(e) => { setGovernorate(e.target.value); setPage(1); }} aria-label={t('المحافظة', 'Governorate')}>
          <option value="">{t('كل المحافظات', 'All governorates')}</option>
          {meta?.governorates.map((g) => <option key={g.value} value={g.value}>{isAr ? g.labelAr : g.labelEn}</option>)}
        </select>
        {sees ? (
          <select className="form-control" value={bank} onChange={(e) => { setBank(e.target.value); setPage(1); }} aria-label={t('البنك', 'Bank')} data-testid="filter-bank">
            <option value="">{t('كل البنوك', 'All banks')}</option>
            {(meta?.banks ?? []).map((b) => <option key={b.id} value={b.id}>{isAr ? b.nameAr : b.nameEn}</option>)}
          </select>
        ) : null}
        <label className="row" style={{ gap: '0.3rem', fontSize: '0.8rem' }}>{t('من', 'From')}
          <input type="date" className="form-control" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label={t('من تاريخ', 'From date')} data-testid="filter-from" /></label>
        <label className="row" style={{ gap: '0.3rem', fontSize: '0.8rem' }}>{t('إلى', 'To')}
          <input type="date" className="form-control" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label={t('إلى تاريخ', 'To date')} data-testid="filter-to" /></label>
        <select className="form-control" value={sort} onChange={(e) => { setSort(e.target.value as '' | 'oldest'); setPage(1); }} aria-label={t('الترتيب', 'Sort')} data-testid="filter-sort" disabled={tab === 'mine'} title={tab === 'mine' ? t('«بانتظار قراري» مرتبة بالأقدم دائمًا', '“Awaiting my decision” is always oldest first') : undefined}>
          <option value="">{t('الأحدث أولًا', 'Newest first')}</option>
          <option value="oldest">{t('الأقدم أولًا', 'Oldest first')}</option>
        </select>
        {(state || governorate || bank || from || to || q) ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setState(''); setGovernorate(''); setBank(''); setFrom(''); setTo(''); setPage(1); }} data-testid="filters-clear">{t('مسح الفلاتر', 'Clear filters')}</button>
        ) : null}
      </div>
      <div className="card" style={{ padding: 0 }}>
        {res.loading && !res.data ? <div style={{ padding: '1rem' }}><Loading variant="table" /></div>
          : res.error ? <ErrorState message={res.error} onRetry={res.reload} />
          : !res.data?.items.length ? <Empty title={tab === 'mine' ? t('لا توجد طلبات بانتظار قرارك', 'Nothing awaiting your decision') : t('لا توجد طلبات', 'No applications')} />
          : (
            <div className="table-responsive">
              <table className="eng-table" data-testid="queue-table">
                <thead>
                  <tr><th>{t('رقم الطلب', 'Number')}</th><th>{t('المنشأة', 'Company')}</th><th>{t('المحافظة', 'Governorate')}</th><th>{t('الحالة', 'State')}</th><th>{t('الجهة المسؤولة', 'Responsible')}</th><th>{t('في المرحلة منذ', 'In stage since')}</th><th>{t('أيام الانتظار', 'Days waiting')}</th><th /></tr>
                </thead>
                <tbody>
                  {res.data.items.map((a) => (
                    <tr key={a.id} className="clickable-row" onClick={() => store.navigate('application', a.id)} data-testid={`row-${a.number}`}>
                      <td className="num-ltr" style={{ fontWeight: 700 }}>{a.number ?? '—'}</td>
                      <td>{a.companyName}</td>
                      <td>{govLabel(a.governorate)}</td>
                      <td><StateBadge state={a.state} labelAr={a.stateLabelAr} labelEn={a.stateLabelEn} /></td>
                      <td>{a.responsible.orgNameAr ? (isAr ? a.responsible.orgNameAr : a.responsible.orgNameEn) : (isAr ? a.responsible.labelAr : a.responsible.labelEn)}</td>
                      <td>{formatDate(a.stateEnteredAt, isAr)} {a.overdue ? <span className="overdue-flag"><Clock size={12} /> {t('متأخر', 'Overdue')}</span> : null}</td>
                      <td data-testid="days-waiting">{formatNumber(a.daysInState, isAr)}</td>
                      <td>{a.isMine ? <span className="badge badge-gold">{t('بانتظارك', 'Yours')}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {res.data && res.data.totalPages > 1 ? (
        <div className="row" style={{ justifyContent: 'center', marginTop: '0.8rem' }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('السابق', 'Previous')}</button>
          <span style={{ fontSize: '0.85rem' }}>{formatNumber(page, isAr)} / {formatNumber(res.data.totalPages, isAr)}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={page >= res.data.totalPages} onClick={() => setPage(page + 1)}>{t('التالي', 'Next')}</button>
        </div>
      ) : null}
    </>
  );
};
