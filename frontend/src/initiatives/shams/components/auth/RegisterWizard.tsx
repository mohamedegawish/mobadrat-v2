/**
 * صفحة تسجيل المصنع: كل بيانات Registration Form V01.xlsx في مكان واحد، مقسمة على خطوات، مع بيانات الدخول في خطوة مسؤول الاتصال.
 * - ما يُدخل يُحفظ في المتصفح فورًا (localStorage للنصوص، IndexedDB للملفات) فلا يضيع بالتحديث أو الإغلاق. كلمة المرور لا تُحفظ.
 * - «إنشاء الحساب» يرسل الحساب + بيانات الأقسام الأربعة في طلب واحد (POST /auth/register)، فيُنشأ الحساب ومسودة الطلب معًا.
 * - المستندات لا تُرفع قبل تفعيل البريد (L7: لا تخزين ملفات لحساب غير مُثبت)؛ تبقى في هذا المتصفح، وبعد التفعيل وأول دخول
 *   تعرض «لوحتي» رفعها إلى الطلب.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCircle2, FileText, KeyRound, MailCheck, RotateCcw, Trash2, UserPlus } from 'lucide-react';
import { api, ApiException, type FieldMeta, type FormSection } from '../../api';
import { errorDetails, errorText, store, useStore } from '../../store/state';
import { formatBytes, formatNumber } from '../../hooks/useAsync';
import { clientFieldIssue, toLatinDigits, validationMessage } from '../../utils/validation';
import {
  addLocalFile, clearDone, clearLocalFiles, clearTextDraft, listLocalFiles, loadDone, loadTextDraft, localFilesAvailable,
  removeLocalFile, saveDone, saveTextDraft, toFile, type LocalFile,
} from '../../utils/registrationDraft';
import {
  completeRoofRows, DataFieldControl, emptyForm, FieldLabel, FORM_SECTION_STEPS, FormSummary, IssueList, missingFields, normalizeFieldInput, type FormState,
} from '../application/FormFields';
import { SITE_NAME } from '../../content/shams';
import { ErrorBox } from '../ui/ErrorBox';
import { PdfUploader } from '../ui/PdfUploader';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Loading } from '../common/StateViews';
import { useToast } from '../common/ToastSystem';

const STEPS: Array<{ section: FormSection | 'review'; ar: string; en: string }> = [
  FORM_SECTION_STEPS[0],
  { section: 'contact', ar: 'مسؤول الاتصال وبيانات الدخول', en: 'Contact person & sign-in' },
  FORM_SECTION_STEPS[2],
  FORM_SECTION_STEPS[3],
  { section: 'review', ar: 'المراجعة وإنشاء الحساب', en: 'Review & create account' },
];
const FORM_STEP_COUNT = 4;
const SAVE_DELAY_MS = 300;

const strongPassword = (p: string) => p.length >= 8 && p.length <= 128 && /[A-Za-z]/.test(p) && /\d/.test(p);
/** أخطاء السيرفر لحقول الحساب ← حقول الفورم التي تعرضها هذه الصفحة. */
const SERVER_FIELD: Record<string, string> = { email: 'contactEmail', mobile: 'contactMobile' };

/** ما يُرسل للسيرفر: القيم غير الفارغة فقط، وصفوف الأسطح المكتملة، واسم الشركة خارج القسم (حقل الحساب). */
function buildApplication(form: FormState): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const { section } of FORM_SECTION_STEPS) {
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form[section])) {
      if (section === 'general' && k === 'companyName') continue;
      const val = k === 'roofAreas' ? completeRoofRows(v) : typeof v === 'string' ? v.trim() : v;
      if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) continue;
      data[k] = val;
    }
    if (Object.keys(data).length) out[section] = data;
  }
  return out;
}

