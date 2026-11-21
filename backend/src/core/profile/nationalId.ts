/**
 * الرقم القومي المصري (14 رقمًا): C YYMMDD GG SSSS X
 * C = القرن (2 → 1900s، 3 → 2000s)، YYMMDD = تاريخ الميلاد، GG = كود محافظة الميلاد، SSSS = تسلسل (الرقم الثالث عشر فردي للذكور)، X = رقم تحقق.
 * يُتحقق من البنية وتاريخ الميلاد وكود المحافظة فقط — خوارزمية رقم التحقق غير منشورة رسميًا.
 */

/** أكواد محافظات الميلاد في الرقم القومي (88 = مواليد الخارج). */
const GOVERNORATE_CODES = new Set([
  '01', '02', '03', '04', '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '23', '24', '25', '26', '27', '28', '29', '31', '32', '33', '34', '35', '88',
]);

export interface NationalIdInfo { birthDate: string; governorateCode: string; gender: 'male' | 'female' }

export type NationalIdIssue = 'format' | 'century' | 'birth_date' | 'governorate_code' | 'future_birth_date';

export function parseNationalId(raw: string, today = new Date()): { ok: true; info: NationalIdInfo } | { ok: false; issue: NationalIdIssue } {
  if (!/^\d{14}$/.test(raw)) return { ok: false, issue: 'format' };
  const century = raw[0] === '2' ? 1900 : raw[0] === '3' ? 2000 : null;
  if (century === null) return { ok: false, issue: 'century' };
  const yy = Number(raw.slice(1, 3));
  const mm = raw.slice(3, 5);
  const dd = raw.slice(5, 7);
  const birthDate = `${century + yy}-${mm}-${dd}`;
  const d = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== birthDate) return { ok: false, issue: 'birth_date' };
  if (d.getTime() > today.getTime()) return { ok: false, issue: 'future_birth_date' };
  const governorateCode = raw.slice(7, 9);
  if (!GOVERNORATE_CODES.has(governorateCode)) return { ok: false, issue: 'governorate_code' };
  const gender = Number(raw[12]) % 2 === 1 ? 'male' : 'female';
  return { ok: true, info: { birthDate, governorateCode, gender } };
}

/** العمر بالسنوات الكاملة في تاريخ مرجعي (YYYY-MM-DD). */
export function ageOn(birthDate: string, refDate: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ry, rm, rd] = refDate.split('-').map(Number);
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age--;
  return age;
}

/** إخفاء الرقم القومي للجهات الخارجية: أول رقمين وآخر رقمين فقط. */
export function maskNationalId(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.length < 6 ? '••••' : `${id.slice(0, 2)}${'•'.repeat(id.length - 4)}${id.slice(-2)}`;
}
