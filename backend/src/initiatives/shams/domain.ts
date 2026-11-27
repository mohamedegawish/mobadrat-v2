/** الجهات والأدوار — ثابتة لهذا الموقع (القسم 4 من المواصفة). */
export const ROLES = ['factory_owner', 'imc_reviewer', 'encpc_reviewer', 'pmu_reviewer', 'electricity_reviewer', 'bank_reviewer', 'system_admin'] as const;
export type Role = (typeof ROLES)[number];

export const ORG_TYPES = ['factory', 'imc', 'encpc', 'pmu', 'electricity', 'bank', 'admin'] as const;
export type OrgType = (typeof ORG_TYPES)[number];

/** الجهات الهيكلية — تُنشأ في migration لأنها لازمة في الإنتاج. */
export const ORG_IDS = { imc: 'org-imc', encpc: 'org-encpc', pmu: 'org-pmu', electricity: 'org-electricity', admin: 'org-admin' } as const;

/** نوع الجهة المطلوب لكل دور (يطابق trigger قاعدة البيانات users_role_org_*). */
export const ROLE_ORG_TYPE: Record<Role, OrgType> = {
  factory_owner: 'factory',
  imc_reviewer: 'imc',
  encpc_reviewer: 'encpc',
  pmu_reviewer: 'pmu',
  electricity_reviewer: 'electricity',
  bank_reviewer: 'bank',
  system_admin: 'admin',
};

export const ROLE_LABELS: Record<Role, { ar: string; en: string }> = {
  factory_owner: { ar: 'مالك المصنع', en: 'Factory owner' },
  imc_reviewer: { ar: 'مراجع IMC', en: 'IMC reviewer' },
  encpc_reviewer: { ar: 'مراجع ENCPC', en: 'ENCPC reviewer' },
  pmu_reviewer: { ar: 'مراجع وحدة إدارة المبادرة', en: 'PMU reviewer' },
  electricity_reviewer: { ar: 'مراجع وزارة الكهرباء', en: 'Ministry of Electricity reviewer' },
  bank_reviewer: { ar: 'مراجع البنك (دور ملغى)', en: 'Bank reviewer (retired role)' },
  system_admin: { ar: 'مدير النظام', en: 'System administrator' },
};

/** أدوار الجهات التي ينشئ الأدمن حساباتها (لا تسجيل عام لها). */
export const STAFF_ROLES: Role[] = ['imc_reviewer', 'encpc_reviewer', 'pmu_reviewer', 'electricity_reviewer', 'system_admin'];

/**
 * G-02: البنك جهة خارجية بلا حساب ولا دور ولا خطوة في المنصة. القيمة باقية في ROLES لأن قيد CHECK والسجل التاريخي يذكرانها،
 * لكن لا يُنشأ بها حساب، ولا يُعاد تفعيله، ولا يدخل، ولا يملك أي إجراء أو رؤية.
 */
export const RETIRED_ROLES: readonly Role[] = ['bank_reviewer'];
export function isRetiredRole(role: Role): boolean { return RETIRED_ROLES.includes(role); }
