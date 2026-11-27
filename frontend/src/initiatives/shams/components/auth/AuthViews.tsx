import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, LogIn, MailCheck } from 'lucide-react';
import { api, ApiException } from '../../api';
import { errorText, store, useStore } from '../../store/state';
import { ErrorBox } from '../ui/ErrorBox';
import { takeSubmitFlash, type SubmitFlash } from '../../utils/submitFlash';

const Shell: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <div className="container-custom page">
    <div className="auth-card">
      <div className="card">
        <div className="row" style={{ marginBottom: '1rem' }}>
          <span className="home-card-icon">{icon}</span>
          <h1 className="page-title" style={{ fontSize: '1.2rem' }}>{title}</h1>
        </div>
        {children}
      </div>
    </div>
  </div>
);

const Field: React.FC<{ id: string; label: string; type?: string; value: string; onChange: (v: string) => void; autoComplete?: string; error?: string; hint?: string; required?: boolean }> =
  ({ id, label, type = 'text', value, onChange, autoComplete, error, hint, required = true }) => (
    <div className="form-group">
      <label className={`form-label${required ? ' required' : ''}`} htmlFor={id}>{label}</label>
      <input id={id} name={id} className={`form-control${error ? ' is-invalid' : ''}`} type={type} value={value} autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)} required={required} aria-invalid={Boolean(error)} dir={type === 'email' || type === 'tel' ? 'ltr' : undefined} />
      {error ? <div className="field-error">{error}</div> : hint ? <div className="form-helper">{hint}</div> : null}
    </div>
  );

export const LoginView: React.FC = () => {
  const { t, isAr } = useStore();
  // بعد إرسال طلب التسجيل من حساب مقيّد: انتهت الجلسة، والقرار يصل بالبريد.
  const [flash] = useState<SubmitFlash | null>(() => { const f = takeSubmitFlash(); return f?.signedOut ? f : null; });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [needsVerify, setNeedsVerify] = useState(false);
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setInfo(''); setNeedsVerify(false);
    setBusy(true);
    try {
      await store.login(email.trim(), password);
    } catch (err) {
      setError(errorText(err, isAr));
      setNeedsVerify(err instanceof ApiException && err.apiError.code === 'EMAIL_NOT_VERIFIED');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      const r = await api.resendVerification(email.trim());
      setInfo(r.message);
    } catch (err) { setError(errorText(err, isAr)); }
  };

  return (
    <Shell title={t('تسجيل الدخول', 'Sign in')} icon={<LogIn size={20} />}>
      {flash ? (
        <div className="final-outcome is-success" role="status" data-testid="signed-out-submitted" style={{ marginBottom: '1rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="final-outcome-title" style={{ fontSize: '1.05rem' }}>{t('تم إرسال طلب التسجيل للمراجعة', 'Your registration was sent for review')}</p>
            <p className="final-outcome-sub">{t('يراجع مركز تحديث الصناعة (IMC) طلبكم الآن، وسيصلكم بريد بالقرار. لا يمكن الدخول حتى قبول الحساب.', 'IMC is reviewing your registration; you will be emailed the decision. Sign-in is available once the account is approved.')}</p>
          </div>
        </div>
      ) : null}
      <form onSubmit={submit}>
        <Field id="email" label={t('البريد الإلكتروني', 'Email')} type="email" value={email} onChange={setEmail} autoComplete="username" />
        <Field id="password" label={t('كلمة المرور', 'Password')} type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <ErrorBox message={error} />
        {needsVerify ? <button type="button" className="btn btn-ghost btn-sm" onClick={resend}>{t('إعادة إرسال رابط التفعيل', 'Resend activation link')}</button> : null}
        {info ? <div className="form-helper" role="status">{info}</div> : null}
        <button type="submit" className="btn btn-primary w-full" style={{ marginTop: '0.75rem' }} disabled={busy} data-testid="login-submit">
          {busy ? t('جارٍ الدخول…', 'Signing in…') : t('دخول', 'Sign in')}
        </button>
      </form>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: '1rem', fontSize: '0.84rem' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => store.navigate('forgot-password')}>{t('نسيت كلمة المرور؟', 'Forgot password?')}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => store.navigate('register')}>{t('تسجيل مصنع جديد', 'Register a factory')}</button>
      </div>
      <p className="form-helper" style={{ marginTop: '0.75rem' }}>{t('حسابات الجهات (IMC وENCPC وPMU ووزارة الكهرباء) ينشئها مدير النظام فقط.', 'Accounts for IMC, ENCPC, PMU and the Ministry of Electricity are created by the system administrator only.')}</p>
    </Shell>
  );
};

/** صفحة التسجيل متعددة الخطوات (كل بيانات نموذج التسجيل في مكان واحد) — RegisterWizard.tsx. */
export { RegisterView } from './RegisterWizard';

