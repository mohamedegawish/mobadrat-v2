/**
 * The import itself (runs inside the caller's transaction, on the target connection):
 *   1. accounts of the three sources merged by e-mail (Shams > Sona3 > platform for the kept id) + memberships;
 *   2. every Shams/Sona3 table copied into its prefixed module table, user references remapped;
 *   3. shared records (audit, notifications, inbox) into the core tables with their initiative;
 *   4. old platform: staff platform roles, catalog pages (info only), audit, read-only archive of the generic records;
 *   5. shared profiles built from each person's latest application (+ company / identity documents);
 *   6. verification: every row read back and compared, every foreign key of the schema, every stored file's sha256.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../../config.js';
import { cleanProfileValue, FIELD_BY_KEY, PROFILE_FIELDS, type Option, type ProfileScope } from '../../core/profile/catalog.js';
import { listGovernorates } from '../../core/reference/locations.js';
import { DOC_MAP as SHAMS_DOC_MAP, factoryProfileFromSections } from '../../initiatives/shams/requirements.js';
import { DOC_MAP as SONA3_DOC_MAP, FIELD_MAP as SONA3_FIELD_MAP } from '../../initiatives/sona3/requirements.js';
import { checkFile, copyIntoProfileStore, copyTree } from './files.js';
import type { Row, SourceDb, SourceName } from './sources.js';
import { norm, type Target } from './target.js';

export const MODULE_SOURCES = ['shams', 'sona3'] as const;
const ORDER: SourceName[] = ['shams', 'sona3', 'platform'];
const ID_PREFIX: Record<SourceName, string> = { shams: 'sh-', sona3: 's3-', platform: 'pf-' };
/** Not migrated: sessions, throttling state and the old migration ledgers. */
const MODULE_SKIP: Record<string, string> = {
  users: 'merged into the platform accounts', refresh_tokens: 'sessions are not migrated — everyone signs in again',
  login_throttle: 'transient throttling state', integration_auth_failures: 'transient throttling state', schema_migrations: 'old migration ledger',
};
const MODULE_TO_CORE = new Set(['audit_logs', 'notification_outbox', 'user_notifications', 'industrial_zones']);
const UPSERT_TABLES = new Set(['organizations', 'application_counters', 'site_content']);
const PLATFORM_ROLE: Record<string, string> = { ministry_admin: 'super_admin', auditor: 'auditor', initiative_manager: 'catalog_manager' };
/** Demo personas seeded by the three legacy apps (known passwords). */
const DEMO_DOMAINS = ['@shams.local', '@sona3.local'];
const PLATFORM_DEMO_EMAILS = new Set([
  'tarek.mansour@industry.gov.eg', 'sara.adel@industry.gov.eg', 'a.sherif@ida.gov.eg', 'mona.kamal@imc-egypt.org', 'yasser.fawzy@nbe.com.eg',
  'k.nabil@apexsolar.eg', 'h.radwan@eehc.gov.eg', 'm.sewedy@elsewedy-ind.com', 'heba.farouk@audit.gov.eg', 'factory@nile.eg',
  'dina.samir@nbe.com.eg', 'karim.elshorbagy@ghazl-textile.eg', 'hany.ramzy@suezchem.eg', 'maged.fahmy@ceramic10.eg',
]);

export interface ImportOptions {
  sources: Partial<Record<SourceName, SourceDb>>;
  uploads: Partial<Record<SourceName, string>>;
  dryRun: boolean;
  disableDemoAccounts: boolean;
  /** The old platform's initiative that IS the Shams El-Senaa module (not duplicated in the catalog). */
  platformShamsInitiative: string;
}

export interface Report {
  mode: 'dry-run' | 'commit';
  startedAt: string;
  finishedAt?: string;
  sources: Array<{ name: string; kind: string; location: string; fingerprint: string; schemaVersion: number | null; tables: Record<string, number> }>;
  users: {
    sourceAccounts: number; accounts: number;
    merged: Array<{ email: string; sources: string[]; keptId: string; passwordFrom: string }>;
    renamedIds: Array<{ source: string; oldId: string; newId: string; email: string }>;
    platformRoles: Array<{ email: string; legacyRole: string; platformRole: string }>;
    withoutRole: Array<{ email: string; legacyRoles: string[] }>;
    demoDisabled: string[];
  };
  memberships: number;
  tables: Array<{ source: string; table: string; target: string; rows: number; verified: string }>;
  skippedTables: Array<{ source: string; table: string; rows: number; reason: string }>;
  notResent: { notifications: number; webhooks: number };
  industrialZones: { matched: number; added: number };
  catalog: Array<{ legacyId: string; slug: string; result: string }>;
  archive: Record<string, number>;
  profiles: {
    person: number; factory: number; documents: number;
    rejectedValues: Array<{ owner: string; key: string; value: string; issue: string }>;
    notes: string[];
  };
  files: Array<{ source: string; folder: string; files: number; copied: number; identical: number; conflicts: string[] }>;
  fileChecks: { ok: number; missing: string[]; mismatch: string[] };
  duplicates: { nationalIds: Array<{ nationalId: string; accounts: string[] }>; registryNumbers: Array<{ registryNumber: string; profiles: string[] }> };
  warnings: string[];
  errors: string[];
}

export function newReport(dryRun: boolean): Report {
  return {
    mode: dryRun ? 'dry-run' : 'commit', startedAt: new Date().toISOString(), sources: [],
    users: { sourceAccounts: 0, accounts: 0, merged: [], renamedIds: [], platformRoles: [], withoutRole: [], demoDisabled: [] },
    memberships: 0, tables: [], skippedTables: [], notResent: { notifications: 0, webhooks: 0 }, industrialZones: { matched: 0, added: 0 },
    catalog: [], archive: {}, profiles: { person: 0, factory: 0, documents: 0, rejectedValues: [], notes: [] },
    files: [], fileChecks: { ok: 0, missing: [], mismatch: [] }, duplicates: { nationalIds: [], registryNumbers: [] }, warnings: [], errors: [],
  };
}

interface SrcUser {
  source: SourceName; id: string; email: string; nameAr: string; nameEn: string; phone: string; passwordHash: string;
  isActive: boolean; mustChangePassword: boolean; emailVerifiedAt: string | null; lastLoginAt: string | null;
  createdAt: string; updatedAt: string; tokenVersion: number; notificationsSeenAt: string | null; createdBy: string | null;
  role: string; organizationId: string | null; factoryId: string | null;
}

