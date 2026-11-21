/**
 * Write-back from an initiative to the shared profile — called by a module AFTER a successful submit/resubmit, never on
 * drafts. Only `prefill+writeback` fields are copied, plus `lockedAfterSubmit` fields that are still empty in the profile
 * (identity data is filled once, never overwritten silently). Every change is audited with the initiative id.
 * Submitted application snapshots never change when the profile changes later.
 */
import { addAuditLog } from '../store/audit.js';
import { cleanProfileValue, FIELD_BY_KEY, isEmptyValue } from './catalog.js';
import type { RequirementsManifest } from './requirements.js';
import { getFactoryProfile, getPersonProfile, saveFactoryProfile, savePersonProfile } from './store.js';

export async function writeBackToProfile(input: {
  initiativeId: string;
  manifest: RequirementsManifest;
  userId: string;
  factoryProfileId: string | null;
  /** Module form data by section: { general: { companyName: … }, … }. */
  sections: Record<string, Record<string, unknown> | undefined>;
  actorName?: string;
}): Promise<string[]> {
  const person = await getPersonProfile(input.userId);
  const factory = input.factoryProfileId ? await getFactoryProfile(input.factoryProfileId) : null;
  const current: Record<string, unknown> = { ...person.values, ...(factory?.values ?? {}) };
  const personPatch: Record<string, unknown> = {};
  const factoryPatch: Record<string, unknown> = {};
  const ctx: Record<string, unknown> = { ...current };

  for (const r of input.manifest.fields) {
    if (!r.moduleField || !r.sync || r.sync === 'prefill') continue;
    const [section, field] = r.moduleField.split('.');
    const raw = input.sections[section]?.[field];
    if (isEmptyValue(raw)) continue;
    if (r.sync === 'lockedAfterSubmit' && !isEmptyValue(current[r.profileKey])) continue;
    const f = FIELD_BY_KEY.get(r.profileKey);
    if (!f) continue;
    ctx[r.profileKey] = raw;
    const cleaned = cleanProfileValue(f, raw, ctx);
    if ('issue' in cleaned || cleaned.value === null) continue;
    if (JSON.stringify(cleaned.value) === JSON.stringify(current[r.profileKey] ?? null)) continue;
    if (f.scope === 'person') personPatch[f.key] = cleaned.value;
    else if (factory) factoryPatch[f.key] = cleaned.value;
  }

  const changed = [...Object.keys(personPatch), ...Object.keys(factoryPatch)];
  if (Object.keys(personPatch).length) await savePersonProfile(input.userId, personPatch);
  if (factory && Object.keys(factoryPatch).length) await saveFactoryProfile(factory.id, factoryPatch);
  if (changed.length) {
    await addAuditLog({
      initiativeId: input.initiativeId, actorType: 'user', actorUserId: input.userId, actorName: input.actorName ?? '',
      action: 'profile.writeback', entityType: factory ? 'factory_profile' : 'person_profile', entityId: factory?.id ?? input.userId,
      summaryAr: `تحديث بيانات الملف المشترك من طلب المبادرة (${changed.length} حقل)`, details: { fields: changed },
    });
  }
  return changed;
}
