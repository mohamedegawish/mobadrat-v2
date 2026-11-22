/**
 * What Sona'a El-Mostaqbal needs from the shared person profile (the "already registered" path): the applicant's personal
 * data and national ID / qualification documents. Team, project, idea, readiness, declarations and the feasibility study are
 * initiative-specific and stay in the Sona3 wizard.
 */
import type { Blocker, RequirementField, RequirementsManifest } from '../../core/profile/requirements.js';
import { openCohort } from './store/cohorts.js';
import { findOpenSubmittedByNationalId } from './store/applications.js';
import { parseNationalId, ageOn } from './workflow/nationalId.js';

/** Sona3 personal section field ↔ shared profile key. */
export const FIELD_MAP: Array<{ key: string; profileKey: string; required: boolean; locked?: boolean; requiredWhen?: { key: string; in: unknown[] } }> = [
  { key: 'fullName', profileKey: 'person.fullNameAr', required: true },
  { key: 'nationalId', profileKey: 'person.nationalId', required: true, locked: true },
  { key: 'birthDate', profileKey: 'person.birthDate', required: true, locked: true },
  { key: 'nationality', profileKey: 'person.nationality', required: true },
  { key: 'nationalityOther', profileKey: 'person.nationalityOther', required: true, requiredWhen: { key: 'person.nationality', in: ['other'] } },
  { key: 'governorate', profileKey: 'person.governorate', required: true },
  { key: 'address', profileKey: 'person.address', required: true },
  { key: 'phone', profileKey: 'person.phone', required: true },
  { key: 'qualification', profileKey: 'person.qualification', required: true },
  { key: 'experience', profileKey: 'person.experience', required: true },
];

export const DOC_MAP = [
  { kind: 'nationalIdFile', required: true },
  { kind: 'qualificationFile', required: false },
] as const;

const fields: RequirementField[] = FIELD_MAP.map((f) => ({
  profileKey: f.profileKey, moduleField: `personal.${f.key}`, required: f.required, requiredWhen: f.requiredWhen,
  sync: f.locked ? 'lockedAfterSubmit' : 'prefill+writeback',
}));

async function precheck({ person }: { person: { values: Record<string, unknown> } }): Promise<Blocker[]> {
  const out: Blocker[] = [];
  const cohort = await openCohort();
  if (!cohort) {
    out.push({ code: 'NO_OPEN_COHORT', messageAr: 'باب التقديم مغلق حاليًا — تابع الإعلان عن الدورة القادمة.', messageEn: 'Applications are currently closed. Watch for the next cohort.' });
    return out;
  }
  const nid = String(person.values['person.nationalId'] ?? '');
  const birth = String(person.values['person.birthDate'] ?? '');
  if (nid) {
    const p = parseNationalId(nid);
    if (p.ok && birth && p.info.birthDate !== birth) {
      out.push({ code: 'BIRTHDATE_MISMATCH', messageAr: 'تاريخ الميلاد في ملفك لا يطابق الرقم القومي — صحّحه من صفحة بياناتي.', messageEn: 'Your birth date does not match the national ID — correct it in your profile.' });
    }
    if (await findOpenSubmittedByNationalId(nid, '')) {
      out.push({ code: 'DUPLICATE_NATIONAL_ID', messageAr: 'يوجد طلب مفتوح آخر بنفس الرقم القومي.', messageEn: 'Another open application uses this national ID.' });
    }
  }
  if (birth && cohort.ageReference === 'cohort_close' && ageOn(birth, cohort.closesAt) > cohort.maxAge) {
    out.push({ code: 'AGE_LIMIT', messageAr: `الحد الأقصى للسن في هذه الدورة ${cohort.maxAge} سنة.`, messageEn: `The age limit for this cohort is ${cohort.maxAge}.` });
  }
  return out;
}

export const requirements: RequirementsManifest = {
  subject: 'person',
  fields,
  documents: DOC_MAP.map((d) => ({ profileKind: d.kind, moduleKind: d.kind, required: d.required })),
  moduleStepsAr: ['بيانات الفريق والمشروع والفكرة والجاهزية والإقرارات في نموذج المبادرة', 'إرسال الطلب لمراجعة الأهلية (IMC)', 'إعداد دراسة الجدوى بعد قبول الأهلية'],
  moduleStepsEn: ['Team, project, idea, readiness and declarations in the initiative form', 'Submit for the eligibility review (IMC)', 'Prepare the feasibility study once eligible'],
  precheck: precheck as RequirementsManifest['precheck'],
};

/** Shared profile values → the Sona3 personal section (draft prefill). */
export function personalFromProfile(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELD_MAP) {
    const v = values[f.profileKey];
    if (v !== undefined && v !== null && v !== '') out[f.key] = v;
  }
  return out;
}

/** Sona3 personal section → shared profile values (legacy import). */
export function profileFromPersonal(personal: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELD_MAP) {
    const v = personal?.[f.key];
    if (v !== undefined && v !== null && v !== '') out[f.profileKey] = v;
  }
  return out;
}
