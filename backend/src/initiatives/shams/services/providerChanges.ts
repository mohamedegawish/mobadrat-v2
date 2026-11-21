/**
 * F-04: أثر تعديل بيانات مقدم الخدمة (من ENCPC أو API الربط) — فرق منظم في التدقيق، وتنبيه PMU إن كان المقدم معتمدًا.
 * لا يغيّر حالة الاعتماد ولا التفعيل ولا ظهور المقدم للمصانع: سياسة إعادة الاعتماد قرار مفتوح للجهة المالكة، فيُسجَّل التغيير ويُبلَّغ به فقط.
 *
 * التصنيف:
 *  - جوهري (material): الاسم، الموقع، والوصف إذا تغير معناه (نطاق الخدمة).
 *  - شكلي (cosmetic): الشعار، وتغيير الوصف في التنسيق/المسافات فقط، وبيانات الاتصال، والملاحظات الداخلية.
 * بيانات الاتصال والملاحظات الداخلية تُسجَّل «changed» دون قيمها (بيانات شخصية/داخلية).
 */
import { createHash } from 'node:crypto';
import { addAuditLog, type AuditActor } from '../store/audit.js';
import type { ServiceProvider } from '../store/providers.js';
import { dispatch, orgRecipients } from '../notifications/notify.js';
import { ORG_IDS } from '../domain.js';

export type ProviderChangeSource = 'encpc' | 'integration';
export type ProviderChangeClass = 'none' | 'cosmetic' | 'material';
export type FieldChange = [string | null, string | null] | 'changed';

export interface ProviderChange {
  changes: Record<string, FieldChange>;
  classification: ProviderChangeClass;
  material: string[];
  cosmetic: string[];
}

const VALUE_FIELDS_MATERIAL = ['nameAr', 'nameEn', 'website'] as const;
const REDACTED_FIELDS = ['contactName', 'contactPhone', 'contactEmail', 'notes'] as const;
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

const FIELD_LABELS: Record<string, { ar: string; en: string }> = {
  nameAr: { ar: 'الاسم', en: 'name' }, nameEn: { ar: 'الاسم بالإنجليزية', en: 'English name' }, website: { ar: 'الموقع الإلكتروني', en: 'website' },
  description: { ar: 'الوصف', en: 'description' }, logo: { ar: 'الشعار', en: 'logo' }, notes: { ar: 'الملاحظات الداخلية', en: 'internal notes' },
  contactName: { ar: 'اسم جهة الاتصال', en: 'contact name' }, contactPhone: { ar: 'هاتف الاتصال', en: 'contact phone' }, contactEmail: { ar: 'بريد الاتصال', en: 'contact email' },
};
const SOURCE_LABELS: Record<ProviderChangeSource, { ar: string; en: string }> = { encpc: { ar: 'ENCPC', en: 'ENCPC' }, integration: { ar: 'واجهة الربط', en: 'the integration API' } };

/** يقارن حالتين لمقدم الخدمة (قبل/بعد) ويصنّف الفرق. دالة نقية بلا أثر جانبي. */
export function diffProvider(before: ServiceProvider, after: ServiceProvider): ProviderChange {
  const changes: Record<string, FieldChange> = {};
  const material: string[] = [];
  const cosmetic: string[] = [];
  for (const f of VALUE_FIELDS_MATERIAL) {
    if (before[f] !== after[f]) { changes[f] = [before[f], after[f]]; material.push(f); }
  }
  if (before.description !== after.description) {
    changes.description = [before.description, after.description];
    (squash(before.description) === squash(after.description) ? cosmetic : material).push('description');
  }
  for (const f of REDACTED_FIELDS) if (before[f] !== after[f]) { changes[f] = 'changed'; cosmetic.push(f); }
  if ((before.logoSha256 ?? null) !== (after.logoSha256 ?? null)) {
    changes.logo = [before.logoSha256?.slice(0, 12) ?? null, after.logoSha256?.slice(0, 12) ?? null];
    cosmetic.push('logo');
  }
  const classification: ProviderChangeClass = material.length ? 'material' : cosmetic.length ? 'cosmetic' : 'none';
  return { changes, classification, material, cosmetic };
}

/**
 * يسجل التغيير في التدقيق (بالفاعل الفعلي: مستخدم ENCPC أو مفتاح الربط) وينبّه PMU إن كان المقدم معتمدًا وتغيّر شيء فعلًا.
 * يُستدعى داخل معاملة التعديل نفسها؛ على المستدعي إيقاظ عامل الإشعارات بعد الالتزام.
 * يرجع الفرق ليستعمله المستدعي في تفاصيل صفه التدقيقي الإضافي (الشعار).
 */
export async function recordProviderChange(args: {
  before: ServiceProvider; after: ServiceProvider; source: ProviderChangeSource; actor: AuditActor;
  action: 'provider.update' | 'provider.logo'; summaryAr: string; extraDetails?: Record<string, unknown>;
}): Promise<ProviderChange> {
  const { before, after, source, actor, action, summaryAr, extraDetails } = args;
  const diff = diffProvider(before, after);
  await addAuditLog({
    ...actor, action, entityType: 'service_provider', entityId: after.id, summaryAr,
    details: {
      ...extraDetails, providerId: after.id, changes: diff.changes, classification: diff.classification, source,
      previousStatus: before.status, status: after.status, isActive: after.isActive,
    },
  });
  if (diff.classification !== 'none' && before.status === 'approved') {
    const fields = Object.keys(diff.changes);
    const kindAr = diff.classification === 'material' ? 'تغيير جوهري' : 'تغيير شكلي';
    const kindEn = diff.classification === 'material' ? 'Material change' : 'Cosmetic change';
    const stamp = createHash('sha256').update(JSON.stringify([after.updatedAt, diff.changes])).digest('hex').slice(0, 12);
    await dispatch('ops.provider_changed', {
      providerNameAr: after.nameAr,
      eventAr: `${kindAr} في: ${fields.map((f) => FIELD_LABELS[f]?.ar ?? f).join('، ')} — بواسطة ${SOURCE_LABELS[source].ar}`,
      eventEn: `${kindEn} to: ${fields.map((f) => FIELD_LABELS[f]?.en ?? f).join(', ')} — by ${SOURCE_LABELS[source].en}`,
    }, await orgRecipients(ORG_IDS.pmu, 'pmu_reviewer'), { dedupePrefix: `spc:${after.id}:${stamp}`, channels: ['email'] });
  }
  return diff;
}
