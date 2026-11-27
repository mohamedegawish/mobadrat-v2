import React from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Clock, Download, FileText, Hourglass, XCircle } from 'lucide-react';
import { api, type ApplicationDetail, type ApplicationDocument, type ApplicationState, type ContractPath, type CurrentTask } from '../../api';
import { errorText, store, useStore, type View } from '../../store/state';
import { formatBytes, formatDate, formatNumber } from '../../hooks/useAsync';
import { saveFile } from '../../utils/reports';
import { useToast } from '../common/ToastSystem';

/** شاشة المصنع المناسبة لحالة الطلب. */
export function factoryTarget(state: ApplicationState): View {
  if (state === 'DRAFT' || state === 'IMC_CORRECTION') return 'apply';
  if (['ENCPC_CORRECTION', 'OFFER_UPLOAD', 'OFFER_CORRECTION', 'ELECTRICITY_UPLOAD', 'CONTRACT_OUTCOME', 'DISTRIBUTION_UPLOAD'].includes(state)) return 'task';
  return 'application';
}

/** D11: «الإجراء — الجهة المسؤولة». The numbers match the server's STATE_STEP. */
const STEPS = [
  { ar: 'التسجيل — المصنع', en: 'Registration — Factory' }, { ar: 'مراجعة الطلب — IMC', en: 'Application review — IMC' },
  { ar: 'المراجعة الفنية — ENCPC', en: 'Technical review — ENCPC' }, { ar: 'العرض الفني — المصنع / PMU', en: 'Technical offer — Factory / PMU' },
  { ar: 'موافقة الكهرباء — وزارة الكهرباء', en: 'Electricity approval — Ministry of Electricity' },
  { ar: 'مسار التعاقد — المصنع', en: 'Contracting path — Factory' }, { ar: 'التعاقد — المصنع', en: 'Contract — Factory' },
];

/** شريط المراحل. */
export const StageTracker: React.FC<{ step: number; state: ApplicationState }> = ({ step, state }) => {
  const { isAr } = useStore();
  // الإغلاق غير الناجح (رفض نهائي / لم يتم التعاقد) يظهر بعلامة X حمراء على مرحلته؛ الانسحاب يبقى محايدًا.
  const failed = state === 'REJECTED' || state === 'CLOSED_NOT_CONTRACTED';
  const terminal = failed || state === 'WITHDRAWN';
  const done = state === 'CONTRACTED';
  return (
    <div className="stage-track" role="list" aria-label={isAr ? 'مراحل الطلب' : 'Application stages'} data-state={state}>
      {STEPS.map((s, i) => {
        const n = i + 1;
        const cls = done || n < step ? 'done' : n === step ? (failed ? 'failed' : terminal ? 'closed' : 'current') : '';
        const finalOk = done && n === STEPS.length;
        return (
          <div key={s.en} className={`stage-chip ${cls}`} role="listitem" aria-current={n === step ? 'step' : undefined}>
            <span className="stage-dot">{finalOk ? <CheckCircle2 size={18} aria-label={isAr ? 'تم' : 'Done'} /> : cls === 'failed' ? <XCircle size={18} aria-label={isAr ? 'لم يكتمل' : 'Failed'} /> : n.toLocaleString(isAr ? 'ar-EG' : 'en-US')}</span>
            <span>{isAr ? s.ar : s.en}</span>
          </div>
        );
      })}
    </div>
  );
};

/** اسم مسار التعاقد للعرض. */
export function contractPathLabel(path: ContractPath | null | undefined, t: (ar: string, en: string) => string): string | null {
  if (path === 'bank') return t('التعاقد من خلال بنك', 'Contracting through a bank');
  if (path === 'distribution') return t('التعاقد من خلال شركة توزيع الكهرباء', 'Contracting through the electricity distribution company');
  return null;
}

/**
 * النتيجة النهائية للطلب بمؤشر واضح: ✓ أخضر «تم التعاقد»، ✗ أحمر لعدم التعاقد أو الرفض النهائي، ومحايد للانسحاب.
 * العنوان يذكر نوع التعاقد (بنك / شركة توزيع الكهرباء). لا يظهر لغير الحالات النهائية.
 */