interface Loaded { source: SourceName | 'built'; table: string; target: string; cols: string[]; key: string[]; rows: Row[] }

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const sn = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const isUserRef = (c: string) => c === 'userId' || /UserId$/.test(c) || /By$/.test(c);
const parseJson = (v: unknown): Record<string, unknown> => { try { const o = JSON.parse(s(v)); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
const mask = (key: string, v: unknown) => { const t = typeof v === 'string' ? v : JSON.stringify(v) ?? ''; return /nationalId/i.test(key) ? `${t.slice(0, 3)}…${t.slice(-2)}` : t.slice(0, 80); };

export class Importer {
  private srcUsers: Partial<Record<SourceName, SrcUser[]>> = {};
  private userMap: Record<SourceName, Map<string, string>> = { shams: new Map(), sona3: new Map(), platform: new Map() };
  private emailOf = new Map<string, string>();
  private loaded: Loaded[] = [];
  private byTable = new Map<string, Row[]>();
  private idMap: Array<[SourceName, string, string, string]> = [];
  private coreIds = new Map<string, Set<string>>();
  private coreDedupe = new Map<string, Set<string>>();
  private persons = new Map<string, { values: Record<string, unknown>; createdAt: string; updatedAt: string }>();
  private factories: Array<{ id: string; owner: string; values: Record<string, unknown>; createdAt: string; updatedAt: string }> = [];
  private profileDocs: Row[] = [];
  private readonly now = new Date().toISOString();

  constructor(private readonly t: Target, private readonly o: ImportOptions, private readonly r: Report) {}

  async run(): Promise<void> {
    this.copyFiles();
    for (const name of ORDER) {
      const src = this.o.sources[name];
      if (src) this.srcUsers[name] = await this.loadUsers(src);
    }
    await this.mergeUsers();
    for (const name of MODULE_SOURCES) {
      const src = this.o.sources[name];
      if (!src) continue;
      await this.copyModuleTables(src);
      await this.copyCoreTables(src, name);
    }
    if (this.o.sources.platform) await this.importPlatform(this.o.sources.platform);
    await this.buildProfiles();
    await this.writeProfiles();
    await this.writeIdMap();
    await this.verify();
  }

  // ── 0. files ────────────────────────────────────────────────────────────────

  private copyFiles(): void {
    for (const name of MODULE_SOURCES) {
      if (!this.o.sources[name]) continue;
      const dir = this.o.uploads[name];
      if (!dir) throw new Error(`--${name}-uploads is required with the ${name} database (its documents are copied and verified)`);
      const res = copyTree(dir, path.join(config.uploadDir, name), this.o.dryRun);
      this.r.files.push({ source: name, folder: dir, ...res });
      if (res.conflicts.length) this.r.errors.push(`${name}: ${res.conflicts.length} file(s) already exist in ${path.join(config.uploadDir, name)} with different content (${res.conflicts.slice(0, 5).join(', ')})`);
    }
  }

  /** The folder a module row's stored file must be in after the import (in a dry run: the legacy folder). */
  private storedDir(source: SourceName, sub: string): string {
    return this.o.dryRun ? path.join(this.o.uploads[source]!, sub) : path.join(config.uploadDir, source, sub);
  }

  // ── 1. accounts ─────────────────────────────────────────────────────────────

  private async loadUsers(src: SourceDb): Promise<SrcUser[]> {
    const rows = await src.rows('users');
    this.r.users.sourceAccounts += rows.length;
    return rows.map((u) => src.name === 'platform' ? {
      source: src.name, id: s(u.id), email: s(u.email).trim().toLowerCase(), nameAr: s(u.name), nameEn: s(u.nameEn), phone: '',
      passwordHash: s(u.passwordHash), isActive: true, mustChangePassword: Number(u.mustChangePassword) === 1,
      emailVerifiedAt: Number(u.isVerified) === 1 ? s(u.createdAt) : null, lastLoginAt: null,
      createdAt: s(u.createdAt), updatedAt: s(u.updatedAt) || s(u.createdAt), tokenVersion: 0, notificationsSeenAt: null, createdBy: null,
      role: s(u.role), organizationId: sn(u.organizationId), factoryId: sn(u.factoryId),
    } : {
      source: src.name, id: s(u.id), email: s(u.email).trim().toLowerCase(), nameAr: s(u.nameAr), nameEn: s(u.nameEn), phone: s(u.phone),
      passwordHash: s(u.passwordHash), isActive: Number(u.isActive) === 1, mustChangePassword: Number(u.mustChangePassword) === 1,
      emailVerifiedAt: sn(u.emailVerifiedAt), lastLoginAt: sn(u.lastLoginAt), createdAt: s(u.createdAt), updatedAt: s(u.updatedAt) || s(u.createdAt),
      tokenVersion: Number(u.tokenVersion ?? 0), notificationsSeenAt: sn(u.notificationsSeenAt), createdBy: sn(u.createdBy),
      role: s(u.role), organizationId: sn(u.organizationId), factoryId: null,
    });
  }

  private async mergeUsers(): Promise<void> {
    const groups = new Map<string, SrcUser[]>();
    for (const name of ORDER) {
      for (const u of this.srcUsers[name] ?? []) {
        if (!u.email) throw new Error(`[${name}] account ${u.id} has no e-mail`);
        const g = groups.get(u.email) ?? [];
        if (g.some((x) => x.source === u.source)) throw new Error(`[${name}] two accounts share the e-mail ${u.email} (case-insensitively) — resolve it in the source first`);
        g.push(u);
        groups.set(u.email, g);
      }
    }
    const taken = new Set<string>();
    const users: Row[] = [];
    const memberships: Row[] = [];
    for (const [email, members] of groups) {
      const canon = members[0];
      let id = canon.id;
      if (taken.has(id)) {
        id = `${ID_PREFIX[canon.source]}${canon.id}`;
        for (let n = 2; taken.has(id); n++) id = `${ID_PREFIX[canon.source]}${n}-${canon.id}`;
        this.r.users.renamedIds.push({ source: canon.source, oldId: canon.id, newId: id, email });
      }
      taken.add(id);
      for (const m of members) { this.userMap[m.source].set(m.id, id); this.idMap.push([m.source, 'user', m.id, id]); }
      this.emailOf.set(id, email);
    }
    for (const [email, members] of groups) {
      const canon = members[0];
      const id = this.userMap[canon.source].get(canon.id)!;
      const pw = [...members].sort((a, b) => s(b.lastLoginAt).localeCompare(s(a.lastLoginAt)))[0];
      const plat = members.find((m) => m.source === 'platform');
      const platformRole = plat ? PLATFORM_ROLE[plat.role] ?? null : null;
      const demo = DEMO_DOMAINS.some((d) => email.endsWith(d)) || PLATFORM_DEMO_EMAILS.has(email);
      const disable = demo && this.o.disableDemoAccounts;
      const pick = (f: (m: SrcUser) => string) => members.map(f).find((v) => v.trim() !== '') ?? '';
      const minOf = (vals: Array<string | null>) => vals.filter((v): v is string => !!v).sort()[0] ?? null;
      const maxOf = (vals: Array<string | null>) => vals.filter((v): v is string => !!v).sort().reverse()[0] ?? null;
      const nameAr = (pick((m) => m.nameAr) || email.split('@')[0]).slice(0, 200);
      users.push({
        id, email, nameAr, nameEn: pick((m) => m.nameEn).slice(0, 200), phone: pick((m) => m.phone),
        passwordHash: disable ? bcrypt.hashSync(randomBytes(24).toString('hex'), 10) : pw.passwordHash,
        isActive: disable ? 0 : (members.some((m) => m.isActive) ? 1 : 0), mustChangePassword: disable ? 1 : (pw.mustChangePassword ? 1 : 0),
        platformRole, emailVerifiedAt: minOf(members.map((m) => m.emailVerifiedAt)), failedLoginCount: 0, lockedUntil: null,
        lastLoginAt: maxOf(members.map((m) => m.lastLoginAt)), notificationsSeenAt: maxOf(members.map((m) => m.notificationsSeenAt)),
        tokenVersion: Math.max(...members.map((m) => m.tokenVersion)),
        createdBy: canon.createdBy ? this.userMap[canon.source].get(canon.createdBy) ?? null : null,
        createdAt: minOf(members.map((m) => m.createdAt)) ?? this.now, updatedAt: maxOf(members.map((m) => m.updatedAt)) ?? this.now,
      });
      if (members.length > 1) this.r.users.merged.push({ email, sources: members.map((m) => m.source), keptId: id, passwordFrom: pw.source });
      if (platformRole) this.r.users.platformRoles.push({ email, legacyRole: plat!.role, platformRole });
      if (disable) this.r.users.demoDisabled.push(email);
      const modules = members.filter((m) => m.source !== 'platform');
      for (const m of modules) {
        memberships.push({
          id: `mem-${randomUUID()}`, userId: id, initiativeId: m.source, role: m.role, organizationId: m.organizationId,
          status: m.isActive && !disable ? 'active' : 'suspended', createdBy: null, createdAt: m.createdAt, updatedAt: m.updatedAt,
        });
      }
      if (!modules.length && !platformRole) this.r.users.withoutRole.push({ email, legacyRoles: members.map((m) => `${m.source}:${m.role}`) });
    }
    const ucols = ['id', 'email', 'nameAr', 'nameEn', 'phone', 'passwordHash', 'isActive', 'mustChangePassword', 'platformRole', 'emailVerifiedAt',
      'failedLoginCount', 'lockedUntil', 'lastLoginAt', 'notificationsSeenAt', 'tokenVersion', 'createdBy', 'createdAt', 'updatedAt'];
    await this.t.insert('users', ucols, users);
    this.track('built', 'users (merged)', 'users', ucols, ['id'], users);
    this.r.users.accounts = users.length;
    // Memberships after the module organizations exist (the module triggers check role ↔ organization): see copyModuleTables.
    this.pendingMemberships = memberships;
  }

  private pendingMemberships: Row[] = [];

  private async insertMemberships(initiativeId: string): Promise<void> {
    const rows = this.pendingMemberships.filter((m) => m.initiativeId === initiativeId);
    const cols = ['id', 'userId', 'initiativeId', 'role', 'organizationId', 'status', 'createdBy', 'createdAt', 'updatedAt'];
    await this.t.insert('initiative_memberships', cols, rows);
    this.track(initiativeId as SourceName, 'memberships', 'initiative_memberships', cols, ['id'], rows);
    this.r.memberships += rows.length;
  }

  // ── 2. module tables ────────────────────────────────────────────────────────

  private remap(row: Row, source: SourceName, fkCols: Set<string>): Row {
    const map = this.userMap[source];
    const renamed = [...map].filter(([a, b]) => a !== b);
    const out: Row = { ...row };
    for (const [k, v] of Object.entries(out)) {
      if (typeof v !== 'string') continue;
      if ((fkCols.has(k) || isUserRef(k)) && map.has(v)) out[k] = map.get(v);
      else if (renamed.length && (v.startsWith('{') || v.startsWith('['))) {
        let txt = v;
        for (const [a, b] of renamed) txt = txt.split(`"${a}"`).join(`"${b}"`);
        out[k] = txt;
      }
    }
    return out;
  }

  private async copyModuleTables(src: SourceDb): Promise<void> {
    const name = src.name;
    const tables = await src.tables();
    // Organizations first: memberships (and their triggers) need them.
    const ordered = [...tables.filter((t) => t === 'organizations'), ...tables.filter((t) => t !== 'organizations')];
    for (const table of ordered) {
      if (MODULE_SKIP[table]) {
        this.r.skippedTables.push({ source: name, table, rows: (await src.rows(table)).length, reason: MODULE_SKIP[table] });
        continue;
      }
      if (MODULE_TO_CORE.has(table)) continue;
      const target = `${name}_${table}`;
      if (!(await this.t.tableExists(target))) throw new Error(`[${name}] table ${table} has no counterpart ${target} in the platform schema`);
      const srcCols = await src.columns(table);
      const tcols = await this.t.columns(target);
      const tnames = new Set(tcols.map((c) => c.name));
      const dropped = srcCols.filter((c) => !tnames.has(c));
      if (dropped.length) this.r.warnings.push(`${name}.${table}: column(s) without a place in ${target}: ${dropped.join(', ')}`);
      const fk = new Set(await src.userFkColumns(table));
      let rows = (await src.rows(table)).map((r) => this.remap(r, name, fk));
      const cols = srcCols.filter((c) => tnames.has(c));
      rows = this.moduleHook(name, table, rows, cols);
      const missing = tcols.filter((c) => !c.nullable && !c.hasDefault && !cols.includes(c.name));
      if (missing.length) throw new Error(`[${name}] ${target} needs ${missing.map((c) => c.name).join(', ')} which ${table} does not have`);
      await this.t.insert(target, cols, rows, { upsert: UPSERT_TABLES.has(table) });
      this.track(name, table, target, cols, await src.primaryKey(table), rows);
      if (table === 'organizations') await this.insertMemberships(name);
    }
  }

  private moduleHook(source: SourceName, table: string, rows: Row[], cols: string[]): Row[] {
    if (table === 'webhook_outbox') {
      return rows.map((r) => {
        if (!['pending', 'sending', 'failed'].includes(s(r.status))) return r;
        this.r.notResent.webhooks++;
        return { ...r, status: 'skipped', lastError: 'legacy import: not re-sent from the platform' };
      });
    }
    if (source === 'sona3' && table === 'applicants') {
      cols.push('userId');
      const applicants = (this.srcUsers.sona3 ?? []).filter((u) => u.role === 'applicant');
      return rows.map((r) => {
        const owner = applicants.find((u) => u.organizationId === r.organizationId && this.userMap.sona3.get(u.id) === r.createdBy)
          ?? applicants.find((u) => u.organizationId === r.organizationId);
        if (!owner) this.r.warnings.push(`sona3 applicant ${s(r.id)} has no applicant account in its organization`);
        return { ...r, userId: owner ? this.userMap.sona3.get(owner.id) ?? null : null };
      });
    }
    return rows;
  }

  // ── 3. shared records → core tables ─────────────────────────────────────────

  private uniqueId(table: string, source: SourceName, entity: string, id: string): string {
    const set = this.coreIds.get(table) ?? new Set<string>();
    this.coreIds.set(table, set);
    let out = id;
    if (set.has(out)) {
      out = `${source}-${id}`;
      this.idMap.push([source, entity, id, out]);
    }
    set.add(out);
    return out;
  }

  private uniqueDedupe(table: string, source: SourceName, key: string): string {
    const set = this.coreDedupe.get(table) ?? new Set<string>();
    this.coreDedupe.set(table, set);
    const out = set.has(key) ? `${source}:${key}` : key;
    set.add(out);
    return out;
  }

  private async copyCoreTables(src: SourceDb, initiativeId: string): Promise<void> {
    const tables = await src.tables();
    const entity: Record<string, string> = { audit_logs: 'audit_log', notification_outbox: 'notification', user_notifications: 'inbox' };
    for (const table of ['audit_logs', 'notification_outbox', 'user_notifications']) {
      if (!tables.includes(table)) continue;
      const tnames = new Set((await this.t.columns(table)).map((c) => c.name));
      const srcCols = await src.columns(table);
      const cols = [...srcCols.filter((c) => tnames.has(c)), 'initiativeId'];
      const dropped = srcCols.filter((c) => !tnames.has(c));
      if (dropped.length) this.r.warnings.push(`${src.name}.${table}: column(s) without a place in ${table}: ${dropped.join(', ')}`);
      const fk = new Set(await src.userFkColumns(table));
      const rows = (await src.rows(table)).map((raw) => {
        const r = this.remap(raw, src.name, fk);
        r.initiativeId = initiativeId;
        r.id = this.uniqueId(table, src.name, entity[table], s(r.id));
        if ('dedupeKey' in r) r.dedupeKey = this.uniqueDedupe(table, src.name, s(r.dedupeKey));
        if (table === 'notification_outbox' && ['pending', 'sending'].includes(s(r.status))) {
          r.status = 'skipped'; r.skipReason = 'legacy_import'; this.r.notResent.notifications++;
          if (!cols.includes('skipReason')) cols.push('skipReason');
        }
        return r;
      });
      await this.t.insert(table, cols, rows);
      this.track(src.name, table, table, cols, ['id'], rows);
    }
    if (tables.includes('industrial_zones')) {
      const existing = await this.t.all<{ id: string; governorate: string; value: string }>('SELECT id, governorate, value FROM industrial_zones');
      const keys = new Set(existing.map((z) => `${z.governorate}|${z.value}`));
      const ids = new Set(existing.map((z) => z.id));
      const src_rows = await src.rows('industrial_zones');
      const add = src_rows.filter((z) => !keys.has(`${s(z.governorate)}|${s(z.value)}`)).map((z) => (ids.has(s(z.id)) ? { ...z, id: `zone-${randomUUID()}` } : z));
      this.r.industrialZones.matched += src_rows.length - add.length;
      this.r.industrialZones.added += add.length;
      if (add.length) {
        const tnames = new Set((await this.t.columns('industrial_zones')).map((c) => c.name));
        const cols = (await src.columns('industrial_zones')).filter((c) => tnames.has(c));
        await this.t.insert('industrial_zones', cols, add);
        this.track(src.name, 'industrial_zones', 'industrial_zones', cols, ['id'], add);
      }
    }
  }

  // ── 4. old platform ─────────────────────────────────────────────────────────

  private async importPlatform(src: SourceDb): Promise<void> {
    const tables = await src.tables();
    const fkFree = new Set<string>();
    const archive: Array<[string, string]> = [['applications', 'application'], ['initiatives', 'initiative'], ['organizations', 'organization'], ['factories', 'factory'], ['details_files', 'details_file']];
    const arch: Row[] = [];
    for (const [table, kind] of archive) {
      if (!tables.includes(table)) continue;
      const rows = await src.rows(table);
      for (const r of rows) arch.push({ id: s(r.id), kind, data: JSON.stringify(this.remap(r, 'platform', fkFree)), importedAt: this.now });
      this.r.archive[kind] = rows.length;
    }
    await this.t.insert('legacy_platform_archive', ['id', 'kind', 'data', 'importedAt'], arch);
    this.track('platform', 'archive', 'legacy_platform_archive', ['id', 'kind', 'data', 'importedAt'], ['kind', 'id'], arch);
    for (const table of ['meta', 'refresh_tokens']) {
      if (tables.includes(table)) this.r.skippedTables.push({ source: 'platform', table, rows: (await src.rows(table)).length, reason: table === 'meta' ? 'old seed markers' : 'sessions are not migrated' });
    }
    if (tables.includes('details_files') && (await src.rows('details_files')).length && !this.o.uploads.platform) {
      this.r.warnings.push('the old platform has details files but --platform-uploads was not given: their rows are archived, their files are not copied');
    }
    if (tables.includes('details_files') && this.o.uploads.platform) {
      const dest = path.join(config.uploadDir, 'core', 'legacy-platform');
      for (const f of await src.rows('details_files')) {
        const from = path.resolve(this.o.uploads.platform, s(f.storedPath));
        if (!fs.existsSync(from)) { this.r.fileChecks.missing.push(`platform details file ${s(f.storedPath)}`); continue; }
        if (!this.o.dryRun) { fs.mkdirSync(dest, { recursive: true }); fs.copyFileSync(from, path.join(dest, path.basename(from))); }
        this.r.fileChecks.ok++;
      }
    }

    // Catalog: the old initiatives become information pages (no module, registration closed); the Shams one IS the module.
    if (tables.includes('initiatives')) {
      const tcols = await this.t.columns('initiatives');
      const tnames = new Set(tcols.map((c) => c.name));
      const srcCols = (await src.columns('initiatives')).filter((c) => tnames.has(c) && c !== 'id' && c !== 'slug');
      const statuses = ['active', 'draft', 'coming_soon', 'closed', 'archived', 'completed'];
      let order = 100;
      const rows: Row[] = [];
      for (const r of await src.rows('initiatives')) {
        if (s(r.id) === this.o.platformShamsInitiative) {
          this.idMap.push(['platform', 'initiative', s(r.id), 'shams']);
          this.r.catalog.push({ legacyId: s(r.id), slug: s(r.slug), result: 'the Shams El-Senaa module page (not duplicated; its applications are in the archive)' });
          continue;
        }
        let id = s(r.id);
        if (await this.t.one('SELECT 1 AS x FROM initiatives WHERE id = ?', [id])) id = `legacy-${id}`;
        let slug = s(r.slug);
        if (await this.t.one('SELECT 1 AS x FROM initiatives WHERE slug = ?', [slug]) || rows.some((x) => x.slug === slug)) slug = `${slug}-legacy`;
        const row: Row = { id, slug, moduleId: null, registrationOpen: 0, sortOrder: order++ };
        for (const c of srcCols) row[c] = r[c];
        if (!statuses.includes(s(row.status))) row.status = 'draft';
        rows.push(row);
        this.idMap.push(['platform', 'initiative', s(r.id), id]);
        this.r.catalog.push({ legacyId: s(r.id), slug, result: 'information page (no module yet, registration closed)' });
      }
      const cols = ['id', 'slug', 'moduleId', 'registrationOpen', 'sortOrder', ...srcCols];
      await this.t.insert('initiatives', cols, rows);
      this.track('platform', 'initiatives', 'initiatives', cols, ['id'], rows);
    }

    if (tables.includes('audit_logs')) {
      const map = this.userMap.platform;
      const rows = (await src.rows('audit_logs')).map((a) => ({
        id: this.uniqueId('audit_logs', 'platform', 'audit_log', s(a.id)), at: s(a.timestamp), initiativeId: null,
        actorType: a.userId && map.has(s(a.userId)) ? 'user' : 'system', actorUserId: map.get(s(a.userId)) ?? null, actorName: s(a.userName),
        action: s(a.actionType) || 'legacy.event', entityType: s(a.entityType) || 'legacy', entityId: s(a.entityId), summaryAr: s(a.summaryAr),
        details: JSON.stringify({ legacy: 'platform', before: parseJson(a.beforeJson), after: parseJson(a.afterJson) }), ip: sn(a.ip),
      }));
      const cols = ['id', 'at', 'initiativeId', 'actorType', 'actorUserId', 'actorName', 'action', 'entityType', 'entityId', 'summaryAr', 'details', 'ip'];
      await this.t.insert('audit_logs', cols, rows);
      this.track('platform', 'audit_logs', 'audit_logs', cols, ['id'], rows);
    }
  }

  // ── 5. shared profiles ──────────────────────────────────────────────────────

  private rowsOf(source: SourceName, table: string): Row[] { return this.byTable.get(`${source}.${table}`) ?? []; }

  /** Latest data of every section of an application (highest attempt). */
  private sectionsOf(source: SourceName, appId: string): Record<string, Record<string, unknown>> {
    const best = new Map<string, Row>();
    for (const d of this.rowsOf(source, 'application_data')) {
      if (d.applicationId !== appId) continue;
      const cur = best.get(s(d.section));
      if (!cur || Number(d.attempt) > Number(cur.attempt) || (Number(d.attempt) === Number(cur.attempt) && s(d.updatedAt) > s(cur.updatedAt))) best.set(s(d.section), d);
    }
    const out: Record<string, Record<string, unknown>> = {};
    for (const [section, d] of best) out[section] = parseJson(d.data);
    return out;
  }

  private latestApp(source: SourceName, field: string, value: unknown): Row | undefined {
    return this.rowsOf(source, 'applications').filter((a) => a[field] === value).sort((a, b) => s(b.createdAt).localeCompare(s(a.createdAt)))[0];
  }

  private clean(scope: ProfileScope, values: Record<string, unknown>, owner: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries(values)) {
      const f = FIELD_BY_KEY.get(k);
      if (!f || f.scope !== scope || raw === undefined || raw === null || raw === '') continue;
      const c = cleanProfileValue(f, raw, values);
      if ('issue' in c) { this.r.profiles.rejectedValues.push({ owner, key: k, value: mask(k, raw), issue: c.issue }); continue; }
      if (c.value !== null) out[k] = c.value;
    }
    return out;
  }

  private addPerson(userId: string, values: Record<string, unknown>, createdAt: string, updatedAt: string): void {
    const clean = this.clean('person', values, this.emailOf.get(userId) ?? userId);
    const cur = this.persons.get(userId);
    if (!cur) { this.persons.set(userId, { values: clean, createdAt, updatedAt }); return; }
    for (const [k, v] of Object.entries(clean)) if (cur.values[k] === undefined) cur.values[k] = v;
  }

  private addDoc(source: SourceName, doc: Row, ownerType: ProfileScope, ownerId: string, uploader: string): void {
    if (this.profileDocs.some((d) => d.ownerType === ownerType && d.ownerId === ownerId && d.kind === doc.kind)) return;
    const file = path.join(this.o.uploads[source]!, 'documents', path.basename(s(doc.storedName)));
    if (!fs.existsSync(file)) { this.r.profiles.notes.push(`${source} document ${s(doc.id)} (${s(doc.kind)}) is missing on disk — not added to the profile`); return; }
    const copy = copyIntoProfileStore(file, path.join(config.uploadDir, 'core', 'documents'), this.o.dryRun);
    if (doc.sha256 && copy.sha256 !== doc.sha256) this.r.fileChecks.mismatch.push(`${source} document ${s(doc.id)} (sha256 differs from the record)`);
    this.profileDocs.push({
      id: `pdoc-${randomUUID()}`, ownerType, ownerId, kind: s(doc.kind), version: 1, status: 'current', originalName: s(doc.originalName) || `${s(doc.kind)}.pdf`,
      storedName: copy.storedName, mimeType: s(doc.mimeType) || 'application/pdf', sizeBytes: copy.sizeBytes, sha256: copy.sha256,
      uploadedBy: this.userMap[source].get(s(doc.uploadedBy)) ?? uploader, createdAt: s(doc.createdAt) || this.now,
    });
  }

  private currentDocs(source: SourceName, appId: string, kinds: readonly string[]): Row[] {
    const out = new Map<string, Row>();
    for (const d of this.rowsOf(source, 'documents')) {
      if (d.applicationId !== appId || !kinds.includes(s(d.kind)) || ['superseded', 'removed'].includes(s(d.status))) continue;
      const cur = out.get(s(d.kind));
      if (!cur || Number(d.version) > Number(cur.version)) out.set(s(d.kind), d);
    }
    return [...out.values()];
  }

  private async buildProfiles(): Promise<void> {
    // Shams: one factory profile per factory file (from its latest application), owned by the factory owner.
    if (this.o.sources.shams) {
      const owners = (this.srcUsers.shams ?? []).filter((u) => u.role === 'factory_owner');
      for (const f of this.rowsOf('shams', 'factories')) {
        const owner = owners.find((u) => u.organizationId === f.organizationId && this.userMap.shams.get(u.id) === f.createdBy)
          ?? owners.find((u) => u.organizationId === f.organizationId);
        if (!owner) { this.r.profiles.notes.push(`shams factory ${s(f.id)} has no owner account — no shared profile`); continue; }
        const ownerId = this.userMap.shams.get(owner.id)!;
        const app = this.latestApp('shams', 'factoryId', f.id);
        const values = app ? factoryProfileFromSections(this.sectionsOf('shams', s(app.id))) : {};
        if (!values['factory.companyName']) values['factory.companyName'] = s(f.companyName);
        const id = `fac-${randomUUID()}`;
        this.factories.push({ id, owner: ownerId, values: this.clean('factory', values, this.emailOf.get(ownerId) ?? ownerId), createdAt: s(f.createdAt), updatedAt: s(f.updatedAt) });
        await this.t.exec('UPDATE shams_factories SET factoryProfileId = ? WHERE id = ?', [id, f.id]);
        f.factoryProfileId = id;
        this.idMap.push(['shams', 'factory_profile', s(f.id), id]);
        this.addPerson(ownerId, { 'person.fullNameAr': owner.nameAr, 'person.phone': owner.phone }, owner.createdAt, owner.updatedAt);
        if (app) for (const d of this.currentDocs('shams', s(app.id), SHAMS_DOC_MAP.map((m) => m.kind))) this.addDoc('shams', d, 'factory', id, ownerId);
      }
    }
    // Sona3: the person profile of each applicant (from the personal section of the latest application).
    if (this.o.sources.sona3) {
      for (const a of this.rowsOf('sona3', 'applicants')) {
        const userId = sn(a.userId);
        if (!userId) continue;
        const app = this.latestApp('sona3', 'applicantId', a.id);
        const personal = app ? this.sectionsOf('sona3', s(app.id)).personal ?? {} : {};
        const values: Record<string, unknown> = { 'person.fullNameAr': s(a.fullName) };
        for (const m of SONA3_FIELD_MAP) if (personal[m.key] !== undefined) values[m.profileKey] = personal[m.key];
        this.addPerson(userId, values, s(a.createdAt), s(a.updatedAt));
        if (app) for (const d of this.currentDocs('sona3', s(app.id), SONA3_DOC_MAP.map((m) => m.kind))) this.addDoc('sona3', d, 'person', userId, userId);
      }
    }
    // Old platform: factory records of factory owners become their factory profiles.
    if (this.o.sources.platform) {
      const src = this.o.sources.platform;
      const sectorOpts = (FIELD_BY_KEY.get('factory.sector')?.options ?? []) as Option[];
      // Compare Arabic labels without the definite article (also after a leading "و"): "الغزل والنسيج" ~ "غزل ونسيج".
      const bare = (v: string) => v.replace(/(^|\s)(و?)ال/g, '$1$2').replace(/\s+/g, ' ').trim();
      for (const f of (await src.tables()).includes('factories') ? await src.rows('factories') : []) {
        const owner = (this.srcUsers.platform ?? []).find((u) => u.factoryId === f.id);
        if (!owner) { this.r.profiles.notes.push(`platform factory ${s(f.id)} has no owner account — archived only`); continue; }
        const ownerId = this.userMap.platform.get(owner.id)!;
        const d = parseJson(f.data);
        const gov = listGovernorates().find((g) => g.labelAr === s(d.governorate) || g.labelEn.toLowerCase() === s(d.governorateEn).toLowerCase());
        const sector = sectorOpts.find((o) => bare(o.labelAr) === bare(s(d.sector)) || o.labelEn.toLowerCase() === s(d.sectorEn).toLowerCase())
          ?? sectorOpts.filter((o) => o.value !== 'other' && d.sector && bare(s(d.sector)).includes(bare(o.labelAr))).sort((a, b) => b.labelAr.length - a.labelAr.length)[0];
        if (d.governorate && !gov) this.r.profiles.notes.push(`platform factory ${s(f.id)}: governorate "${s(d.governorate)}" not recognised`);
        if (d.sector && !sector) this.r.profiles.notes.push(`platform factory ${s(f.id)}: sector "${s(d.sector)}" not recognised`);
        const values: Record<string, unknown> = {
          'factory.companyName': s(d.nameAr) || s(d.nameEn), 'factory.commercialRegisterNumber': d.commercialRegistrationNumber,
          'factory.industrialRegistryNumber': d.industrialRegistrationNumber, 'factory.taxNumber': d.taxIdNumber,
          'factory.governorate': gov?.value, 'factory.sector': sector?.value, 'factory.employeesCount': d.employeesCount,
          'factory.roofAreas': Number(d.roofAreaSqMeters) > 0 ? [{ name: 'إجمالي مساحة الأسطح', area: Number(d.roofAreaSqMeters) }] : undefined,
        };
        const id = `fac-${randomUUID()}`;
        this.factories.push({ id, owner: ownerId, values: this.clean('factory', values, owner.email), createdAt: s(f.createdAt) || this.now, updatedAt: s(f.updatedAt) || this.now });
        this.idMap.push(['platform', 'factory_profile', s(f.id), id]);
        this.addPerson(ownerId, { 'person.fullNameAr': owner.nameAr }, owner.createdAt, owner.updatedAt);
      }
    }
  }

  private storage(scope: ProfileScope, values: Record<string, unknown>): { cols: Row; attrs: Record<string, unknown> } {
    const cols: Row = {};
    const attrs: Record<string, unknown> = {};
    for (const f of PROFILE_FIELDS) {
      if (f.scope !== scope || values[f.key] === undefined) continue;
      if (f.storage.startsWith('attributes.')) attrs[f.storage.slice('attributes.'.length)] = values[f.key];
      else cols[f.storage] = values[f.key];
    }
    return { cols, attrs };
  }

  private async writeProfiles(): Promise<void> {
    const fill = async (table: string, rows: Row[], keyCols: string[]) => {
      const tcols = await this.t.columns(table);
      const storageCols = tcols.map((c) => c.name).filter((c) => rows.some((r) => c in r) && !keyCols.includes(c));
      const cols = [...keyCols, ...storageCols];
      const full = rows.map((r) => {
        const o: Row = { ...r };
        for (const c of storageCols) if (!(c in o)) o[c] = tcols.find((x) => x.name === c)!.nullable ? null : '';
        return o;
      });
      await this.t.insert(table, cols, full);
      this.track('built', table, table, cols, keyCols.slice(0, 1), full);
    };
    const persons: Row[] = [...this.persons].map(([userId, p]) => {
      const { cols, attrs } = this.storage('person', p.values);
      return { userId, ...cols, attributes: JSON.stringify(attrs), version: 1, createdAt: p.createdAt || this.now, updatedAt: p.updatedAt || this.now };
    });
    if (persons.length) await fill('person_profiles', persons, ['userId']);
    const factories: Row[] = this.factories.map((f) => {
      const { cols, attrs } = this.storage('factory', f.values);
      return { id: f.id, ...cols, companyName: s(cols.companyName) || '—', attributes: JSON.stringify(attrs), version: 1, createdBy: f.owner, createdAt: f.createdAt, updatedAt: f.updatedAt };
    });
    if (factories.length) {
      await fill('factory_profiles', factories, ['id']);
      const members = this.factories.map((f) => ({ factoryProfileId: f.id, userId: f.owner, role: 'owner', createdAt: f.createdAt }));
      await this.t.insert('factory_profile_members', ['factoryProfileId', 'userId', 'role', 'createdAt'], members);
      this.track('built', 'factory_profile_members', 'factory_profile_members', ['factoryProfileId', 'userId', 'role', 'createdAt'], ['factoryProfileId', 'userId'], members);
    }
    const dcols = ['id', 'ownerType', 'ownerId', 'kind', 'version', 'status', 'originalName', 'storedName', 'mimeType', 'sizeBytes', 'sha256', 'uploadedBy', 'createdAt'];
    await this.t.insert('profile_documents', dcols, this.profileDocs);
    this.track('built', 'profile_documents', 'profile_documents', dcols, ['id'], this.profileDocs);
    this.r.profiles.person = persons.length;
    this.r.profiles.factory = factories.length;
    this.r.profiles.documents = this.profileDocs.length;

    // Same identity in two profiles: reported for the operators (the data is kept as it was).
    const nid = new Map<string, string[]>();
    for (const [userId, p] of this.persons) if (p.values['person.nationalId']) nid.set(s(p.values['person.nationalId']), [...(nid.get(s(p.values['person.nationalId'])) ?? []), this.emailOf.get(userId) ?? userId]);
    this.r.duplicates.nationalIds = [...nid].filter(([, a]) => a.length > 1).map(([n, accounts]) => ({ nationalId: mask('nationalId', n), accounts }));
    const reg = new Map<string, string[]>();
    for (const f of this.factories) if (f.values['factory.industrialRegistryNumber']) reg.set(s(f.values['factory.industrialRegistryNumber']), [...(reg.get(s(f.values['factory.industrialRegistryNumber'])) ?? []), `${f.id} (${this.emailOf.get(f.owner) ?? f.owner})`]);
    this.r.duplicates.registryNumbers = [...reg].filter(([, p]) => p.length > 1).map(([registryNumber, profiles]) => ({ registryNumber, profiles }));
  }

  private async writeIdMap(): Promise<void> {
    const rows = this.idMap.map(([source, entity, oldId, newId]) => ({ source, entity, oldId, newId }));
    await this.t.insert('legacy_id_map', ['source', 'entity', 'oldId', 'newId'], rows, { upsert: true });
  }

  // ── 6. verification ─────────────────────────────────────────────────────────

  private track(source: SourceName | 'built', table: string, target: string, cols: string[], key: string[], rows: Row[]): void {
    this.loaded.push({ source, table, target, cols: [...cols], key, rows });
    this.byTable.set(`${source}.${table}`, rows);
  }

  private async verify(): Promise<void> {
    // Every loaded row is read back and compared column by column.
    const byTarget = new Map<string, Loaded[]>();
    for (const l of this.loaded) byTarget.set(l.target, [...(byTarget.get(l.target) ?? []), l]);
    for (const [target, loads] of byTarget) {
      const key = loads[0].key.length ? loads[0].key : ['id'];
      const cols = [...new Set(loads.flatMap((l) => l.cols))];
      const k = (r: Row) => key.map((c) => norm(r[c])).join('\u0001');
      const stored = new Map((await this.t.all(`SELECT ${cols.map((c) => `\`${c}\``).join(', ')} FROM \`${target}\``)).map((r) => [k(r), r]));
      for (const l of loads) {
        let bad = 0;
        for (const r of l.rows) {
          const got = stored.get(k(r));
          if (!got) { bad++; if (bad <= 3) this.r.errors.push(`${target}: row ${k(r)} from ${l.source}.${l.table} is missing after the import`); continue; }
          for (const c of l.cols) {
            if (norm(r[c]) !== norm(got[c])) {
              bad++;
              if (bad <= 3) this.r.errors.push(`${target}.${c}: row ${k(r)} differs from ${l.source}.${l.table} (${String(norm(r[c])).slice(0, 40)} → ${String(norm(got[c])).slice(0, 40)})`);
              break;
            }
          }
        }
        this.r.tables.push({ source: l.source, table: l.table, target, rows: l.rows.length, verified: bad ? `${bad} row(s) differ` : 'identical' });
      }
    }
    // Every foreign key of the whole schema.
    for (const v of await this.t.foreignKeyViolations()) {
      this.r.errors.push(`foreign key ${v.constraint}: ${v.orphans} row(s) of ${v.table}(${v.columns.join(', ')}) point to no ${v.parent} row`);
    }
    // Every stored file named by a module row, against its recorded sha256.
    const fileRefs: Array<[SourceName, string, string, string, string]> = [
      ['shams', 'documents', 'documents', 'storedName', 'sha256'], ['shams', 'registry_objections', 'documents', 'storedName', 'sha256'],
      ['shams', 'account_recovery_requests', 'documents', 'documentStoredName', 'documentSha256'], ['shams', 'service_providers', 'providers', 'logoStoredName', 'logoSha256'],
      ['sona3', 'documents', 'documents', 'storedName', 'sha256'],
    ];
    for (const [source, table, sub, nameCol, shaCol] of fileRefs) {
      if (!this.o.sources[source]) continue;
      for (const r of this.rowsOf(source, table)) {
        if (!r[nameCol]) continue;
        const res = checkFile(this.storedDir(source, sub), s(r[nameCol]), sn(r[shaCol]));
        if (res === 'ok') this.r.fileChecks.ok++;
        else (res === 'missing' ? this.r.fileChecks.missing : this.r.fileChecks.mismatch).push(`${source}.${table} ${s(r.id)}: ${sub}/${s(r[nameCol])}`);
      }
    }
    if (this.r.fileChecks.mismatch.length) this.r.errors.push(`${this.r.fileChecks.mismatch.length} stored file(s) do not match their recorded sha256`);
    const users = await this.t.count('users');
    if (users !== this.r.users.accounts) this.r.errors.push(`users: ${users} accounts in the platform, ${this.r.users.accounts} expected`);
  }
}

