/**
 * Deploy seeder — SEED_ON_DEPLOY=1 (every boot) or `npm run db:seed:deploy:prod` (once): one account for every role of the
 * platform and of every initiative, plus the demo data those accounts need to work (a demo factory, applicant, funder,
 * and — only where the initiative has none of its own — banks, service providers, an open cohort, experts).
 *
 * Safe on a production database, including one with real (imported) data:
 *   • it creates only what is missing and never changes an existing account (password, role, status) or existing data;
 *   • every account it creates must replace the shared SEED_PASSWORD at its first sign-in (mustChangePassword);
 *   • reference data that real people choose from is added only when the initiative has none — next to real banks,
 *     providers, cohorts and experts the demo accounts use the real ones, and real users never see demo entries;
 *   • SEED_EMAIL_DOMAIN moves the accounts to another domain (imc1@shams.local → imc1.shams@<domain>), e.g. after the legacy
 *     import, whose old demo accounts (@shams.local, @sona3.local) arrive disabled;
 *   • it runs in one write transaction (write transactions are serialised across instances), so two instances starting at
 *     the same time cannot create an account twice.
 * The legacy import needs an empty database: keep SEED_ON_DEPLOY=0 until the import has finished (docs/DEPLOY.md).
 */
import { seedPassword } from '../config.js';
import { tx } from './db/index.js';
import { hashPassword } from './auth/jwt.js';
import { accountStatus, ensureSeedAccount } from './seedAccounts.js';
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
    await seedBodies(notes);
    return { accounts, notes };
  });
}

/** Log lines of a run (no password, ever). */
export function describeSeedReport(r: DeploySeedReport): string[] {
  const created = r.accounts.filter((a) => a.status === 'created').length;
  const disabled = r.accounts.filter((a) => a.status === 'exists_disabled');
  const lines = [`[seed:deploy] ${r.accounts.length} role account(s): ${created} created, ${r.accounts.length - created} already there (left untouched)`
    + (created ? ' — sign in with SEED_PASSWORD, then each account sets its own password' : '')];
  for (const a of r.accounts) lines.push(`[seed:deploy]   ${a.status.padEnd(15)} ${(a.initiativeId ?? 'platform').padEnd(8)} ${a.role.padEnd(16)} ${a.email}`);
  if (disabled.length) lines.push(`[seed:deploy] ${disabled.length} account(s) exist but are disabled (e.g. demo accounts of the legacy import) — set SEED_EMAIL_DOMAIN to seed working ones on another domain`);
  for (const n of r.notes) lines.push(`[seed:deploy] ${n}`);
  return lines;
}