export const FinalOutcomeCard: React.FC<{
  state: ApplicationState; closedAt?: string | null; bankName?: string | null; contractDate?: string | null; reason?: string | null; onView?: () => void;
  contractPath?: ContractPath | null; children?: React.ReactNode;
}> = ({ state, closedAt, bankName, contractDate, reason, onView, contractPath, children }) => {
  const { isAr, t } = useStore();
  const viaDistribution = contractPath === 'distribution';
  const specs: Partial<Record<ApplicationState, { tone: string; Icon: typeof CheckCircle2; title: string; sub: string }>> = {
    CONTRACTED: viaDistribution
      ? { tone: 'success', Icon: CheckCircle2, title: t('تم التعاقد عن طريق شركة توزيع الكهرباء', 'Contracted through the electricity distribution company'), sub: t('قبلت وحدة إدارة المبادرة موافقة شركة التوزيع واكتملت رحلة الطلب بنجاح. الطلب مغلق ولا يقبل تعديلات.', 'The PMU accepted the distribution company approval and the application completed successfully. It is closed to changes.') }
      : { tone: 'success', Icon: CheckCircle2, title: contractPath === 'bank' ? t('تم التعاقد عن طريق البنك', 'Contracted through the bank') : t('تم التعاقد', 'Contracted'), sub: t('اكتمل الطلب بنجاح وسُجّلت نتيجة التعاقد. الطلب مغلق ولا يقبل تعديلات.', 'The application completed successfully and the contract was recorded. It is closed to changes.') },
    CLOSED_NOT_CONTRACTED: viaDistribution
      ? { tone: 'failure', Icon: XCircle, title: t('لم يتم التعاقد — رُفضت موافقة شركة التوزيع', 'Not contracted — distribution company approval rejected'), sub: t('رفضت وحدة إدارة المبادرة موافقة شركة توزيع الكهرباء. قرار نهائي: الطلب مغلق ولا يمكن استكماله.', 'The PMU rejected the distribution company approval. Final decision: the application is closed and cannot be continued.') }
      : { tone: 'failure', Icon: XCircle, title: t('لم يتم التعاقد', 'Not contracted'), sub: t('سُجّلت نتيجة التعاقد بعدم إتمامه. الطلب مغلق نهائيًا.', 'The contracting was recorded as unsuccessful. The application is closed.') },
    REJECTED: { tone: 'failure', Icon: XCircle, title: t('طلب مرفوض نهائيًا', 'Finally rejected'), sub: t('رُفض الطلب في مراجعة IMC وأُغلق نهائيًا، ولا يمكن تعديله أو إعادة تقديمه.', 'IMC rejected the application; it is closed and cannot be edited or resubmitted.') },
    WITHDRAWN: { tone: 'neutral', Icon: Hourglass, title: t('منسحب', 'Withdrawn'), sub: t('انسحب المصنع من هذا الطلب وأُغلق.', 'The factory withdrew this application; it is closed.') },
  };
  const spec = specs[state];
  if (!spec) return null;
  const { Icon } = spec;
  const pathLabel = state === 'CONTRACTED' || state === 'CLOSED_NOT_CONTRACTED' ? contractPathLabel(contractPath, t) : null;
  return (
    <div className={`final-outcome is-${spec.tone}`} data-testid="final-outcome" data-outcome={state} role="status">
      <span className="final-outcome-icon"><Icon size={34} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="final-outcome-title">{spec.title}</p>
        <p className="final-outcome-sub">{spec.sub}</p>
        {pathLabel || bankName || contractDate || reason || closedAt ? (
          <dl className="kv" style={{ marginTop: '0.5rem' }}>
            {pathLabel ? <><dt>{t('نوع التعاقد', 'Contracting type')}</dt><dd data-testid="final-outcome-path">{pathLabel}</dd></> : null}
            {bankName && !viaDistribution ? <><dt>{t('البنك', 'Bank')}</dt><dd>{bankName}</dd></> : null}
            {contractDate ? <><dt>{t('تاريخ التعاقد', 'Contract date')}</dt><dd className="num-ltr">{contractDate}</dd></> : null}
            {reason ? <><dt>{viaDistribution && state === 'CLOSED_NOT_CONTRACTED' ? t('سبب الرفض', 'Rejection reason') : viaDistribution ? t('ملاحظات المراجعة', 'Review notes') : t('السبب', 'Reason')}</dt><dd data-testid="final-outcome-reason">{reason}</dd></> : null}
            {closedAt ? <><dt>{t('تاريخ الإغلاق', 'Closed on')}</dt><dd>{formatDate(closedAt, isAr, true)}</dd></> : null}
          </dl>
        ) : null}
        {children}
      </div>
      {onView ? <button type="button" className="btn btn-secondary btn-sm" onClick={onView} data-testid="final-outcome-view">{t('تفاصيل الطلب', 'Application details')}</button> : null}
    </div>
  );
};

