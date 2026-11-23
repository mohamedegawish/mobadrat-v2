import { mapSeq } from '../http/helpers.js';
/** إسناد المقيّمين، وإقرار تضارب المصالح، وتسجيل الدرجات وتسليمها (docs/SONA3_DESIGN.md §8). */
import { tx } from '../db/database.js';
import { Errors, type ErrorDetail } from '../http/errors.js';
import { isObj, onlyKeys } from '../http/validate.js';
import type { UserInternal } from '../store/users.js';
import { getUserById } from '../store/users.js';
import { getApplication, type AppRow } from '../store/applications.js';
import { getCohort } from '../store/cohorts.js';
import {
  activeAssignments, allAssignments, assignmentFor, assignmentsOfEvaluator, declareCoi, getAssignment, insertAssignment, removeAssignment, saveScores, submitScores,
  weighted, aggregate, type Assignment,
} from '../store/evaluations.js';
import { addAuditLog } from '../store/audit.js';
import { canSeeApplication } from '../access/visibility.js';
import { dispatch, imcRecipients, baseVars } from '../notifications/notify.js';
import { CRITERIA, CRITERION_KEYS, policy, type CriterionKey } from '../config/initiativePolicy.js';
import { ORG_IDS } from '../domain.js';

const ASSIGNABLE_STATES = ['STUDY_REVIEW', 'COMMITTEE_EVALUATION'];

async function loadForImc(user: UserInternal, appId: string): Promise<AppRow> {
  if (user.role !== 'imc_officer' || user.organizationId !== ORG_IDS.imc) throw Errors.forbidden();
  const app = await getApplication(appId);
  if (!app) throw Errors.notFound('الطلب غير موجود.', 'Application not found.');
  return app;
}

async function audit(user: UserInternal, ip: string, action: string, app: AppRow, summaryAr: string, details: Record<string, unknown> = {}) {
  await addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, actorRole: user.role, actorOrgId: user.organizationId, ip,
    action, entityType: 'application', entityId: app.id, applicationId: app.id, summaryAr, details });
}

export async function assignEvaluator(user: UserInternal, appId: string, body: unknown, ip: string): Promise<Assignment> {
  const app = await loadForImc(user, appId);
  const b = onlyKeys(body, ['evaluatorUserId']);
  if (!ASSIGNABLE_STATES.includes(app.state)) {
    throw Errors.conflict('INVALID_STATE', 'إسناد المقيّمين متاح أثناء مراجعة الدراسة أو التقييم فقط.', 'Evaluators can be assigned only during study review or evaluation.');
  }
  const ev = typeof b.evaluatorUserId === 'string' ? await getUserById(b.evaluatorUserId) : null;
  if (!ev || ev.role !== 'evaluator' || !ev.isActive) throw Errors.validation([{ field: 'evaluatorUserId', issue: 'unknown or inactive evaluator' }]);
  if (await assignmentFor(app.id, ev.id)) throw Errors.conflict('ALREADY_ASSIGNED', 'المقيّم مسند لهذا المشروع بالفعل.', 'The evaluator is already assigned.');
  const a = await tx(async () => {
    const created = await insertAssignment(app.id, ev.id, user.id);
    await audit(user, ip, 'evaluation.assign', app, `إسناد المقيّم ${ev.nameAr}`, { assignmentId: created.id, evaluatorUserId: ev.id });
    await dispatch('app.evaluation_assigned', baseVars(app), [{ userId: ev.id, email: ev.email, phone: ev.phone || undefined }],
      { dedupePrefix: `assign:${created.id}`, applicationId: app.id });
    return created;
  });
  return a;
}

export async function unassignEvaluator(user: UserInternal, appId: string, assignmentId: string, body: unknown, ip: string): Promise<void> {
  const app = await loadForImc(user, appId);
  const b = onlyKeys(body ?? {}, ['reason']);
  const a = await getAssignment(assignmentId);
  if (!a || a.applicationId !== app.id || a.status === 'removed') throw Errors.notFound();
  if (a.status === 'submitted') throw Errors.conflict('ALREADY_SUBMITTED', 'لا يمكن إلغاء إسناد مقيّم سلّم تقييمه.', 'A submitted evaluation cannot be unassigned.');
  if (!ASSIGNABLE_STATES.includes(app.state)) throw Errors.conflict('INVALID_STATE', 'التقييم مغلق.', 'Evaluation is closed.');
  const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
  await tx(async () => {
    await removeAssignment(a.id, user.id, reason);
    await audit(user, ip, 'evaluation.unassign', app, 'إلغاء إسناد مقيّم', { assignmentId: a.id, reason });
  });
}

