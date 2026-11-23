/**
 * Sona'a El-Mostaqbal's participating bodies for the platform's unified directory: every organization except applicants.
 * Activity per organization:
 *   staff     active accounts with an active Sona3 membership in it
 *   decisions workflow transitions taken by its staff (sona3_application_transitions.actorOrgId) plus, for the evaluation
 *             committee, the evaluations its members submitted
 *   pending   IMC: open applications in a state where IMC has an action; committee: evaluations assigned to its members
 *             and not submitted yet; funder: applications referred to this funder and awaiting its decision
 */
import { getDb } from './db/database.js';
import { MODULE_ID } from './config.js';
import { TRANSITIONS } from './workflow/workflow.js';
import type { BodyActivity, InitiativeBodies, ModuleBody } from '../contract.js';

const TYPE_LABELS: Record<string, { ar: string; en: string }> = {
  imc: { ar: 'فريق إدارة المبادرة — IMC', en: 'Initiative team — IMC' },
  committee: { ar: 'لجنة التقييم', en: 'Evaluation committee' },
  funder: { ar: 'جهة تمويل', en: 'Funder' },
  admin: { ar: 'إدارة النظام', en: 'System administration' },
};
const BODY_TYPES = Object.keys(TYPE_LABELS);

const IMC_STATES = [...new Set(TRANSITIONS.filter((t) => t.actorRole === 'imc_officer' && t.from !== 'ANY_BEFORE_FUNDING').map((t) => String(t.from)))];
const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');

export const sona3Bodies: InitiativeBodies = {
  async list(): Promise<ModuleBody[]> {
    const rows = await getDb().prepare(`SELECT id, type, nameAr, nameEn, isActive FROM sona3_organizations WHERE type IN (${marks(BODY_TYPES.length)}) ORDER BY type, nameAr`)
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
    const orgs = await db.prepare(`SELECT id, type FROM sona3_organizations WHERE id IN (${marks(ids.length)}) AND type IN (${marks(BODY_TYPES.length)})`)
      .all(...ids, ...BODY_TYPES) as Array<{ id: string; type: string }>;
    if (!orgs.length) return {};
    const found = orgs.map((o) => o.id);
    const staff = new Map((await db.prepare(`SELECT m.organizationId AS id, COUNT(*) AS n FROM initiative_memberships m JOIN users u ON u.id = m.userId
      WHERE m.initiativeId = ? AND m.status = 'active' AND u.isActive = 1 AND m.organizationId IN (${marks(found.length)}) GROUP BY m.organizationId`)
      .all(MODULE_ID, ...found) as Array<{ id: string; n: number }>).map((r) => [r.id, Number(r.n)]));
    const transitions = new Map((await db.prepare(`SELECT actorOrgId AS id, COUNT(*) AS n, MAX(createdAt) AS lastAt FROM sona3_application_transitions
      WHERE actorOrgId IN (${marks(found.length)}) GROUP BY actorOrgId`).all(...found) as Array<{ id: string; n: number; lastAt: string | null }>)
      .map((r) => [r.id, { n: Number(r.n), lastAt: r.lastAt }]));
    // Evaluations: submitted ones are decisions of the committee, assigned/draft ones are its pending work.
    const evaluations = new Map((await db.prepare(`SELECT m.organizationId AS id,
        SUM(CASE WHEN ea.status = 'submitted' THEN 1 ELSE 0 END) AS submitted,
        SUM(CASE WHEN ea.status IN ('assigned', 'draft') THEN 1 ELSE 0 END) AS open,
        MAX(ea.submittedAt) AS lastAt
      FROM sona3_evaluator_assignments ea JOIN initiative_memberships m ON m.userId = ea.evaluatorUserId AND m.initiativeId = ?
      WHERE m.organizationId IN (${marks(found.length)}) GROUP BY m.organizationId`).all(MODULE_ID, ...found) as Array<{ id: string; submitted: number; open: number; lastAt: string | null }>)
      .map((r) => [r.id, { submitted: Number(r.submitted ?? 0), open: Number(r.open ?? 0), lastAt: r.lastAt }]));
    const imcPending = IMC_STATES.length
      ? Number((await db.prepare(`SELECT COUNT(*) AS n FROM sona3_applications WHERE state IN (${marks(IMC_STATES.length)})`).get(...IMC_STATES) as { n: number }).n)
      : 0;
    const funderPending = new Map((await db.prepare(`SELECT funderOrgId AS id, COUNT(*) AS n FROM sona3_applications
      WHERE state = 'FUNDER_REVIEW' AND funderOrgId IN (${marks(found.length)}) GROUP BY funderOrgId`).all(...found) as Array<{ id: string; n: number }>)
      .map((r) => [r.id, Number(r.n)]));

    const out: Record<string, BodyActivity> = {};
    for (const o of orgs) {
      const t = transitions.get(o.id);
      const e = evaluations.get(o.id);
      const last = [t?.lastAt, e?.lastAt].filter((x): x is string => Boolean(x)).sort().pop() ?? null;
      const pending = o.type === 'imc' ? imcPending : o.type === 'committee' ? e?.open ?? 0 : o.type === 'funder' ? funderPending.get(o.id) ?? 0 : 0;
      out[o.id] = { staff: staff.get(o.id) ?? 0, decisions: (t?.n ?? 0) + (o.type === 'committee' ? e?.submitted ?? 0 : 0), pending, lastActivityAt: last };
    }
    return out;
  },
};