export const RegisterView: React.FC = () => {
  const { t, isAr, meta } = useStore();
  const { toast } = useToast();
  const restored = useRef(loadTextDraft());
  const [doneEmail, setDoneEmail] = useState<string | null>(() => loadDone());
  const [step, setStep] = useState(() => Math.min(Math.max(restored.current?.step ?? 0, 0), STEPS.length - 1));
  const [form, setForm] = useState<FormState>(() => ({ ...emptyForm(), ...(restored.current?.form ?? {}) } as FormState));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [filesOk, setFilesOk] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  /** متصفح يمنع التخزين المحلي (التصفح الخاص): الملفات في الذاكرة فقط وتضيع بالتحديث. */
  const [memFiles, setMemFiles] = useState<LocalFile[]>([]);
  const [resetting, setResetting] = useState(false);
  const [showRestored, setShowRestored] = useState(Boolean(restored.current));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshFiles = async () => setFiles(await listLocalFiles(null));
  useEffect(() => { void localFilesAvailable().then(setFilesOk); void refreshFiles(); }, []);

  // الحفظ في المتصفح بعد كل تعديل (وعند الخروج من الصفحة).
  const latest = useRef({ step, form });
  latest.current = { step, form };
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (doneEmail) return;
    // بعد إنشاء الحساب لا يُكتب شيء في المتصفح (البيانات صارت في الطلب على السيرفر).
    saveTimer.current = setTimeout(() => { if (!loadDone()) saveTextDraft(latest.current); }, SAVE_DELAY_MS);
  }, [step, form, doneEmail]);
  useEffect(() => {
    const flush = () => { if (!loadDone()) saveTextDraft(latest.current); };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); if (saveTimer.current) clearTimeout(saveTimer.current); flush(); };
  }, []);

  const fields = meta?.form.fields ?? [];
  const fieldOf = (key: string) => fields.find((f) => f.key === key);
  const allFiles = filesOk ? files : memFiles;
  const filesOfKind = (kind: string) => allFiles.filter((f) => f.kind === kind);
  const clearFileError = (kind: string) => setErrors((prev) => { const n = { ...prev }; delete n[kind === 'electricityBill' ? 'electricityBills' : kind]; return n; });

  const change = (section: FormSection, key: string, raw: unknown) => {
    const f = fieldOf(key);
    const value = normalizeFieldInput(f, raw);
    setForm((prev) => {
      const next = { ...prev, [section]: { ...prev[section], [key]: value } };
      if (key === 'governorate') next.general = { ...next.general, industrialZone: '' };
      return next;
    });
    const issue = f ? clientFieldIssue(f.type, value) : null;
    setErrors((prev) => { const n = { ...prev }; if (issue) n[key] = validationMessage(issue, isAr); else delete n[key]; return n; });
  };

  // ── التحقق: الناقص من الفورم (تنبيه)، وغير الصحيح (يمنع)، وبيانات الحساب (تمنع) ──
  const missing = useMemo(() => (meta ? missingFields(fields, form, (kind) => filesOfKind(kind).length, meta.form.electricityBills.min) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meta, form, files]);
  const invalid = useMemo(() => Object.keys(errors).map((k) => fieldOf(k)).filter((f): f is FieldMeta => Boolean(f)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [errors, meta]);
  const companyName = String(form.general.companyName ?? '').trim();
  const contactName = String(form.contact.contactName ?? '').trim();
  const email = String(form.contact.contactEmail ?? '').trim();
  const mobile = toLatinDigits(String(form.contact.contactMobile ?? '').trim());
  const accountIssues: Array<{ key: string; section: FormSection; text: string }> = [];
  if (companyName.length < 2) accountIssues.push({ key: 'companyName', section: 'general', text: t('اسم الشركة (حرفان على الأقل)', 'Company name (at least 2 characters)') });
  if (contactName.length < 2) accountIssues.push({ key: 'contactName', section: 'contact', text: t('اسم مسؤول الاتصال (حرفان على الأقل)', 'Contact name (at least 2 characters)') });
  if (!email || clientFieldIssue('email', email)) accountIssues.push({ key: 'contactEmail', section: 'contact', text: t('بريد إلكتروني صحيح (للدخول وتفعيل الحساب)', 'A valid email (for sign-in and activation)') });
  if (!mobile || clientFieldIssue('phone', mobile)) accountIssues.push({ key: 'contactMobile', section: 'contact', text: t('رقم موبايل صحيح', 'A valid mobile number') });
  if (!strongPassword(password)) accountIssues.push({ key: 'regPassword', section: 'contact', text: t('كلمة مرور: 8 أحرف على الأقل، حروف وأرقام', 'Password: at least 8 characters, letters and digits') });
  else if (password !== confirm) accountIssues.push({ key: 'confirm', section: 'contact', text: t('تأكيد كلمة المرور مطابق', 'Matching password confirmation') });

  const leftIn = (s: FormSection) => new Set([
    ...missing.filter((f) => f.section === s).map((f) => f.key), ...invalid.filter((f) => f.section === s).map((f) => f.key),
    ...accountIssues.filter((a) => a.section === s).map((a) => a.key),
  ]).size;
  const sectionComplete = (s: FormSection | 'review') => s !== 'review' && leftIn(s) === 0;
  const completed = FORM_SECTION_STEPS.filter((s) => sectionComplete(s.section)).length;

  const goStep = (i: number) => { setStep(i); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const goField = (key: string) => {
    const section = fieldOf(key)?.section ?? accountIssues.find((a) => a.key === key)?.section;
    const i = STEPS.findIndex((s) => s.section === section);
    if (i < 0) return;
    goStep(i);
    setTimeout(() => {
      const el = document.getElementById(key === 'regPassword' || key === 'confirm' ? key : `f-${key}`) ?? document.querySelector<HTMLElement>(`[data-field="${key}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (el?.matches('input,select,textarea') ? el : el?.querySelector<HTMLElement>('input,select,textarea,button'))?.focus();
    }, 60);
  };

  const addFile = async (kind: string, file: File, replace: boolean) => {
    clearFileError(kind);
    if (!filesOk) {
      const rec: LocalFile = { id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind, name: file.name, type: file.type, size: file.size, blob: file, addedAt: new Date().toISOString(), owner: null };
      setMemFiles((prev) => [...(replace ? prev.filter((x) => x.kind !== kind) : prev), rec]);
      return;
    }
    if (replace) for (const old of filesOfKind(kind)) await removeLocalFile(old.id);
    await addLocalFile(kind, file);
    await refreshFiles();
  };
  const dropFile = async (id: string) => {
    const kind = allFiles.find((x) => x.id === id)?.kind;
    if (kind) clearFileError(kind);
    if (!filesOk) { setMemFiles((prev) => prev.filter((x) => x.id !== id)); return; }
    await removeLocalFile(id);
    await refreshFiles();
  };

  const submit = async () => {
    setSubmitError('');
    if (accountIssues.length || invalid.length || missing.length) return;
    setBusy(true); setProgress(0);
    try {
      // الحساب + كل أقسام النموذج + المستندات في طلب واحد؛ قبول الحساب مبني على هذه المستندات.
      await api.register({ companyName, contactName, email, mobile, password, application: buildApplication(form) },
        allFiles.map((f) => ({ kind: f.kind, file: toFile(f) })), setProgress);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveDone(email);
      clearTextDraft();
      await clearLocalFiles(null);
      setMemFiles([]);
      setPassword(''); setConfirm('');
      setDoneEmail(email);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setSubmitError(errorText(e, isAr));
      if (e instanceof ApiException) {
        const mapped = Object.fromEntries(Object.entries(errorDetails(e, isAr)).map(([k, v]) => [SERVER_FIELD[k] ?? k.split(/[[.]/)[0], v]));
        setErrors((prev) => ({ ...prev, ...mapped }));
      }
    } finally { setBusy(false); setProgress(null); }
  };

  const startOver = async () => {
    clearTextDraft();
    await clearLocalFiles(null);
    setForm(emptyForm()); setPassword(''); setConfirm(''); setErrors({}); setStep(0); setShowRestored(false); setResetting(false);
    await refreshFiles();
    toast('success', t('تم مسح البيانات المحفوظة في هذا المتصفح.', 'Saved data cleared from this browser.'));
  };

  if (doneEmail) return <RegisterDone email={doneEmail} onAnother={() => { clearDone(); setDoneEmail(null); setForm(emptyForm()); setStep(0); setShowRestored(false); }} />;
  if (!meta) return <div className="container-custom page"><Loading /></div>;

  const current = STEPS[step];
  const sectionFields = (s: FormSection) => fields.filter((f) => f.section === s);

  return (
    <div className="container-custom page register-page">
      <div className="page-head">
        <div>
          <h1 className="page-title"><UserPlus size={20} style={{ verticalAlign: '-3px' }} /> {t(`تسجيل مصنع في مبادرة ${SITE_NAME.ar}`, `Register a factory — ${SITE_NAME.en}`)}</h1>
          <p className="page-sub">{t('أدخل بيانات نموذج التسجيل كاملة هنا على خطوات. يُحفظ ما تدخله في هذا المتصفح تلقائيًا، فلا يضيع إذا حدّثت الصفحة أو أغلقتها.', 'Enter the whole registration form here, step by step. What you enter is saved in this browser automatically, so a refresh or closing the page does not lose it.')}</p>
        </div>
        <div className="row" style={{ gap: '0.4rem' }}>
          {showRestored ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setResetting(true)} data-testid="register-start-over"><RotateCcw size={14} aria-hidden /> {t('البدء من جديد', 'Start over')}</button>
          ) : null}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => store.navigate('login')}>{t('لديك حساب؟ سجّل الدخول', 'Have an account? Sign in')}</button>
        </div>
      </div>

      <div className="wizard-mobile-label">
        {t(`الخطوة ${formatNumber(step + 1, true)} من ${formatNumber(STEPS.length, true)}`, `Step ${step + 1} of ${STEPS.length}`)}: <b>{isAr ? current.ar : current.en}</b>
      </div>
      <div className="wizard-steps" role="tablist">
        {STEPS.map((s, i) => {
          const complete = sectionComplete(s.section);
          return (
            <button key={s.section} type="button" role="tab" aria-selected={i === step} data-testid={`reg-step-${s.section}`} data-complete={complete ? '1' : '0'}
              className={`wizard-step${i === step ? ' active' : complete ? ' done' : ''}`} onClick={() => goStep(i)}>
              <span className="num">{complete && i !== step ? <Check size={13} aria-label={t('مكتمل', 'complete')} /> : formatNumber(i + 1, isAr)}</span>{isAr ? s.ar : s.en}
              {s.section !== 'review' && !complete ? <span className="wizard-step-left">{formatNumber(leftIn(s.section), isAr)}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="wizard-progress-label" data-testid="reg-progress-label">
        <span>{t(`اكتمل ${formatNumber(completed, true)} من ${formatNumber(FORM_STEP_COUNT, true)} أقسام`, `${completed} of ${FORM_STEP_COUNT} sections complete`)}</span>
        <span className="form-helper" style={{ margin: 0 }}>{t('محفوظ في هذا المتصفح', 'Saved in this browser')} <Check size={12} /></span>
      </div>
      <div className="wizard-progress" role="progressbar" aria-valuemin={0} aria-valuemax={FORM_STEP_COUNT} aria-valuenow={completed}><span style={{ width: `${(completed / FORM_STEP_COUNT) * 100}%` }} /></div>

      <div className="card">
        {current.section === 'review' ? (
          <div className="stack">
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{t('مراجعة البيانات قبل إنشاء الحساب', 'Review before creating the account')}</h2>
            {accountIssues.length ? (
              <div className="error-box" data-testid="account-issues">
                <b>{t('مطلوب لإنشاء الحساب', 'Required to create the account')}:</b>
                <ul style={{ margin: '0.4rem 0 0' }}>
                  {accountIssues.map((a) => <li key={a.key}><button type="button" className="btn btn-ghost btn-sm" onClick={() => goField(a.key)} data-testid={`account-issue-${a.key}`}>{a.text}</button></li>)}
                </ul>
              </div>
            ) : null}
            <IssueList testId="invalid-list" title={t('حقول قيمتها غير صحيحة', 'Fields with invalid values')} items={invalid} prefix="invalid" onGo={goField} />
            {missing.length ? (
              <div className="error-box" data-testid="register-missing">
                <span style={{ flex: 1 }}>
                  <b>{t(`بنود ناقصة (${formatNumber(missing.length, true)}) — مطلوبة قبل إنشاء الحساب، لأن قبول الحساب مبني على النموذج كاملًا:`, `${missing.length} missing item(s) — required before creating the account, because the account is approved on the complete form:`)}</b>
                  <span className="review-missing-links">{missing.map((f) => <button key={f.key} type="button" className="btn btn-ghost btn-sm" onClick={() => goField(f.key)} data-testid={`missing-${f.key}`}>{isAr ? f.labelAr : f.labelEn}</button>)}</span>
                </span>
              </div>
            ) : !accountIssues.length && !invalid.length ? (
              <div className="badge badge-approved" style={{ alignSelf: 'flex-start', padding: '0.5rem 0.8rem' }} data-testid="review-complete"><CheckCircle2 size={15} /> {t('كل بيانات نموذج التسجيل مكتملة', 'The registration form is complete')}</div>
            ) : null}
            <FormSummary form={form} missing={missing} invalid={invalid} onEdit={(s) => goStep(STEPS.findIndex((x) => x.section === s))}
              filesOf={(f) => filesOfKind(f.docKind!).map((x) => ({ id: x.id, name: x.name, sizeBytes: x.size }))}
              extraRows={{ contact: [{ key: 'password', label: t('كلمة المرور', 'Password'), value: password ? '••••••••' : <span className="review-empty">{t('مطلوب — لم يُدخل', 'Required — not provided')}</span> }] }} />
          </div>
        ) : (
          <div className="field-grid">
            {sectionFields(current.section).map((f) => (f.type === 'file' || f.type === 'files') ? (
              <LocalDocField key={f.key} field={f} files={filesOfKind(f.docKind!)} available={filesOk}
                onAdd={(file) => addFile(f.docKind!, file, f.type === 'file')} onRemove={(id) => void dropFile(id)} />
            ) : (
              <DataFieldControl key={f.key} field={f} value={form[current.section as FormSection][f.key]} governorate={String(form.general.governorate ?? '')}
                error={errors[f.key]} onChange={(v) => change(current.section as FormSection, f.key, v)}
                hint={f.key === 'contactEmail' ? t('يُستخدم أيضًا لتسجيل الدخول وتفعيل الحساب.', 'Also used to sign in and activate the account.')
                  : f.key === 'contactName' ? t('صاحب الحساب على المنصة.', 'The account holder on the platform.') : undefined} />
            ))}
            {current.section === 'contact' ? (
              <fieldset className="span-2 register-credentials" data-testid="register-credentials">
                <legend><KeyRound size={15} style={{ verticalAlign: '-2px' }} /> {t('بيانات الدخول', 'Sign-in details')}</legend>
                <div className="field-grid">
                  <div className="form-group">
                    <label className="form-label required" htmlFor="regPassword">{t('كلمة المرور', 'Password')}</label>
                    <input id="regPassword" name="regPassword" type="password" autoComplete="new-password" className={`form-control${password && !strongPassword(password) ? ' is-invalid' : ''}`}
                      value={password} onChange={(e) => setPassword(e.target.value)} />
                    <div className={password && !strongPassword(password) ? 'field-error' : 'form-helper'}>{t('8 أحرف على الأقل، حروف وأرقام. لا تُحفظ في المتصفح.', 'At least 8 characters, letters and digits. Never saved in the browser.')}</div>
                  </div>
                  <div className="form-group">
                    <label className="form-label required" htmlFor="confirm">{t('تأكيد كلمة المرور', 'Confirm password')}</label>
                    <input id="confirm" name="confirm" type="password" autoComplete="new-password" className={`form-control${confirm && confirm !== password ? ' is-invalid' : ''}`}
                      value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                    {confirm && confirm !== password ? <div className="field-error">{t('غير مطابقة.', 'Does not match.')}</div> : null}
                  </div>
                </div>
              </fieldset>
            ) : null}
          </div>
        )}
        {submitError ? <ErrorBox style={{ marginTop: '1rem' }} message={submitError} /> : null}
        <div className="wizard-nav">
          <button type="button" className="btn btn-secondary" disabled={step === 0} onClick={() => goStep(step - 1)}>{t('السابق', 'Previous')}</button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn-primary" onClick={() => goStep(step + 1)} data-testid="reg-next">
              {step === STEPS.length - 2 ? t('التالي: المراجعة', 'Next: review') : t('التالي', 'Next')}
            </button>
          ) : (
            <div className="row" style={{ gap: '0.6rem' }}>
              {progress !== null ? (
                <span className="upload-progress" data-testid="register-progress">
                  <span className="upload-progress-bar"><span style={{ width: `${Math.round(progress * 100)}%` }} /></span>
                  {progress < 1 ? t(`جارٍ رفع المستندات… ${formatNumber(Math.round(progress * 100), true)}٪`, `Uploading documents… ${Math.round(progress * 100)}%`) : t('جارٍ التحقق وإنشاء الحساب…', 'Checking and creating the account…')}
                </span>
              ) : accountIssues.length || invalid.length || missing.length ? <span className="form-helper">{t('أكمل كل البنود وصحّح الحقول المعلّمة أولًا', 'Complete every item and fix the marked fields first')}</span> : null}
              <button type="button" className="btn btn-gold" onClick={() => void submit()} disabled={busy || accountIssues.length > 0 || invalid.length > 0 || missing.length > 0} data-testid="register-submit">
                <UserPlus size={16} /> {busy ? t('جارٍ إنشاء الحساب…', 'Creating the account…') : t('إنشاء الحساب وإرسال المستندات', 'Create account & send documents')}
              </button>
            </div>
          )}
        </div>
      </div>

      {resetting ? (
        <ConfirmDialog danger title={t('البدء من جديد', 'Start over')}
          message={t('ستُمسح كل البيانات والمستندات المحفوظة في هذا المتصفح لصفحة التسجيل.', 'All data and documents saved in this browser for the registration page will be deleted.')}
          confirmLabel={t('مسح والبدء من جديد', 'Clear and start over')} onConfirm={() => void startOver()} onCancel={() => setResetting(false)} />
      ) : null}
    </div>
  );
};

/** مستند في صفحة التسجيل: يُحفظ في المتصفح حتى تفعيل الحساب. */
const LocalDocField: React.FC<{ field: FieldMeta; files: LocalFile[]; available: boolean; onAdd: (f: File) => Promise<void>; onRemove: (id: string) => void }> = ({ field: f, files, available, onAdd, onRemove }) => {
  const { t, isAr, meta } = useStore();
  const multi = f.type === 'files';
  const max = multi ? meta?.form.electricityBills.max ?? 12 : 1;
  return (
    <div className="form-group span-2 doc-field" data-field={f.key}>
      <FieldLabel field={f} />
      {files.length ? (
        <ul className="doc-list" data-testid={`docs-${f.key}`}>
          {files.map((d) => (
            <li key={d.id} className="doc-item is-uploaded" data-testid={`doc-${f.key}`}>
              <CheckCircle2 size={16} className="doc-ok" aria-label={t('محفوظ', 'Saved')} />
              <span className="doc-name">{d.name}</span>
              <span className="doc-meta">{formatBytes(d.size)} · {available ? t('جاهز — محفوظ في هذا المتصفح ويُرفع مع إنشاء الحساب', 'ready — kept in this browser, uploaded with the account') : t('جاهز — يُرفع مع إنشاء الحساب', 'ready — uploaded with the account')}</span>
              <button type="button" className="btn btn-ghost btn-sm doc-remove" onClick={() => onRemove(d.id)} data-testid={`remove-${f.key}`} aria-label={t('حذف الملف', 'Remove file')} title={t('حذف الملف', 'Remove file')}><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`doc-empty${f.required ? ' is-required' : ''}`} data-testid={`doc-empty-${f.key}`}>
          {multi ? t('لم تُختر أي فاتورة بعد.', 'No bills chosen yet.') : t('لم يُختر الملف بعد.', 'No file chosen yet.')}
        </p>
      )}
      {multi ? <div className="form-helper">{t(`فاتورة لكل شهر (حتى ${formatNumber(max, true)}) — المختار: ${formatNumber(files.length, isAr)}`, `One bill per month (up to ${max}) — chosen: ${files.length}`)}</div> : null}
      {!available ? <div className="deficiency-note">{t('متصفحك لا يسمح بحفظ الملفات (مثل التصفح الخاص): المستندات المختارة تضيع إذا حدّثت الصفحة قبل إنشاء الحساب.', 'Your browser does not allow saving files (e.g. private mode): chosen documents are lost if you refresh before creating the account.')}</div> : null}
      {!multi || files.length < max ? (
        <div style={{ marginTop: '0.5rem' }}>
          <PdfUploader onFile={onAdd} testId={`upload-${f.key}`}
            label={multi ? t(`أضف فاتورة (${formatNumber(files.length, true)}/${formatNumber(max, true)})`, `Add a bill (${files.length}/${max})`) : files.length ? t('استبدال الملف', 'Replace the file') : undefined} />
        </div>
      ) : null}
    </div>
  );
};

/** بعد إنشاء الحساب: راجع بريدك (تبقى بعد تحديث الصفحة). */
const RegisterDone: React.FC<{ email: string; onAnother: () => void }> = ({ email, onAnother }) => {
  const { t, isAr } = useStore();
  const [info, setInfo] = useState('');
  const resend = async () => {
    try { setInfo((await api.resendVerification(email)).message); } catch (e) { setInfo(errorText(e, isAr)); }
  };
  return (
    <div className="container-custom page">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <div className="card">
          <div className="row" style={{ marginBottom: '1rem' }}>
            <span className="home-card-icon"><MailCheck size={20} /></span>
            <h1 className="page-title" style={{ fontSize: '1.2rem' }}>{t('راجع بريدك الإلكتروني', 'Check your email')}</h1>
          </div>
          <p style={{ lineHeight: 1.9 }} data-testid="register-done">
            {t(`استلمنا بيانات التسجيل ومستنداته، وأرسلنا رابط تفعيل إلى ${email}.`, `We received the registration data and documents, and sent an activation link to ${email}.`)}
          </p>
          <ol className="register-next" data-testid="register-next-steps">
            <li>{t('افتح رابط التفعيل في بريدك — يُرسل طلب التسجيل بعده لمراجعة مركز تحديث الصناعة (IMC).', 'Open the activation link — the registration then goes to IMC review.')}</li>
            <li>{t('يصلك بريد بالقرار: قبول الحساب، أو طلب تعديل بيانات، أو الرفض.', 'You will be emailed the decision: approval, a request to edit data, or rejection.')}</li>
            <li>{t('عند القبول تسجّل الدخول وتتابع باقي مراحل المبادرة. عند طلب التعديل تدخل لتعديل البنود المطلوبة فقط.', 'Once approved, sign in and continue. If edits are requested, you sign in to edit those items only.')}</li>
          </ol>
          <p className="form-helper"><FileText size={13} style={{ verticalAlign: '-2px' }} /> {t('لا يمكن الدخول إلى المنصة قبل قبول الحساب.', 'Sign-in is available only after the account is approved.')}</p>
          {info ? <div className="form-helper" role="status">{info}</div> : null}
          <div className="row" style={{ gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void resend()}>{t('إعادة إرسال رابط التفعيل', 'Resend activation link')}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onAnother} data-testid="register-another">{t('تسجيل مصنع آخر', 'Register another factory')}</button>
          </div>
        </div>
      </div>
    </div>
  );
};
