/* eslint-disable @typescript-eslint/no-explicit-any */
// نموذج ديناميكي مبني على GET /meta (الاستمارة ودراسة الجدوى) + لوحة الإجراءات + قائمة المستندات.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { errorDetails, errorText, useStore } from '../../store/state';
import type { ApplicationDetail, FieldMeta, FormKind, FormSection } from '../../api/schemas';
import { useToast } from './ToastSystem';

export const APP_SECTIONS: FormSection[] = ['personal', 'team', 'project', 'idea', 'readiness', 'declarations'];
export const STUDY_SECTIONS: FormSection[] = ['study_market', 'study_technical', 'study_financial', 'study_risks', 'study_impact', 'study_plan', 'expert'];

export const secLabel = (m: any, s: string, isAr: boolean): string => { const x = (m.form?.sections ?? []).find((y: any) => y.key === s); return x ? (isAr ? x.labelAr : x.labelEn) : s; };

export const money = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('en-US') : '—');

function useOptions(meta: any) {
  const [experts, setExperts] = useState<any[]>([]);
  useEffect(() => { api.listExperts('approved').then(setExperts).catch(() => undefined); }, []);
  return useCallback((key?: string): Array<{ value: string; labelAr: string; labelEn: string }> => {
    if (!key) return [];
    if (key === 'governorates') return (meta.governorates ?? []).map((g: any) => ({ value: g.value, labelAr: g.labelAr, labelEn: g.labelEn }));
    if (key === 'experts') return experts.map((e) => ({ value: e.id, labelAr: `${e.nameAr}${e.specialty ? ` — ${e.specialty}` : ''}`, labelEn: e.nameEn || e.nameAr }));
    return meta.options?.[key] ?? meta.form?.[key] ?? [];
  }, [meta, experts]);
}

interface FieldProps { f: FieldMeta; value: any; onCommit: (v: any) => void; disabled: boolean; error?: string; opts: ReturnType<typeof useOptions>; isAr: boolean }

/** خصائص الوصول المشتركة لكل حقل: id للربط بالعنوان، ووصف التلميح/الخطأ، وحالة الخطأ والإجبار. */
interface A11y { id?: string; 'aria-label'?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; 'aria-required'?: boolean }

const Cell: React.FC<{ type: string; value: any; onChange: (v: any) => void; onBlur: () => void; options?: any[]; isAr: boolean; disabled: boolean; a11y?: A11y }> = ({ type, value, onChange, onBlur, options, isAr, disabled, a11y }) => {
  if (type === 'select') {
    return (
      <select {...a11y} className="input" value={value ?? ''} disabled={disabled} onChange={(e) => { onChange(e.target.value); setTimeout(onBlur, 0); }}>
        <option value="">—</option>
        {(options ?? []).map((o) => <option key={o.value} value={o.value}>{isAr ? o.labelAr : o.labelEn}</option>)}
      </select>
    );
  }
  const num = ['integer', 'money', 'number', 'percent'].includes(type);
  return <input {...a11y} className="input" dir={num || type === 'nationalId' ? 'ltr' : undefined} inputMode={num ? 'decimal' : undefined} disabled={disabled}
    value={value ?? ''} onChange={(e) => onChange(num ? (e.target.value === '' ? '' : e.target.value) : e.target.value)} onBlur={onBlur} />;
};