async function loadForEvaluator(user: UserInternal, appId: string): Promise<{ app: AppRow; a: Assignment }> {
  if (user.role !== 'evaluator') throw Errors.forbidden();
  const app = await getApplication(appId);
  if (!app || !await canSeeApplication(user, app)) throw Errors.notFound('الطلب غير موجود.', 'Application not found.');
  return { app, a: (await assignmentFor(app.id, user.id))! };
}

export async function declareConflict(user: UserInternal, appId: string, body: unknown, ip: string): Promise<Assignment> {
  const { app, a } = await loadForEvaluator(user, appId);
  const b = onlyKeys(body, ['hasConflict', 'note']);
  if (typeof b.hasConflict !== 'boolean') throw Errors.validation([{ field: 'hasConflict', issue: 'must be true or false' }]);
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 1000) : '';
  if (b.hasConflict && note.length < 3) throw Errors.validation([{ field: 'note', issue: 'required when declaring a conflict' }]);
  if (a.status !== 'assigned') throw Errors.conflict('ALREADY_DECLARED', 'سبق تسجيل إقرار تضارب المصالح.', 'The declaration was already recorded.');
  return await tx(async () => {
    await declareCoi(a.id, b.hasConflict as boolean, note);
    await audit(user, ip, b.hasConflict ? 'evaluation.coi_conflict' : 'evaluation.coi_none', app,
      b.hasConflict ? 'إقرار بوجود تضارب مصالح — استبعاد من التقييم' : 'إقرار بعدم وجود تضارب مصالح', { assignmentId: a.id });
    if (b.hasConflict) {
      await dispatch('ops.coi_declared', { ...baseVars(app), evaluatorName: user.nameAr, reason: note }, await imcRecipients(), { dedupePrefix: `coi:${a.id}`, applicationId: app.id, channels: ['email'] });
    }
    return (await getAssignment(a.id))!;
  });
}

interface ScoreInput { scores: Partial<Record<CriterionKey, number>>; notes: Partial<Record<CriterionKey, string>>; recommendation: string }

function parseScores(body: unknown, final: boolean): ScoreInput {
  const b = onlyKeys(body, ['scores', 'notes', 'recommendation']);
  const details: ErrorDetail[] = [];
  const scores: Partial<Record<CriterionKey, number>> = {};
  const notes: Partial<Record<CriterionKey, string>> = {};
  const rawS = isObj(b.scores) ? b.scores : {};
  const rawN = isObj(b.notes) ? b.notes : {};
  if (b.scores !== undefined && !isObj(b.scores)) details.push({ field: 'scores', issue: 'must be an object' });
  for (const k of Object.keys(rawS)) if (!(CRITERION_KEYS as string[]).includes(k)) details.push({ field: `scores.${k}`, issue: 'unknown criterion' });
  for (const k of Object.keys(rawN)) if (!(CRITERION_KEYS as string[]).includes(k)) details.push({ field: `notes.${k}`, issue: 'unknown criterion' });
  for (const k of CRITERION_KEYS) {
    const v = rawS[k];
    if (v === undefined || v === null) { if (final) details.push({ field: `scores.${k}`, issue: 'required' }); }
    else if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100) details.push({ field: `scores.${k}`, issue: 'must be an integer 0..100' });
    else scores[k] = v;
    const n = rawN[k];
    if (typeof n === 'string' && n.trim()) notes[k] = n.trim().slice(0, 2000);
  }
  const rec = typeof b.recommendation === 'string' ? b.recommendation : '';
  if (rec && !policy.recommendations.some((r) => r.value === rec)) details.push({ field: 'recommendation', issue: 'unknown recommendation' });
  if (final && !rec) details.push({ field: 'recommendation', issue: 'required' });
  if (details.length) throw Errors.validation(details);
  return { scores, notes, recommendation: rec };
}

function requireScoring(app: AppRow, a: Assignment): void {
  if (a.status === 'assigned') throw Errors.conflict('COI_REQUIRED', 'سجّل إقرار تضارب المصالح أولًا.', 'Record the conflict-of-interest declaration first.');
  if (a.status === 'conflict') throw Errors.forbidden('استُبعدت من تقييم هذا المشروع لتضارب المصالح.', 'You were excluded for a conflict of interest.');
  if (a.status === 'submitted') throw Errors.conflict('ALREADY_SUBMITTED', 'سُلّم التقييم ولا يمكن تعديله.', 'The evaluation was submitted and cannot be changed.');
  if (app.state !== 'COMMITTEE_EVALUATION') throw Errors.conflict('INVALID_STATE', 'التقييم متاح أثناء مرحلة تقييم اللجنة فقط.', 'Scoring is open only during committee evaluation.');
}

