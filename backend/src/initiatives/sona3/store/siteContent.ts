/** محتوى الواجهة العامة القابل للتعديل من الأدمن. القيم الافتراضية في الواجهة؛ هنا فقط التجاوزات (overrides) بعد التحقق من بنيتها. */
import { getDb, nowIso, parseJson } from '../db/database.js';
import { Errors, type ErrorDetail } from '../http/errors.js';
import { isObj } from '../http/validate.js';

/** نوع كل مفتاح — يطابق CONTENT_SCHEMA في الواجهة (frontend/src/content/siteContent.ts). */
export const CONTENT_KINDS = {
  vision: 'bi', mission: 'bi', siteName: 'bi', siteTagline: 'bi', ministry: 'bi', topBar: 'bi', brandSub: 'bi', heroEyebrow: 'bi', footerRights: 'bi',
  figures: 'figures', journey: 'journey',
  eligibility: 'bilist', financing: 'bilist',
  about: 'bilist', contact: 'bilist', terms: 'bilist', faq: 'faq',
} as const;
export type ContentKey = keyof typeof CONTENT_KINDS;
export const CONTENT_KEYS = Object.keys(CONTENT_KINDS) as ContentKey[];

const MAX_TEXT = 2000;
const MAX_ITEMS = 60;

export function isContentKey(k: string): k is ContentKey { return Object.prototype.hasOwnProperty.call(CONTENT_KINDS, k); }

const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();

function bi(v: unknown, path: string, d: ErrorDetail[], opts: { allowEmpty?: boolean } = {}): { ar: string; en: string } {
  if (!isObj(v)) { d.push({ field: path, issue: 'must be {ar,en}' }); return { ar: '', en: '' }; }
  const out = { ar: '', en: '' };
  for (const l of ['ar', 'en'] as const) {
    const s = v[l];
    if (typeof s !== 'string') { d.push({ field: `${path}.${l}`, issue: 'must be a string' }); continue; }
    if (s.length > MAX_TEXT) { d.push({ field: `${path}.${l}`, issue: `max ${MAX_TEXT} chars` }); continue; }
    out[l] = clean(s);
    if (!out[l] && !opts.allowEmpty) d.push({ field: `${path}.${l}`, issue: 'required' });
  }
  return out;
}

function list(v: unknown, path: string, d: ErrorDetail[]): unknown[] {
  if (!Array.isArray(v)) { d.push({ field: path, issue: 'must be an array' }); return []; }
  if (v.length > MAX_ITEMS) { d.push({ field: path, issue: `max ${MAX_ITEMS} items` }); return []; }
  return v;
}

/** يتحقق من البنية ويرجع قيمة منظفة (يرمي 400 عند الخطأ). */
export function validateContent(key: ContentKey, raw: unknown): unknown {
  const d: ErrorDetail[] = [];
  let out: unknown;
  switch (CONTENT_KINDS[key]) {
    case 'bi': out = bi(raw, 'value', d); break;
    case 'bilist': out = list(raw, 'value', d).map((x, i) => bi(x, `value[${i}]`, d)); break;
    case 'figures': out = list(raw, 'value', d).map((x, i) => {
      const o = isObj(x) ? x : {};
      const value = typeof o.value === 'string' ? clean(o.value) : '';
      if (!value || value.length > 60) d.push({ field: `value[${i}].value`, issue: 'required, max 60 chars' });
      return { value, label: bi(o.label, `value[${i}].label`, d) };
    }); break;
    case 'journey': out = list(raw, 'value', d).map((x, i) => {
      const o = isObj(x) ? x : {};
      return { title: bi(o.title, `value[${i}].title`, d), desc: bi(o.desc, `value[${i}].desc`, d, { allowEmpty: true }) };
    }); break;
    case 'faq': out = list(raw, 'value', d).map((x, i) => {
      const o = isObj(x) ? x : {};
      return { q: bi(o.q, `value[${i}].q`, d), a: bi(o.a, `value[${i}].a`, d) };
    }); break;
  }
  if (d.length) throw Errors.validation(d);
  return out;
}

export interface ContentRow { key: ContentKey; value: unknown; updatedAt: string; updatedBy: string | null }

export async function listOverrides(): Promise<ContentRow[]> {
  const rows = await getDb().prepare('SELECT key, value, updatedAt, updatedBy FROM sona3_site_content ORDER BY key').all() as Array<Record<string, unknown>>;
  return rows.filter((r) => isContentKey(String(r.key))).map((r) => ({
    key: String(r.key) as ContentKey, value: parseJson<unknown>(r.value, null), updatedAt: String(r.updatedAt), updatedBy: (r.updatedBy as string | null) ?? null,
  }));
}

export async function setOverride(key: ContentKey, value: unknown, userId: string | null): Promise<ContentRow> {
  const at = nowIso();
  await getDb().prepare(`INSERT INTO sona3_site_content (key, value, updatedAt, updatedBy) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy`)
    .run(key, JSON.stringify(value), at, userId);
  return { key, value, updatedAt: at, updatedBy: userId };
}

export async function resetOverride(key: ContentKey): Promise<boolean> {
  return Number((await getDb().prepare('DELETE FROM sona3_site_content WHERE key = ?').run(key)).changes) > 0;
}
