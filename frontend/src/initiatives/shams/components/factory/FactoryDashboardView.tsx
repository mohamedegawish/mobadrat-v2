import React, { useState } from 'react';
import { CheckCircle2, FilePlus2, History } from 'lucide-react';
import { takeSubmitFlash, type SubmitFlash } from '../../utils/submitFlash';
import { api } from '../../api';
import { errorText, store, useStore } from '../../store/state';
import { useAsync, formatDate } from '../../hooks/useAsync';
import { Loading, Empty, ErrorState } from '../common/StateViews';
import { StateBadge } from '../ui/StateBadge';
import { ErrorBox } from '../ui/ErrorBox';
import { FinalOutcomeCard, StageTracker, TaskCard, TransitionTimeline, factoryTarget } from '../application/shared';
import { WithdrawDialog } from './WithdrawDialog';

/** «لوحتي»: حالة الطلب الحالي، الخط الزمني، والمطلوب الآن. */
export const FactoryDashboardView: React.FC = () => {
  const { isAr, t } = useStore();
  const profile = useAsync(() => api.factoryProfile(), []);
  const openId = profile.data?.openApplicationId ?? null;
  const current = useAsync(() => (openId ? api.getApplication(openId) : Promise.resolve(null)), [openId]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [flash, setFlash] = useState<SubmitFlash | null>(() => takeSubmitFlash());

  const startNew = async () => {
    setCreating(true); setError('');
    try {
      const app = await api.createApplication();
      store.navigate('apply', app.id);
    } catch (e) { setError(errorText(e, isAr)); } finally { setCreating(false); }
  };

  if (profile.loading) return <div className="container-custom page"><Loading /></div>;
  if (profile.error || !profile.data) return <div className="container-custom page"><ErrorState message={profile.error} onRetry={profile.reload} /></div>;
  const p = profile.data;
  const app = current.data;
  const past = p.applications.filter((a) => a.id !== openId);
  // آخر طلب مغلق (الأحدث أولًا من السيرفر): نتيجته النهائية تُعرض بوضوح في اللوحة بدل أن تختفي في جدول السابقة.
  const latestClosed = !openId ? p.applications.find((a) => a.closedAt) ?? null : null;

  return (
    <div className="container-custom page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('لوحتي', 'My dashboard')}</h1>
          <p className="page-sub">{p.factory.companyName}</p>
        </div>
        {p.canStartNew ? (
          <button type="button" className="btn btn-primary" onClick={startNew} disabled={creating} data-testid="start-application">
            <FilePlus2 size={16} /> {creating ? t('جارٍ الإنشاء…', 'Creating…') : t('بدء طلب جديد', 'Start a new application')}
          </button>
        ) : null}
      </div>
      <ErrorBox message={error} />

      {flash ? (
        <div className="final-outcome is-success submit-success" role="status" aria-live="polite" data-testid="submit-success" style={{ marginBottom: '1rem' }}>
          <span className="final-outcome-icon"><CheckCircle2 size={34} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="final-outcome-title">{flash.resubmitted ? t('تمت إعادة تقديم طلبك بنجاح', 'Your application was resubmitted') : t('تم إرسال طلب التسجيل بنجاح', 'Your registration was submitted')}</p>
            <p className="final-outcome-sub">
              {flash.resubmitted
                ? t('عاد الطلب إلى الجهة التي طلبت الاستيفاء لاستكمال مراجعته.', 'The application went back to the reviewer who requested the corrections.')
                : t('تحقق النظام من رقم السجل الصناعي، وأُحيل الطلب إلى مرحلة المراجعة. لا يُعد المصنع مسجلًا نهائيًا إلا بعد اعتماد المراجعة، وسنُعلمك بأي طلب استيفاء.', 'The industrial registry number was verified and the application was sent for review. The factory is not finally registered until the review approves it; you will be notified of any requested corrections.')}
            </p>
            <dl className="kv" style={{ marginTop: '0.5rem' }}>
              {flash.number ? <><dt>{t('رقم الطلب', 'Application number')}</dt><dd className="num-ltr" data-testid="submit-success-number">{flash.number}</dd></> : null}
              <dt>{t('الحالة الآن', 'Current status')}</dt><dd>{isAr ? flash.stateLabelAr : flash.stateLabelEn}</dd>
            </dl>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFlash(null)} aria-label={t('إغلاق', 'Dismiss')}>{t('إغلاق', 'Dismiss')}</button>
        </div>
      ) : null}

      {latestClosed ? (
        <div className="card" style={{ marginBottom: '1rem' }} data-testid="latest-outcome">
          <div className="row" style={{ marginBottom: '0.75rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }} className="num-ltr">{latestClosed.number ?? t('مسودة طلب', 'Draft application')}</h2>
            <StateBadge state={latestClosed.state} labelAr={latestClosed.stateLabelAr} labelEn={latestClosed.stateLabelEn} />
          </div>
          <FinalOutcomeCard
            state={latestClosed.state} closedAt={latestClosed.closedAt} contractPath={latestClosed.contractPath}
            bankName={latestClosed.bank ? (isAr ? latestClosed.bank.nameAr : latestClosed.bank.nameEn) : null}
            onView={() => store.navigate('application', latestClosed.id)}
          />
          <div style={{ marginTop: '1rem' }}><StageTracker step={latestClosed.step} state={latestClosed.state} /></div>
          {/* G-09: الطلب المغلق في السجل وليس طلبًا نشطًا — لا رسالة «لا يوجد طلب» متعارضة تحت النتيجة، بل خطوة تالية واضحة. */}
          {p.canStartNew ? (
            <div className="row" style={{ marginTop: '1rem', justifyContent: 'space-between', gap: '0.75rem' }} data-testid="new-after-close">
              <p className="form-helper" style={{ margin: 0 }}>{t('انتهت دورة هذا الطلب ويبقى في سجل طلباتك. يمكنك بدء طلب جديد متى شئت.', 'This application’s cycle has ended; it stays in your history. You can start a new application whenever you are ready.')}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={startNew} disabled={creating} data-testid="start-after-close">
                <FilePlus2 size={15} /> {t('بدء طلب جديد', 'Start a new application')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* G-09: لا طلب مفتوح → إما بطاقة النتيجة أعلاه (طلب مغلق في السجل) أو حالة «لم تقدّم بعد» — لا تحميل لطلب غير موجود. */}
      {!openId && latestClosed ? null : !openId ? (
        <div className="card">
          <Empty
            title={p.applications.length ? t('لا يوجد طلب مفتوح حاليًا', 'No open application') : t('لم تقدّم على المبادرة بعد', 'You have not applied yet')}
            hint={t('ابدأ طلبًا جديدًا وأكمل البيانات والمستندات — يُحفظ تلقائيًا كمسودة.', 'Start an application and complete the data and documents — it is saved automatically as a draft.')}
          />
        </div>
      ) : current.loading ? <Loading /> : current.error || !app ? <ErrorState message={current.error} onRetry={current.reload} /> : (
        <div className="stack">
          <div className="card">
            <div className="page-head" style={{ marginBottom: '0.75rem' }}>
              <div>
                <div className="row">
                  <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{app.number ?? t('مسودة طلب', 'Draft application')}</h2>
                  <StateBadge state={app.state} labelAr={app.stateLabelAr} labelEn={app.stateLabelEn} />
                </div>
                <p className="page-sub">{t('آخر تحديث', 'Last update')}: {formatDate(app.updatedAt, isAr, true)}</p>
              </div>
              <div className="row" style={{ gap: '0.4rem' }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => store.navigate('application', app.id)}>{t('تفاصيل الطلب', 'Application details')}</button>
                {app.allowedActions.some((a) => a.action === 'withdraw') ? (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setWithdrawing(true)} data-testid="withdraw-open">{t('الانسحاب من الطلب', 'Withdraw')}</button>
                ) : null}
              </div>
            </div>
            <StageTracker step={app.step} state={app.state} />
          </div>
          <TaskCard
            task={app.currentTask}
            onAct={() => store.navigate(factoryTarget(app.state), app.id)}
            actLabel={app.state === 'DRAFT' ? t('إكمال الطلب', 'Continue application') : t('تنفيذ المطلوب', 'Do it now')}
          />
          <div className="card">
            <h3 style={{ marginTop: 0, fontSize: '1rem' }}>{t('الخط الزمني', 'Timeline')}</h3>
            <TransitionTimeline items={app.transitions} />
          </div>
        </div>
      )}

      {withdrawing && app ? (
        <WithdrawDialog app={app} onClose={() => setWithdrawing(false)} onDone={async () => { setWithdrawing(false); await profile.reload(); await current.reload(); }} />
      ) : null}

      {past.length ? (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}><History size={16} style={{ verticalAlign: '-3px' }} /> {t('الطلبات السابقة', 'Previous applications')}</h3>
          <div className="table-responsive">
            <table className="eng-table">
              <thead><tr><th>{t('رقم الطلب', 'Number')}</th><th>{t('الحالة', 'State')}</th><th>{t('التاريخ', 'Date')}</th><th /></tr></thead>
              <tbody>
                {past.map((a) => (
                  <tr key={a.id}>
                    <td className="num-ltr">{a.number ?? '—'}</td>
                    <td><StateBadge state={a.state} labelAr={a.stateLabelAr} labelEn={a.stateLabelEn} /></td>
                    <td>{formatDate(a.closedAt ?? a.updatedAt, isAr)}</td>
                    <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => store.navigate('application', a.id)}>{t('عرض', 'View')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
};
