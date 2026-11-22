/**
 * Shams El-Senaa's participating bodies for the platform's unified directory: every organization except factories (the
 * applicants). Activity per organization:
 *   staff     active accounts with an active Shams membership in it
 *   decisions workflow transitions taken by its staff (shams_application_transitions.actorOrgId)
 *   pending   open applications in a state where its role has an action (IMC, ENCPC, PMU; banks have no account — G-02)
 */
import { getDb } from './db/sqlite.js';
import { MODULE_ID } from './config.js';
import { TRANSITIONS } from './workflow/shamsWorkflow.js';
import type { BodyActivity, InitiativeBodies, ModuleBody } from '../contract.js';

const TYPE_LABELS: Record<string, { ar: string; en: string }> = {
  imc: { ar: 'مراجعة الطلبات — IMC', en: 'Application review — IMC' },
  encpc: { ar: 'المراجعة الفنية — ENCPC', en: 'Technical review — ENCPC' },
  pmu: { ar: 'وحدة إدارة المبادرة — PMU', en: 'Initiative management unit — PMU' },
  bank: { ar: 'بنك (مسار التمويل البنكي)', en: 'Bank (bank financing path)' },
  admin: { ar: 'إدارة النظام', en: 'System administration' },
};
const BODY_TYPES = Object.keys(TYPE_LABELS);
/** The role of each body type in the workflow (types without one never have applications waiting for them). */
const ROLE_OF_TYPE: Record<string, string> = { imc: 'imc_reviewer', encpc: 'encpc_reviewer', pmu: 'pmu_reviewer' };

function statesAwaiting(role: string): string[] {
  return [...new Set(TRANSITIONS.filter((t) => t.actorRole === role && t.from !== 'ANY_NON_TERMINAL').map((t) => String(t.from)))];
}

const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');

export const shamsBodies: InitiativeBodies = {
  async list(): Promise<ModuleBody[]> {
    const rows = await getDb().prepare(`SELECT id, type, nameAr, nameEn, isActive FROM shams_organizations WHERE type IN (${marks(BODY_TYPES.length)}) ORDER BY type, nameAr`)
      .all(...BODY_TYPES) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id), type: String(r.type), typeLabelAr: TYPE_LABELS[String(r.type)].ar, typeLabelEn: TYPE_LABELS[String(r.type)].en,
      nameAr: String(r.nameAr), nameEn: String(r.nameEn), isActive: Number(r.isActive) === 1,
    }));
  },

  async activity(orgIds: string[]): Promise<Record<string, BodyActivity>> {
    const ids = [...new Set(orgIds)].filter(Boolean);
    if (!ids.length) return {};
    const db = getDb();
    const orgs = await db.prepare(`SELECT id, type FROM shams_organizations WHERE id IN (${marks(ids.length)}) AND type IN (${marks(BODY_TYPES.length)})`)
      .all(...ids, ...BODY_TYPES) as Array<{ id: string; type: string }>;
    if (!orgs.length) return {};
    const found = orgs.map((o) => o.id);
    const staff = new Map((await db.prepare(`SELECT m.organizationId AS id, COUNT(*) AS n FROM initiative_memberships m JOIN users u ON u.id = m.userId
      WHERE m.initiativeId = ? AND m.status = 'active' AND u.isActive = 1 AND m.organizationId IN (${marks(found.length)}) GROUP BY m.organizationId`)
      .all(MODULE_ID, ...found) as Array<{ id: string; n: number }>).map((r) => [r.id, Number(r.n)]));
    const decisions = new Map((await db.prepare(`SELECT actorOrgId AS id, COUNT(*) AS n, MAX(createdAt) AS lastAt FROM shams_application_transitions
      WHERE actorOrgId IN (${marks(found.length)}) GROUP BY actorOrgId`).all(...found) as Array<{ id: string; n: number; lastAt: string | null }>)
      .map((r) => [r.id, { n: Number(r.n), lastAt: r.lastAt }]));
    const pendingByType = new Map<string, number>();
    for (const type of new Set(orgs.map((o) => o.type))) {
      const role = ROLE_OF_TYPE[type];
      const states = role ? statesAwaiting(role) : [];
      pendingByType.set(type, states.length
        ? Number((await db.prepare(`SELECT COUNT(*) AS n FROM shams_applications WHERE state IN (${marks(states.length)})`).get(...states) as { n: number }).n)
        : 0);
    }
    const out: Record<string, BodyActivity> = {};
    for (const o of orgs) {
      const d = decisions.get(o.id);
      out[o.id] = { staff: staff.get(o.id) ?? 0, decisions: d?.n ?? 0, pending: pendingByType.get(o.type) ?? 0, lastActivityAt: d?.lastAt ?? null };
    }
    return out;
  },
};
