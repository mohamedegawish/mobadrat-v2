import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, LogIn, MailCheck, UserPlus } from 'lucide-react';
import { api, ApiException } from '../../api';
import { errorDetails, errorText, store, useStore } from '../../store/state';
import { ErrorBox } from '../ui/ErrorBox';
import { useSiteContent } from '../../content/siteContent';
import { toLatinDigits } from '../../utils/validation';

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
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => store.navigate('register')}>{t('تسجيل متقدم جديد', 'Register')}</button>
      </div>
      <p className="form-helper" style={{ marginTop: '0.75rem' }}>{t('حسابات فريق IMC ولجنة التقييم وجهات التمويل ينشئها مدير النظام فقط.', 'Accounts for the IMC team, evaluators and funders are created by the system administrator only.')}</p>
    </Shell>
  );
};

export const RegisterView: React.FC = () => {
  const { t, isAr } = useStore();
  const SITE_NAME = useSiteContent().siteName;
  const [f, setF] = useState({ fullName: '', email: '', mobile: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const errs: Record<string, string> = {};
    if (f.password.length < 8 || !/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) errs.password = t('8 أحرف على الأقل، حروف وأرقام.', 'At least 8 characters, letters and digits.');
    if (f.password !== f.confirm) errs.confirm = t('غير مطابقة.', 'Does not match.');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const { confirm: _c, ...body } = f;
      void _c;
      await api.register({ ...body, email: body.email.trim(), mobile: toLatinDigits(body.mobile.trim()) });
      setDone(f.email.trim());
    } catch (err) {
      setError(errorText(err, isAr));
      setErrors(errorDetails(err, isAr));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Shell title={t('راجع بريدك الإلكتروني', 'Check your email')} icon={<MailCheck size={20} />}>
        <p style={{ lineHeight: 1.9 }} data-testid="register-done">
          {t(`أرسلنا رابط تفعيل إلى ${done}. افتح الرابط لتفعيل الحساب ثم سجّل الدخول.`, `We sent an activation link to ${done}. Open it to activate your account, then sign in.`)}
        </p>
        <button type="button" className="btn btn-primary" onClick={() => store.navigate('login')}>{t('الذهاب لتسجيل الدخول', 'Go to sign in')}</button>
      </Shell>
    );
  }

  return (
    <Shell title={t(`تسجيل متقدم في مبادرة ${SITE_NAME.ar}`, `Register — ${SITE_NAME.en}`)} icon={<UserPlus size={20} />}>
      <form onSubmit={submit}>
        <Field id="fullName" label={t('الاسم الرباعي', 'Full name')} value={f.fullName} onChange={set('fullName')} autoComplete="name" error={errors.fullName} />
        <Field id="regEmail" label={t('البريد الإلكتروني', 'Email')} type="email" value={f.email} onChange={set('email')} autoComplete="email" error={errors.email} />
        <Field id="mobile" label={t('رقم الموبايل', 'Mobile number')} type="tel" value={f.mobile} onChange={set('mobile')} autoComplete="tel" error={errors.mobile} />
        <Field id="regPassword" label={t('كلمة المرور', 'Password')} type="password" value={f.password} onChange={set('password')} autoComplete="new-password" error={errors.password} hint={t('8 أحرف على الأقل، حروف وأرقام.', 'At least 8 characters, letters and digits.')} />
        <Field id="confirm" label={t('تأكيد كلمة المرور', 'Confirm password')} type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" error={errors.confirm} />
        <ErrorBox message={error} />
        <button type="submit" className="btn btn-primary w-full" style={{ marginTop: '0.75rem' }} disabled={busy} data-testid="register-submit">
          {busy ? t('جارٍ التسجيل…', 'Registering…') : t('إنشاء الحساب', 'Create account')}
        </button>
      </form>
      <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: '0.75rem' }} onClick={() => store.navigate('login')}>{t('لديك حساب؟ سجّل الدخول', 'Have an account? Sign in')}</button>
    </Shell>
  );
};

export const VerifyEmailView: React.FC = () => {
  const { t, isAr, param } = useStore();
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [msg, setMsg] = useState('');
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    if (!param) { setState('error'); setMsg(t('الرابط غير مكتمل.', 'The link is incomplete.')); return; }
    api.verifyEmail(param).then((r) => { setState('ok'); setMsg(r.message); }).catch((e) => { setState('error'); setMsg(errorText(e, isAr)); });
    // إزالة التوكن من شريط العنوان بعد استخدامه
    history.replaceState(null, '', '#verify-email');
  }, [param, isAr, t]);
  return (
    <Shell title={t('تفعيل الحساب', 'Account activation')} icon={<CheckCircle2 size={20} />}>
      {state === 'working' ? <p>{t('جارٍ التفعيل…', 'Activating…')}</p> : null}
      {state === 'ok' ? <p role="status" data-testid="verify-ok">{msg}</p> : null}
      {state === 'error' ? <ErrorBox message={msg} /> : null}
      {state !== 'working' ? <button type="button" className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => store.navigate('login')}>{t('تسجيل الدخول', 'Sign in')}</button> : null}
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
