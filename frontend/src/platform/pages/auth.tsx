/** Platform account screens — one account for every initiative. */
import React, { useEffect, useState } from 'react';
import { api, errText, fieldErrors } from '../api';
import { usePlatform, store } from '../store';
import { Alert } from '../layout';

const ISSUE_AR: Record<string, string> = {
  required: 'مطلوب', 'invalid email': 'بريد إلكتروني غير صحيح', 'invalid phone number': 'رقم هاتف غير صحيح',
  'min 8 chars with letters and digits': '8 أحرف على الأقل وتحتوي حروفًا وأرقامًا',
};
export const issueText = (issue: string, isAr: boolean) => (isAr ? ISSUE_AR[issue] ?? issue : issue);

const Field: React.FC<{ label: string; error?: string; children: React.ReactNode; required?: boolean }> = ({ label, error, children, required }) => {
  const { isAr } = usePlatform();
  return <div className="pf-field"><label>{label}{required ? <span className="req"> *</span> : null}</label>{children}{error ? <div className="err">{issueText(error, isAr)}</div> : null}</div>;
};

export const LoginPage: React.FC = () => {
  const { t, isAr, initiatives } = usePlatform();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true); setUnverified(false);
    try { await store.login(email.trim(), password); }
    catch (x) { setErr(errText(x, isAr)); setUnverified((x as { body?: { code?: string } }).body?.code === 'EMAIL_NOT_VERIFIED'); }
    finally { setBusy(false); }
  };
  const regs = (initiatives ?? []).filter((i) => i.registerView && i.status === 'active' && i.registrationOpen);
  return (
    <div className="pf-container pf-page">
      <div className="pf-box pf-auth">
        <h3>{t('تسجيل الدخول', 'Sign in')}</h3>
        <p className="pf-muted" style={{ marginBottom: 14 }}>{t('حساب واحد لكل المبادرات — المصانع ورواد الأعمال والجهات المشاركة.', 'One account for every initiative — factories, founders and participating bodies.')}</p>
        <form className="pf-form" onSubmit={submit}>
          <Field label={t('البريد الإلكتروني', 'E-mail')}><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required dir="ltr" /></Field>
          <Field label={t('كلمة المرور', 'Password')}><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          {err ? <Alert tone="err">{err}</Alert> : null}
          {unverified ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => void api.resendVerification(email).then(() => setErr(t('أُرسل رابط تفعيل جديد إلى بريدك.', 'A new activation link was sent.')))}>{t('إعادة إرسال رابط التفعيل', 'Resend the activation link')}</button> : null}
          <button className="btn btn-primary" disabled={busy}>{busy ? t('جارٍ الدخول…', 'Signing in…') : t('دخول', 'Sign in')}</button>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 14 }}>
            <a href="#forgot-password">{t('نسيت كلمة المرور؟', 'Forgot your password?')}</a>
            <a href="#register">{t('ليس لديك حساب؟ أنشئ حسابًا', 'No account? Create one')}</a>
          </div>
        </form>
        {regs.length ? (
          <div style={{ marginTop: 18, borderTop: '1px solid #EEF2F7', paddingTop: 14 }}>
            <p className="pf-muted" style={{ fontSize: 13, marginBottom: 8 }}>{t('أو سجّل مباشرة في مبادرة بنموذجها:', 'Or register directly with an initiative\'s form:')}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{regs.map((i) => <a key={i.id} className="btn btn-outline btn-sm" href={`#${i.registerView}`}>{isAr ? i.titleAr : i.titleEn}</a>)}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const RegisterPage: React.FC = () => {
  const { t, isAr, initiatives } = usePlatform();
  const [f, setF] = useState({ fullName: '', email: '', mobile: '', password: '', confirm: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setErrs({});
    if (f.password !== f.confirm) { setErrs({ confirm: isAr ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match' }); return; }
    setBusy(true);
    try { const r = await api.register({ fullName: f.fullName, email: f.email, mobile: f.mobile, password: f.password }); setDone(r.email); }
    catch (x) { setErr(errText(x, isAr)); setErrs(fieldErrors(x)); } finally { setBusy(false); }
  };
  if (done) return <div className="pf-container pf-page"><div className="pf-box pf-auth"><Alert tone="ok">{t(`تم إنشاء الحساب — أرسلنا رابط التفعيل إلى ${done}. افتحه ثم سجّل الدخول.`, `Account created — we sent an activation link to ${done}. Open it, then sign in.`)}</Alert></div></div>;
  const regs = (initiatives ?? []).filter((i) => i.registerView && i.status === 'active' && i.registrationOpen);
  return (
    <div className="pf-container pf-page">
      <div className="pf-box pf-auth" style={{ maxWidth: 560 }}>
        <h3>{t('إنشاء حساب على المنصة', 'Create a platform account')}</h3>
        <p className="pf-muted" style={{ marginBottom: 14 }}>{t('بعد التفعيل أكمل بياناتك مرة واحدة وقدّم على أي مبادرة.', 'After activation complete your data once and apply to any initiative.')}</p>
        {regs.length ? <Alert tone="info">{t('تريد التقديم على مبادرة بعينها؟ يمكنك التسجيل بنموذجها مباشرة: ', 'Applying to a specific initiative? Register with its form directly: ')}
          {regs.map((i, k) => <React.Fragment key={i.id}>{k ? ' · ' : ''}<a href={`#${i.registerView}`}>{isAr ? i.titleAr : i.titleEn}</a></React.Fragment>)}</Alert> : null}
        <form className="pf-form" onSubmit={submit} style={{ marginTop: 14 }}>
          <Field label={t('الاسم الكامل', 'Full name')} error={errs.fullName} required><input value={f.fullName} onChange={set('fullName')} required /></Field>
          <div className="pf-row">
            <Field label={t('البريد الإلكتروني', 'E-mail')} error={errs.email} required><input type="email" dir="ltr" value={f.email} onChange={set('email')} required /></Field>
            <Field label={t('رقم الموبايل', 'Mobile')} error={errs.mobile} required><input dir="ltr" value={f.mobile} onChange={set('mobile')} required /></Field>
          </div>
          <div className="pf-row">
            <Field label={t('كلمة المرور', 'Password')} error={errs.password} required><input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} required /></Field>
            <Field label={t('تأكيد كلمة المرور', 'Confirm password')} error={errs.confirm} required><input type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} required /></Field>
          </div>
          {err ? <Alert tone="err">{err}</Alert> : null}
          <button className="btn btn-primary" disabled={busy}>{busy ? t('جارٍ الإنشاء…', 'Creating…') : t('إنشاء الحساب', 'Create account')}</button>
          <a href="#login" style={{ fontSize: 14 }}>{t('لديك حساب؟ سجّل الدخول', 'Already registered? Sign in')}</a>
        </form>
      </div>
    </div>
  );
};

/** One activation request per link, however often the page mounts (the token is single-use on the server). */
const verifyRequests = new Map<string, Promise<{ res: Response; j: { message?: string; messageAr?: string; messageEn?: string; data?: { submitted?: boolean } } }>>();
function verifyOnce(token: string) {
  let p = verifyRequests.get(token);
  if (!p) {
    p = fetch('/api/v1/auth/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ token }) })
      .then(async (res) => ({ res, j: await res.json() }));
    verifyRequests.set(token, p);
  }
  return p;
}

export const VerifyEmailPage: React.FC = () => {
  const { t, isAr, param } = usePlatform();
  const [state, setState] = useState<{ ok: boolean; msg: string; submitted?: boolean } | null>(null);
  useEffect(() => {
    if (!param) return;
    let cancelled = false;
    (async () => {
      try {
        const { res, j } = await verifyOnce(param);
        if (!cancelled) setState({ ok: res.ok, msg: (res.ok ? j.message : (isAr ? j.messageAr : j.messageEn)) ?? '', submitted: Boolean(j.data?.submitted) });
      } catch (e) { if (!cancelled) setState({ ok: false, msg: errText(e, isAr) }); }
    })();
    return () => { cancelled = true; };
  }, [param, isAr]);
  return (
    <div className="pf-container pf-page"><div className="pf-box pf-auth">
      <h3>{t('تفعيل البريد الإلكتروني', 'E-mail activation')}</h3>
      {!state ? <p className="pf-muted">{t('جارٍ التفعيل…', 'Activating…')}</p> : (
        <div data-testid={state.ok ? 'verify-ok' : 'verify-failed'} data-under-review={state.submitted ? '1' : '0'}><Alert tone={state.ok ? 'ok' : 'err'}>{state.msg}</Alert></div>
      )}
      {state?.ok ? <a className="btn btn-primary" href="#login" style={{ marginTop: 14 }}>{t('تسجيل الدخول', 'Sign in')}</a> : null}
    </div></div>
  );
};

export const ForgotPasswordPage: React.FC = () => {
  const { t, isAr } = usePlatform();
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const submit = async (e: React.FormEvent) => { e.preventDefault(); try { await api.forgotPassword(email); setMsg(t('إذا كان البريد مسجلًا فستصلك رسالة لاستعادة كلمة المرور.', 'If the e-mail is registered you will receive a reset link.')); } catch (x) { setMsg(errText(x, isAr)); } };
  return (
    <div className="pf-container pf-page"><div className="pf-box pf-auth">
      <h3>{t('استعادة كلمة المرور', 'Reset your password')}</h3>
      <form className="pf-form" onSubmit={submit}>
        <Field label={t('البريد الإلكتروني', 'E-mail')}><input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        {msg ? <Alert tone="info">{msg}</Alert> : null}
        <button className="btn btn-primary">{t('إرسال الرابط', 'Send the link')}</button>
      </form>
    </div></div>
  );
};

export const ResetPasswordPage: React.FC = () => {
  const { t, isAr, param } = usePlatform();
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.resetPassword(param ?? '', pw); setMsg({ ok: true, text: t('تم تعيين كلمة المرور — سجّل الدخول بها الآن.', 'Password set — sign in with it now.') }); }
    catch (x) { setMsg({ ok: false, text: errText(x, isAr) }); }
  };
  return (
    <div className="pf-container pf-page"><div className="pf-box pf-auth">
      <h3>{t('تعيين كلمة مرور جديدة', 'Set a new password')}</h3>
      <form className="pf-form" onSubmit={submit}>
        <Field label={t('كلمة المرور الجديدة', 'New password')}><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
        {msg ? <Alert tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Alert> : null}
        {msg?.ok ? <a className="btn btn-primary" href="#login">{t('تسجيل الدخول', 'Sign in')}</a> : <button className="btn btn-primary">{t('حفظ', 'Save')}</button>}
      </form>
    </div></div>
  );
};

export const ChangePasswordPage: React.FC = () => {
  const { t, isAr, me } = usePlatform();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.changePassword(cur, pw); await store.reloadMe(); setMsg({ ok: true, text: t('تم تغيير كلمة المرور.', 'Password changed.') }); }
    catch (x) { setMsg({ ok: false, text: errText(x, isAr) }); }
  };
  return (
    <div className="pf-container pf-page"><div className="pf-box pf-auth">
      <h3>{t('تغيير كلمة المرور', 'Change password')}</h3>
      {me?.user.mustChangePassword ? <Alert tone="warn">{t('يجب تغيير كلمة المرور المؤقتة قبل المتابعة.', 'You must change your temporary password first.')}</Alert> : null}
      <form className="pf-form" onSubmit={submit}>
        <Field label={t('كلمة المرور الحالية', 'Current password')}><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} required /></Field>
        <Field label={t('كلمة المرور الجديدة', 'New password')}><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
        {msg ? <Alert tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Alert> : null}
        {msg?.ok ? <button type="button" className="btn btn-primary" onClick={() => store.goHome()}>{t('متابعة', 'Continue')}</button> : <button className="btn btn-primary">{t('حفظ', 'Save')}</button>}
      </form>
    </div></div>
  );
};
