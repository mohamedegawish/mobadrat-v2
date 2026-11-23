/**
 * Platform account screens — one account for every initiative. Sign in and registration are the login page
 * (components/auth/LoginView); these are the e-mail links and password screens, in the same sovereign card.
 */
import React, { useEffect, useState } from 'react';
import { LogIn, Send, Save, ArrowLeft, ArrowRight } from 'lucide-react';
import { api, errText } from '../api';
import { usePlatform, store } from '../store';
import { Alert } from '../layout';
import { AuthShell } from '../../components/auth/LoginView';
import { ChangePasswordModal } from '../../components/auth/ChangePasswordModal';
import { usePlatformStore } from '../../store/state';

const ISSUE_AR: Record<string, string> = {
  required: 'مطلوب', 'invalid email': 'بريد إلكتروني غير صحيح', 'invalid phone number': 'رقم هاتف غير صحيح',
  'min 8 chars with letters and digits': '8 أحرف على الأقل وتحتوي حروفًا وأرقامًا',
};
export const issueText = (issue: string, isAr: boolean) => (isAr ? ISSUE_AR[issue] ?? issue : issue);

const Field: React.FC<{ label: string; error?: string; children: React.ReactNode; required?: boolean }> = ({ label, error, children, required }) => {
  const { isAr } = usePlatform();
  return (
    <div className="form-group pf-field">
      <label className={`form-label${required ? ' required' : ''}`}>{label}</label>
      {children}
      {error ? <div className="err">{issueText(error, isAr)}</div> : null}
    </div>
  );
};

const Body: React.FC<{ children: React.ReactNode }> = ({ children }) => <div style={{ padding: '2rem' }}>{children}</div>;

const BackToLogin: React.FC = () => {
  const { t, isAr } = usePlatform();
  return (
    <div style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.85rem' }}>
      <a href="#login" style={{ color: 'var(--egypt-red)', fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
        {isAr ? <ArrowRight size={14} /> : <ArrowLeft size={14} />}{t('العودة لتسجيل الدخول', 'Back to sign in')}
      </a>
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
    <AuthShell title={t('تفعيل البريد الإلكتروني', 'E-mail activation')} maxWidth="640px">
      <Body>
        {!state ? <p style={{ textAlign: 'center', color: 'var(--text-muted)', margin: 0 }}>{t('جارٍ التفعيل…', 'Activating…')}</p> : (
          <div data-testid={state.ok ? 'verify-ok' : 'verify-failed'} data-under-review={state.submitted ? '1' : '0'}><Alert tone={state.ok ? 'ok' : 'err'}>{state.msg}</Alert></div>
        )}
        {state?.ok ? (
          <a className="btn btn-primary btn-lg" href="#login" style={{ width: '100%', marginTop: '1.25rem', textDecoration: 'none' }}>
            <LogIn size={16} /><span>{t('تسجيل الدخول', 'Sign in')}</span>
          </a>
        ) : state ? <BackToLogin /> : null}
      </Body>
    </AuthShell>
  );
};

export const ForgotPasswordPage: React.FC = () => {
  const { t, isAr } = usePlatform();
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await api.forgotPassword(email); setMsg(t('إذا كان البريد مسجلًا فستصلك رسالة لاستعادة كلمة المرور.', 'If the e-mail is registered you will receive a reset link.')); }
    catch (x) { setMsg(errText(x, isAr)); } finally { setBusy(false); }
  };
  return (
    <AuthShell title={t('استعادة كلمة المرور', 'Reset your password')} subtitle={t('أدخل البريد الإلكتروني المسجل وسنرسل لك رابطًا لتعيين كلمة مرور جديدة.', 'Enter your registered e-mail and we will send you a link to set a new password.')} maxWidth="640px">
      <Body>
        <form onSubmit={submit}>
          <Field label={t('البريد الإلكتروني', 'E-mail')} required><input className="form-control" type="email" dir="ltr" style={{ textAlign: 'left' }} value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          {msg ? <div style={{ marginBottom: '1rem' }}><Alert tone="info">{msg}</Alert></div> : null}
          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy}><Send size={16} /><span>{t('إرسال الرابط', 'Send the link')}</span></button>
        </form>
        <BackToLogin />
      </Body>
    </AuthShell>
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
    <AuthShell title={t('تعيين كلمة مرور جديدة', 'Set a new password')} maxWidth="640px">
      <Body>
        <form onSubmit={submit}>
          <Field label={t('كلمة المرور الجديدة', 'New password')} required><input className="form-control" type="password" dir="ltr" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
          <div className="form-helper" style={{ marginTop: '-0.6rem', marginBottom: '1rem' }}>{t('8 أحرف على الأقل وتحتوي حرفاً ورقماً.', '8+ chars, letter+digit.')}</div>
          {msg ? <div style={{ marginBottom: '1rem' }}><Alert tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Alert></div> : null}
          {msg?.ok
            ? <a className="btn btn-primary btn-lg" href="#login" style={{ width: '100%', textDecoration: 'none' }}><LogIn size={16} /><span>{t('تسجيل الدخول', 'Sign in')}</span></a>
            : <button className="btn btn-primary btn-lg" style={{ width: '100%' }}><Save size={16} /><span>{t('حفظ', 'Save')}</span></button>}
        </form>
      </Body>
    </AuthShell>
  );
};

/**
 * Change password: the original password dialog — forced (cannot be dismissed) when the account still has its
 * temporary password, otherwise opened from the account menu or this link.
 */
export const ChangePasswordPage: React.FC = () => {
  const { me } = usePlatform();
  const { currentUser } = usePlatformStore();
  const forced = Boolean(me?.user.mustChangePassword);
  const [open, setOpen] = useState(true);
  return (
    <div className="container-custom" style={{ padding: '3rem 1.5rem', minHeight: '50vh' }}>
      <ChangePasswordModal
        isOpen={open || forced}
        isForced={forced}
        user={currentUser}
        onClose={() => { setOpen(false); store.goHome(); }}
        onSuccess={() => store.goHome()}
      />
    </div>
  );
};
