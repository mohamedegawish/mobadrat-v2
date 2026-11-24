/**
 * محتوى الواجهة العامة القابل للتحرير من الأدمن.
 * الافتراضي من content/site.ts؛ ما يحفظه الأدمن (GET /site-content) يتجاوزه. بنية المفاتيح تطابق backend/src/store/siteContent.ts.
 */
import { useSyncExternalStore } from 'react';
import { apiFetch } from '../api/client';
import * as D from './site';
import type { Bi } from './site';

export type { Bi };
export interface Figure { value: string; label: Bi }
export interface JourneyItem { title: Bi; desc: Bi }
export interface FaqItem { q: Bi; a: Bi }
export type Kind = 'bi' | 'bilist' | 'figures' | 'journey' | 'faq';

export interface SiteContent {
  vision: Bi; mission: Bi; siteName: Bi; siteTagline: Bi; ministry: Bi; topBar: Bi; brandSub: Bi; heroEyebrow: Bi; footerRights: Bi;
  figures: Figure[]; journey: JourneyItem[];
  eligibility: Bi[]; financing: Bi[];
  about: Bi[]; contact: Bi[]; terms: Bi[]; faq: FaqItem[];
}
export type ContentKey = keyof SiteContent;

export const DEFAULTS: SiteContent = {
  vision: D.VISION, mission: D.MISSION,
  siteName: D.SITE_NAME, siteTagline: D.SITE_TAGLINE, ministry: D.MINISTRY,
  topBar: { ar: 'وزارة الصناعة · مبادرة صُنّاع المستقبل', en: 'Ministry of Industry · Future Makers Initiative' },
  brandSub: { ar: 'تقديم · تقييم · تمويل · متابعة', en: 'Apply · Evaluate · Fund · Monitor' },
  heroEyebrow: D.HERO_EYEBROW,
  footerRights: { ar: 'مبادرة صُنّاع المستقبل — جميع الحقوق محفوظة', en: 'Future Makers Initiative — All rights reserved' },
  figures: D.FIGURES, journey: D.JOURNEY,
  eligibility: D.ELIGIBILITY, financing: D.FINANCING_TERMS,
  about: [], contact: [], terms: [], faq: [],
};

/** وصف المفاتيح لشاشة التحرير. */
export const CONTENT_SCHEMA: Array<{ key: ContentKey; kind: Kind; ar: string; en: string; group: 'brand' | 'home' | 'pages' }> = [
  { key: 'siteName', kind: 'bi', ar: 'اسم المبادرة', en: 'Initiative name', group: 'brand' },
  { key: 'siteTagline', kind: 'bi', ar: 'الوصف التعريفي (الصفحة الرئيسية)', en: 'Tagline (home)', group: 'brand' },
  { key: 'ministry', kind: 'bi', ar: 'اسم الجهة (التذييل)', en: 'Organization (footer)', group: 'brand' },
  { key: 'topBar', kind: 'bi', ar: 'الشريط العلوي', en: 'Top bar', group: 'brand' },
  { key: 'brandSub', kind: 'bi', ar: 'الشعار النصي تحت الاسم', en: 'Brand subtitle', group: 'brand' },
  { key: 'footerRights', kind: 'bi', ar: 'حقوق التذييل', en: 'Footer rights line', group: 'brand' },
  { key: 'heroEyebrow', kind: 'bi', ar: 'وسم الواجهة الرئيسية', en: 'Hero label', group: 'home' },
  { key: 'vision', kind: 'bi', ar: 'الرؤية', en: 'Vision', group: 'home' },
  { key: 'mission', kind: 'bi', ar: 'الرسالة', en: 'Mission', group: 'home' },
  { key: 'figures', kind: 'figures', ar: 'الأرقام الرئيسية', en: 'Key figures', group: 'home' },
  { key: 'journey', kind: 'journey', ar: 'رحلة المشروع', en: 'Project journey', group: 'home' },
  { key: 'eligibility', kind: 'bilist', ar: 'شروط التقديم', en: 'Eligibility', group: 'home' },
  { key: 'financing', kind: 'bilist', ar: 'نماذج التمويل', en: 'Financing models', group: 'home' },
  { key: 'about', kind: 'bilist', ar: 'صفحة «عن المبادرة» (فقرات)', en: 'About page (paragraphs)', group: 'pages' },
  { key: 'faq', kind: 'faq', ar: 'الأسئلة الشائعة', en: 'FAQ', group: 'pages' },
  { key: 'contact', kind: 'bilist', ar: 'صفحة «تواصل معنا» (فقرات)', en: 'Contact page (paragraphs)', group: 'pages' },
  { key: 'terms', kind: 'bilist', ar: 'الشروط والأحكام (فقرات)', en: 'Terms (paragraphs)', group: 'pages' },
];

// ── الحالة: تجاوزات الخادم فقط، والدمج مع الافتراضي يتم عند الطلب ──
let overrides: Partial<SiteContent> = {};
let merged: SiteContent = DEFAULTS;
const subs = new Set<() => void>();

function rebuild() {
  merged = { ...DEFAULTS, ...overrides } as SiteContent;
  subs.forEach((f) => f());
}

export function getOverrides(): Partial<SiteContent> { return overrides; }

export async function loadSiteContent(): Promise<void> {
  try {
    const r = await apiFetch<{ data: { overrides: Partial<SiteContent> } }>('/api/v1/site-content');
    overrides = r.data.overrides ?? {};
    rebuild();
  } catch { /* الافتراضي كافٍ عند غياب الخادم */ }
}

export async function saveContent<K extends ContentKey>(key: K, value: SiteContent[K]): Promise<void> {
  await apiFetch(`/api/v1/admin/site-content/${key}`, { method: 'PUT', body: { value } });
  overrides = { ...overrides, [key]: value };
  rebuild();
}

export async function resetContent(key: ContentKey): Promise<void> {
  await apiFetch(`/api/v1/admin/site-content/${key}`, { method: 'DELETE' });
  const { [key]: _gone, ...rest } = overrides;
  overrides = rest;
  rebuild();
}

export function useSiteContent(): SiteContent {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => merged, () => merged);
}
