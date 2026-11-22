import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText, useStore } from '../store/state';
import { ApiException } from '../api';

/** تحميل بيانات مع حالات loading/error وإعادة المحاولة. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const { isAr } = useStore();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string>('');
  /** HTTP status للخطأ الأخير (404/403 = غير متاح لهذا الحساب — لا معنى لإعادة المحاولة، M4). */
  const [errorStatus, setErrorStatus] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    setError('');
    setErrorStatus(0);
    try {
      const d = await fn();
      if (my === seq.current) setData(d);
    } catch (e) {
      if (my === seq.current) { setError(errorText(e, isAr)); setErrorStatus(e instanceof ApiException ? e.http : 0); }
    } finally {
      if (my === seq.current) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { void reload(); }, [reload]);
  return { data, setData, error, errorStatus, loading, reload, notAvailable: errorStatus === 404 || errorStatus === 403 };
}

export function formatDate(iso: string | null | undefined, isAr: boolean, withTime = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(isAr ? 'ar-EG' : 'en-GB', withTime
    ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' }
    : { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Africa/Cairo' });
}

/**
 * M2 — قاعدة الأرقام: الكميات والعدّ والتواريخ بأرقام اللغة (عربية-هندية في الواجهة العربية)،
 * والمعرفات (رقم الطلب، رقم السجل، الهاتف، البريد) لاتينية دائمًا بـ class num-ltr.
 */
export function formatNumber(n: number | null | undefined, isAr: boolean): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString(isAr ? 'ar-EG' : 'en-US');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
