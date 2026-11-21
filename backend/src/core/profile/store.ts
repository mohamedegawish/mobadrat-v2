/**
 * Shared profiles: person_profiles (one per user), factory_profiles (+ members), profile_documents.
 * Values are read/written through the catalog keys (`person.x`, `factory.y`) so the requirements engine, the profile
 * screens and the initiatives' prefill/write-back all speak the same language.
 */
import { getDb, nowIso, parseJson } from '../db/index.js';
import { newId } from '../http/helpers.js';
import { FIELD_BY_KEY, PROFILE_FIELDS, type ProfileScope } from './catalog.js';

export type ProfileValues = Record<string, unknown>;

const PERSON_COLUMNS = ['fullNameAr', 'fullNameEn', 'nationalId', 'birthDate', 'gender', 'nationality', 'nationalityOther', 'governorate', 'address', 'phone', 'qualification', 'experience'];
const FACTORY_COLUMNS = ['companyName', 'commercialRegisterNumber', 'industrialRegistryNumber', 'taxNumber', 'governorate', 'industrialZone', 'address',
  'phone1', 'phone2', 'fax', 'website', 'contactName', 'contactTitle', 'contactMobile', 'contactPhone', 'contactFax', 'contactEmail'];

export interface PersonProfile { userId: string; values: ProfileValues; version: number; updatedAt: string | null }
export interface FactoryProfile { id: string; values: ProfileValues; version: number; createdBy: string | null; createdAt: string; updatedAt: string; role?: 'owner' | 'member' }

/** Row → { 'scope.field': value } for every catalog field of the scope (attributes JSON flattened). */
function rowToValues(scope: ProfileScope, r: Record<string, unknown> | undefined): ProfileValues {
  const out: ProfileValues = {};
  if (!r) return out;
  const attrs = parseJson<Record<string, unknown>>(r.attributes, {});
  for (const f of PROFILE_FIELDS) {
    if (f.scope !== scope) continue;
    if (f.storage.startsWith('attributes.')) {
      const v = attrs[f.storage.slice('attributes.'.length)];
      out[f.key] = v === undefined ? null : v;
    } else {
      const v = r[f.storage];
      out[f.key] = v === undefined || v === '' ? null : v;
    }
  }
  return out;
}

/** Splits catalog values into column updates and attribute updates (unknown keys are ignored — the API validates). */
function splitValues(scope: ProfileScope, values: ProfileValues): { columns: Record<string, unknown>; attrs: Record<string, unknown> } {
  const columns: Record<string, unknown> = {};
  const attrs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const f = FIELD_BY_KEY.get(k);
    if (!f || f.scope !== scope) continue;
    if (f.storage.startsWith('attributes.')) attrs[f.storage.slice('attributes.'.length)] = v;
    else columns[f.storage] = v;
  }
  return { columns, attrs };
}

function columnValue(col: string, v: unknown): string | number | null {
  // NULL-able columns keep NULL; text columns default to ''.
  const nullable = ['nationalId', 'birthDate', 'gender', 'nationality'];
  if (v === null || v === undefined) return nullable.includes(col) ? null : '';
  return typeof v === 'number' ? v : String(v);
}

// ── Person ──────────────────────────────────────────────────────────────────

export async function getPersonProfile(userId: string): Promise<PersonProfile> {
  const r = await getDb().prepare('SELECT * FROM person_profiles WHERE userId = ?').get(userId);
  return { userId, values: rowToValues('person', r), version: Number(r?.version ?? 0), updatedAt: (r?.updatedAt as string | undefined) ?? null };
}

/** Upserts the given catalog values of the person (other values unchanged). */
export async function savePersonProfile(userId: string, values: ProfileValues): Promise<PersonProfile> {
  const { columns, attrs } = splitValues('person', values);
  const db = getDb();
  const now = nowIso();
  const cur = await db.prepare('SELECT attributes FROM person_profiles WHERE userId = ?').get(userId);
  if (!cur) {
    await db.prepare('INSERT INTO person_profiles (userId, createdAt, updatedAt) VALUES (?, ?, ?)').run(userId, now, now);
  }
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  for (const c of PERSON_COLUMNS) if (c in columns) { sets.push(`${c} = ?`); params.push(columnValue(c, columns[c])); }
  if (Object.keys(attrs).length) {
    const merged = { ...parseJson<Record<string, unknown>>(cur?.attributes, {}), ...attrs };
    for (const [k, v] of Object.entries(merged)) if (v === null) delete merged[k];
    sets.push('attributes = ?'); params.push(JSON.stringify(merged));
  }
  if (sets.length) {
    await db.prepare(`UPDATE person_profiles SET ${sets.join(', ')}, version = version + 1, updatedAt = ? WHERE userId = ?`).run(...params, now, userId);
  }
  return getPersonProfile(userId);
}

// ── Factory ─────────────────────────────────────────────────────────────────

function mapFactory(r: Record<string, unknown>): FactoryProfile {
  return {
    id: String(r.id), values: rowToValues('factory', r), version: Number(r.version ?? 1), createdBy: (r.createdBy as string | null) ?? null,
    createdAt: String(r.createdAt), updatedAt: String(r.updatedAt), role: (r.memberRole as 'owner' | 'member' | undefined) ?? undefined,
  };
}

export async function getFactoryProfile(id: string): Promise<FactoryProfile | null> {
  const r = await getDb().prepare('SELECT * FROM factory_profiles WHERE id = ?').get(id);
  return r ? mapFactory(r) : null;
}

