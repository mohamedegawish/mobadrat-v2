// عُدّة مشتركة لواجهات الموظفين: لغة، تحميل، نوافذ، حقول، تنسيق. لا تعتمد على store/ ولا على مكونات المتقدم.
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { ApiException } from '../../api/client';
import { staffApi } from '../../api/staffEndpoints';
import './staff.css';

// ── اللغة ──
interface LangCtx { isAr: boolean }
const Lang = createContext<LangCtx>({ isAr: true });

export function useLang() {
  const { isAr } = useContext(Lang);
  return useMemo(() => ({
    isAr,
    t: (ar: string, en: string) => (isAr ? ar : en),
    pick: (o: { ar: string; en: string }) => (isAr ? o.ar : o.en),
    n: (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? '—' : v.toLocaleString(isAr ? 'ar-EG' : 'en-US', { maximumFractionDigits: digits })),
    date: (iso: string | null | undefined, time = false) => {
      if (!iso) return '—';
      const dt = new Date(iso);
      if (Number.isNaN(dt.getTime())) return iso;
      return dt.toLocaleString(isAr ? 'ar-EG' : 'en-GB', time
        ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' }
        : { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Africa/Cairo' });
    },
    egp: (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString(isAr ? 'ar-EG' : 'en-US', { maximumFractionDigits: 0 })} ${isAr ? 'ج.م' : 'EGP'}`),
  }), [isAr]);
}

/** جذر كل واجهة موظفين: يحدد الاتجاه واللغة ويحمّل الأنماط. */
export function StaffRoot({ isAr, children, className = '' }: { isAr: boolean; children: ReactNode; className?: string }) {
  const v = useMemo(() => ({ isAr }), [isAr]);
  return (
    <Lang.Provider value={v}>
      <div className={`sx ${className}`} dir={isAr ? 'rtl' : 'ltr'} lang={isAr ? 'ar' : 'en'}><div className="sx-wrap">{children}</div></div>
    </Lang.Provider>
  );
}

export function errText(e: unknown, isAr: boolean): string {
  if (e instanceof ApiException) {
    const base = isAr ? e.apiError.messageAr : e.apiError.messageEn;
    const det = e.apiError.details?.length ? ` (${e.apiError.details.map((d) => d.field).join('، ')})` : '';
    return (base || e.apiError.code) + det;
  }
  return e instanceof Error ? e.message : String(e);
}
export function errFields(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (e instanceof ApiException) for (const d of e.apiError.details ?? []) out[d.field] = d.issue;
  return out;
}
export function errStatus(e: unknown): number { return e instanceof ApiException ? e.http : 0; }

// ── تحميل ──
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const { isAr } = useLang();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(0);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true); setError(''); setStatus(0);
    try { const r = await fn(); if (my === seq.current) setData(r); }
    catch (e) { if (my === seq.current) { setError(errText(e, isAr)); setStatus(errStatus(e)); } }
    finally { if (my === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void reload(); }, [reload]);
  return { data, setData, error, status, loading, reload };
}

/** عنوان ورقم الطلب المعروض. */
export function appTitle(a: { number: string | null; projectName: string }, isAr: boolean) {
  return a.projectName || (isAr ? 'مشروع بلا اسم' : 'Untitled project');
}

// ── مكونات صغيرة ──
export function Spinner({ label }: { label?: string }) {
  return <span className="sx-row" role="status"><Loader2 size={18} className="spin" style={{ animation: 'sx-spin 0.9s linear infinite' }} />{label && <span className="muted">{label}</span>}<style>{'@keyframes sx-spin{to{transform:rotate(360deg)}}'}</style></span>;
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="sx-stack" aria-hidden="true">{Array.from({ length: rows }, (_, i) => <div key={i} className="sx-skel" style={{ width: `${95 - (i % 3) * 15}%`, height: i === 0 ? 26 : 18 }} />)}</div>;
}

export function Note({ kind = 'info', children, role }: { kind?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode; role?: string }) {
  const Icon = kind === 'ok' ? CheckCircle2 : kind === 'bad' ? XCircle : kind === 'warn' ? AlertTriangle : Info;
  return <div className={`sx-note ${kind === 'info' ? '' : kind}`} role={role ?? (kind === 'bad' ? 'alert' : undefined)}><Icon size={18} /><div>{children}</div></div>;
}

export function LoadError({ error, onRetry }: { error: string; onRetry?: () => void }) {
  const { t } = useLang();
  return (
    <div className="sx-card"><Note kind="bad">{error}</Note>
      {onRetry && <div style={{ marginTop: 12 }}><button type="button" className="sx-btn ghost sm" onClick={onRetry}>{t('إعادة المحاولة', 'Retry')}</button></div>}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return <div className="sx-empty"><strong>{title}</strong>{body && <span>{body}</span>}{action}</div>;
}

export function Chip({ kind = 'blue', children }: { kind?: 'blue' | 'ok' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  return <span className={`sx-chip ${kind === 'blue' ? '' : kind}`}>{children}</span>;
}

/** رقم/معرّف لاتيني داخل نص عربي. */
export function Num({ children }: { children: ReactNode }) { return <span className="num">{children}</span>; }

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="sx-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err" role="alert">{error}</span>}
    </div>
  );
}

/** حقل نصي مرتبط بعنوانه تلقائيًا. */
export function TextField({ label, value, onChange, type = 'text', hint, error, multiline, min, max, step, placeholder, required, dir }: {
  label: string; value: string | number; onChange: (v: string) => void; type?: string; hint?: string; error?: string; multiline?: boolean;
  min?: number; max?: number; step?: number; placeholder?: string; required?: boolean; dir?: 'ltr' | 'rtl';
}) {
  const id = useId();
  return (
    <Field label={label + (required ? ' *' : '')} hint={hint} error={error} htmlFor={id}>
      {multiline
        ? <textarea id={id} className="sx-in" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-invalid={Boolean(error)} dir={dir} />
        : <input id={id} className="sx-in" type={type} value={value} min={min} max={max} step={step} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-invalid={Boolean(error)} dir={dir ?? (type === 'email' || type === 'number' || type === 'date' ? 'ltr' : undefined)} />}
    </Field>
  );
}

export function SelectField({ label, value, onChange, options, placeholder, error, hint }: {
  label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; placeholder?: string; error?: string; hint?: string;
}) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} htmlFor={id}>
      <select id={id} className="sx-in" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={Boolean(error)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function Button({ children, variant = 'primary', size, busy, ...rest }: {
  children: ReactNode; variant?: 'primary' | 'ghost' | 'accent' | 'danger' | 'danger-ghost'; size?: 'sm'; busy?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  const cls = ['sx-btn', variant === 'ghost' ? 'ghost' : variant === 'accent' ? 'accent' : variant === 'danger' || variant === 'danger-ghost' ? 'danger' : '', variant === 'danger-ghost' ? 'ghost' : '', size === 'sm' ? 'sm' : ''].filter(Boolean).join(' ');
  return <button type="button" {...rest} className={cls} disabled={rest.disabled || busy}>{busy && <Loader2 size={16} style={{ animation: 'sx-spin 0.9s linear infinite' }} />}{children}</button>;
}

/** نافذة حوار: Esc يغلق، التركيز يدخل النافذة ويعود بعدها. */
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const { t } = useLang();
  const ref = useRef<HTMLDivElement>(null);
  const tid = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not(.sx-x)');
    (first ?? ref.current)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && ref.current) {
        const f = Array.from(ref.current.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)'));
        if (!f.length) return;
        const a = f[0]; const z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="sx-modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`sx-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={tid} ref={ref} tabIndex={-1}>
        <header><h2 id={tid}>{title}</h2><button type="button" className="sx-x" onClick={onClose} aria-label={t('إغلاق', 'Close')}><X size={20} /></button></header>
        <div className="bd">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Pager({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (p: number) => void }) {
  const { t, n } = useLang();
  if (totalPages <= 1) return <div className="sx-pager"><span>{t(`${n(total)} نتيجة`, `${n(total)} results`)}</span></div>;
  return (
    <div className="sx-pager">
      <span>{t(`${n(total)} نتيجة — صفحة ${n(page)} من ${n(totalPages)}`, `${n(total)} results — page ${n(page)} of ${n(totalPages)}`)}</span>
      <span className="sx-row">
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('السابق', 'Previous')}</Button>
        <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>{t('التالي', 'Next')}</Button>
      </span>
    </div>
  );
}

export function Tabs<K extends string>({ items, value, onChange, label }: {
  items: Array<{ key: K; label: string; count?: number; hot?: boolean }>; value: K; onChange: (k: K) => void; label: string;
}) {
  return (
    <div className="sx-tabs" role="tablist" aria-label={label}>
      {items.map((it) => (
        <button key={it.key} type="button" role="tab" className="sx-tab" aria-selected={it.key === value} onClick={() => onChange(it.key)}>
          {it.label}{it.count !== undefined && <span className={`count ${it.hot ? 'hot' : ''}`}>{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Kpi({ value, label, hot, onClick }: { value: string; label: string; hot?: boolean; onClick?: () => void }) {
  const inner = <><span className="v">{value}</span><span className="l">{label}</span></>;
  return onClick
    ? <button type="button" className={`sx-kpi ${hot ? 'hot' : ''}`} onClick={onClick}>{inner}</button>
    : <div className={`sx-kpi ${hot ? 'hot' : ''}`}>{inner}</div>;
}

export function StateChip({ state, label }: { state: string; label: string }) {
  const kind = ['REJECTED', 'NOT_SELECTED', 'NOT_APPROVED', 'CLOSED_NOT_FUNDED', 'WITHDRAWN'].includes(state) ? 'bad'
    : ['COMPLETED', 'IMPLEMENTATION', 'OPERATING', 'SELECTED'].includes(state) ? 'ok'
      : state.endsWith('CORRECTION') ? 'warn' : 'blue';
  return <Chip kind={kind}>{label}</Chip>;
}

/** يفتح مستندًا بمصادقة (التوكن في الذاكرة فلا يكفي رابط). */
export async function openDocument(appId: string, docId: string, name: string) {
  const blob = await staffApi.download(appId, docId);
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank', 'noopener');
  if (!w) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** حالة عملية async واحدة: busy + خطأ. */
export function useBusy() {
  const { isAr } = useLang();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setError(''); setFields({});
    try { return await fn(); }
    catch (e) { setError(errText(e, isAr)); setFields(errFields(e)); return undefined; }
    finally { setBusy(false); }
  }, [isAr]);
  return { busy, error, fields, run, clear: () => { setError(''); setFields({}); } };
}

export interface StaffViewProps {
  /** لغة الواجهة الحالية. */
  isAr: boolean;
  /** معرّف الطلب المفتوح (للتحكم من الراوتر). اختياري — وإلا تدير الواجهة الاختيار داخليًا. */
  applicationId?: string | null;
  /** يُستدعى عند فتح/إغلاق طلب (id أو null) حتى يزامن الراوتر الرابط. */
  onNavigate?: (applicationId: string | null) => void;
}

/** اختيار الطلب المفتوح: يتحكم فيه الراوتر إن مرّر applicationId، وإلا حالة داخلية. */
export function useSelected(props: Pick<StaffViewProps, 'applicationId' | 'onNavigate'>) {
  const [local, setLocal] = useState<string | null>(null);
  const controlled = props.applicationId !== undefined;
  const id = controlled ? props.applicationId ?? null : local;
  const select = useCallback((next: string | null) => { if (!controlled) setLocal(next); props.onNavigate?.(next); window.scrollTo?.({ top: 0 }); }, [controlled, props]);
  return [id, select] as const;
}
