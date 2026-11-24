import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Check, CloudOff, Download, Loader2, Save, Send, Trash2 } from 'lucide-react';
import { api, ApiException, type ApplicationDetail, type ApplicationDocument, type DocumentKind, type FieldMeta, type FormSection } from '../../api';
import { errorDetails, errorText, isRestrictedFactory, store, useStore } from '../../store/state';
import { useAsync, formatBytes, formatDate, formatNumber } from '../../hooks/useAsync';
import { clientFieldIssue, validationMessage } from '../../utils/validation';
import { completeRoofRows, DataFieldControl, FieldLabel, FormSummary, IssueList, missingFields, normalizeFieldInput, FORM_SECTION_STEPS, type FormState, type SectionData } from '../application/FormFields';
import { setSubmitFlash } from '../../utils/submitFlash';
import { setPlatformFlash } from '../../../../core/session';
import { Loading, ErrorState, NotAvailable } from '../common/StateViews';
import { ErrorBox } from '../ui/ErrorBox';
import { ObjectionDialog } from './ObjectionDialog';
import { PdfUploader } from '../ui/PdfUploader';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { StateBadge } from '../ui/StateBadge';
import { downloadDocument } from '../application/shared';
import { useToast } from '../common/ToastSystem';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const STEPS: Array<{ section: FormSection | 'review'; ar: string; en: string }> = [
  ...FORM_SECTION_STEPS,
  { section: 'review', ar: 'المراجعة والإرسال', en: 'Review & submit' },
];
const FORM_STEPS = FORM_SECTION_STEPS;

const AUTOSAVE_MS = 1200;

