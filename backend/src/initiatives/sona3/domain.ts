/** الجهات والأدوار — ثابتة لمنصة «صُنّاع المستقبل» (docs/SONA3_DESIGN.md §2). */
export const ROLES = ['applicant', 'imc_officer', 'evaluator', 'funder_reviewer', 'system_admin'] as const;
export type Role = (typeof ROLES)[number];

export const ORG_TYPES = ['applicant', 'imc', 'committee', 'funder', 'admin'] as const;
export type OrgType = (typeof ORG_TYPES)[number];

/** الجهات الهيكلية — تُنشأ في migration لأنها لازمة في الإنتاج. */
export const ORG_IDS = { imc: 'org-imc', committee: 'org-committee', admin: 'org-admin' } as const;

/** نوع الجهة المطلوب لكل دور (يطابق trigger قاعدة البيانات users_role_org_*). */
export const ROLE_ORG_TYPE: Record<Role, OrgType> = {
  applicant: 'applicant',
  imc_officer: 'imc',
  evaluator: 'committee',
  funder_reviewer: 'funder',
  system_admin: 'admin',
};

export const ROLE_LABELS: Record<Role, { ar: string; en: string }> = {
  applicant: { ar: 'متقدم (مؤسس مشروع)', en: 'Applicant (founder)' },
  imc_officer: { ar: 'فريق إدارة المبادرة — IMC', en: 'Initiative team — IMC' },
  evaluator: { ar: 'عضو لجنة التقييم', en: 'Evaluation committee member' },
  funder_reviewer: { ar: 'مسؤول جهة التمويل', en: 'Funder officer' },
  system_admin: { ar: 'مدير النظام', en: 'System administrator' },
};

/** أدوار الجهات التي ينشئ الأدمن حساباتها (لا تسجيل عام لها). */
export const STAFF_ROLES: Role[] = ['imc_officer', 'evaluator', 'funder_reviewer', 'system_admin'];
