/**
 * المحافظات والمناطق الصناعية لحقلي `governorate` و`industrialZone` (select مرتبط).
 * المحافظات: القائمة الكاملة (27) من المنصة الأصلية (frontend/src/utils/egypt.ts).
 * TODO(محتوى): لا توجد قائمة رسمية بالمناطق الصناعية. المدرج هنا هو ما ورد في المنصة الأصلية فقط
 * (LoginView + بذرة المبادرة)، ولكل محافظة خيار «أخرى» حتى تُعتمد القائمة الرسمية.
 */
export interface Zone { value: string; labelAr: string; labelEn: string }
export interface Governorate { value: string; labelAr: string; labelEn: string; zones: Zone[] }

export const OTHER_ZONE: Zone = { value: 'other', labelAr: 'أخرى / خارج المناطق المدرجة', labelEn: 'Other / not listed' };

const g = (value: string, labelAr: string, labelEn: string, zones: Zone[] = []): Governorate =>
  ({ value, labelAr, labelEn, zones: [...zones, OTHER_ZONE] });

export const GOVERNORATES: Governorate[] = [
  g('cairo', 'القاهرة', 'Cairo'),
  g('giza', 'الجيزة', 'Giza', [{ value: '6th-october', labelAr: 'السادس من أكتوبر', labelEn: '6th of October' }]),
  g('alexandria', 'الإسكندرية', 'Alexandria'),
  g('qalyubia', 'القليوبية', 'Qalyubia', [
    { value: 'obour', labelAr: 'العبور', labelEn: 'Obour' },
    { value: 'khanka', labelAr: 'الخانكة', labelEn: 'Khanka' },
  ]),
  g('sharqia', 'الشرقية', 'Sharqia', [{ value: '10th-ramadan', labelAr: 'العاشر من رمضان', labelEn: '10th of Ramadan' }]),
  g('dakahlia', 'الدقهلية', 'Dakahlia'),
  g('gharbia', 'الغربية', 'Gharbia'),
  g('monufia', 'المنوفية', 'Monufia', [{ value: 'sadat-city', labelAr: 'مدينة السادات', labelEn: 'Sadat City' }]),
  g('beheira', 'البحيرة', 'Beheira'),
  g('kafr-el-sheikh', 'كفر الشيخ', 'Kafr El Sheikh'),
  g('damietta', 'دمياط', 'Damietta'),
  g('port-said', 'بورسعيد', 'Port Said'),
  g('ismailia', 'الإسماعيلية', 'Ismailia'),
  g('suez', 'السويس', 'Suez', [{ value: 'sczone', labelAr: 'المنطقة الاقتصادية لقناة السويس', labelEn: 'Suez Canal Economic Zone' }]),
  g('north-sinai', 'شمال سيناء', 'North Sinai'),
  g('south-sinai', 'جنوب سيناء', 'South Sinai'),
  g('faiyum', 'الفيوم', 'Faiyum'),
  g('beni-suef', 'بني سويف', 'Beni Suef'),
  g('minya', 'المنيا', 'Minya'),
  g('asyut', 'أسيوط', 'Asyut'),
  g('sohag', 'سوهاج', 'Sohag'),
  g('qena', 'قنا', 'Qena'),
  g('luxor', 'الأقصر', 'Luxor'),
  g('aswan', 'أسوان', 'Aswan'),
  g('red-sea', 'البحر الأحمر', 'Red Sea'),
  g('new-valley', 'الوادي الجديد', 'New Valley'),
  g('matrouh', 'مطروح', 'Matrouh'),
];

export function findGovernorate(value: string): Governorate | undefined {
  return GOVERNORATES.find((x) => x.value === value);
}

export function isValidZone(governorate: string, zone: string): boolean {
  return Boolean(findGovernorate(governorate)?.zones.some((z) => z.value === zone));
}
