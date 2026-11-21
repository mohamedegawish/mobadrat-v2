/**
 * Requirements engine — "what does this person still need to provide to apply to initiative X?".
 *
 * Every initiative module declares a manifest: which shared profile fields/documents it needs (and how they map to its
 * own form fields), plus module checks (open application, cohort window, age…). The engine compares the manifest with the
 * person's profile (and the chosen factory profile) and returns only what is missing, ready for the "complete your data"
 * step; the module's enroll() calls it again on the server before opening the file.
 */
import type { CoreUser } from '../store/users.js';
import { DOC_KIND_BY_KEY, FIELD_BY_KEY, isEmptyValue, type ProfileField } from './catalog.js';
import {
  getFactoryProfile, getPersonProfile, listCurrentDocuments, listFactoryProfilesOfUser,
  type FactoryProfile, type PersonProfile, type ProfileDocument,
} from './store.js';

export type SyncMode =
  /** Profile value prefills the module form; the module writes the submitted value back to the profile. */
  | 'prefill+writeback'
  /** Prefill only. */
  | 'prefill'
  /** Prefill; never written back silently once submitted (identity data: national ID, registry number). */
  | 'lockedAfterSubmit';

export interface RequirementField {
  profileKey: string;
  /** `<section>.<field>` in the module form (omitted = the module reads the profile directly). */
  moduleField?: string;
  required: boolean;
  /** Required only when another profile value equals one of the given values. */
  requiredWhen?: { key: string; in: unknown[] };
  sync?: SyncMode;
}

export interface RequirementDoc {
  profileKind: string;
  /** Document kind in the module (copied into the module's storage on enrollment). */
  moduleKind?: string;
  required: boolean;
}

export interface Blocker { code: string; messageAr: string; messageEn: string }

export interface PrecheckContext { user: CoreUser; person: PersonProfile; factory: FactoryProfile | null }

export interface RequirementsManifest {
  subject: 'person' | 'factory';
  fields: RequirementField[];
  documents: RequirementDoc[];
  /** What the initiative's own form will still ask after enrolling (shown to the applicant). */
  moduleStepsAr?: string[];
  moduleStepsEn?: string[];
  precheck?(ctx: PrecheckContext): Promise<Blocker[]>;
}

export interface RequirementItem {
  key: string; scope: 'person' | 'factory'; type: ProfileField['type']; labelAr: string; labelEn: string;
  required: boolean; filled: boolean; value: unknown; options?: ProfileField['options']; dependsOn?: string; max?: number;
  hintAr?: string; hintEn?: string;
}

export interface RequirementDocItem {
  kind: string; scope: 'person' | 'factory'; labelAr: string; labelEn: string; required: boolean; filled: boolean;
  document: { id: string; originalName: string; sizeBytes: number; createdAt: string } | null;
}

export interface RequirementsResult {
  subject: 'person' | 'factory';
  factoryOptions: Array<{ id: string; companyName: string }>;
  selectedFactoryId: string | null;
  /** Factory subject without a chosen/created factory profile. */
  needsFactory: boolean;
  fields: RequirementItem[];
  documents: RequirementDocItem[];
  missing: RequirementItem[];
  missingDocuments: RequirementDocItem[];
  blockers: Blocker[];
  /** Nothing missing and nothing blocking. */
  complete: boolean;
  moduleStepsAr: string[];
  moduleStepsEn: string[];
  /** module form field → value from the profile (prefill of the draft). */
  prefill: Record<string, unknown>;
}

export function isRequirementActive(r: RequirementField, values: Record<string, unknown>): boolean {
  if (!r.required) return false;
  if (!r.requiredWhen) return true;
  return r.requiredWhen.in.includes(values[r.requiredWhen.key]);
}