const FieldInput: React.FC<FieldProps> = ({ f, value, onCommit, disabled, error, opts, isAr }) => {
  const [local, setLocal] = useState<any>(value);
  useEffect(() => { setLocal(value); }, [value]);
  const label = isAr ? f.labelAr : f.labelEn;
  const hint = isAr ? f.hintAr : f.hintEn;
  const commit = (v: any = local) => { if (JSON.stringify(v ?? '') !== JSON.stringify(value ?? '')) onCommit(v === '' ? null : v); };
  const id = `fld-${f.key}`;
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined;
  const a11y: A11y = { id, 'aria-describedby': describedBy, 'aria-invalid': Boolean(error) || undefined, 'aria-required': f.required || undefined };
  let control: React.ReactNode;
  switch (f.type) {
    case 'textarea':
      control = <textarea {...a11y} className="input" rows={3} disabled={disabled} value={local ?? ''} onChange={(e) => setLocal(e.target.value)} onBlur={() => commit()} />;
      break;
    case 'select':
      control = <Cell type="select" value={local} onChange={(v) => { setLocal(v); commit(v); }} onBlur={() => undefined} options={opts(f.options)} isAr={isAr} disabled={disabled} a11y={a11y} />;
      break;
    case 'yesNo':
      control = (
        <div className="row-gap" role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={describedBy} aria-required={f.required || undefined}>
          {[true, false].map((b) => (
            <label key={String(b)} className="chk"><input type="radio" name={id} disabled={disabled} checked={local === b} onChange={() => { setLocal(b); commit(b); }} /> {b ? (isAr ? 'نعم' : 'Yes') : (isAr ? 'لا' : 'No')}</label>
          ))}
        </div>
      );
      break;
    case 'checkbox':
      return (
        <label className={`chk full${error ? ' has-error' : ''}`}>
          <input type="checkbox" aria-invalid={Boolean(error) || undefined} aria-required={f.required || undefined} disabled={disabled} checked={local === true} onChange={(e) => { setLocal(e.target.checked); commit(e.target.checked); }} /> {label}
          {error ? <span className="err">{error}</span> : null}
        </label>
      );
    case 'table': {
      const rows: any[] = Array.isArray(local) ? local : [];
      const cols = f.columns ?? [];
      const set = (next: any[]) => setLocal(next);
      control = (
        <div className="tbl-wrap">
          <table className="tbl" aria-labelledby={`${id}-label`}>
            <thead><tr>{cols.map((c) => <th key={c.key}>{isAr ? c.labelAr : c.labelEn}</th>)}<th /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c.key}>
                      <Cell type={c.type} value={r[c.key]} isAr={isAr} disabled={disabled} options={opts(c.options)}
                        a11y={{ 'aria-label': `${isAr ? c.labelAr : c.labelEn} — ${isAr ? 'صف' : 'row'} ${i + 1}` }}
                        onChange={(v) => set(rows.map((x, j) => (j === i ? { ...x, [c.key]: v } : x)))} onBlur={() => commit(local)} />
                    </td>
                  ))}
                  <td>{!disabled ? <button type="button" className="btn btn-ghost" aria-label={`${isAr ? 'حذف الصف' : 'Remove row'} ${i + 1}`} onClick={() => { const n = rows.filter((_, j) => j !== i); setLocal(n); commit(n); }}>✕</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!disabled && (!f.maxItems || rows.length < f.maxItems) ? <button type="button" className="btn btn-secondary" onClick={() => set([...rows, {}])}>+ {isAr ? 'إضافة صف' : 'Add row'}</button> : null}
        </div>
      );
      break;
    }
    default: {
      const num = ['integer', 'money', 'number', 'percent'].includes(f.type);
      const t = f.type === 'date' ? 'date' : 'text';
      control = <input {...a11y} className="input" type={t} dir={num || ['nationalId', 'phone', 'email'].includes(f.type) ? 'ltr' : undefined} inputMode={num ? 'decimal' : undefined}
        disabled={disabled} value={local ?? ''} onChange={(e) => setLocal(e.target.value)} onBlur={() => commit(num && local !== '' && local != null ? Number(String(local).replace(/,/g, '')) : local)} />;
    }
  }
  return (
    <div className={`fld${['textarea', 'table'].includes(f.type) ? ' full' : ''}${error ? ' has-error' : ''}`}>
      <label id={`${id}-label`} htmlFor={['yesNo', 'table'].includes(f.type) ? undefined : id}>{label}{f.required ? <span className="req" aria-hidden> *</span> : null}</label>
      {hint ? <div className="hint" id={`${id}-hint`}>{hint}</div> : null}
      {control}
      {error ? <div className="err" id={`${id}-err`} role="alert">{error}</div> : null}
    </div>
  );
};