export const VerifyEmailView: React.FC = () => {
  const { t, isAr, param } = useStore();
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [msg, setMsg] = useState('');
  const [underReview, setUnderReview] = useState(false);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    if (!param) { setState('error'); setMsg(t('الرابط غير مكتمل.', 'The link is incomplete.')); return; }
    api.verifyEmail(param).then((r) => { setState('ok'); setMsg(r.message); setUnderReview(Boolean(r.data?.submitted)); }).catch((e) => { setState('error'); setMsg(errorText(e, isAr)); });
    // إزالة التوكن من شريط العنوان بعد استخدامه
    history.replaceState(null, '', '#verify-email');
  }, [param, isAr, t]);
  return (
    <Shell title={t('تفعيل الحساب', 'Account activation')} icon={<CheckCircle2 size={20} />}>
      {state === 'working' ? <p>{t('جارٍ التفعيل…', 'Activating…')}</p> : null}
      {state === 'ok' ? <p role="status" data-testid="verify-ok" data-under-review={underReview ? '1' : '0'} style={{ lineHeight: 1.9 }}>{msg}</p> : null}
      {state === 'error' ? <ErrorBox message={msg} /> : null}
      {/* طلب التسجيل لدى IMC: لا دخول قبل القرار، فلا زر دخول مضلل. */}
      {state === 'ok' && underReview ? <button type="button" className="btn btn-secondary" style={{ marginTop: '1rem' }} onClick={() => store.navigate('home')}>{t('الصفحة الرئيسية', 'Home page')}</button> : null}
      {state !== 'working' && !(state === 'ok' && underReview) ? <button type="button" className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => store.navigate('login')}>{t('تسجيل الدخول', 'Sign in')}</button> : null}
    </Shell>
  );
};

/** H4: صاحب الحساب يلغي طلب استرداد (نقل بريد) برابط وصله على بريده وهاتفه — لمرة واحدة، ويُزال التوكن من الشريط. */
export const CancelRecoveryView: React.FC = () => {
  const { t, isAr, param } = useStore();
  const [state, setState] = useState<'ask' | 'working' | 'ok' | 'error'>('ask');
  const [msg, setMsg] = useState('');
  const token = useRef(param);
  useEffect(() => { history.replaceState(null, '', '#cancel-recovery'); }, []);
  const cancel = async () => {
    if (!token.current) { setState('error'); setMsg(t('الرابط غير مكتمل.', 'The link is incomplete.')); return; }
    setState('working');
    try { setMsg((await api.cancelRecoveryByOwner(token.current)).message); setState('ok'); } catch (e) { setMsg(errorText(e, isAr)); setState('error'); }
  };
  return (
    <Shell title={t('إلغاء طلب نقل الحساب', 'Cancel the account transfer request')} icon={<CheckCircle2 size={20} />}>
      {state === 'ask' || state === 'working' ? (
        <>
          <p style={{ lineHeight: 1.9 }}>{t('وصلك هذا الرابط لأن طلبًا رسميًا قُدّم لنقل حساب مصنعك إلى بريد إلكتروني آخر. إن لم تطلب ذلك أو لم تكن على علم به فألغِ الطلب الآن؛ لن يتغير بريدك.', 'This link was sent because a formal request was filed to move your factory account to another email address. If you did not ask for this, cancel it now; your email will not change.')}</p>
          <button type="button" className="btn btn-danger" disabled={state === 'working'} onClick={() => void cancel()} data-testid="cancel-recovery">{state === 'working' ? t('جارٍ الإلغاء…', 'Cancelling…') : t('ألغِ الطلب', 'Cancel the request')}</button>
        </>
      ) : null}
      {state === 'ok' ? <p role="status" data-testid="cancel-ok">{msg}</p> : null}
      {state === 'error' ? <ErrorBox message={msg} /> : null}
    </Shell>
  );
};

export const ForgotPasswordView: React.FC = () => {
  const { t, isAr } = useStore();
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { setMsg((await api.forgotPassword(email.trim())).message); } catch (err) { setError(errorText(err, isAr)); } finally { setBusy(false); }
  };
  return (
    <Shell title={t('استعادة كلمة المرور', 'Reset your password')} icon={<MailCheck size={20} />}>
      {msg ? <p role="status" style={{ lineHeight: 1.9 }}>{msg}</p> : (
        <form onSubmit={submit}>
          <Field id="fpEmail" label={t('البريد الإلكتروني', 'Email')} type="email" value={email} onChange={setEmail} autoComplete="email" />
          <ErrorBox message={error} />
          <button type="submit" className="btn btn-primary w-full" disabled={busy}>{t('إرسال رابط الاستعادة', 'Send reset link')}</button>
        </form>
      )}
      <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: '0.75rem' }} onClick={() => store.navigate('login')}>{t('العودة لتسجيل الدخول', 'Back to sign in')}</button>
    </Shell>
  );
};

export const ResetPasswordView: React.FC = () => {
  const { t, isAr, param } = useStore();
  const token = useRef(param ?? '');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (param) { token.current = param; history.replaceState(null, '', '#reset-password'); } }, [param]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (pw !== confirm) { setError(t('التأكيد لا يطابق كلمة المرور.', 'Confirmation does not match.')); return; }
    setBusy(true);
    try { setMsg((await api.resetPassword(token.current, pw)).message); } catch (err) { setError(errorText(err, isAr)); } finally { setBusy(false); }
  };
  return (
    <Shell title={t('تعيين كلمة مرور جديدة', 'Set a new password')} icon={<CheckCircle2 size={20} />}>
      {msg ? (
        <>
          <p role="status">{msg}</p>
          <button type="button" className="btn btn-primary" onClick={() => store.navigate('login')}>{t('تسجيل الدخول', 'Sign in')}</button>
        </>
      ) : (
        <form onSubmit={submit}>
          <Field id="rpNew" label={t('كلمة المرور الجديدة', 'New password')} type="password" value={pw} onChange={setPw} autoComplete="new-password" hint={t('8 أحرف على الأقل، حروف وأرقام.', 'At least 8 characters, letters and digits.')} />
          <Field id="rpConfirm" label={t('تأكيد كلمة المرور', 'Confirm password')} type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          <ErrorBox message={error} />
          <button type="submit" className="btn btn-primary w-full" disabled={busy || !token.current}>{t('حفظ', 'Save')}</button>
        </form>
      )}
    </Shell>
  );
};
