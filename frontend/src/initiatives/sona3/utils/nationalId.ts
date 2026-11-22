/**
 * فحص أولي للرقم القومي المصري في المتصفح (14 رقمًا: C YYMMDD GG SSSS X) لإعطاء تنبيه فوري أثناء الكتابة.
 * القرار النهائي دائمًا للسيرفر (backend/src/workflow/nationalId.ts).
 */
const GOV_CODES = new Set(['01', '02', '03', '04', '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '23', '24', '25', '26', '27', '28', '29', '31', '32', '33', '34', '35', '88']);

export type NidIssue = 'format' | 'century' | 'birth_date' | 'governorate_code';

export function parseNid(raw: string): { ok: true; birthDate: string; gender: 'male' | 'female' } | { ok: false; issue: NidIssue } {
  if (!/^\d{14}$/.test(raw)) return { ok: false, issue: 'format' };
  const century = raw[0] === '2' ? 1900 : raw[0] === '3' ? 2000 : null;
  if (century === null) return { ok: false, issue: 'century' };
  const birthDate = `${century + Number(raw.slice(1, 3))}-${raw.slice(3, 5)}-${raw.slice(5, 7)}`;
  const d = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== birthDate || d.getTime() > Date.now()) return { ok: false, issue: 'birth_date' };
  if (!GOV_CODES.has(raw.slice(7, 9))) return { ok: false, issue: 'governorate_code' };
  return { ok: true, birthDate, gender: Number(raw[12]) % 2 === 1 ? 'male' : 'female' };
}

export function nidMessage(issue: NidIssue, isAr: boolean): string {
  const m: Record<NidIssue, [string, string]> = {
    format: ['الرقم القومي 14 رقمًا بالضبط.', 'The national ID must be exactly 14 digits.'],
    century: ['يبدأ الرقم القومي بـ 2 (مواليد 1900–1999) أو 3 (مواليد 2000 فما بعد).', 'The ID starts with 2 (born 1900–1999) or 3 (born 2000+).'],
    birth_date: ['تاريخ الميلاد داخل الرقم القومي غير صحيح.', 'The birth date inside the ID is not valid.'],
    governorate_code: ['كود المحافظة داخل الرقم القومي غير معروف.', 'The governorate code inside the ID is unknown.'],
  };
  return isAr ? m[issue][0] : m[issue][1];
}

/** العمر بالسنوات الكاملة في تاريخ مرجعي (YYYY-MM-DD). */
export function ageOn(birthDate: string, refDate: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ry, rm, rd] = refDate.split('-').map(Number);
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age--;
  return age;
}