export async function computeRequirements(manifest: RequirementsManifest, user: CoreUser, factoryProfileId?: string | null): Promise<RequirementsResult> {
  const person = await getPersonProfile(user.id);
  const factories = manifest.subject === 'factory' ? await listFactoryProfilesOfUser(user.id) : [];
  let factory: FactoryProfile | null = null;
  if (manifest.subject === 'factory') {
    if (factoryProfileId) factory = factories.find((f) => f.id === factoryProfileId) ?? null;
    else if (factories.length === 1) factory = factories[0];
  }
  // A factory id the person is not a member of is treated as "not chosen" (no data leak).
  if (factory) factory = await getFactoryProfile(factory.id);

  const values: Record<string, unknown> = { ...person.values, ...(factory?.values ?? {}) };
  // The account name / phone are a sensible default for the person's profile.
  if (isEmptyValue(values['person.fullNameAr'])) values['person.fullNameAr'] = null;

  const fields: RequirementItem[] = [];
  const prefill: Record<string, unknown> = {};
  for (const r of manifest.fields) {
    const f = FIELD_BY_KEY.get(r.profileKey);
    if (!f) throw new Error(`[requirements] unknown profile key ${r.profileKey}`);
    const v = values[r.profileKey];
    const required = isRequirementActive(r, values);
    fields.push({
      key: f.key, scope: f.scope, type: f.type, labelAr: f.labelAr, labelEn: f.labelEn, required, filled: !isEmptyValue(v), value: v ?? null,
      options: f.options, dependsOn: f.dependsOn, max: f.max, hintAr: f.hintAr, hintEn: f.hintEn,
    });
    if (r.moduleField && !isEmptyValue(v)) prefill[r.moduleField] = v;
  }

  const personDocs = await listCurrentDocuments('person', user.id);
  const factoryDocs = factory ? await listCurrentDocuments('factory', factory.id) : [];
  const documents: RequirementDocItem[] = manifest.documents.map((d) => {
    const def = DOC_KIND_BY_KEY.get(d.profileKind);
    if (!def) throw new Error(`[requirements] unknown profile document kind ${d.profileKind}`);
    const pool: ProfileDocument[] = def.scope === 'person' ? personDocs : factoryDocs;
    const doc = pool.find((x) => x.kind === d.profileKind) ?? null;
    return {
      kind: def.kind, scope: def.scope, labelAr: def.labelAr, labelEn: def.labelEn, required: d.required, filled: Boolean(doc),
      document: doc ? { id: doc.id, originalName: doc.originalName, sizeBytes: doc.sizeBytes, createdAt: doc.createdAt } : null,
    };
  });

  const needsFactory = manifest.subject === 'factory' && !factory;
  const missing = needsFactory ? fields.filter((f) => f.required && !f.filled && f.scope === 'person') : fields.filter((f) => f.required && !f.filled);
  // Without a factory profile every factory field is missing by definition; the UI first asks to choose/create one.
  if (needsFactory) missing.push(...fields.filter((f) => f.required && f.scope === 'factory'));
  const missingDocuments = documents.filter((d) => d.required && !d.filled);
  const blockers = manifest.precheck ? await manifest.precheck({ user, person, factory }) : [];

  return {
    subject: manifest.subject,
    factoryOptions: factories.map((f) => ({ id: f.id, companyName: String(f.values['factory.companyName'] ?? '') })),
    selectedFactoryId: factory?.id ?? null,
    needsFactory,
    fields, documents, missing, missingDocuments, blockers,
    complete: !needsFactory && missing.length === 0 && missingDocuments.length === 0 && blockers.length === 0,
    moduleStepsAr: manifest.moduleStepsAr ?? [], moduleStepsEn: manifest.moduleStepsEn ?? [],
    prefill,
  };
}

/** Splits a prefill map `{ 'general.companyName': v }` into sections `{ general: { companyName: v } }`. */
export function prefillBySection(prefill: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(prefill)) {
    const i = k.indexOf('.');
    if (i < 0) continue;
    const section = k.slice(0, i);
    (out[section] ??= {})[k.slice(i + 1)] = v;
  }
  return out;
}