export async function listFactoryProfilesOfUser(userId: string): Promise<FactoryProfile[]> {
  return (await getDb().prepare(`SELECT f.*, m.role AS memberRole FROM factory_profiles f JOIN factory_profile_members m ON m.factoryProfileId = f.id
    WHERE m.userId = ? ORDER BY f.createdAt`).all(userId)).map(mapFactory);
}

export async function factoryMemberRole(factoryId: string, userId: string): Promise<'owner' | 'member' | null> {
  const r = await getDb().prepare('SELECT role FROM factory_profile_members WHERE factoryProfileId = ? AND userId = ?').get(factoryId, userId);
  return (r?.role as 'owner' | 'member' | undefined) ?? null;
}

export async function createFactoryProfile(ownerUserId: string, values: ProfileValues, id?: string): Promise<FactoryProfile> {
  const fid = id ?? newId('fac');
  const now = nowIso();
  const name = String(values['factory.companyName'] ?? '').trim() || '—';
  await getDb().prepare('INSERT INTO factory_profiles (id, companyName, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)').run(fid, name, ownerUserId, now, now);
  await getDb().prepare("INSERT INTO factory_profile_members (factoryProfileId, userId, role, createdAt) VALUES (?, ?, 'owner', ?)").run(fid, ownerUserId, now);
  return (await saveFactoryProfile(fid, values))!;
}

export async function saveFactoryProfile(id: string, values: ProfileValues): Promise<FactoryProfile | null> {
  const db = getDb();
  const cur = await db.prepare('SELECT attributes FROM factory_profiles WHERE id = ?').get(id);
  if (!cur) return null;
  const { columns, attrs } = splitValues('factory', values);
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  for (const c of FACTORY_COLUMNS) {
    if (!(c in columns)) continue;
    if (c === 'companyName' && (columns[c] === null || columns[c] === '')) continue; // the name is mandatory
    sets.push(`${c} = ?`); params.push(columnValue(c, columns[c]));
  }
  if (Object.keys(attrs).length) {
    const merged = { ...parseJson<Record<string, unknown>>(cur.attributes, {}), ...attrs };
    for (const [k, v] of Object.entries(merged)) if (v === null) delete merged[k];
    sets.push('attributes = ?'); params.push(JSON.stringify(merged));
  }
  if (sets.length) await db.prepare(`UPDATE factory_profiles SET ${sets.join(', ')}, version = version + 1, updatedAt = ? WHERE id = ?`).run(...params, nowIso(), id);
  return getFactoryProfile(id);
}

// ── Documents ───────────────────────────────────────────────────────────────

export interface ProfileDocument {
  id: string; ownerType: ProfileScope; ownerId: string; kind: string; version: number; status: 'current' | 'superseded';
  originalName: string; storedName: string; mimeType: string; sizeBytes: number; sha256: string; uploadedBy: string | null; createdAt: string;
}

function mapDoc(r: Record<string, unknown>): ProfileDocument {
  return {
    id: String(r.id), ownerType: r.ownerType as ProfileScope, ownerId: String(r.ownerId), kind: String(r.kind), version: Number(r.version),
    status: r.status as 'current' | 'superseded', originalName: String(r.originalName), storedName: String(r.storedName),
    mimeType: String(r.mimeType), sizeBytes: Number(r.sizeBytes), sha256: String(r.sha256), uploadedBy: (r.uploadedBy as string | null) ?? null,
    createdAt: String(r.createdAt),
  };
}

export async function listCurrentDocuments(ownerType: ProfileScope, ownerId: string): Promise<ProfileDocument[]> {
  return (await getDb().prepare("SELECT * FROM profile_documents WHERE ownerType = ? AND ownerId = ? AND status = 'current' ORDER BY kind").all(ownerType, ownerId)).map(mapDoc);
}

export async function getProfileDocument(id: string): Promise<ProfileDocument | null> {
  const r = await getDb().prepare('SELECT * FROM profile_documents WHERE id = ?').get(id);
  return r ? mapDoc(r) : null;
}

/** Adds a new current version of a document kind (the previous current one becomes superseded). */
export async function addProfileDocument(input: {
  ownerType: ProfileScope; ownerId: string; kind: string; originalName: string; storedName: string; sizeBytes: number; sha256: string; uploadedBy: string | null; id?: string; createdAt?: string;
}): Promise<ProfileDocument> {
  const db = getDb();
  const prev = await db.prepare('SELECT MAX(version) AS v FROM profile_documents WHERE ownerType = ? AND ownerId = ? AND kind = ?').get(input.ownerType, input.ownerId, input.kind);
  await db.prepare("UPDATE profile_documents SET status = 'superseded' WHERE ownerType = ? AND ownerId = ? AND kind = ? AND status = 'current'").run(input.ownerType, input.ownerId, input.kind);
  const id = input.id ?? newId('pdoc');
  await db.prepare(`INSERT INTO profile_documents (id, ownerType, ownerId, kind, version, status, originalName, storedName, mimeType, sizeBytes, sha256, uploadedBy, createdAt)
    VALUES (?, ?, ?, ?, ?, 'current', ?, ?, 'application/pdf', ?, ?, ?, ?)`).run(
    id, input.ownerType, input.ownerId, input.kind, Number(prev?.v ?? 0) + 1, input.originalName, input.storedName, input.sizeBytes, input.sha256,
    input.uploadedBy, input.createdAt ?? nowIso(),
  );
  return (await getProfileDocument(id))!;
}
