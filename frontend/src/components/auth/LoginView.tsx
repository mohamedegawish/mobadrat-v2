import React, { useState } from 'react';
import { usePlatformStore, pendingApplication } from '../../store/state';
import { store as platform } from '../../platform/store';
import { api, ApiError, errText, fieldErrors } from '../../platform/api';
import { useToast } from '../common/ToastSystem';
import {
  LogIn,
  Mail,
  Lock,
  AlertCircle,
  Building2,
  Factory,
  ShieldCheck,
  UserPlus,
  Eye,
  EyeOff,
  CheckCircle2,
  Phone,
  User as UserIcon,
  Info,
} from 'lucide-react';
import { EgyptianEagle } from '../common/EgyptianEagle';

const ISSUE_AR: Record<string, string> = {
  required: 'مطلوب', 'invalid email': 'بريد إلكتروني غير صحيح', 'invalid phone number': 'رقم هاتف غير صحيح',
  'min 8 chars with letters and digits': '8 أحرف على الأقل وتحتوي حروفاً وأرقاماً',
};

/** The sovereign card every account screen sits in (eagle, title, subtitle). */
export const AuthShell: React.FC<{ title?: string; subtitle?: string; children: React.ReactNode; maxWidth?: string }> = ({ title, subtitle, children, maxWidth = '820px' }) => {
  const { language } = usePlatformStore();
  const isAr = language === 'ar';
  return (
    <div className="container-custom" style={{ padding: '2.5rem 1.5rem 4rem 1.5rem', maxWidth }}>
      <div
        className="login-shell"
        style={{
          background: '#FFFFFF',
          borderRadius: 'var(--radius-2xl)',
          border: '1px solid var(--border-medium)',
          boxShadow: 'var(--shadow-xl)',
          overflow: 'hidden',
        }}
      >
        {/* Top Sovereign Header */}
        <div
          style={{
            padding: '2.25rem 2rem 1.75rem',
            borderBottom: '1px solid var(--border-subtle)',
            textAlign: 'center',
            background: 'linear-gradient(180deg, #FAFAFA 0%, #FFFFFF 100%)',
            position: 'relative',
          }}
        >
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: 'var(--radius-lg)',
              background: '#0F172A',
              border: '1px solid rgba(255,255,255,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem',
              boxShadow: '0 4px 12px rgba(15, 23, 42, 0.15)',
            }}
          >
            <EgyptianEagle size={42} />
          </div>

          <h1 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-main)', margin: '0 0 0.5rem' }}>
            {title ?? (isAr ? 'بوابة الدخول الموحدة للمنصة الصناعية' : 'Unified Industrial Platform Portal')}
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6, margin: 0, maxWidth: '520px', marginInline: 'auto' }}>
            {subtitle ?? (isAr
              ? 'المنظومة الوطنية الموحدة للمبادرات والحوافز وتمويل المصانع المصرية — وزارة الصناعة'
              : 'National Unified Portal for Egyptian Industrial Initiatives & Incentives — Ministry of Industry')}
          </p>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              fontSize: '0.78rem',
              color: 'var(--egypt-red)',
              fontWeight: 700,
              marginTop: '1rem',
            }}
          >
            <ShieldCheck size={16} />
            <span>{isAr ? 'بوابة حكومية رسمية مؤمنة' : 'Official Secured Sovereign Portal'}</span>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
};

const PasswordInput: React.FC<{ id: string; value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void; autoComplete: string }> = ({ id, value, onChange, show, onToggle, autoComplete }) => (
  <div style={{ position: 'relative' }}>
    <Lock size={16} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', insetInlineStart: '0.75rem', color: 'var(--text-muted)' }} />
    <input
      id={id}
      type={show ? 'text' : 'password'}
      className="form-control"
      dir="ltr"
      placeholder="••••••••"
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{ paddingInlineStart: '2.4rem', paddingInlineEnd: '2.5rem', textAlign: 'left' }}
      autoComplete={autoComplete}
    />
    <button
      type="button"
      onClick={onToggle}
      aria-label={show ? 'hide' : 'show'}
      style={{
        position: 'absolute',
        insetInlineEnd: '0.6rem',
        top: '50%',
        transform: 'translateY(-50%)',
        background: 'none',
        border: 'none',
        color: 'var(--text-muted)',
        cursor: 'pointer',
      }}
    >
      {show ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  </div>
);