/** «المطلوب منك الآن»، أو لمن ينتظر: الإجراء ثم الجهة المسؤولة عنه (D11). */
export const TaskCard: React.FC<{ task: CurrentTask | null; returnReason?: string | null; onAct?: () => void; actLabel?: string }> = ({ task, returnReason, onAct, actLabel }) => {
  const { isAr, t } = useStore();
  const Arrow = isAr ? ArrowLeft : ArrowRight;
  if (!task) return null;
  const responsible = task.responsible.orgNameAr ? (isAr ? task.responsible.orgNameAr : task.responsible.orgNameEn) : (isAr ? task.responsible.labelAr : task.responsible.labelEn);
  return (
    <div className={`task-card${task.isMine ? '' : ' is-waiting'}`} data-testid="current-task">
      <span className="task-card-icon">{task.isMine ? <AlertTriangle size={20} /> : <Hourglass size={20} />}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="task-card-title">{task.isMine ? t('المطلوب منك الآن', 'Your action is needed') : `${isAr ? task.labelAr : task.labelEn} — ${responsible}`}</p>
        <p className="task-card-sub">{task.isMine ? `${isAr ? task.labelAr : task.labelEn} — ${responsible}` : t('بانتظار تنفيذ الجهة المسؤولة', 'Waiting for the responsible party')}</p>
        {task.overdue ? <p className="overdue-flag" style={{ margin: '0.3rem 0 0' }}><Clock size={13} /> {t('متأخر عن المهلة', 'Overdue')} ({formatDate(task.dueAt, isAr)})</p> : null}
        {/* D16: the factory reads each IMC note at its field (the wizard opens on it); here it sees how many items. */}
        {task.state === 'IMC_CORRECTION' && task.deficiencies.length ? (
          <>
            <p className="task-card-sub" style={{ marginTop: '0.45rem', fontWeight: 700 }} data-testid="returned-notice">
              {task.isMine ? t(`ليس رفضًا نهائيًا — مطلوب تعديل ${formatNumber(task.deficiencies.length, true)} بند، والملاحظة عند كل حقل.`, `Not a final rejection — ${task.deficiencies.length} item(s) to change; each note is at its field.`)
                : t('أُعيد الطلب للمصنع للتصحيح:', 'Returned to the factory for correction:')}
            </p>
            {!task.isMine ? <ul className="home-list" style={{ marginTop: '0.5rem' }}>{task.deficiencies.map((d) => <li key={d.id}><b>{isAr ? d.labelAr : d.labelEn}</b>{d.note ? ` — ${d.note}` : ''}</li>)}</ul> : null}
          </>
        ) : null}
        {task.state !== 'IMC_CORRECTION' && returnReason ? (
          <p className="task-card-sub" style={{ marginTop: '0.45rem', fontWeight: 700, whiteSpace: 'pre-line' }} data-testid="return-reason">{t('الملاحظات', 'Notes')}: {returnReason}</p>
        ) : null}
      </div>
      {onAct && task.isMine ? <button type="button" className="btn btn-primary" onClick={onAct} data-testid="task-go">{actLabel ?? t('ابدأ', 'Start')} <Arrow size={15} /></button> : null}
    </div>
  );
};

export async function downloadDocument(appId: string, doc: Pick<ApplicationDocument, 'id' | 'originalName'>, toast: (type: 'error', m: string) => void, isAr: boolean) {
  try { saveFile(await api.downloadDocument(appId, doc.id), doc.originalName); } catch (e) { toast('error', errorText(e, isAr)); }
}