export async function saveEvaluation(user: UserInternal, appId: string, body: unknown, ip: string): Promise<Assignment> {
  const { app, a } = await loadForEvaluator(user, appId);
  requireScoring(app, a);
  const input = parseScores(body, false);
  return await tx(async () => {
    await saveScores(a.id, input.scores, input.notes, input.recommendation);
    await audit(user, ip, 'evaluation.save', app, 'حفظ مسودة تقييم', { assignmentId: a.id });
    return (await getAssignment(a.id))!;
  });
}

export async function submitEvaluation(user: UserInternal, appId: string, body: unknown, ip: string): Promise<Assignment> {
  const { app, a } = await loadForEvaluator(user, appId);
  requireScoring(app, a);
  const input = parseScores(body, true);
  const cohort = (await getCohort(app.cohortId))!;
  const score = weighted(input.scores, cohort.weights);
  return await tx(async () => {
    await saveScores(a.id, input.scores, input.notes, input.recommendation);
    await submitScores(a.id, score);
    await audit(user, ip, 'evaluation.submit', app, `تسليم تقييم (${score})`, { assignmentId: a.id, weightedScore: score });
    const remaining = (await activeAssignments(app.id)).filter((x) => x.status !== 'conflict' && x.status !== 'submitted');
    if (!remaining.length) {
      await dispatch('ops.evaluations_complete', { ...baseVars(app), count: (await activeAssignments(app.id)).filter((x) => x.status === 'submitted').length },
        await imcRecipients(), { dedupePrefix: `evaldone:${app.id}:${a.id}`, applicationId: app.id, channels: ['email'] });
    }
    return (await getAssignment(a.id))!;
  });
}

const STATUS_LABELS: Record<Assignment['status'], { ar: string; en: string }> = {
  assigned: { ar: 'بانتظار إقرار تضارب المصالح', en: 'Awaiting COI declaration' },
  draft: { ar: 'جارٍ التقييم', en: 'In progress' },
  submitted: { ar: 'سُلّم', en: 'Submitted' },
  conflict: { ar: 'مستبعد — تضارب مصالح', en: 'Excluded — conflict' },
  removed: { ar: 'أُلغي الإسناد', en: 'Removed' },
};

async function mapAssignment(a: Assignment, withScores: boolean) {
  const ev = await getUserById(a.evaluatorUserId);
  return {
    id: a.id, evaluatorUserId: a.evaluatorUserId, evaluatorName: ev?.nameAr ?? '', status: a.status,
    statusLabelAr: STATUS_LABELS[a.status].ar, statusLabelEn: STATUS_LABELS[a.status].en, assignedAt: a.assignedAt,
    coiDeclaredAt: a.coiDeclaredAt, coiNote: a.coiNote, submittedAt: a.submittedAt,
    ...(withScores ? { scores: a.scores, notes: a.notes, recommendation: a.recommendation, weightedScore: a.weightedScore } : {}),
  };
}

/** كتلة التقييم في تفاصيل الطلب — حسب الدور (المقيّم يرى تقييمه فقط؛ IMC يرى الكل). */
export async function evaluationBlock(user: UserInternal, app: AppRow) {
  const cohort = await getCohort(app.cohortId);
  const criteria = CRITERIA.map((c) => ({ ...c, weight: cohort?.weights[c.key] ?? 0 }));
  if (user.role === 'imc_officer') {
    const list = (await allAssignments(app.id)).filter((a) => a.status !== 'removed');
    const agg = aggregate(list);
    return {
      criteria, assignments: await mapSeq(list, async (a) => await mapAssignment(a, a.status === 'submitted')), aggregate: agg,
      minimums: cohort ? { total: cohort.minTotalScore, financial: cohort.minFinancialScore, technical: cohort.minTechnicalScore, evaluators: cohort.minEvaluators } : null,
      canAssign: ASSIGNABLE_STATES.includes(app.state),
    };
  }
  if (user.role === 'evaluator') {
    const a = await assignmentFor(app.id, user.id);
    return { criteria, recommendations: policy.recommendations, mine: a ? await mapAssignment(a, true) : null, canScore: Boolean(a && (a.status === 'draft') && app.state === 'COMMITTEE_EVALUATION') };
  }
  return null;
}

/** قائمة عمل المقيّم: إسناداته مع حالة كل منها. */
export async function evaluatorQueue(user: UserInternal) {
  if (user.role !== 'evaluator') throw Errors.forbidden();
  return mapSeq(await assignmentsOfEvaluator(user.id), async (a) => {
    const app = await getApplication(a.applicationId);
    return { ...await mapAssignment(a, false), applicationId: a.applicationId, number: app?.number ?? null, projectName: app?.projectName ?? '', sector: app?.sector ?? '', appState: app?.state ?? null };
  });
}