/** رفع مستند PDF لحقل ملف. */
const FileField: React.FC<{ f: FieldMeta; app: ApplicationDetail; disabled: boolean; onChanged: () => void; isAr: boolean; error?: string }> = ({ f, app, disabled, onChanged, isAr, error }) => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const docs = app.documents.filter((d: any) => d.kind === f.docKind && d.status === 'current');
  const multi = f.type === 'files';
  const up = async (file?: File) => {
    if (!file || !f.docKind) return;
    setBusy(true);
    try { await api.uploadDocument(app.id, f.docKind, file); onChanged(); } catch (e) { toast.toast('error', errorText(e, isAr)); } finally { setBusy(false); }
  };
  const del = async (id: string) => { try { await api.removeDocument(app.id, id); onChanged(); } catch (e) { toast.toast('error', errorText(e, isAr)); } };
  return (
    <div className={`fld full${error ? ' has-error' : ''}`}>
      <label htmlFor={`file-${f.key}`}>{isAr ? f.labelAr : f.labelEn}{f.required ? <span className="req" aria-hidden> *</span> : null}</label>
      <ul className="doclist">
        {docs.map((d: any) => (
          <li key={d.id}>
            <a href="#" onClick={async (e) => { e.preventDefault(); const b = await api.downloadDocument(app.id, d.id); window.open(URL.createObjectURL(b), '_blank'); }}>{d.originalName}</a>
            {multi && !disabled ? <button type="button" className="btn btn-ghost" onClick={() => del(d.id)} aria-label={`${isAr ? 'حذف الملف' : 'Remove file'} ${d.originalName}`}>✕</button> : null}
          </li>
        ))}
      </ul>
      {!disabled && (multi || docs.length === 0 || true) ? <input id={`file-${f.key}`} type="file" accept="application/pdf" disabled={busy} aria-required={f.required || undefined} aria-invalid={Boolean(error) || undefined} onChange={(e) => { void up(e.target.files?.[0]); e.target.value = ''; }} /> : null}
      {error ? <div className="err" role="alert">{error}</div> : null}
    </div>
  );
};