/** المستندات بنسخها (المسموح بها فقط). */
export const DocumentsList: React.FC<{ app: ApplicationDetail; kinds?: string[]; onRemove?: (docId: string) => void; removable?: (d: ApplicationDocument) => boolean }> = ({ app, kinds, onRemove, removable }) => {
  const { isAr, t } = useStore();
  const { toast } = useToast();
  const docs = app.documents.filter((d) => !kinds || kinds.includes(d.kind)).sort((a, b) => a.kind.localeCompare(b.kind) || b.version - a.version);
  if (!docs.length) return <p className="text-muted" style={{ fontSize: '0.85rem' }}>{t('لا توجد مستندات.', 'No documents.')}</p>;
  return (
    <ul className="doc-list">
      {docs.map((d) => (
        <li key={d.id} className={`doc-item${d.isCurrent ? '' : ' is-old'}`}>
          <FileText size={16} aria-hidden />
          <span className="doc-name">{isAr ? d.labelAr : d.labelEn} — {d.originalName}</span>
          <span className="doc-meta">
            {t('نسخة', 'v')} {formatNumber(d.version, isAr)} · {formatBytes(d.sizeBytes)} · {formatDate(d.createdAt, isAr)}
            {!d.isCurrent ? ` · ${t('نسخة سابقة', 'previous version')}` : ''}{!d.submitted ? ` · ${t('لم تُرسل بعد', 'not submitted yet')}` : ''}
          </span>
          {d.downloadable ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => void downloadDocument(app.id, d, toast, isAr)} aria-label={t('تنزيل', 'Download')}><Download size={15} /></button> : null}
          {onRemove && removable?.(d) ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemove(d.id)}>{t('إزالة', 'Remove')}</button> : null}
        </li>
      ))}
    </ul>
  );
};

/** عرض أقسام بيانات الطلب بأسماء الحقول من meta. */
export const DataSections: React.FC<{ app: ApplicationDetail }> = ({ app }) => {
  const { isAr, t, meta } = useStore();
  if (!meta) return null;
  const optionLabel = (key: string, v: unknown): string => {
    const f = meta.form.fields.find((x) => x.key === key);
    if (f?.options === 'governorates') { const g = meta.governorates.find((x) => x.value === v); return g ? (isAr ? g.labelAr : g.labelEn) : String(v); }
    if (f?.options === 'zones') {
      const g = meta.governorates.find((x) => x.value === app.data.general?.governorate);
      const z = g?.zones.find((x) => x.value === v);
      return z ? (isAr ? z.labelAr : z.labelEn) : String(v);
    }
    if (f?.options === 'ownershipTypes') { const o = meta.form.ownershipTypes.find((x) => x.value === v); return o ? (isAr ? o.labelAr : o.labelEn) : String(v); }
    return String(v);
  };
  const SECTIONS: Array<{ key: 'general' | 'contact' | 'company' | 'engineering'; ar: string; en: string }> = [
    { key: 'general', ar: 'البيانات العامة', en: 'General data' }, { key: 'contact', ar: 'مسؤول الاتصال', en: 'Contact person' },
    { key: 'company', ar: 'أوراق الشركة', en: 'Company papers' }, { key: 'engineering', ar: 'البيانات الهندسية', en: 'Engineering data' },
  ];
  return (
    <div className="grid-2">
      {SECTIONS.map((s) => {
        const d = app.data[s.key];
        const fields = meta.form.fields.filter((f) => f.section === s.key && f.type !== 'file' && f.type !== 'files');
        return (
          <div key={s.key} className="card">
            <h3 style={{ marginTop: 0, fontSize: '0.98rem' }}>{isAr ? s.ar : s.en}</h3>
            {!d ? <p className="text-muted">{t('غير متاح', 'Not available')}</p> : (
              <dl className="kv">
                {fields.map((f) => {
                  const v = d[f.key];
                  let shown: React.ReactNode = v === undefined || v === null || v === '' ? '—' : optionLabel(f.key, v);
                  if (f.type === 'roofTable' && Array.isArray(v)) {
                    shown = (
                      <span>
                        {(v as Array<{ name: string; area: number }>).map((r, i) => <span key={i} style={{ display: 'block' }}>{r.name}: <span>{formatNumber(r.area, isAr)}</span> {t('م²', 'm²')}</span>)}
                        <b>{t('الإجمالي', 'Total')}: <span>{formatNumber(app.totalRoofArea, isAr)}</span> {t('م²', 'm²')}</b>
                      </span>
                    );
                  }
                  return (
                    <React.Fragment key={f.key}>
                      <dt>{isAr ? f.labelAr : f.labelEn}</dt>
                      <dd>{shown}</dd>
                    </React.Fragment>
                  );
                })}
              </dl>
            )}
          </div>
        );
      })}
    </div>
  );
};

export function goToApplication(id: string) {
  store.navigate('application', id);
}
