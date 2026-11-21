import { Errors, type ErrorDetail } from './errors.js';

export type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** يرفض أي حقل خارج القائمة المسموح بها (حماية من mass assignment). */
export function onlyKeys(body: unknown, allowed: readonly string[]): Obj {
  if (!isObj(body)) throw Errors.validation([{ field: '_body', issue: 'must be a JSON object' }]);
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) throw Errors.validation(unknown.map((k) => ({ field: k, issue: 'unknown field' })));
  return body;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PHONE_RE = /^\+?[0-9][0-9\s-]{5,19}$/;
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isEmail(v: unknown): v is string { return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v); }
export function isPhone(v: unknown): v is string { return typeof v === 'string' && PHONE_RE.test(v.trim()); }
export function isUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 300) return false;
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** يجمع أخطاء التحقق ثم يرميها مرة واحدة. */
export class Checker {
  details: ErrorDetail[] = [];
  add(field: string, issue: string): void { this.details.push({ field, issue }); }
  text(body: Obj, field: string, opts: { required?: boolean; max?: number; min?: number } = {}): string | undefined {
    const v = body[field];
    if (v === undefined || v === null || v === '') {
      if (opts.required) this.add(field, 'required');
      return undefined;
    }
    if (typeof v !== 'string') { this.add(field, 'must be a string'); return undefined; }
    const t = v.trim();
    if (opts.required && !t) { this.add(field, 'required'); return undefined; }
    if (opts.min !== undefined && t.length < opts.min) this.add(field, `min length ${opts.min}`);
    if (t.length > (opts.max ?? 500)) this.add(field, `max length ${opts.max ?? 500}`);
    return t;
  }
  throwIfAny(): void {
    if (this.details.length) throw Errors.validation(this.details);
  }
}

export function isStrongPassword(pw: unknown): pw is string {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 128 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
}

/** I2: الأرقام العربية-الهندية (٠-٩) والفارسية (۰-۹) → لاتينية، قبل أي تحقق. */
export function normalizeDigits(v: string): string {
  return v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** I2: موقع بلا بروتوكول (www.x.com) → https://www.x.com. */
export function withHttpScheme(v: string): string {
  const t = v.trim();
  return t && !/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? `https://${t}` : t;
}