export const DynamicForm: React.FC<{ app: ApplicationDetail; kind: FormKind; errors?: Record<string, string>; onChanged: (a?: ApplicationDetail) => void }> = ({ app, kind, errors = {}, onChanged }) => {
  const { meta, isAr } = useStore();
  const m: any = meta ?? {};
  const toast = useToast();
  const sections = kind === 'application' ? APP_SECTIONS : STUDY_SECTIONS;
  const [active, setActive] = useState<FormSection>(sections[0]);
  const opts = useOptions(m);
  const fields: FieldMeta[] = m.form?.fields ?? [];
  const editable = app.editableForm === kind;
  const allowed = app.editableFields;
  const dis = (key: string) => !editable || (allowed != null && !allowed.includes(key));
  const label = (s: FormSection) => secLabel(m, s, isAr);
  const secFields = useMemo(() => fields.filter((f) => f.section === active), [fields, active]);
  const data = (app.data as any)[active] ?? {};
  const errCount = (s: FormSection) => fields.filter((f) => f.section === s && Object.keys(errors).some((k) => k === f.key || k.startsWith(`${f.key}[`))).length;
  const save = async (key: string, v: any) => {
    try { await api.saveSection(app.id, active, { [key]: v }); onChanged(); } catch (e) { toast.toast('error', Object.values(errorDetails(e, isAr))[0] ?? errorText(e, isAr)); }
  };
  const when = (f: FieldMeta) => !f.requiredWhen || data[f.requiredWhen.field] === f.requiredWhen.equals;
  return (
    <div className="dform">
      <nav className="dtabs" aria-label="sections">
        {sections.map((s, i) => (
          <button key={s} type="button" className={`dtab${s === active ? ' on' : ''}${errCount(s) ? ' bad' : ''}`} onClick={() => setActive(s)}>
            <b>{i + 1}</b> {label(s)}{errCount(s) ? <span className="dot" /> : null}
          </button>
        ))}
      </nav>
      <div className="card dpanel">
        <h2>{label(active)}</h2>
        <div className="grid2">
          {secFields.filter(when).map((f) => (f.type === 'file' || f.type === 'files'
            ? <FileField key={f.key} f={f} app={app} disabled={dis(f.key)} isAr={isAr} error={errors[f.key]} onChanged={() => onChanged()} />
            : <FieldInput key={f.key} f={f} value={data[f.key]} disabled={dis(f.key)} error={errors[f.key] ?? Object.entries(errors).find(([k]) => k.startsWith(`${f.key}[`))?.[1]} opts={opts} isAr={isAr} onCommit={(v) => save(f.key, v)} />))}
        </div>
        {active === 'study_plan' && app.studyTotals ? <Totals t={app.studyTotals} isAr={isAr} /> : null}
        <div className="row-gap between">
          <button type="button" className="btn btn-secondary" disabled={sections.indexOf(active) === 0} onClick={() => setActive(sections[sections.indexOf(active) - 1])}>{isAr ? 'السابق' : 'Back'}</button>
          <button type="button" className="btn btn-secondary" disabled={sections.indexOf(active) === sections.length - 1} onClick={() => setActive(sections[sections.indexOf(active) + 1])}>{isAr ? 'التالي' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
};

export const Totals: React.FC<{ t: any; isAr: boolean }> = ({ t, isAr }) => (
  <div className="totals">
    {[['إجمالي الأصول', 'Total assets', t.totalAssets], ['الخامات الشهرية', 'Monthly materials', t.monthlyMaterials], ['إجمالي الاستثمار', 'Total investment', t.totalInvestment],
      ['صافي ربح السنة الأولى', 'Year-1 net profit', t.firstYearNetProfit], ['إجمالي خطة التنفيذ', 'Plan total', t.planTotal], ['فرص العمل', 'Jobs', t.totalJobs]].map(([ar, en, v]: any) => (
      <div key={en} className="kpi"><b>{money(v)}</b><span>{isAr ? ar : en}</span></div>
    ))}
  </div>
);

/** لوحة الإجراءات المتاحة للمستخدم على الطلب (لا يحسب الواجهة الصلاحيات — من allowedActions). */
export const ActionPanel: React.FC<{ app: ApplicationDetail; onDone: (a: ApplicationDetail) => void; onError?: (e: unknown) => void }> = ({ app, onDone, onError }) => {
  const { meta, isAr } = useStore();
  const m: any = meta ?? {};
  const toast = useToast();
  const [cur, setCur] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [funders, setFunders] = useState<any[]>([]);
  useEffect(() => { if (cur?.requires?.funderOrgId) api.listFunders().then(setFunders).catch(() => undefined); }, [cur]);
  const labels = (kind: 'application' | 'study') => (m.form?.fields ?? []).filter((f: FieldMeta) => (kind === 'study' ? f.section.startsWith('study') || f.section === 'expert' : !f.section.startsWith('study') && f.section !== 'expert'));
  const open = (a: any) => { setCur(a); setForm({ deficiencies: [] }); setErr(''); };
  const submit = async () => {
    if (!cur) return;
    setBusy(true); setErr('');
    const r = cur.requires ?? {};
    const body: any = { expectedVersion: app.version };
    if (form.reason) body.reason = form.reason;
    if (form.note && !body.reason) body.note = form.note;
    if (r.deficiencies) body.deficiencies = (form.deficiencies ?? []).filter((d: any) => d.field);
    if (r.funderOrgId) body.funderOrgId = form.funderOrgId;
    if (r.approval) { body.approvalDate = form.approvalDate; body.approvalReference = form.approvalReference; }
    if (r.funding) { body.amount = Number(form.amount); body.model = form.model; body.terms = form.terms; }
    try {
      if (r.approval && form.file) await api.uploadDocument(app.id, 'approvalFile', form.file);
      if (r.funding && form.file) await api.uploadDocument(app.id, 'fundingDecisionFile', form.file);
      const res = await api.performAction(app.id, cur.action, body);
      toast.toast('success', isAr ? 'تم تنفيذ الإجراء' : 'Done');
      setCur(null);
      onDone(res);
    } catch (e) {
      const d = errorDetails(e, isAr);
      setErr([errorText(e, isAr), ...Object.entries(d).map(([k, v]) => `${k}: ${v}`)].join(' — '));
      onError?.(e);
    } finally { setBusy(false); }
  };
  if (!app.allowedActions.length) return null;
  const r = cur?.requires ?? {};
  const danger = (a: string) => ['reject', 'withdraw', 'not_select', 'record_not_approved', 'close_unfunded', 'decline_funding'].includes(a);
  return (
    <div className="card actions">
      <h3>{isAr ? 'الإجراءات المتاحة' : 'Available actions'}</h3>
      <div className="row-gap wrap">
        {app.allowedActions.map((a) => <button key={a.action} type="button" className={`btn ${danger(a.action) ? 'btn-danger' : 'btn-primary'}`} onClick={() => open(a)}>{isAr ? a.labelAr : a.labelEn}</button>)}
      </div>
      {cur ? (
        <div className="modal-back" role="dialog" aria-modal="true">
          <div className="card modal-box">
            <h3>{isAr ? cur.labelAr : cur.labelEn}</h3>
            {r.deficiencies ? (
              <div className="fld"><label>{isAr ? 'البنود المطلوب استيفاؤها' : 'Items to complete'}</label>
                {(form.deficiencies as any[]).map((d, i) => (
                  <div key={i} className="row-gap">
                    <select className="input" value={d.field} onChange={(e) => setForm({ ...form, deficiencies: form.deficiencies.map((x: any, j: number) => (j === i ? { ...x, field: e.target.value } : x)) })}>
                      <option value="">—</option>
                      {labels(r.deficiencies).map((f: FieldMeta) => <option key={f.key} value={f.key}>{isAr ? f.labelAr : f.labelEn}</option>)}
                    </select>
                    <input className="input" placeholder={isAr ? 'ملاحظة' : 'Note'} value={d.note ?? ''} onChange={(e) => setForm({ ...form, deficiencies: form.deficiencies.map((x: any, j: number) => (j === i ? { ...x, note: e.target.value } : x)) })} />
                  </div>
                ))}
                <button type="button" className="btn btn-secondary" onClick={() => setForm({ ...form, deficiencies: [...form.deficiencies, { field: '', note: '' }] })}>+ {isAr ? 'بند' : 'Item'}</button>
              </div>
            ) : null}
            {(r.reason || r.reasonIfOutOfRank || ['select', 'reject', 'not_select'].includes(cur.action)) ? (
              <div className="fld"><label>{isAr ? 'السبب' : 'Reason'}{r.reason ? ' *' : ''}</label>
                <textarea className="input" rows={3} value={form.reason ?? ''} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                {r.reasonIfOutOfRank ? <div className="hint">{isAr ? 'مطلوب فقط إن كان الاختيار خارج ترتيب الدرجات.' : 'Required only when selecting out of score order.'}</div> : null}
              </div>
            ) : null}
            {r.funderOrgId ? (
              <div className="fld"><label>{isAr ? 'جهة التمويل' : 'Funder'} *</label>
                <select className="input" value={form.funderOrgId ?? ''} onChange={(e) => setForm({ ...form, funderOrgId: e.target.value })}>
                  <option value="">—</option>{funders.map((f) => <option key={f.id} value={f.id}>{isAr ? f.nameAr : f.nameEn}</option>)}
                </select></div>
            ) : null}
            {r.approval ? (
              <>
                <div className="fld"><label>{isAr ? 'تاريخ الاعتماد' : 'Approval date'} *</label><input className="input" type="date" onChange={(e) => setForm({ ...form, approvalDate: e.target.value })} /></div>
                <div className="fld"><label>{isAr ? 'مرجع الاعتماد' : 'Approval reference'} *</label><input className="input" onChange={(e) => setForm({ ...form, approvalReference: e.target.value })} /></div>
                <div className="fld"><label>{isAr ? 'مستند قرار الاعتماد (PDF)' : 'Approval document (PDF)'} *</label><input type="file" accept="application/pdf" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] })} /></div>
              </>
            ) : null}
            {r.funding ? (
              <>
                <div className="fld"><label>{isAr ? 'مبلغ التمويل (جنيه)' : 'Amount (EGP)'} *</label><input className="input" dir="ltr" onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
                <div className="fld"><label>{isAr ? 'نموذج التمويل' : 'Model'} *</label>
                  <select className="input" onChange={(e) => setForm({ ...form, model: e.target.value })}><option value="">—</option>
                    {(m.options?.financingModels ?? []).map((o: any) => <option key={o.value} value={o.value}>{isAr ? o.labelAr : o.labelEn}</option>)}</select></div>
                <div className="fld"><label>{isAr ? 'الشروط' : 'Terms'} *</label><textarea className="input" rows={3} onChange={(e) => setForm({ ...form, terms: e.target.value })} /></div>
                <div className="hint">{isAr ? 'تُبنى مراحل الصرف تلقائيًا من خطة التنفيذ في الدراسة.' : 'Milestones are built from the study implementation plan.'}</div>
                <div className="fld"><label>{isAr ? 'مستند قرار التمويل (PDF)' : 'Funding decision (PDF)'}</label><input type="file" accept="application/pdf" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] })} /></div>
              </>
            ) : null}
            {!r.reason && !r.deficiencies && !r.funderOrgId && !r.approval && !r.funding && !['select', 'reject', 'not_select'].includes(cur.action) ? (
              <div className="fld"><label>{isAr ? 'ملاحظة (اختياري)' : 'Note (optional)'}</label><textarea className="input" rows={2} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            ) : null}
            {err ? <div className="err" role="alert">{err}</div> : null}
            <div className="row-gap between">
              <button type="button" className="btn btn-secondary" onClick={() => setCur(null)}>{isAr ? 'إلغاء' : 'Cancel'}</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{isAr ? 'تأكيد' : 'Confirm'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

/** ملخص قراءة فقط لبيانات الطلب (للجهات). */
export const DataSummary: React.FC<{ app: ApplicationDetail }> = ({ app }) => {
  const { meta, isAr } = useStore();
  const m: any = meta ?? {};
  const opts = useOptions(m);
  const fields: FieldMeta[] = m.form?.fields ?? [];
  const show = (f: FieldMeta, v: any): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? (isAr ? 'نعم' : 'Yes') : (isAr ? 'لا' : 'No');
    if (f.type === 'select') { const o = opts(f.options).find((x) => x.value === v); return o ? (isAr ? o.labelAr : o.labelEn) : String(v); }
    if (f.type === 'money') return money(v);
    if (f.type === 'table' && Array.isArray(v)) return v.map((r) => (f.columns ?? []).map((c) => r[c.key]).join(' | ')).join('\n');
    return String(v);
  };
  const secs = [...APP_SECTIONS, ...STUDY_SECTIONS].filter((s) => (app.data as any)[s] && Object.keys((app.data as any)[s]).length);
  return (
    <>
      {secs.map((s) => (
        <details key={s} className="card sec" open={s === 'personal'}>
          <summary>{secLabel(m, s, isAr)}</summary>
          <dl className="dl">
            {fields.filter((f) => f.section === s && f.type !== 'file' && f.type !== 'files').map((f) => {
              const v = (app.data as any)[s][f.key];
              return v === undefined ? null : <React.Fragment key={f.key}><dt>{isAr ? f.labelAr : f.labelEn}</dt><dd style={{ whiteSpace: 'pre-line' }}>{show(f, v)}</dd></React.Fragment>;
            })}
          </dl>
        </details>
      ))}
    </>
  );
};

