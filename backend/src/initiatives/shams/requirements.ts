/**
 * What Shams El-Senaa needs from the shared profiles (the "already registered" path): the factory data and company
 * documents of the registration form come from the person's factory profile; only what is missing is asked. Electricity
 * bills (time-bound evidence) and the later stages stay in the Shams wizard.
 */
import type { Blocker, RequirementField, RequirementsManifest } from '../../core/profile/requirements.js';
import { isRequired } from './workflow/applicationForm.js';
import type { FormFieldKey } from './config/shamsPolicy.js';
import { registryAccess } from './store/registry.js';
import { findOpenSubmittedByRegistry } from './store/applications.js';
import { getFactoryByProfile } from './store/factories.js';
import { getDb } from './db/sqlite.js';

/** Shams form field (section.key) ↔ shared profile key. */
export const FIELD_MAP: Array<{ section: 'general' | 'contact' | 'company' | 'engineering'; key: FormFieldKey; profileKey: string; locked?: boolean }> = [
  { section: 'general', key: 'companyName', profileKey: 'factory.companyName' },
  { section: 'general', key: 'governorate', profileKey: 'factory.governorate' },
  { section: 'general', key: 'industrialZone', profileKey: 'factory.industrialZone' },
  { section: 'general', key: 'address', profileKey: 'factory.address' },
  { section: 'general', key: 'phone1', profileKey: 'factory.phone1' },
  { section: 'general', key: 'phone2', profileKey: 'factory.phone2' },
  { section: 'general', key: 'fax', profileKey: 'factory.fax' },
  { section: 'general', key: 'website', profileKey: 'factory.website' },
  { section: 'contact', key: 'contactName', profileKey: 'factory.contactName' },
  { section: 'contact', key: 'contactTitle', profileKey: 'factory.contactTitle' },
  { section: 'contact', key: 'contactMobile', profileKey: 'factory.contactMobile' },
  { section: 'contact', key: 'contactPhone', profileKey: 'factory.contactPhone' },
  { section: 'contact', key: 'contactFax', profileKey: 'factory.contactFax' },
  { section: 'contact', key: 'contactEmail', profileKey: 'factory.contactEmail' },
  { section: 'company', key: 'commercialRegisterNumber', profileKey: 'factory.commercialRegisterNumber' },
  { section: 'company', key: 'industrialRegistryNumber', profileKey: 'factory.industrialRegistryNumber', locked: true },
  { section: 'company', key: 'taxNumber', profileKey: 'factory.taxNumber' },
  { section: 'engineering', key: 'roofAreas', profileKey: 'factory.roofAreas' },
  { section: 'engineering', key: 'contractedCapacity', profileKey: 'factory.contractedCapacity' },
  { section: 'engineering', key: 'capacityUnit', profileKey: 'factory.capacityUnit' },
  { section: 'engineering', key: 'peakLoad', profileKey: 'factory.peakLoad' },
  { section: 'engineering', key: 'loadUnit', profileKey: 'factory.loadUnit' },
  { section: 'engineering', key: 'ownershipType', profileKey: 'factory.ownershipType' },
  { section: 'engineering', key: 'ownershipExpiresAt', profileKey: 'factory.ownershipExpiresAt' },
];

/** Company documents reused from the factory profile (copied into the Shams file on enrollment). */
export const DOC_MAP = [
  { kind: 'commercialRegisterFile', field: 'commercialRegisterFile' as FormFieldKey },
  { kind: 'industrialRegisterFile', field: 'industrialRegisterFile' as FormFieldKey },
  { kind: 'taxCardFile', field: 'taxCardFile' as FormFieldKey },
  { kind: 'ownershipProofFile', field: 'ownershipProofFile' as FormFieldKey },
] as const;

const fields: RequirementField[] = FIELD_MAP.map((f) => ({
  profileKey: f.profileKey, moduleField: `${f.section}.${f.key}`, required: isRequired(f.key), sync: f.locked ? 'lockedAfterSubmit' : 'prefill+writeback',
}));

async function precheck({ factory }: { factory: { id: string; values: Record<string, unknown> } | null }): Promise<Blocker[]> {
  const out: Blocker[] = [];
  if (!factory) return out;
  const linked = await getFactoryByProfile(factory.id);
  if (linked) {
    const open = await getDb().prepare(`SELECT 1 FROM shams_applications WHERE factoryId = ? AND state NOT IN ('REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN')`).get(linked.id);
    if (open) out.push({ code: 'OPEN_APPLICATION', messageAr: 'لهذه المنشأة طلب مفتوح في المبادرة بالفعل.', messageEn: 'This factory already has an open application in the initiative.' });
  }
  const reg = String(factory.values['factory.industrialRegistryNumber'] ?? '');
  if (reg) {
    const access = await registryAccess(reg, linked?.id ?? '');
    if (!access.allowed || await findOpenSubmittedByRegistry(reg, '')) {
      out.push({ code: 'REGISTRY_IN_USE', messageAr: 'رقم السجل الصناعي لهذه المنشأة مستخدم في طلب آخر أو موقوف لمراجعة وحدة إدارة المبادرة — تواصل مع الدعم الفني.',
        messageEn: 'The factory\'s industrial registry number is used by another application or on hold for PMU review — contact support.' });
    }
  }
  return out;
}

export const requirements: RequirementsManifest = {
  subject: 'factory',
  fields,
  documents: DOC_MAP.map((d) => ({ profileKind: d.kind, moduleKind: d.kind, required: isRequired(d.field) })),
  moduleStepsAr: ['رفع فواتير الكهرباء لآخر 12 شهرًا', 'مراجعة بيانات الطلب وإرساله لمراجعة مركز تحديث الصناعة (IMC)', 'متابعة مراحل المبادرة من لوحة شمس الصناعة'],
  moduleStepsEn: ['Upload the electricity bills of the last 12 months', 'Review the application and submit it to IMC', 'Follow the initiative stages from the Shams dashboard'],
  precheck: precheck as RequirementsManifest['precheck'],
};

/** Registration form sections → shared factory profile values (registration, enrollment write-back, legacy import). */
export function factoryProfileFromSections(sections: Record<string, Record<string, unknown> | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELD_MAP) {
    const v = sections[f.section]?.[f.key];
    if (v !== undefined && v !== null && v !== '') out[f.profileKey] = v;
  }
  return out;
}

/** Shared factory profile values → Shams form sections (draft prefill). */
export function sectionsFromProfile(values: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const f of FIELD_MAP) {
    const v = values[f.profileKey];
    if (v === undefined || v === null || v === '') continue;
    (out[f.section] ??= {})[f.key] = v;
  }
  return out;
}
