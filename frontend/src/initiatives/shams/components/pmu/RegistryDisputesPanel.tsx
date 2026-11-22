import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { api, type RegistryDispute, type RegistryObjection } from '../../api';
import { errorText, store, useStore } from '../../store/state';
import { useAsync, formatDate } from '../../hooks/useAsync';
import { Loading, Empty, ErrorState } from '../common/StateViews';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { ErrorBox } from '../ui/ErrorBox';
import { useToast } from '../common/ToastSystem';

type Decision =
  | { kind: 'objection'; op: 'accept' | 'reject'; item: RegistryObjection }
  | { kind: 'dispute'; item: RegistryDispute };

/** نزاعات أرقام السجل (القاعدة G): PMU وحدها تسمّي المصنع المخوَّل بالرقم، بسبب ومرجع إجباريين، والتاريخ كله ظاهر. */
export const RegistryDisputesPanel: React.FC = () => {
  const { isAr, t } = useStore();
  const { toast } = useToast();
  const res = useAsync(() => api.registryDisputes(), []);
  const [showDecided, setShowDecided] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const items = (res.data ?? []).filter((d) => showDecided || d.status === 'open');

  const download = async (o: RegistryObjection) => {
    try {
      const blob = await api.registryObjectionDocument(o.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = o.document.originalName || 'objection.pdf'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast('error', errorText(e, isAr)); }
  };

  return (
    <section className="card" style={{ padding: 0, marginBottom: '1rem' }} aria-labelledby="ap-disputes" data-testid="disputes-panel">
      <div className="row" style={{ justifyContent: 'space-between', padding: '0.9rem 1rem 0' }}>
        <h2 id="ap-disputes" className="section-title" style={{ margin: 0 }}>{t('نزاعات أرقام السجل الصناعي', 'Industrial registry number disputes')}</h2>
        <label className="row" style={{ gap: '0.4rem', fontSize: '0.84rem' }}>
          <input type="checkbox" checked={showDecided} onChange={(e) => setShowDecided(e.target.checked)} /> {t('عرض المحسومة', 'Show decided')}
        </label>
      </div>
      <p className="form-helper" style={{ padding: '0 1rem' }}>
        {t('أثناء النزاع يبقى الرقم موقوفًا فلا يسجَّل مرتين. قراركم يحدد المنشأة الوحيدة المسموح لها بالرقم، ويُبلَّغ الأطراف وIMC. الطلب المفتوح لمنشأة أخرى لا يُغلق آليًا: تتخذ IMC قرارها عليه.',
          'While a dispute is open the number stays on hold, so it cannot be registered twice. Your decision names the only facility allowed to use it; the parties and IMC are notified. An open application of another facility is not closed automatically: IMC decides on it.')}
      </p>
      {res.loading && !res.data ? <div style={{ padding: '1rem' }}><Loading variant="table" /></div> : res.error ? <ErrorState message={res.error} onRetry={res.reload} />
        : !items.length ? <Empty title={t('لا توجد نزاعات مفتوحة', 'No open disputes')} /> : (
          <div className="table-responsive">
            <table className="eng-table">
              <thead><tr><th>{t('رقم السجل', 'Registry number')}</th><th>{t('الأطراف', 'Parties')}</th><th>{t('الحالة', 'Status')}</th><th>{t('آخر نشاط', 'Last activity')}</th><th /></tr></thead>
              <tbody>
                {items.map((d) => {
                  const pending = d.objections.filter((o) => o.status === 'pending');
                  return (
                    <React.Fragment key={d.registryNumber}>
                      <tr>
                        <td className="num-ltr"><b>{d.registryNumber}</b>{d.holderApplication ? <div className="doc-meta">{t('يحجزه الطلب', 'Held by')} <button type="button" className="btn btn-ghost btn-sm" onClick={() => store.navigate('application', d.holderApplication!.id)}>{d.holderApplication.number ?? d.holderApplication.companyName}</button></div> : null}</td>
                        <td>{d.parties.map((p) => p.companyName).join(' · ')}</td>
                        <td>
                          <Badge status={d.status === 'open' ? 'pending' : 'approved'}>{d.status === 'open' ? t('مفتوح', 'Open') : t('محسوم', 'Decided')}</Badge>
                          {d.allowedFactory ? <div className="doc-meta">{t('المخوَّل', 'Authorized')}: {d.allowedFactory.companyName}</div> : null}
                          {pending.length ? <div className="doc-meta">{t(`${pending.length} اعتراض بانتظار القرار`, `${pending.length} objection(s) awaiting decision`)}</div> : null}
                        </td>
                        <td>{formatDate(d.lastActivity, isAr, true)}</td>
                        <td className="row" style={{ gap: '0.3rem' }}>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(open === d.registryNumber ? null : d.registryNumber)}>{open === d.registryNumber ? t('إخفاء التاريخ', 'Hide history') : t('التاريخ', 'History')}</button>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => setDecision({ kind: 'dispute', item: d })} data-testid={`decide-${d.registryNumber}`}>{d.status === 'open' ? t('حسم النزاع', 'Decide') : t('قرار جديد', 'New decision')}</button>
                        </td>
                      </tr>
                      {open === d.registryNumber ? (
                        <tr><td colSpan={5}>
                          <DisputeHistory dispute={d} onDownload={download} onDecide={(o, op) => setDecision({ kind: 'objection', op, item: o })} />
                        </td></tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      {decision ? <DecisionDialog decision={decision} onClose={() => setDecision(null)} onDone={async (msg) => { setDecision(null); toast('success', msg); await res.reload(); }} /> : null}
    </section>
  );
};

const SOURCE_LABEL: Record<string, [string, string]> = {
  imc_reject: ['رفض IMC لعدم تطابق الملكية', 'IMC rejection (ownership mismatch)'], pmu_dispute: ['قرار PMU', 'PMU decision'], objection: ['اعتراض مقبول', 'Accepted objection'],
};

const DisputeHistory: React.FC<{ dispute: RegistryDispute; onDownload: (o: RegistryObjection) => void; onDecide: (o: RegistryObjection, op: 'accept' | 'reject') => void }> = ({ dispute, onDownload, onDecide }) => {
  const { isAr, t } = useStore();
  const rows: Array<{ at: string; node: React.ReactNode }> = [
    ...dispute.conflicts.map((c) => ({ at: c.firstAttemptAt, node: <>{t('محاولة تسجيل من', 'Registration attempt by')} <b>{c.companyName}</b> — {t(`${c.attempts} محاولة، آخرها`, `${c.attempts} attempt(s), last`)} {formatDate(c.lastAttemptAt, isAr, true)}</> })),
    ...dispute.blocks.map((b) => ({ at: b.createdAt, node: <>{t('حظر الرقم', 'Number blocked')} ({isAr ? SOURCE_LABEL[b.source][0] : SOURCE_LABEL[b.source][1]}){b.companyName ? <> — {b.companyName}</> : null}
      {b.releasedAt ? <> · {t('رُفع لصالح', 'released for')} <b>{b.allowedCompanyName}</b> ({formatDate(b.releasedAt, isAr, true)}) — {b.releaseReason} [{b.releaseReference}]</> : <> · <b>{t('نشط', 'active')}</b></>}</> })),
    ...dispute.objections.map((o) => ({ at: o.createdAt, node: (
      <>
        {t('اعتراض من', 'Objection by')} <b>{o.companyName}</b> — <Badge status={o.status === 'pending' ? 'pending' : o.status === 'accepted' ? 'approved' : 'rejected'}>{o.status === 'pending' ? t('معلق', 'pending') : o.status === 'accepted' ? t('مقبول', 'accepted') : t('مرفوض', 'rejected')}</Badge>
        {o.note ? <div className="doc-meta">{o.note}</div> : null}
        {o.decisionReason ? <div className="doc-meta">{o.decisionReason} [{o.decisionReference}]</div> : null}
        <div className="row" style={{ gap: '0.3rem', marginTop: 4 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDownload(o)}><Download size={14} /> {t('المستند', 'Document')}</button>
          {o.status === 'pending' ? <>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onDecide(o, 'accept')} data-testid={`accept-obj-${o.id}`}>{t('قبول الاعتراض', 'Accept')}</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onDecide(o, 'reject')}>{t('رفض', 'Reject')}</button>
          </> : null}
        </div>
      </>
    ) })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <ol className="timeline" aria-label={t('تاريخ النزاع', 'Dispute history')}>
      {rows.map((r, i) => <li key={i}><div className="doc-meta">{formatDate(r.at, isAr, true)}</div><div>{r.node}</div></li>)}
    </ol>
  );
};

const DecisionDialog: React.FC<{ decision: Decision; onClose: () => void; onDone: (message: string) => Promise<void> }> = ({ decision, onClose, onDone }) => {
  const { isAr, t } = useStore();
  const [factoryId, setFactoryId] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isDispute = decision.kind === 'dispute';
  const ok = reason.trim().length >= 10 && reference.trim().length >= 3 && (!isDispute || Boolean(factoryId));
  const title = isDispute ? t('حسم نزاع رقم السجل', 'Decide the registry number dispute')
    : decision.op === 'accept' ? t('قبول الاعتراض', 'Accept the objection') : t('رفض الاعتراض', 'Reject the objection');

  const go = async () => {
    if (busy || !ok) return;
    setBusy(true); setError('');
    try {
      const body = { reason: reason.trim(), reference: reference.trim() };
      if (decision.kind === 'dispute') {
        await api.decideRegistryDispute({ registryNumber: decision.item.registryNumber, allowedFactoryId: factoryId, ...body });
        await onDone(t('سُجّل القرار — الرقم مسموح للمنشأة المسمّاة فقط.', 'Decision recorded — the number is allowed for the named facility only.'));
      } else {
        const r = await api.decideRegistryObjection(decision.item.id, decision.op, body);
        await onDone(r.heldByOtherApplication
          ? t(`سُجّل القرار. ما زال الطلب ${r.heldByOtherApplication.number ?? ''} (${r.heldByOtherApplication.companyName}) مفتوحًا ويحجز الرقم — أُبلغت IMC لاتخاذ قرارها عليه.`, `Decision recorded. Application ${r.heldByOtherApplication.number ?? ''} (${r.heldByOtherApplication.companyName}) is still open and holds the number — IMC was notified.`)
          : t('سُجّل القرار.', 'Decision recorded.'));
      }
    } catch (e) { setError(errorText(e, isAr)); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={busy ? () => undefined : onClose} title={title} maxWidth="520px"
      footer={<div className="row" style={{ justifyContent: 'flex-end', width: '100%' }}>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={busy || !ok} onClick={() => void go()} data-testid="decision-confirm">{busy ? t('جارٍ التنفيذ…', 'Working…') : t('تأكيد القرار', 'Confirm decision')}</button>
      </div>}>
      <p style={{ fontSize: '0.88rem', lineHeight: 1.9 }}>
        {isDispute
          ? t(`الرقم ${decision.item.registryNumber}: اختر المنشأة الوحيدة المسموح لها به. ستُرفض الاعتراضات المعلقة الأخرى بنفس القرار.`, `Number ${decision.item.registryNumber}: choose the only facility allowed to use it. Other pending objections are closed by the same decision.`)
          : decision.op === 'accept'
            ? t(`سيُحجز الرقم ${decision.item.registryNumber} لمنشأة «${decision.item.companyName}» فقط.`, `Number ${decision.item.registryNumber} will be reserved for “${decision.item.companyName}” only.`)
            : t('لا يتغير حظر الرقم عند الرفض.', 'Rejecting does not change the block on the number.')}
      </p>
      {decision.kind === 'dispute' ? (
        <div className="form-group">
          <label className="form-label required" htmlFor="d-factory">{t('المنشأة المخوَّلة', 'Authorized facility')}</label>
          <select id="d-factory" className="form-control" value={factoryId} onChange={(e) => setFactoryId(e.target.value)} data-testid="decision-factory">
            <option value="">{t('— اختر —', '— Select —')}</option>
            {decision.item.parties.map((p) => <option key={p.id} value={p.id}>{p.companyName}</option>)}
          </select>
        </div>
      ) : null}
      <div className="form-group"><label className="form-label required" htmlFor="d-ref">{t('مرجع القرار / الخطاب الرسمي', 'Decision / official letter reference')}</label><input id="d-ref" className="form-control" value={reference} onChange={(e) => setReference(e.target.value)} data-testid="decision-reference" /></div>
      <div className="form-group"><label className="form-label required" htmlFor="d-reason">{t('السبب', 'Reason')}</label><textarea id="d-reason" rows={3} className="form-control" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="decision-reason" /><div className="form-helper">{t('10 أحرف على الأقل، ويُسجل في التدقيق ويراه الأطراف.', 'At least 10 characters; audited and shown to the parties.')}</div></div>
      <ErrorBox message={error} />
    </Modal>
  );
};