export const ApplicationWizard: React.FC = () => {
  const { param: appId, meta, isAr, t, user } = useStore();
  const restricted = isRestrictedFactory(user);
  const { toast } = useToast();
  // بلا معرف (#apply مباشرة/تحديث/رابط محفوظ) كان الطلب يذهب إلى /applications/ فيرجع القائمة لا طلبًا فتنهار الصفحة؛
  // لا نجلب شيئًا ونحوّل إلى «لوحتي» حيث «بدء طلب جديد».
  const res = useAsync<ApplicationDetail | null>(() => (appId ? api.getApplication(appId) : Promise.resolve(null)), [appId]);
  const app = res.data;
  useEffect(() => { if (!appId) store.navigate('factory-dashboard'); }, [appId]);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>({ general: {}, contact: {}, company: {}, engineering: {} });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [submitError, setSubmitError] = useState<{ message: string; details: string[]; objectable?: boolean } | null>(null);
  const [objecting, setObjecting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [removing, setRemoving] = useState<ApplicationDocument | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const pending = useRef<Partial<Record<FormSection, SectionData>>>({});
  const inFlight = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (app && loadedFor.current !== app.id) {
      loadedFor.current = app.id;
      setForm({ general: { ...(app.data.general ?? {}) }, contact: { ...(app.data.contact ?? {}) }, company: { ...(app.data.company ?? {}) }, engineering: { ...(app.data.engineering ?? {}) } });
    }
  }, [app]);

  const correction = app ? app.state !== 'DRAFT' : false;
  const editable = useCallback((key: string) => Boolean(app?.editableFields.includes(key)), [app]);
  const defNote = (key: string) => app?.currentTask?.deficiencies.find((d) => d.field === key)?.note;
  const label = (f: { labelAr: string; labelEn: string }) => (isAr ? f.labelAr : f.labelEn);

  /** يحفظ التعديلات المعلقة (يُستدعى بالمؤقت أو قبل الانتقال/الإرسال). */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const batches = pending.current;
    pending.current = {};
    const sections = Object.keys(batches) as FormSection[];
    if (!sections.length || !app) return true;
    setSaveState('saving');
    inFlight.current++;
    let ok = true;
    for (const s of sections) {
      try {
        await api.saveSection(app.id, s, batches[s]!);
        setFieldErrors((prev) => { const n = { ...prev }; for (const k of Object.keys(batches[s]!)) delete n[k]; delete n._save; return n; });
      } catch (e) {
        ok = false;
        // roofAreas[0].area → roofAreas (الخطأ يظهر تحت الحقل نفسه)
        const d = Object.fromEntries(Object.entries(errorDetails(e, isAr)).map(([k, v]) => [k.split(/[[.]/)[0], v]));
        setFieldErrors((prev) => ({ ...prev, ...(Object.keys(d).length ? d : { _save: errorText(e, isAr) }) }));
      }
    }
    inFlight.current--;
    setSaveState(ok ? 'saved' : 'error');
    return ok;
  }, [app, isAr]);

  // عدم فقدان البيانات: التعديلات التي لم يحن موعد حفظها التلقائي تُحفظ عند مغادرة المعالج داخل المنصة،
  // ويُنبَّه المستخدم قبل إغلاق التبويب أو تحديثه أثناء وجود تعديلات لم تُحفظ بعد.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const hasUnsaved = () => Object.keys(pending.current).length > 0 || inFlight.current > 0;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (hasUnsaved()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (timer.current) clearTimeout(timer.current);
      if (Object.keys(pending.current).length) void flushRef.current();
    };
  }, []);

  const change = (section: FormSection, key: string, valueIn: unknown) => {
    // I2: أرقام لوحة المفاتيح العربية في الهاتف والأرقام والتواريخ وأرقام السجلات.
    const f0 = meta?.form.fields.find((x) => x.key === key);
    const value = normalizeFieldInput(f0, valueIn);
    setForm((f) => {
      const next = { ...f, [section]: { ...f[section], [key]: value } };
      if (key === 'governorate') next.general = { ...next.general, industrialZone: '' };
      return next;
    });
    // تحقق فوري بنفس قواعد السيرفر (الهاتف، البريد، الموقع، الأرقام): القيمة غير الصحيحة لا تُرسل، ويظهر الخطأ تحت الحقل.
    // تبقى معلّمة حتى تُصحَّح، ويمنع وجودها الإرسال — فلا يُرسَل طلب بقيمة محفوظة سابقًا تختلف عما يراه المستخدم.
    const issue = f0 ? clientFieldIssue(f0.type, value) : null;
    setFieldErrors((prev) => {
      const n = { ...prev };
      if (issue) n[key] = validationMessage(issue, isAr); else delete n[key];
      return n;
    });
    if (issue) {
      const b = { ...(pending.current[section] ?? {}) };
      delete b[key];
      if (Object.keys(b).length) pending.current[section] = b; else delete pending.current[section];
      return;
    }
    // صفوف الأسطح غير المكتملة تبقى محليًا حتى تكتمل (لا تُرسل للسيرفر نصف صف).
    const sent = key === 'roofAreas' ? completeRoofRows(value) : value;
    const batch = { ...(pending.current[section] ?? {}), [key]: sent === '' ? null : sent };
    if (key === 'governorate' && !correction) batch.industrialZone = null;
    pending.current[section] = batch;
    setSaveState('idle');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, AUTOSAVE_MS);
  };

  /** يرمي عند الفشل: PdfUploader يعرض رسالة السيرفر العربية تحت الحقل نفسه. */
  const upload = async (kind: DocumentKind, file: File) => {
    if (!app) return;
    await api.uploadDocument(app.id, kind, file);
    // اسم الملف يظهر في خانة المستند نفسها؛ الإشعار عام حتى لا يتكرر الاسم على الشاشة.
    toast('success', t('تم رفع الملف.', 'File uploaded.'));
    res.setData(await api.getApplication(app.id));
  };

  const confirmRemove = async () => {
    if (!app || !removing) return;
    setRemoveBusy(true);
    try {
      await api.removeDocument(app.id, removing.id);
      toast('success', t('تم حذف الملف.', 'File removed.'));
      res.setData(await api.getApplication(app.id));
      setRemoving(null);
    } catch (e) { toast('error', errorText(e, isAr)); } finally { setRemoveBusy(false); }
  };

  /** «حفظ كمسودة»: يحفظ كل ما لم يُحفظ بعد، ويؤكد أن العودة لاحقًا ممكنة من «لوحتي». */
  const saveDraft = async () => {
    setSavingDraft(true);
    try {
      const ok = await flush();
      if (!ok) { toast('error', t('تعذر حفظ بعض الحقول — صحّح الحقول المعلّمة باللون الأحمر.', 'Some fields could not be saved — fix the fields marked in red.')); return; }
      toast('success', invalid.length
        ? t('حُفظت المسودة، عدا الحقول التي بها أخطاء — صحّحها لتُحفظ.', 'Draft saved, except fields with errors — fix them to save them.')
        : t('تم حفظ المسودة. يمكنك العودة لاستكمال التسجيل في أي وقت من «لوحتي».', 'Draft saved. You can come back to finish it any time from “My dashboard”.'));
    } finally { setSavingDraft(false); }
  };

  const goStep = async (i: number) => { await flush(); setStep(i); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  /** I12: كل بند ناقص يفتح قسمه ويضع المؤشر على حقله. */
  const goField = async (key: string) => {
    const f = meta?.form.fields.find((x) => x.key === key);
    if (!f) return;
    await goStep(STEPS.findIndex((x) => x.section === f.section));
    setTimeout(() => {
      const el = document.getElementById(`f-${key}`) ?? document.querySelector<HTMLElement>(`[data-field="${key}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (el?.querySelector('input,select,textarea,button') as HTMLElement | null ?? el)?.focus?.();
    }, 60);
  };

  const missing = useMemo(() => (meta && app ? missingFields(meta.form.fields, form, (kind) => app.documents.filter((d) => d.kind === kind && d.isCurrent).length, meta.form.electricityBills.min) : []), [meta, app, form]);
  /** حقول بها خطأ تحقق (من الواجهة أو السيرفر) — تمنع الإرسال حتى تُصحَّح. */
  const invalid = useMemo(() => Object.keys(fieldErrors).filter((k) => k !== '_save')
    .map((k) => meta?.form.fields.find((f) => f.key === k)).filter((f): f is FieldMeta => Boolean(f)), [fieldErrors, meta]);
  const leftIn = (s: FormSection) => missing.filter((f) => f.section === s).length + invalid.filter((f) => f.section === s && !missing.includes(f)).length;
  /** I12: ✓ على القسم فقط عند اكتمال كل بنوده الإجبارية وخلوّه من الأخطاء. */
  const sectionComplete = (s: FormSection | 'review') => s !== 'review' && leftIn(s) === 0;
  const completedSections = FORM_STEPS.filter((s) => sectionComplete(s.section)).length;
  const unchanged = correction ? (app?.unchangedDeficiencies ?? []) : [];
  const fieldLabel = (key: string) => { const f = meta?.form.fields.find((x) => x.key === key); return f ? label(f) : key; };

  const submit = async () => {
    if (!app) return;
    setSubmitting(true);
    setSubmitError(null);
    const saved = await flush();
    if (!saved) { setSubmitting(false); setConfirming(false); return; }
    try {
      const fresh = await api.getApplication(app.id);
      const done = await api.performAction(app.id, correction ? 'resubmit' : 'submit', { expectedVersion: fresh.version });
      toast('success', correction ? t('تمت إعادة التقديم.', 'Resubmitted.') : t('تم إرسال الطلب.', 'Application submitted.'));
      // رسالة النجاح (رقم الطلب والحالة الجديدة) تُعرض في «لوحتي» حيث يتابع المصنع مراحل الطلب.
      setSubmitFlash({ appId: done.id, number: done.number, stateLabelAr: done.stateLabelAr, stateLabelEn: done.stateLabelEn, resubmitted: correction, signedOut: restricted });
      if (restricted) {
        // حساب لم يُقبل بعد: أُرسل الطلب لـIMC — شاشات المبادرة مقفلة حتى القرار (يصل بالبريد)، والحساب على المنصة يبقى
        // صالحًا لباقي المبادرات. الرسالة تُعرض في صفحة «مبادراتي» حيث تظهر حالة «قيد المراجعة».
        setPlatformFlash({
          testId: 'submitted-for-review', tone: 'ok',
          titleAr: correction ? 'تم إرسال التعديلات للمراجعة' : 'تم إرسال طلب التسجيل للمراجعة',
          titleEn: correction ? 'Your changes were sent for review' : 'Your registration was sent for review',
          textAr: 'يراجع مركز تحديث الصناعة (IMC) طلبكم الآن، وسيصلكم بريد بالقرار. تُفتح لوحة «شمس الصناعة» بعد قبول الحساب.',
          textEn: 'IMC is reviewing your registration; you will be emailed the decision. The Shams El-Senaa dashboard opens once the account is approved.',
        });
        try { sessionStorage.removeItem('platform_return_to'); } catch { /* storage unavailable */ }
        window.location.hash = '#hub';
        return;
      }
      store.navigate('factory-dashboard');
    } catch (e) {
      // F7: the server names each field in Arabic; a field code never reaches the person.
      const details = e instanceof ApiException ? (e.apiError.details ?? []).map((d) => {
        const own = isAr ? d.messageAr : d.messageEn;
        if (own) return own;
        const f = meta?.form.fields.find((x) => x.key === d.field);
        return f ? `${label(f)}: ${validationMessage(d.issue, isAr)}` : validationMessage(d.issue, isAr);
      }) : [];
      // رقم السجل محجوز لطلب آخر أو محظور: المصنع المتضرر يعترض بمستند (القاعدة G) بدل أن يبقى بلا مخرج.
      const code = e instanceof ApiException ? e.apiError.code : '';
      setSubmitError({ message: errorText(e, isAr), details, objectable: code === 'REGISTRY_BLOCKED' || code === 'DUPLICATE_REGISTRY' });
      res.setData(await api.getApplication(app.id).catch(() => app));
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  };

  if (!appId) return <div className="container-custom page"><ErrorState message={t('لم يُحدد الطلب.', 'No application selected.')} /></div>;
  if (!appId || (res.loading && !app)) return <div className="container-custom page"><Loading /></div>;
  if (res.notAvailable) return <div className="container-custom page"><NotAvailable /></div>;
  if (res.error || !app || !meta) return <div className="container-custom page"><ErrorState message={res.error || t('تعذر التحميل', 'Failed to load')} onRetry={res.reload} /></div>;
  if (!['DRAFT', 'IMC_CORRECTION', 'ENCPC_CORRECTION'].includes(app.state)) {
    return (
      <div className="container-custom page">
        <div className="card"><p>{t('لا يمكن تعديل الطلب في مرحلته الحالية.', 'The application cannot be edited in its current state.')}</p>
          <button type="button" className="btn btn-primary" onClick={() => store.navigate('application', app.id)}>{t('عرض الطلب', 'View application')}</button></div>
      </div>
    );
  }

  const current = STEPS[step];
  const fieldsOf = (s: FormSection) => meta.form.fields.filter((f) => f.section === s);

  return (
    <div className="container-custom page">
      <div className="page-head">
        <div>
          <div className="row">
            <h1 className="page-title">{correction ? t('استيفاء الطلب', 'Complete the requested items') : t('طلب الانضمام للمبادرة', 'Initiative application')}</h1>
            <StateBadge state={app.state} labelAr={app.stateLabelAr} labelEn={app.stateLabelEn} />
          </div>
          <p className="page-sub">{correction ? t('عدّل البنود المطلوبة فقط ثم أعد التقديم — باقي الحقول مقفلة.', 'Edit only the requested items, then resubmit — other fields are locked.') : t('يُحفظ تقدمك تلقائيًا كمسودة.', 'Your progress is saved automatically as a draft.')}</p>
        </div>
        <SaveIndicator state={saveState} />
      </div>

      {restricted ? (
        <div className="account-banner" role="status" data-testid="restricted-banner">
          <b>{user?.accountStatus === 'correction' ? t('حساب مصنعكم لم يُقبل بعد — مطلوب تعديل بيانات التسجيل', 'Your factory account is not approved yet — registration changes are requested') : t('حساب مصنعكم لم يُقبل بعد — لم يُرسل طلب التسجيل للمراجعة', 'Your factory account is not approved yet — the registration has not been sent for review')}</b>
          <span>{user?.accountStatus === 'correction'
            ? t('عدّل البنود التي طلبها مركز تحديث الصناعة (IMC) ثم أعد الإرسال. باقي المنصة متاح بعد قبول الحساب؛ حتى صدور القرار يمكنك الاطلاع على طلبك أو الانسحاب منه.', 'Edit the items IMC requested, then resubmit. The rest of the platform opens once the account is approved; after resubmitting you cannot sign in until the decision is emailed.')
            : t('راجع البيانات ثم أرسل طلب التسجيل لمراجعة IMC. بعد الإرسال يمكنك الاطلاع على طلبك أو الانسحاب منه حتى يصلك القرار بالبريد.', 'Review the data, then send the registration for IMC review. After sending you cannot sign in until the decision is emailed.')}</span>
        </div>
      ) : null}

      {app.registryHold ? (
        <div className="account-banner" role="status" data-testid="registry-hold" style={{ marginBottom: '1rem' }}>
          <b>{t(`رقم السجل الصناعي ${app.registryHold.registryNumber} مستخدم في طلب مصنع آخر أو موقوف — لا يُرسل طلبك حتى تقرر وحدة إدارة المبادرة`, `Registry number ${app.registryHold.registryNumber} is used by another factory’s application or on hold — your application cannot be sent until the PMU decides`)}</b>
          {app.registryHold.objection?.status === 'pending'
            ? <span data-testid="registry-hold-pending">{t('اعتراضكم قيد مراجعة وحدة إدارة المبادرة. ستصلكم رسالة بالقرار.', 'Your objection is under PMU review. You will be notified of the decision.')}</span>
            : <span>{app.registryHold.objection?.status === 'rejected' ? t(`رُفض اعتراضكم السابق: ${app.registryHold.objection.decisionReason}`, `Your previous objection was rejected: ${app.registryHold.objection.decisionReason}`) : t('إن كان الرقم لمنشأتكم فقدّموا اعتراضًا بمستند يثبت الملكية أو التفويض.', 'If the number belongs to your facility, file an objection with a document proving ownership or authorisation.')}
              {' '}<button type="button" className="btn btn-outline btn-sm" onClick={() => setObjecting(true)} data-testid="open-objection">{t('الرقم لمنشأتي — تقديم اعتراض بمستند', 'This number is my facility’s — file an objection')}</button></span>}
        </div>
      ) : null}

      {/* manual = no registry API yet: nothing failed, IMC checks the certificate — no message to the factory */}
      {app.registry && app.registry.result !== 'valid' && app.registry.result !== 'manual' ? (
        <ErrorBox style={{ marginBottom: '1rem' }} message={app.registry.result === 'invalid'
          ? t('آخر تحقق: رقم السجل الصناعي غير صحيح أو غير مسجل. صحّح الرقم في «أوراق الشركة» ثم أعد الإرسال — بياناتك محفوظة.', 'Last check: the industrial registry number is invalid. Correct it under “Company papers” and submit again — your data is saved.')
          : t('آخر تحقق: تعذر الوصول لخدمة السجل الصناعي. طلبك محفوظ — أعد المحاولة لاحقًا.', 'Last check: the industrial registry service was unavailable. Your application is saved — retry later.')} />
      ) : null}

      {/* M13: على الموبايل يظهر «الخطوة 3 من 5» بدل التبويبات المقصوصة */}
      <div className="wizard-mobile-label" data-testid="wizard-mobile-label">
        {t(`الخطوة ${formatNumber(step + 1, true)} من ${formatNumber(STEPS.length, true)}`, `Step ${step + 1} of ${STEPS.length}`)}: <b>{isAr ? STEPS[step].ar : STEPS[step].en}</b>
      </div>
      <div className="wizard-steps" role="tablist">
        {STEPS.map((s, i) => {
          const complete = sectionComplete(s.section);
          return (
            <button key={s.section} type="button" role="tab" aria-selected={i === step} data-testid={`wizard-step-${s.section}`} data-complete={complete ? '1' : '0'}
              className={`wizard-step${i === step ? ' active' : complete ? ' done' : ''}`} onClick={() => void goStep(i)}>
              <span className="num">{complete && i !== step ? <Check size={13} aria-label={t('مكتمل', 'complete')} /> : formatNumber(i + 1, isAr)}</span>{isAr ? s.ar : s.en}
              {s.section !== 'review' && !complete && !correction ? (
                <span className="wizard-step-left" data-testid={`wizard-left-${s.section}`} title={t('بنود متبقية', 'Items left')}>{formatNumber(leftIn(s.section), isAr)}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {/* مؤشر التقدم: الأقسام المكتملة فعلًا (لا موضع الخطوة الحالية) */}
      <div className="wizard-progress-label" data-testid="wizard-progress-label">
        <span>{t(`اكتمل ${formatNumber(completedSections, true)} من ${formatNumber(FORM_STEPS.length, true)} أقسام`, `${completedSections} of ${FORM_STEPS.length} sections complete`)}</span>
        <span className="form-helper" style={{ margin: 0 }}>
          {missing.length + invalid.length
            ? t(`متبقٍ ${formatNumber(missing.length, true)} بند إجباري${invalid.length ? ` · ${formatNumber(invalid.length, true)} حقل يحتاج تصحيحًا` : ''}`, `${missing.length} required item(s) left${invalid.length ? ` · ${invalid.length} field(s) to fix` : ''}`)
            : t('كل البنود الإجبارية مكتملة — راجع الملخص ثم أرسل', 'All required items are complete — review the summary, then submit')}
        </span>
      </div>
      <div className="wizard-progress" role="progressbar" aria-valuemin={0} aria-valuemax={FORM_STEPS.length} aria-valuenow={completedSections}
        aria-label={t('الأقسام المكتملة', 'Completed sections')}><span style={{ width: `${(completedSections / FORM_STEPS.length) * 100}%` }} /></div>

      <div className="card">
        {current.section === 'review' ? (
          <ReviewStep app={app} form={form} missing={missing} invalid={invalid} correction={correction}
            onGo={(key) => void goField(key)} onEdit={(s) => void goStep(STEPS.findIndex((x) => x.section === s))} />
        ) : (
          <div className="field-grid">
            {fieldsOf(current.section).map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                app={app}
                section={current.section as FormSection}
                value={form[current.section as FormSection][f.key]}
                governorate={String(form.general.governorate ?? '')}
                locked={!editable(f.key)}
                flagged={correction && editable(f.key)}
                note={defNote(f.key)}
                error={fieldErrors[f.key]}
                onChange={(v) => change(current.section as FormSection, f.key, v)}
                onUpload={(file) => upload(f.docKind!, file)}
                onRemove={setRemoving}
              />
            ))}
          </div>
        )}
        {fieldErrors._save ? <ErrorBox message={fieldErrors._save} /> : null}
        {submitError ? (
          <ErrorBox style={{ marginTop: '1rem' }} message={<>{submitError.message}{submitError.details.length ? <ul style={{ margin: '0.4rem 0 0' }}>{submitError.details.map((d) => <li key={d}>{d}</li>)}</ul> : null}
            {submitError.objectable && !app.registryHold ? <div style={{ marginTop: '0.6rem' }}><button type="button" className="btn btn-outline btn-sm" onClick={() => setObjecting(true)} data-testid="open-objection">{t('الرقم لمنشأتي — تقديم اعتراض بمستند', 'This number is my facility’s — file an objection')}</button></div> : null}</>} />
        ) : null}
        <div className="wizard-nav">
          <div className="row" style={{ gap: '0.6rem' }}>
            <button type="button" className="btn btn-secondary" disabled={step === 0} onClick={() => void goStep(step - 1)}>{t('السابق', 'Previous')}</button>
            <button type="button" className="btn btn-outline" onClick={() => void saveDraft()} disabled={savingDraft || submitting} data-testid="wizard-save-draft">
              {savingDraft ? <Loader2 size={15} className="spin" /> : <Save size={15} />} {correction ? t('حفظ التعديلات', 'Save changes') : t('حفظ كمسودة', 'Save as draft')}
            </button>
          </div>
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn-primary" onClick={() => void goStep(step + 1)} data-testid="wizard-next">{step === STEPS.length - 2 ? t('التالي: الملخص والمراجعة', 'Next: summary & review') : t('التالي', 'Next')}</button>
          ) : (
            <div className="row" style={{ gap: '0.6rem' }}>
              {missing.length ? <span className="form-helper" data-testid="submit-blocked">{t(`أكمل البنود الناقصة (${formatNumber(missing.length, true)}) أولًا`, `Complete the ${missing.length} missing item(s) first`)}</span>
                : invalid.length ? <span className="form-helper" data-testid="submit-blocked-invalid">{t(`صحّح الحقول غير الصحيحة (${formatNumber(invalid.length, true)}) أولًا`, `Fix the ${invalid.length} invalid field(s) first`)}</span> : null}
              {/* I12: لا يُفتح تأكيد الإرسال والطلب ناقص أو به قيم غير صحيحة */}
              <button type="button" className="btn btn-gold" onClick={() => setConfirming(true)} disabled={submitting || missing.length > 0 || invalid.length > 0} data-testid="wizard-submit">
                <Send size={16} /> {correction ? t('إعادة التقديم', 'Resubmit') : t('إرسال الطلب', 'Submit application')}
              </button>
            </div>
          )}
        </div>
      </div>

      {removing ? (
        <ConfirmDialog
          danger
          title={t('حذف الملف', 'Remove file')}
          message={<>
            {t('سيُحذف هذا الملف من طلبك:', 'This file will be removed from your application:')} <b style={{ overflowWrap: 'anywhere' }}>{removing.originalName}</b>
            <div className="form-helper">{removing.submitted
              ? t('سبق إرسال هذه النسخة، فتبقى محفوظة في سجل الطلب كما رآها المراجع، لكنها لن تُرسل مرة أخرى.', 'This version was already submitted, so it stays in the application history as the reviewer saw it, but it will not be sent again.')
              : t('لم تُرسل هذه النسخة لأي جهة، ولن يراها أحد.', 'This version was never submitted and no one will see it.')}</div>
          </>}
          confirmLabel={t('حذف', 'Remove')}
          busy={removeBusy}
          onConfirm={() => void confirmRemove()}
          onCancel={() => setRemoving(null)}
        />
      ) : null}

      {objecting ? <ObjectionDialog registryNumber={app.registryHold?.registryNumber ?? String(form.company.industrialRegistryNumber ?? '')} onClose={() => setObjecting(false)} onDone={() => res.reload?.()} /> : null}

      {confirming ? (
        <ConfirmDialog
          title={correction ? t('تأكيد إعادة التقديم', 'Confirm resubmission') : t('تأكيد إرسال الطلب', 'Confirm submission')}
          message={<>
            {t('سيتم التحقق من رقم السجل الصناعي ثم إحالة الطلب للمراجعة. لن تستطيع التعديل إلا إذا طُلب منك استيفاء.', 'The industrial registry number will be verified and the application sent for review. You can edit it only if corrections are requested.')}
            {unchanged.length ? (
              // M8: تنبيه لا منع
              <div className="error-box" style={{ marginTop: '0.6rem' }} data-testid="unchanged-warning">
                {t('لم تعدّل بعد هذه البنود المطلوبة:', 'You have not changed these requested items yet:')}
                <ul style={{ margin: '0.3rem 0 0' }}>{unchanged.map((k) => <li key={k}>{fieldLabel(k)}</li>)}</ul>
                {t('يمكنك المتابعة إن كانت صحيحة، لكن قد يُعاد الطلب إليك مرة أخرى.', 'You can continue if they are correct, but the application may be returned again.')}
              </div>
            ) : null}
          </>}
          confirmLabel={correction ? t('إعادة التقديم', 'Resubmit') : t('إرسال', 'Submit')}
          busy={submitting}
          onConfirm={() => void submit()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
};

const SaveIndicator: React.FC<{ state: SaveState }> = ({ state }) => {
  const { t } = useStore();
  if (state === 'saving') return <span className="save-indicator"><Loader2 size={14} className="spin" /> {t('جارٍ الحفظ…', 'Saving…')}</span>;
  if (state === 'saved') return <span className="save-indicator" data-testid="saved"><CheckCircle2 size={14} /> {t('تم الحفظ', 'Saved')}</span>;
  if (state === 'error') return <span className="save-indicator is-error"><CloudOff size={14} /> {t('تعذر الحفظ — راجع الحقول', 'Not saved — check the fields')}</span>;
  return null;
};

const FieldInput: React.FC<{
  field: FieldMeta; app: ApplicationDetail; section: FormSection; value: unknown; governorate: string; locked: boolean; flagged: boolean;
  note?: string; error?: string; onChange: (v: unknown) => void; onUpload: (f: File) => Promise<void>; onRemove: (d: ApplicationDocument) => void;
}> = ({ field: f, app, value, governorate, locked, flagged, note, error, onChange, onUpload, onRemove }) => {
  const { isAr, t, meta } = useStore();
  const { toast } = useToast();
  const lbl = <FieldLabel field={f} flagged={flagged} />;

  if (f.type === 'file' || f.type === 'files') {
    const docs = app.documents.filter((d) => d.kind === f.docKind);
    const active = docs.filter((d) => d.isCurrent).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const previous = docs.length - active.length;
    const multi = f.type === 'files';
    const max = multi ? meta?.form.electricityBills.max ?? 12 : 1;
    return (
      <div className={`form-group span-2 doc-field${locked ? ' field-locked' : ''}`} data-field={f.key}>
        {lbl}
        {note ? <div className="deficiency-note">{note}</div> : null}
        {active.length ? (
          <ul className="doc-list" data-testid={`docs-${f.key}`}>
            {active.map((d) => (
              <li key={d.id} className="doc-item is-uploaded" data-testid={`doc-${f.key}`}>
                <CheckCircle2 size={16} className="doc-ok" aria-label={t('تم الرفع', 'Uploaded')} />
                <span className="doc-name">{d.originalName}</span>
                <span className="doc-meta">
                  {formatBytes(d.sizeBytes)} · {formatDate(d.createdAt, isAr)} · {d.submitted ? t('مُرسل للمراجعة', 'submitted') : t('تم الرفع — لم يُرسل بعد', 'uploaded — not submitted yet')}
                </span>
                {d.downloadable ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void downloadDocument(app.id, d, toast, isAr)} aria-label={t('تنزيل', 'Download')} title={t('تنزيل', 'Download')}><Download size={15} /></button>
                ) : null}
                {!locked ? (
                  <button type="button" className="btn btn-ghost btn-sm doc-remove" onClick={() => onRemove(d)} data-testid={`remove-${f.key}`} aria-label={t('حذف الملف', 'Remove file')} title={t('حذف الملف', 'Remove file')}><Trash2 size={15} /></button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className={`doc-empty${f.required ? ' is-required' : ''}`} data-testid={`doc-empty-${f.key}`}>
            {multi ? t('لم تُرفع أي فاتورة بعد.', 'No bills uploaded yet.') : t('لم يُرفع الملف بعد.', 'No file uploaded yet.')}
          </p>
        )}
        {multi ? <div className="form-helper">{t(`ارفع فاتورة لكل شهر (حتى ${formatNumber(max, true)} فاتورة) — المرفوع: ${formatNumber(active.length, true)}`, `Upload one bill per month (up to ${max}) — uploaded: ${active.length}`)}</div> : null}
        {previous > 0 ? <div className="form-helper">{t(`${formatNumber(previous, true)} نسخة سابقة محفوظة في سجل الطلب`, `${previous} previous version(s) kept in the application history`)}</div> : null}
        {!locked && (!multi || active.length < max) ? (
          <div style={{ marginTop: '0.5rem' }}>
            <PdfUploader onFile={onUpload} testId={`upload-${f.key}`}
              label={multi ? t(`أضف فاتورة (${formatNumber(active.length, true)}/${formatNumber(max, true)})`, `Add a bill (${active.length}/${max})`) : active.length ? t('استبدال الملف بنسخة جديدة', 'Replace with a new version') : undefined} />
          </div>
        ) : null}
        {error ? <div className="field-error">{error}</div> : null}
      </div>
    );
  }

  return <DataFieldControl field={f} value={value} governorate={governorate} locked={locked} flagged={flagged} note={note} error={error} onChange={onChange} />;
};

/**
 * الملخص النهائي قبل الإرسال: كل حقول الأقسام الأربعة كما أدخلها المصنع (من حالة المعالج الحالية لا من آخر تحميل)،
 * والمستندات المرفوعة بأسمائها، مع زر «تعديل» لكل قسم وروابط للبنود الناقصة أو غير الصحيحة.
 */
const ReviewStep: React.FC<{
  app: ApplicationDetail; form: Record<FormSection, SectionData>; missing: FieldMeta[]; invalid: FieldMeta[]; correction: boolean;
  onGo: (fieldKey: string) => void; onEdit: (section: FormSection) => void;
}> = ({ app, form, missing, invalid, correction, onGo, onEdit }) => {
  const { isAr, t, meta } = useStore();
  if (!meta) return null;
  return (
    <div className="stack">
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{t('ملخص الطلب ومراجعته قبل الإرسال', 'Summary and review before submitting')}</h2>
      <IssueList testId="missing-list" title={t('بنود ناقصة', 'Missing items')} items={missing} prefix="missing" onGo={onGo} />
      <IssueList testId="invalid-list" title={t('حقول قيمتها غير صحيحة', 'Fields with invalid values')} items={invalid} prefix="invalid" onGo={onGo} />
      {!missing.length && !invalid.length ? (
        <div className="badge badge-approved" style={{ alignSelf: 'flex-start', padding: '0.5rem 0.8rem' }} data-testid="review-complete"><CheckCircle2 size={15} /> {t('كل البنود الإجبارية مكتملة', 'All required items are complete')}</div>
      ) : null}
      <FormSummary form={form} missing={missing} invalid={invalid} onEdit={onEdit}
        filesOf={(f) => app.documents.filter((d) => d.kind === f.docKind && d.isCurrent).map((d) => ({ id: d.id, name: d.originalName, sizeBytes: d.sizeBytes }))} />

      <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.9, margin: 0 }}>
        {correction
          ? t('بعد إعادة التقديم يعود الطلب مباشرة لنفس الجهة المراجعة. يُحفظ كل تعديل كنسخة جديدة مع الاحتفاظ بالنسخ السابقة.', 'After resubmission the application returns directly to the same reviewer. Every change is kept as a new version alongside previous ones.')
          : t('عند الإرسال يتحقق النظام من رقم السجل الصناعي آليًا ثم يُحال الطلب لمراجعة IMC — لا يُعد المصنع مسجلًا نهائيًا قبل اعتماد المراجعة. إذا تعذر التحقق يبقى الطلب مسودة ويمكنك التصحيح وإعادة المحاولة دون إعادة إدخال البيانات.', 'On submission the industrial registry number is verified automatically and the application goes to IMC review — the factory is not finally registered until the review approves it. If verification fails, the application stays a draft and you can correct and retry without re-entering data.')}
      </p>
      <p className="form-helper">{t('عدد المستندات المرفوعة', 'Uploaded documents')}: {formatNumber(app.documents.filter((d) => d.isCurrent).length, isAr)}</p>
    </div>
  );
};