export function renderMarkdown(r: Report): string {
  const L: string[] = [];
  L.push(`# Legacy import report (${r.mode})`, '', `Started ${r.startedAt}, finished ${r.finishedAt ?? '—'}.`, '');
  L.push(r.errors.length ? `**Result: FAILED — nothing was written (${r.errors.length} error(s)).**` : r.mode === 'dry-run' ? '**Result: dry run OK — rolled back, nothing was written.**' : '**Result: imported and verified.**', '');
  if (r.errors.length) L.push('## Errors', '', ...r.errors.map((e) => `- ${e}`), '');
  L.push('## Sources', '', '| Source | Kind | Location | Schema | Fingerprint |', '|---|---|---|---|---|');
  for (const x of r.sources) L.push(`| ${x.name} | ${x.kind} | ${x.location} | ${x.schemaVersion ?? '—'} | \`${x.fingerprint.slice(0, 16)}…\` |`);
  L.push('', '## Accounts', '', `${r.users.sourceAccounts} legacy accounts → ${r.users.accounts} platform accounts, ${r.memberships} initiative memberships.`, '');
  if (r.users.merged.length) L.push('Merged (same e-mail):', '', ...r.users.merged.map((m) => `- ${m.email}: ${m.sources.join(' + ')} → \`${m.keptId}\` (password from ${m.passwordFrom})`), '');
  if (r.users.renamedIds.length) L.push('Ids renamed (taken by another account):', '', ...r.users.renamedIds.map((m) => `- ${m.source} \`${m.oldId}\` → \`${m.newId}\` (${m.email})`), '');
  if (r.users.platformRoles.length) L.push('Platform roles:', '', ...r.users.platformRoles.map((m) => `- ${m.email}: ${m.legacyRole} → ${m.platformRole}`), '');
  if (r.users.withoutRole.length) L.push('Accounts kept for sign-in without any role (old platform staff roles have no equivalent):', '', ...r.users.withoutRole.map((m) => `- ${m.email} (${m.legacyRoles.join(', ')})`), '');
  if (r.users.demoDisabled.length) L.push(`Demo accounts disabled (${r.users.demoDisabled.length}): ${r.users.demoDisabled.join(', ')}`, '');
  L.push('## Tables', '', '| Source table | Platform table | Rows | Check |', '|---|---|---|---|');
  for (const t of r.tables) L.push(`| ${t.source}.${t.table} | ${t.target} | ${t.rows} | ${t.verified} |`);
  if (r.skippedTables.length) L.push('', 'Not migrated:', '', ...r.skippedTables.map((t) => `- ${t.source}.${t.table} (${t.rows} rows): ${t.reason}`));
  L.push('', `Notifications not re-sent: ${r.notResent.notifications} e-mail/SMS, ${r.notResent.webhooks} webhook(s) (marked skipped).`);
  L.push(`Industrial zones: ${r.industrialZones.matched} already in the reference list, ${r.industrialZones.added} added.`, '');
  if (r.catalog.length) L.push('## Catalog', '', ...r.catalog.map((c) => `- ${c.legacyId} (${c.slug}): ${c.result}`), '');
  if (Object.keys(r.archive).length) L.push('Archived old platform records (read-only, `legacy_platform_archive`): ' + Object.entries(r.archive).map(([k, n]) => `${k} ${n}`).join(', '), '');
  L.push('## Shared profiles', '', `${r.profiles.person} person profile(s), ${r.profiles.factory} factory profile(s), ${r.profiles.documents} document(s).`, '');
  if (r.profiles.rejectedValues.length) L.push('Values not carried into a profile (invalid for the shared profile; still in the application):', '', ...r.profiles.rejectedValues.map((v) => `- ${v.owner} ${v.key} = "${v.value}": ${v.issue}`), '');
  if (r.profiles.notes.length) L.push(...r.profiles.notes.map((n) => `- ${n}`), '');
  if (r.duplicates.nationalIds.length || r.duplicates.registryNumbers.length) {
    L.push('## Duplicates to review', '');
    for (const d of r.duplicates.nationalIds) L.push(`- national ID ${d.nationalId}: ${d.accounts.join(', ')}`);
    for (const d of r.duplicates.registryNumbers) L.push(`- industrial registry ${d.registryNumber}: ${d.profiles.join(', ')}`);
    L.push('');
  }
  L.push('## Files', '');
  for (const f of r.files) L.push(`- ${f.source} (${f.folder}): ${f.files} file(s), ${f.copied} copied, ${f.identical} already identical${f.conflicts.length ? `, **${f.conflicts.length} conflict(s)**` : ''}`);
  L.push(`- checked against their records: ${r.fileChecks.ok} ok, ${r.fileChecks.missing.length} missing, ${r.fileChecks.mismatch.length} different`);
  for (const m of r.fileChecks.missing) L.push(`  - missing: ${m}`);
  for (const m of r.fileChecks.mismatch) L.push(`  - different: ${m}`);
  if (r.warnings.length) L.push('', '## Warnings', '', ...r.warnings.map((w) => `- ${w}`));
  return L.join('\n') + '\n';
}
