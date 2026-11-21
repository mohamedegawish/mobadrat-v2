/**
 * المحافظات والمناطق الصناعية لحقلي `governorate` و`industrialZone` (select مرتبط).
 * المحافظات: القائمة الكاملة (27) — ثابتة في الكود.
 * المناطق الصناعية: جدول industrial_zones، يُزرع عند كل تشغيل من db/reference/industrialZones.ts (دليل الهيئة العامة للتنمية
 * الصناعية) ويُقرأ إلى الذاكرة (db/referenceSeed.ts → setZoneCache). قبل القراءة تُستخدم القائمة المضمّنة نفسها، فالتحقق لا
 * يعتمد على توقيت التحميل. لكل محافظة خيار «أخرى» لمنشأة خارج المناطق المدرجة.
 */
import { INDUSTRIAL_ZONES } from './industrialZones.js';

export interface Zone { value: string; labelAr: string; labelEn: string }
export interface Governorate { value: string; labelAr: string; labelEn: string; zones: Zone[] }
/** صف منطقة كما في الجدول. `active=false` = أُلغيت من القائمة: لا تُعرض للاختيار، وتبقى صالحة لطلبات قائمة. */
export interface ZoneRecord { governorate: string; value: string; labelAr: string; labelEn: string; authority: string; active?: boolean }

export const OTHER_ZONE: Zone = { value: 'other', labelAr: 'أخرى / خارج المناطق المدرجة', labelEn: 'Other / not listed' };

const GOVERNORATE_LIST: ReadonlyArray<Omit<Governorate, 'zones'>> = [
  { value: 'cairo', labelAr: 'القاهرة', labelEn: 'Cairo' },
  { value: 'giza', labelAr: 'الجيزة', labelEn: 'Giza' },
  { value: 'alexandria', labelAr: 'الإسكندرية', labelEn: 'Alexandria' },
  { value: 'qalyubia', labelAr: 'القليوبية', labelEn: 'Qalyubia' },
  { value: 'sharqia', labelAr: 'الشرقية', labelEn: 'Sharqia' },
  { value: 'dakahlia', labelAr: 'الدقهلية', labelEn: 'Dakahlia' },
  { value: 'gharbia', labelAr: 'الغربية', labelEn: 'Gharbia' },
  { value: 'monufia', labelAr: 'المنوفية', labelEn: 'Monufia' },
  { value: 'beheira', labelAr: 'البحيرة', labelEn: 'Beheira' },
  { value: 'kafr-el-sheikh', labelAr: 'كفر الشيخ', labelEn: 'Kafr El Sheikh' },
  { value: 'damietta', labelAr: 'دمياط', labelEn: 'Damietta' },
  { value: 'port-said', labelAr: 'بورسعيد', labelEn: 'Port Said' },
  { value: 'ismailia', labelAr: 'الإسماعيلية', labelEn: 'Ismailia' },
  { value: 'suez', labelAr: 'السويس', labelEn: 'Suez' },
  { value: 'north-sinai', labelAr: 'شمال سيناء', labelEn: 'North Sinai' },
  { value: 'south-sinai', labelAr: 'جنوب سيناء', labelEn: 'South Sinai' },
  { value: 'faiyum', labelAr: 'الفيوم', labelEn: 'Faiyum' },
  { value: 'beni-suef', labelAr: 'بني سويف', labelEn: 'Beni Suef' },
  { value: 'minya', labelAr: 'المنيا', labelEn: 'Minya' },
  { value: 'asyut', labelAr: 'أسيوط', labelEn: 'Asyut' },
  { value: 'sohag', labelAr: 'سوهاج', labelEn: 'Sohag' },
  { value: 'qena', labelAr: 'قنا', labelEn: 'Qena' },
  { value: 'luxor', labelAr: 'الأقصر', labelEn: 'Luxor' },
  { value: 'aswan', labelAr: 'أسوان', labelEn: 'Aswan' },
  { value: 'red-sea', labelAr: 'البحر الأحمر', labelEn: 'Red Sea' },
  { value: 'new-valley', labelAr: 'الوادي الجديد', labelEn: 'New Valley' },
  { value: 'matrouh', labelAr: 'مطروح', labelEn: 'Matrouh' },
];

let zoneCache: ZoneRecord[] = INDUSTRIAL_ZONES.map((z) => ({ ...z, active: true }));
let governorates: Governorate[] = build();

function build(): Governorate[] {
  return GOVERNORATE_LIST.map((g) => ({
    ...g,
    zones: [...zoneCache.filter((z) => z.governorate === g.value && z.active !== false).map(({ value, labelAr, labelEn }) => ({ value, labelAr, labelEn })), OTHER_ZONE],
  }));
}

/** يستبدل المناطق المحمّلة من قاعدة البيانات (db/referenceSeed.ts). */
export function setZoneCache(rows: ZoneRecord[]): void {
  zoneCache = rows;
  governorates = build();
}

/** المحافظات بمناطقها الفعّالة + «أخرى» (تُعرض للواجهة عبر GET /meta). */
export function listGovernorates(): Governorate[] {
  return governorates;
}

export function findGovernorate(value: string): Governorate | undefined {
  return governorates.find((x) => x.value === value);
}

/** منطقة صالحة للمحافظة: فعّالة، أو ملغاة لكنها مخزنة سابقًا (لا يُسقط حفظٌ لاحقٌ قيمةً صحيحة وقت إدخالها)، أو «أخرى». */
export function isValidZone(governorate: string, zone: string): boolean {
  if (!findGovernorate(governorate)) return false;
  return zone === OTHER_ZONE.value || zoneCache.some((z) => z.governorate === governorate && z.value === zone);
}

/** اسم المنطقة للعرض والتقارير (يشمل الملغاة). */
export function zoneLabel(governorate: string, zone: string): { ar: string; en: string } | null {
  if (zone === OTHER_ZONE.value) return { ar: OTHER_ZONE.labelAr, en: OTHER_ZONE.labelEn };
  const z = zoneCache.find((x) => x.governorate === governorate && x.value === zone);
  return z ? { ar: z.labelAr, en: z.labelEn } : null;
}