export const DocsList: React.FC<{ app: ApplicationDetail }> = ({ app }) => {
  const { isAr } = useStore();
  const docs = app.documents.filter((d: any) => d.downloadable !== false);
  if (!docs.length) return null;
  return (
    <div className="card sec"><h3>{isAr ? 'المستندات' : 'Documents'}</h3>
      <ul className="doclist">{docs.map((d: any) => (
        <li key={d.id}><a href="#" onClick={async (e) => { e.preventDefault(); const b = await api.downloadDocument(app.id, d.id); window.open(URL.createObjectURL(b), '_blank'); }}>{isAr ? d.labelAr : d.labelEn} — {d.originalName}</a></li>
      ))}</ul></div>
  );
};

export const History: React.FC<{ app: ApplicationDetail }> = ({ app }) => {
  const { isAr } = useStore();
  if (!app.transitions.length) return null;
  return (
    <div className="card sec"><h3>{isAr ? 'سجل القرارات' : 'History'}</h3>
      <ol className="hist">{app.transitions.map((t: any) => (
        <li key={t.id}><b>{isAr ? t.toLabelAr : t.toLabelEn}</b> <small>{new Date(t.createdAt).toLocaleString(isAr ? 'ar-EG' : 'en-GB')} — {t.actorName}</small>{t.reason ? <div>{t.reason}</div> : null}</li>
      ))}</ol></div>
  );
};

export const Pill: React.FC<{ children: React.ReactNode; kind?: string }> = ({ children, kind = 'blue' }) => <span className={`pill pill-${kind}`}>{children}</span>;
