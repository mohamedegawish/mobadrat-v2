/** دورات التقديم: القراءة لكل الأدوار المصادق عليها، والإدارة (إنشاء/تعديل/أوزان) للأدمن فقط (docs/SONA3_DESIGN.md §3). */
import { Router } from 'express';
import { ah, okMessage, Errors } from '../http/errors.js';
import { onlyKeys } from '../http/validate.js';
import { requireRole } from '../middleware/auth.js';
import { actorFromReq, addAuditLog } from '../store/audit.js';
import {
  cohortStatus, createCohort, getCohort, listCohorts, updateCohort, weightsLocked, type Cohort, type CohortInput,
} from '../store/cohorts.js';
import { getDb } from '../db/sqlite.js';
import { CRITERIA, CRITERION_KEYS, type CriterionKey } from '../config/initiativePolicy.js';
import { tx } from '../db/sqlite.js';

export const cohortsRouter = Router();

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const COHORT_KEYS = ['nameAr', 'nameEn', 'opensAt', 'closesAt', 'evaluationTarget', 'selectionTarget', 'maxAge', 'ageReference',
  'weights', 'minTotalScore', 'minFinancialScore', 'minTechnicalScore', 'minEvaluators'] as const;

function present(c: Cohort) {
  const counts = getDb().prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN state <> 'DRAFT' THEN 1 ELSE 0 END) AS submitted
    FROM applications WHERE cohortId = ?`).get(c.id) as { total: number; submitted: number | null };
  return {
    ...c, status: cohortStatus(c), weightsLocked: weightsLocked(c.id),
    weightsTotal: CRITERION_KEYS.reduce((s, k) => s + c.weights[k], 0),
    applications: { total: counts.total, submitted: counts.submitted ?? 0 },
  };
}

/** يتحقق من أوزان المعايير الستة: أرقام ≥ 0، كل المفاتيح موجودة، ومجموعها 100 بالضبط. */
export function cleanWeights(raw: unknown): Record<CriterionKey, number> {
  const details: Array<{ field: string; issue: string }> = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Errors.validation([{ field: 'weights', issue: 'must be an object' }]);
  const obj = raw as Record<string, unknown>;
  const out = {} as Record<CriterionKey, number>;
  for (const k of Object.keys(obj)) if (!(CRITERION_KEYS as string[]).includes(k)) details.push({ field: `weights.${k}`, issue: 'unknown criterion' });
  for (const k of CRITERION_KEYS) {
    const v = obj[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) details.push({ field: `weights.${k}`, issue: 'number 0..100 required' });
    else out[k] = v;
  }
  if (!details.length) {
    const total = CRITERION_KEYS.reduce((s, k) => s + out[k], 0);
    if (Math.abs(total - 100) > 1e-9) details.push({ field: 'weights', issue: `must sum to 100 (got ${total})` });
  }
  if (details.length) throw Errors.validation(details, 'أوزان المعايير يجب أن تكون أرقامًا مجموعها 100.', 'Criteria weights must sum to 100.');
  return out;
}

function cleanCohort(body: unknown, creating: boolean, current?: Cohort): CohortInput {
  const b = onlyKeys(body, COHORT_KEYS);
  const d: Array<{ field: string; issue: string }> = [];
  const out: Partial<CohortInput> = {};
  const text = (k: 'nameAr' | 'nameEn', min: number) => {
    const v = b[k];
    if (v === undefined) { if (creating && k === 'nameAr') d.push({ field: k, issue: 'required' }); return; }
    if (typeof v !== 'string' || v.trim().length < min || v.trim().length > 200) d.push({ field: k, issue: `string ${min}..200` });
    else out[k] = v.trim();
  };
  text('nameAr', 2); text('nameEn', 0);
  for (const k of ['opensAt', 'closesAt'] as const) {
    const v = b[k];
    if (v === undefined) { if (creating) d.push({ field: k, issue: 'required' }); continue; }
    if (typeof v !== 'string' || !ISO_DAY.test(v) || Number.isNaN(Date.parse(v))) d.push({ field: k, issue: 'YYYY-MM-DD' });
    else out[k] = v;
  }
  const int = (k: 'evaluationTarget' | 'selectionTarget' | 'maxAge' | 'minEvaluators', lo: number, hi: number) => {
    const v = b[k];
    if (v === undefined) return;
    if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) d.push({ field: k, issue: `integer ${lo}..${hi}` });
    else out[k] = v as number;
  };
  int('evaluationTarget', 1, 100000); int('selectionTarget', 1, 100000); int('maxAge', 16, 100); int('minEvaluators', 1, 20);
  for (const k of ['minTotalScore', 'minFinancialScore', 'minTechnicalScore'] as const) {
    const v = b[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) d.push({ field: k, issue: 'number 0..100' });
    else out[k] = v;
  }
  if (b.ageReference !== undefined) {
    if (b.ageReference !== 'cohort_close' && b.ageReference !== 'submission') d.push({ field: 'ageReference', issue: 'cohort_close | submission' });
    else out.ageReference = b.ageReference;
  }
  if (d.length) throw Errors.validation(d);
  if (b.weights !== undefined) out.weights = cleanWeights(b.weights);
  const opens = out.opensAt ?? current?.opensAt;
  const closes = out.closesAt ?? current?.closesAt;
  if (opens && closes && closes < opens) throw Errors.validation([{ field: 'closesAt', issue: 'must be on or after opensAt' }]);
  const sel = out.selectionTarget ?? current?.selectionTarget;
  const ev = out.evaluationTarget ?? current?.evaluationTarget;
  if (sel !== undefined && ev !== undefined && sel > ev) throw Errors.validation([{ field: 'selectionTarget', issue: 'must not exceed evaluationTarget' }]);
  return out as CohortInput;
}

function weightsChanged(a: Record<CriterionKey, number>, b: Record<CriterionKey, number>): boolean {
  return CRITERION_KEYS.some((k) => a[k] !== b[k]);
}

const lockedError = () => Errors.conflict('WEIGHTS_LOCKED',
  'لا يمكن تعديل الأوزان بعد تسليم أول تقييم في الدورة.', 'Weights are locked once the first evaluation has been submitted in this cohort.');

// ── قراءة (أي مستخدم مصادق): قائمة الدورات ──
cohortsRouter.get('/cohorts', ah((_req, res) => okMessage(res, 200, 'ok', {
  items: listCohorts().map((c) => ({ id: c.id, nameAr: c.nameAr, nameEn: c.nameEn, opensAt: c.opensAt, closesAt: c.closesAt, status: cohortStatus(c), maxAge: c.maxAge })),
  criteria: CRITERIA,
})));

// ── إدارة (الأدمن) ──
cohortsRouter.get('/admin/cohorts', requireRole('system_admin'), ah((_req, res) => okMessage(res, 200, 'ok', { items: listCohorts().map(present), criteria: CRITERIA })));

cohortsRouter.get('/admin/cohorts/:id', requireRole('system_admin'), ah((req, res) => {
  const c = getCohort(req.params.id);
  if (!c) throw Errors.notFound();
  return okMessage(res, 200, 'ok', present(c));
}));

cohortsRouter.post('/admin/cohorts', requireRole('system_admin'), ah((req, res) => {
  const input = cleanCohort(req.body, true);
  const actor = actorFromReq(req);
  const c = tx(() => {
    const created = createCohort(input, actor.actorUserId ?? null);
    addAuditLog({ ...actor, action: 'cohort.create', entityType: 'cohort', entityId: created.id, summaryAr: `إنشاء دورة تقديم: ${created.nameAr}`, details: { weights: created.weights } });
    return created;
  });
  return okMessage(res, 201, 'تم إنشاء الدورة.', present(c));
}));

cohortsRouter.put('/admin/cohorts/:id', requireRole('system_admin'), ah((req, res) => {
  const cur = getCohort(req.params.id);
  if (!cur) throw Errors.notFound();
  const patch = cleanCohort(req.body, false, cur);
  if (patch.weights && weightsChanged(patch.weights, cur.weights) && weightsLocked(cur.id)) throw lockedError();
  const actor = actorFromReq(req);
  const c = tx(() => {
    const updated = updateCohort(cur.id, patch)!;
    addAuditLog({ ...actor, action: 'cohort.update', entityType: 'cohort', entityId: cur.id, summaryAr: `تعديل دورة تقديم: ${updated.nameAr}`, details: { before: cur, after: updated } });
    return updated;
  });
  return okMessage(res, 200, 'تم الحفظ.', present(c));
}));

/** أوزان المعايير فقط: مجموعها 100، وتُقفل بمجرد تسليم أول تقييم في الدورة. */
cohortsRouter.put('/admin/cohorts/:id/weights', requireRole('system_admin'), ah((req, res) => {
  const cur = getCohort(req.params.id);
  if (!cur) throw Errors.notFound();
  const weights = cleanWeights(onlyKeys(req.body, ['weights']).weights);
  if (weightsChanged(weights, cur.weights) && weightsLocked(cur.id)) throw lockedError();
  const actor = actorFromReq(req);
  const c = tx(() => {
    const updated = updateCohort(cur.id, { weights })!;
    addAuditLog({ ...actor, action: 'cohort.weights', entityType: 'cohort', entityId: cur.id, summaryAr: `تعديل أوزان معايير الدورة: ${updated.nameAr}`, details: { before: cur.weights, after: weights } });
    return updated;
  });
  return okMessage(res, 200, 'تم حفظ الأوزان.', present(c));
}));