export const LoginView: React.FC = () => {
  const { language, view, initiatives } = usePlatformStore();
  const { toast } = useToast();
  const isAr = language === 'ar';
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');

  // Tabs: 'factory' | 'official'
  const [authTab, setAuthTab] = useState<'factory' | 'official'>(params.get('tab') === 'official' ? 'official' : 'factory');
  // Subtab for factory: 'signin' | 'signup'
  const [factoryMode, setFactoryMode] = useState<'signin' | 'signup'>(view === 'register' ? 'signup' : 'signin');

  // Sign in state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [unverified, setUnverified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  // Registration state (a platform account — the facility data is completed once in «المصانع» or when applying)
  const [regData, setRegData] = useState({ name: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [regErrors, setRegErrors] = useState<Record<string, string>>({});
  const [registered, setRegistered] = useState('');

  const [resendBusy, setResendBusy] = useState(false);

  // Initiatives with their own registration form (e.g. the factory registration of Shams El-Senaa)
  const pending = pendingApplication();
  const regForms = initiatives
    .filter(i => i.status === 'active' && i.registrationOpen)
    .map(i => ({ i, view: registerViewOf(i.id) }))
    .filter(x => x.view);

  const switchTab = (tab: 'factory' | 'official') => { setAuthTab(tab); setError(''); setUnverified(false); setNotice(''); };
  const switchMode = (mode: 'signin' | 'signup') => { setFactoryMode(mode); setError(''); setUnverified(false); setNotice(''); };

  // Handle Official or Factory Login — the platform account (one account for every initiative).
  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    setUnverified(false);
    setNotice('');

    if (!email.trim()) {
      setError(isAr ? 'يرجى إدخال البريد الإلكتروني.' : 'Please enter your email.');
      return;
    }
    if (!password) {
      setError(isAr ? 'يرجى إدخال كلمة المرور.' : 'Please enter your password.');
      return;
    }

    setBusy(true);
    try {
      const me = await platform.login(email.trim(), password);
      if (me && !me.user.mustChangePassword) {
        toast('success', isAr ? `مرحباً بك، ${me.user.nameAr || me.user.email}` : `Welcome, ${me.user.nameEn || me.user.nameAr || me.user.email}`);
      }
    } catch (err) {
      const code = err instanceof ApiError ? err.body.code : '';
      if (code === 'EMAIL_NOT_VERIFIED') {
        setUnverified(true);
        setError(isAr ? 'البريد غير مؤكد — يرجى تفعيل حسابك. تحقق من بريدك أو أعد الإرسال.' : 'Email not verified — check inbox or resend.');
      } else {
        setError(errText(err, isAr) || (isAr ? 'تعذر تسجيل الدخول. تحقق من البيانات.' : 'Login failed. Check credentials.'));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (!email.trim()) { setError(isAr ? 'أدخل بريدك أولاً.' : 'Enter your email first.'); return; }
    setResendBusy(true);
    try {
      await api.resendVerification(email.trim());
      setError('');
      setUnverified(false);
      setNotice(isAr ? 'أُرسل رابط تفعيل جديد إلى بريدك.' : 'A new activation link was sent.');
      toast('success', isAr ? 'تم إرسال رابط التفعيل — راجع بريدك.' : 'Verification link resent — check inbox.');
    } catch (err) {
      setError(errText(err, isAr));
    } finally { setResendBusy(false); }
  };

  // Handle registration — a platform account (activation link by e-mail).
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setRegErrors({});

    if (!regData.name.trim()) {
      setError(isAr ? 'اسم المفوض / الممثل مطلوب.' : 'Representative name is required.');
      return;
    }
    if (!regData.email.trim()) {
      setError(isAr ? 'البريد الإلكتروني مطلوب.' : 'Email is required.');
      return;
    }
    if (!regData.phone.trim()) {
      setError(isAr ? 'رقم الهاتف مطلوب.' : 'Phone is required.');
      return;
    }
    if (regData.password.length < 8 || !/[A-Za-z]/.test(regData.password) || !/\d/.test(regData.password)) {
      setError(isAr ? 'كلمة المرور 8 أحرف على الأقل وتحتوي حرفاً ورقماً.' : 'Password must be 8+ chars with letter+digit.');
      return;
    }
    if (regData.password !== regData.confirmPassword) {
      setError(isAr ? 'تأكيد كلمة المرور غير متطابق.' : 'Password confirmation does not match.');
      return;
    }

    setBusy(true);
    try {
      const r = await api.register({ fullName: regData.name.trim(), email: regData.email.trim(), mobile: regData.phone.trim(), password: regData.password });
      setRegistered(r.email);
      toast('success', isAr ? 'تم التسجيل — يرجى تفعيل بريدك. راجع بريدك.' : 'Registered — please verify your email.');
    } catch (err) {
      setError(errText(err, isAr) || (isAr ? 'فشل إنشاء الحساب.' : 'Registration failed.'));
      setRegErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  const fieldErr = (k: string) => regErrors[k]
    ? <div className="form-helper field-error" style={{ color: 'var(--status-rejected)' }}>{isAr ? (ISSUE_AR[regErrors[k]] ?? regErrors[k]) : regErrors[k]}</div>
    : null;

  const errorBox = error ? (
    <div className="error-box pf-alert err" role="alert" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem', alignItems: 'stretch' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <AlertCircle size={16} />
        <span>{error}</span>
      </div>
      {unverified && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleResend} disabled={resendBusy} style={{ alignSelf: 'flex-start' }}>
          {resendBusy ? (isAr ? 'جارٍ الإرسال...' : 'Sending...') : (isAr ? 'إعادة إرسال رابط التفعيل' : 'Resend verification link')}
        </button>
      )}
    </div>
  ) : null;

  const noticeBox = notice ? (
    <div className="pf-alert ok" role="status" style={{ marginBottom: '1.25rem' }}>
      <CheckCircle2 size={16} />
      <span>{notice}</span>
    </div>
  ) : null;

  const forgotLink = (
    <a href="#forgot-password" style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--egypt-red)', textDecoration: 'none' }}>
      {isAr ? 'نسيت كلمة المرور؟' : 'Forgot password?'}
    </a>
  );

  return (
    <AuthShell>
      {/* Portal Selection Tabs (Factory vs Government Official) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          borderBottom: '1px solid var(--border-subtle)',
          background: '#F8FAFC',
        }}
      >
        <button
          type="button"
          onClick={() => switchTab('factory')}
          style={{
            padding: '1.1rem 1rem',
            background: authTab === 'factory' ? '#FFFFFF' : 'transparent',
            border: 'none',
            borderBottom: authTab === 'factory' ? '3px solid var(--egypt-red)' : '3px solid transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.6rem',
            fontWeight: authTab === 'factory' ? 800 : 600,
            color: authTab === 'factory' ? 'var(--text-main)' : 'var(--text-muted)',
            fontSize: '0.92rem',
            transition: 'all 0.15s ease',
          }}
        >
          <Factory size={18} style={{ color: authTab === 'factory' ? 'var(--egypt-red)' : 'var(--text-muted)' }} />
          <span>{isAr ? 'المنشآت الصناعية والمستثمرون' : 'Industrial Facilities & Investors'}</span>
        </button>

        <button
          type="button"
          onClick={() => switchTab('official')}
          style={{
            padding: '1.1rem 1rem',
            background: authTab === 'official' ? '#FFFFFF' : 'transparent',
            border: 'none',
            borderBottom: authTab === 'official' ? '3px solid var(--egypt-red)' : '3px solid transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.6rem',
            fontWeight: authTab === 'official' ? 800 : 600,
            color: authTab === 'official' ? 'var(--text-main)' : 'var(--text-muted)',
            fontSize: '0.92rem',
            transition: 'all 0.15s ease',
          }}
        >
          <Building2 size={18} style={{ color: authTab === 'official' ? 'var(--egypt-red)' : 'var(--text-muted)' }} />
          <span>{isAr ? 'المسؤولون والجهات الحكومية' : 'Government Officials & Reviewers'}</span>
        </button>
      </div>

      {/* Tab 1: Factory / Investor Portal */}
      {authTab === 'factory' && (
        <div style={{ padding: '2rem' }}>
          {/* Sub-toggle: Sign In vs Sign Up */}
          <div
            style={{
              display: 'flex',
              background: '#F1F5F9',
              padding: '0.3rem',
              borderRadius: 'var(--radius-lg)',
              marginBottom: '1.75rem',
            }}
          >
            <button
              type="button"
              onClick={() => switchMode('signin')}
              style={{
                flex: 1,
                padding: '0.6rem',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                background: factoryMode === 'signin' ? '#FFFFFF' : 'transparent',
                color: factoryMode === 'signin' ? 'var(--text-main)' : 'var(--text-muted)',
                fontWeight: factoryMode === 'signin' ? 800 : 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
                boxShadow: factoryMode === 'signin' ? 'var(--shadow-xs)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              {isAr ? 'تسجيل الدخول لمنشأتك' : 'Sign In to Facility'}
            </button>

            <button
              type="button"
              onClick={() => switchMode('signup')}
              style={{
                flex: 1,
                padding: '0.6rem',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                background: factoryMode === 'signup' ? '#FFFFFF' : 'transparent',
                color: factoryMode === 'signup' ? 'var(--text-main)' : 'var(--text-muted)',
                fontWeight: factoryMode === 'signup' ? 800 : 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
                boxShadow: factoryMode === 'signup' ? 'var(--shadow-xs)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              {isAr ? 'تسجيل منشأة جديدة (حساب جديد)' : 'Register New Facility'}
            </button>
          </div>

          {errorBox}
          {noticeBox}

          {/* Factory Sign In Form */}
          {factoryMode === 'signin' && (
            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label className="form-label required" htmlFor="fac-login-email">{isAr ? 'البريد الإلكتروني للمنشأة' : 'Email'}</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={16} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', insetInlineStart: '0.75rem', color: 'var(--text-muted)' }} />
                  <input
                    id="fac-login-email"
                    type="email"
                    className="form-control"
                    dir="ltr"
                    placeholder="m.sewedy@elsewedy-ind.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    style={{ paddingInlineStart: '2.4rem', textAlign: 'left' }}
                    autoComplete="username"
                  />
                </div>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <label className="form-label required" htmlFor="fac-login-pass" style={{ margin: 0 }}>{isAr ? 'كلمة المرور' : 'Password'}</label>
                  {forgotLink}
                </div>
                <PasswordInput id="fac-login-pass" value={password} onChange={setPassword} show={showPass} onToggle={() => setShowPass(!showPass)} autoComplete="current-password" />
              </div>

              <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: '0.5rem' }} disabled={busy}>
                <LogIn size={16} />
                <span>{busy ? (isAr ? 'جاري التحقق...' : 'Signing in...') : (isAr ? 'دخول المنشأة' : 'Sign in')}</span>
              </button>

              <div style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                <span>{isAr ? 'ليس لديك حساب منشأة مسجل؟ ' : "Don't have a registered facility? "}</span>
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  style={{ background: 'none', border: 'none', color: 'var(--egypt-red)', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                >
                  {isAr ? 'سجل منشأتك الآن' : 'Register now'}
                </button>
              </div>
            </form>
          )}

          {/* Registration */}
          {factoryMode === 'signup' && registered && (
            <div className="pf-alert ok" role="status" data-testid="register-ok">
              <CheckCircle2 size={18} />
              <span>
                {isAr
                  ? `تم إنشاء الحساب — أرسلنا رابط التفعيل إلى ${registered}. افتحه ثم سجّل الدخول.`
                  : `Account created — we sent an activation link to ${registered}. Open it, then sign in.`}
              </span>
            </div>
          )}

          {factoryMode === 'signup' && !registered && (
            <>
              {regForms.length > 0 && (
                <div
                  style={{
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: 'var(--radius-lg)',
                    padding: '1rem',
                    marginBottom: '1.5rem',
                    display: 'flex',
                    gap: '0.75rem',
                    alignItems: 'flex-start',
                  }}
                >
                  <Info size={20} style={{ color: 'var(--egypt-red)', flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '0.25rem' }}>
                      {isAr ? 'التسجيل في مبادرة بعينها؟' : 'Registering for a specific initiative?'}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: '0.6rem' }}>
                      {isAr
                        ? 'سجّل بنموذج المبادرة مباشرة (بيانات المنشأة والمستندات)، أو أنشئ حساباً واحداً على المنصة بالأسفل وأكمل بياناتك مرة واحدة لكل المبادرات.'
                        : 'Register with the initiative\'s own form (facility data and documents), or create one platform account below and complete your data once for every initiative.'}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {regForms.map(({ i, view: rv }) => (
                        <a key={i.id} href={`#${rv}`} className={`btn btn-sm ${pending?.id === i.id ? 'btn-primary' : 'btn-secondary'}`} style={{ textDecoration: 'none' }}>
                          {isAr ? `التسجيل في ${i.titleAr}` : `Register for ${i.titleEn}`}
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <form onSubmit={handleRegister}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label required" htmlFor="reg-name">{isAr ? 'اسم المفوض / الممثل الرسمي' : 'Authorized Representative'}</label>
                    <div style={{ position: 'relative' }}>
                      <UserIcon size={16} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', insetInlineStart: '0.75rem', color: 'var(--text-muted)' }} />
                      <input
                        id="reg-name"
                        type="text"
                        className="form-control"
                        value={regData.name}
                        onChange={e => setRegData({ ...regData, name: e.target.value })}
                        placeholder={isAr ? 'مثال: م. أحمد عبد الله' : 'e.g. Eng. Ahmed Abdullah'}
                        style={{ paddingInlineStart: '2.4rem' }}
                        autoComplete="name"
                      />
                    </div>
                    {fieldErr('fullName')}
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label required" htmlFor="reg-phone">{isAr ? 'رقم الهاتف للتواصل' : 'Phone'}</label>
                    <div style={{ position: 'relative' }}>
                      <Phone size={16} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', insetInlineStart: '0.75rem', color: 'var(--text-muted)' }} />
                      <input
                        id="reg-phone"
                        type="text"
                        className="form-control"
                        dir="ltr"
                        value={regData.phone}
                        onChange={e => setRegData({ ...regData, phone: e.target.value })}
                        placeholder="01001234567"
                        style={{ paddingInlineStart: '2.4rem', textAlign: 'left' }}
                        autoComplete="tel"
                      />
                    </div>
                    {fieldErr('mobile')}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label required" htmlFor="reg-email">{isAr ? 'البريد الإلكتروني الرسمي للمنشأة' : 'Official Email'}</label>
                  <div style={{ position: 'relative' }}>
                    <Mail size={16} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', insetInlineStart: '0.75rem', color: 'var(--text-muted)' }} />
                    <input
                      id="reg-email"
                      type="email"
                      className="form-control"
                      dir="ltr"
                      value={regData.email}
                      onChange={e => setRegData({ ...regData, email: e.target.value })}
                      placeholder="info@factory.com"
                      style={{ paddingInlineStart: '2.4rem', textAlign: 'left' }}
                      autoComplete="email"
                    />
                  </div>
                  {fieldErr('email')}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label required" htmlFor="reg-pass">{isAr ? 'كلمة المرور' : 'Password'}</label>
                    <PasswordInput id="reg-pass" value={regData.password} onChange={v => setRegData({ ...regData, password: v })} show={showPass} onToggle={() => setShowPass(!showPass)} autoComplete="new-password" />
                    <div className="form-helper">{isAr ? '8 أحرف على الأقل وتحتوي حرفاً ورقماً.' : '8+ chars, letter+digit.'}</div>
                    {fieldErr('password')}
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label required" htmlFor="reg-confirm">{isAr ? 'تأكيد كلمة المرور' : 'Confirm Password'}</label>
                    <PasswordInput id="reg-confirm" value={regData.confirmPassword} onChange={v => setRegData({ ...regData, confirmPassword: v })} show={showPass} onToggle={() => setShowPass(!showPass)} autoComplete="new-password" />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.5rem 0 1.25rem' }}>
                  <CheckCircle2 size={14} style={{ color: 'var(--status-approved)', flexShrink: 0 }} />
                  <span>{isAr ? 'بعد تفعيل البريد أكمل بيانات منشأتك مرة واحدة من «المصانع» — تُستخدم في كل المبادرات.' : 'After activating your e-mail, complete your facility data once from "Factories" — reused by every initiative.'}</span>
                </div>

                <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy}>
                  <UserPlus size={16} />
                  <span>{busy ? (isAr ? 'جاري التسجيل...' : 'Registering...') : (isAr ? 'إنشاء حساب المنشأة وتفعيل البوابة' : 'Create Account & Open Portal')}</span>
                </button>
              </form>
            </>
          )}
        </div>
      )}

      {/* Tab 2: Government Officials */}
      {authTab === 'official' && (
        <div style={{ padding: '2rem' }}>
          <div
            style={{
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: 'var(--radius-lg)',
              padding: '1rem',
              marginBottom: '1.5rem',
              display: 'flex',
              gap: '0.75rem',
              alignItems: 'flex-start',
            }}
          >
            <ShieldCheck size={20} style={{ color: 'var(--egypt-red)', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '0.25rem' }}>
                {isAr ? 'بوابة دخول المسؤولين ومراجعي المبادرات المعتمدين' : 'Authorized Officials & Reviewers Access'}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {isAr
                  ? 'دخول موحد لمسؤولي وزارة الصناعة، هيئة التنمية الصناعية (IDA)، مركز تحديث الصناعة (IMC)، البنوك الوطنية الشريكة، ومقدمي الخدمة. الحسابات تُنشأ وتُعتمد مركزياً من قبل المشرف العام للمنصة.'
                  : 'Secured access for Ministry of Industry, IDA, IMC, Banks and Service Providers. Official accounts are managed centrally by the Ministry Admin.'}
              </div>
            </div>
          </div>

          {errorBox}
          {noticeBox}

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label required" htmlFor="off-login-email">{isAr ? 'البريد الإلكتروني الرسمي للجهة' : 'Official Government Email'}</label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', insetInlineStart: '0.75rem', color: 'var(--text-muted)' }} />
                <input
                  id="off-login-email"
                  type="email"
                  className="form-control"
                  dir="ltr"
                  placeholder="tarek.mansour@industry.gov.eg"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  style={{ paddingInlineStart: '2.4rem', textAlign: 'left' }}
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <label className="form-label required" htmlFor="off-login-pass" style={{ margin: 0 }}>{isAr ? 'كلمة المرور' : 'Password'}</label>
                {forgotLink}
              </div>
              <PasswordInput id="off-login-pass" value={password} onChange={setPassword} show={showPass} onToggle={() => setShowPass(!showPass)} autoComplete="current-password" />
            </div>

            <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: '0.5rem' }} disabled={busy}>
              <LogIn size={16} />
              <span>{busy ? (isAr ? 'جاري التحقق...' : 'Authenticating...') : (isAr ? 'تسجيل دخول المسؤول' : 'Sign in as Official')}</span>
            </button>
          </form>
        </div>
      )}
    </AuthShell>
  );
};

/** The registration form of an initiative run by a module (e.g. «i/shams/register»), or null. */
function registerViewOf(initiativeId: string): string | null {
  return platform.get().initiatives?.find(i => i.id === initiativeId)?.registerView ?? null;
}
