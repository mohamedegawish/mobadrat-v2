/**
 * Deploy seeder — SEED_ON_DEPLOY=1 (every boot) or `npm run db:seed:deploy:prod` (once): one account for every role of the
 * platform and of every initiative, plus the demo data those accounts need to work (a demo factory, applicant, funder,
 * and — only where the initiative has none of its own — banks, service providers, an open cohort, experts).
 *
 * Safe on a production database, including one with real (imported) data:
 *   • it creates only what is missing and never changes an existing account (password, role, status) or existing data —
 *     except the one-time reset below;
 *   • every account it creates has the fixed seed password (config.ts DEFAULT_SEED_PASSWORD), usable as it is;
 *   • once (marker «seed_accounts_reset_v1» in the meta table) the seeded accounts that already exist are put back in
 *     their first state: the seed password, active, e-mail verified, their membership / platform role active, sessions
 *     ended — so every seeded account signs in with the documented password after that deployment;
 *   • reference data that real people choose from is added only when the initiative has none — next to real banks,
 *     providers, cohorts and experts the demo accounts use the real ones, and real users never see demo entries;
 *   • SEED_EMAIL_DOMAIN moves the accounts to another domain (imc1@shams.local → imc1.shams@<domain>), e.g. after the legacy
 *     import, whose old demo accounts (@shams.local, @sona3.local) arrive disabled;
 *   • it runs in one write transaction (write transactions are serialised across instances), so two instances starting at
 *     the same time cannot create an account twice.
 * The legacy import needs an empty database: keep SEED_ON_DEPLOY=0 until the import has finished (docs/DEPLOY.md).
 */
import { seedPassword } from '../config.js';
import { getDb, nowIso, tx } from './db/index.js';
import { hashPassword } from './auth/jwt.js';
import { accountStatus, ensureSeedAccount } from './seedAccounts.js';
import { getUserByEmail, setPassword, setPlatformRole, type PlatformRole } from './store/users.js';
import { revokeAllSessions } from './store/refreshTokens.js';
import { DEMO_PLATFORM_ACCOUNTS } from './seed.js';
import { DEMO_BODIES } from './bodies/seed.js';
import { addLink, createBody, findLinkOfOrganization, getBody } from './bodies/store.js';
import { MODULES } from '../initiatives/registry.js';
import type { DeploySeedAccount, DeploySeedResult } from '../initiatives/contract.js';

export type { DeploySeedAccount, DeploySeedResult };

/** The directory of bodies: the demo bodies whose organizations exist and are not linked to a body yet. */
async function seedBodies(notes: string[]): Promise<void> {
  const available = new Map<string, Set<string>>();
  for (const m of MODULES) available.set(m.id, new Set((await m.bodies.list()).map((o) => o.id)));
  let added = 0;
  for (const d of DEMO_BODIES) {
    if (await getBody(d.id)) continue;
    const links: Array<[string, string]> = [];
    for (const [initiativeId, orgId] of d.links) {
      if (available.get(initiativeId)?.has(orgId) && !(await findLinkOfOrganization(initiativeId, orgId))) links.push([initiativeId, orgId]);
    }
    if (!links.length) continue;
    const { id, links: _links, ...input } = d;
    try { await createBody({ ...input, contactEmail: '' }, null, id); } catch { notes.push(`platform: body «${d.nameAr}» — a body with that name exists, skipped`); continue; }
    for (const [initiativeId, orgId] of links) await addLink(id, initiativeId, orgId, null);
    added++;
  }
  notes.push(added ? `platform: directory of bodies — ${added} body(ies) added` : 'platform: directory of bodies — nothing to add');
}

export interface DeploySeedReport { accounts: DeploySeedAccount[]; notes: string[] }

/** The one-time «recreate the seeded accounts» (deployment of 2026-11): runs on the first start that finds no marker. */
const RESET_MARKER = 'seed_accounts_reset_v1';

/**
 * Puts every seeded account that already existed back in its first state, once: the seed password with no forced change,
 * active, e-mail verified, its initiative membership active (or its platform role restored), and its open sessions ended.
 * Accounts created by this run are already in that state. Other accounts are never touched.
 */
async function resetSeedAccountsOnce(accounts: DeploySeedAccount[], passwordHash: string, notes: string[]): Promise<void> {
  const db = getDb();
  if (await db.prepare('SELECT 1 AS x FROM meta WHERE `key` = ?').get(RESET_MARKER)) return;
  const now = nowIso();
  let reset = 0;
  for (const a of accounts) {
    if (a.status === 'created') continue;
    const u = await getUserByEmail(a.email);
    if (!u) continue;
    await setPassword(u.id, passwordHash, false);
    await db.prepare('UPDATE users SET isActive = 1, emailVerifiedAt = COALESCE(emailVerifiedAt, ?), updatedAt = ? WHERE id = ?').run(now, now, u.id);
    if (a.initiativeId) {
      await db.prepare("UPDATE initiative_memberships SET status = 'active', updatedAt = ? WHERE userId = ? AND initiativeId = ?").run(now, u.id, a.initiativeId);
    } else {
      await setPlatformRole(u.id, a.role as PlatformRole);
    }
    await revokeAllSessions(u.id);
    a.status = 'reset';
    reset++;
  }
  await db.prepare('INSERT INTO meta (`key`, value) VALUES (?, ?)').run(RESET_MARKER, now);
  notes.push(`seeded accounts: ${reset} existing account(s) reset once to the seed password (active, no forced change, sessions ended)`);
}

export async function seedOnDeploy(password = seedPassword()): Promise<DeploySeedReport> {
  const passwordHash = hashPassword(password);
  return tx(async () => {
    const accounts: DeploySeedAccount[] = [];
    const notes: string[] = [];
    for (const a of DEMO_PLATFORM_ACCOUNTS) {
      const u = await ensureSeedAccount(a, passwordHash, 'platform');
      accounts.push({ email: u.email, initiativeId: null, role: a.platformRole, status: accountStatus(u) });
    }
    for (const m of MODULES) {
      const r = await m.seedDeploy?.(passwordHash);
      if (r) { accounts.push(...r.accounts); notes.push(...r.notes); }
    }
    await resetSeedAccountsOnce(accounts, passwordHash, notes);
    await seedBodies(notes);
    return { accounts, notes };
  });
}

/** Log lines of a run (no password, ever — the seed password is documented in docs/DEPLOY.md). */
export function describeSeedReport(r: DeploySeedReport): string[] {
  const created = r.accounts.filter((a) => a.status === 'created').length;
  const reset = r.accounts.filter((a) => a.status === 'reset').length;
  const disabled = r.accounts.filter((a) => a.status === 'exists_disabled');
  const lines = [`[seed:deploy] ${r.accounts.length} role account(s): ${created} created, ${reset} reset, ${r.accounts.length - created - reset} already there (left untouched)`];
  for (const a of r.accounts) lines.push(`[seed:deploy]   ${a.status.padEnd(15)} ${(a.initiativeId ?? 'platform').padEnd(8)} ${a.role.padEnd(16)} ${a.email}`);
  if (disabled.length) lines.push(`[seed:deploy] ${disabled.length} account(s) exist but are disabled (e.g. demo accounts of the legacy import) — set SEED_EMAIL_DOMAIN to seed working ones on another domain`);
  for (const n of r.notes) lines.push(`[seed:deploy] ${n}`);
  return lines;
}
