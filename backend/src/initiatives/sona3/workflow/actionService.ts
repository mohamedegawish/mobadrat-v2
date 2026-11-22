/**
 * تنفيذ الإجراءات على الطلب. كل انتقال: تحقق ← معاملة واحدة (الحالة + السجل التاريخي + النواقص + التدقيق
 * + outbox الإشعارات + outbox الـwebhook) مع expectedVersion. لا انتقال خارج TRANSITIONS.
 */
import { randomUUID } from 'node:crypto';
import { tx, nowIso, getDb } from '../db/sqlite.js';
import { AppError, Errors, type ErrorDetail } from '../http/errors.js';
import { isIsoDate, isObj, onlyKeys, type Obj } from '../http/validate.js';
import type { UserInternal } from '../store/users.js';
import {
  getApplication, getSection, writeSection, insertTransition, insertDeficiency, openDeficiencies, resolveDeficiencies,
  nextApplicationNumber, findOpenSubmittedByNationalId, cohortRanking, countCohortEntered, type AppRow,
} from '../store/applications.js';
import { countActiveByKind, activeDocsAt } from '../store/documents.js';
import { getCohort, cohortStatus, today } from '../store/cohorts.js';
import { activeAssignments, aggregate, setApplicationScore } from '../store/evaluations.js';
import { insertReferral, pendingReferral, decideReferral, insertMilestones, listReferrals, type FinancingModel } from '../store/lifecycle.js';
import { getOrganization, activeStaffCount } from '../store/organizations.js';
import { addAuditLog } from '../store/audit.js';
import { enqueueWebhook } from '../store/outbox.js';
import { canSeeApplication } from '../access/visibility.js';
import { notifyTransition } from '../notifications/notify.js';
import { policy } from '../config/initiativePolicy.js';
import { config } from '../config.js';
import {
  ACTIONS, TRANSITIONS, transitionsFrom, actorOwnsRow, isTerminal, STATE_LABELS,
  type ActionName, type ApplicationState,
} from './workflow.js';
import { APPLICATION_SECTIONS, STUDY_SECTIONS, deficiencyFieldsOf, type FormSection } from './applicationForm.js';
import { completenessIssues, studyTotals, type FormData } from './validate.js';
import { ageOn } from './nationalId.js';
import { deficiencyLabels } from './applicationView.js';

interface Deficiency { field: string; note: string }
interface MilestoneInput { title: string; dueDate: string | null; amount: number }

interface Payload {
  expectedVersion: number;
  reason?: string;
  note?: string;
  deficiencies?: Deficiency[];
  approvalDate?: string;
  approvalReference?: string;
  funderOrgId?: string;
  amount?: number;
  model?: FinancingModel;
  terms?: string;
  milestones?: MilestoneInput[];
}

const ACTION_FIELDS: Record<ActionName, string[]> = {
  submit: [],
  resubmit: ['note'],
  accept: ['note'],
  request_correction: ['deficiencies', 'reason'],
  reject: ['reason'],
  submit_study: ['note'],
  complete_evaluation: ['note'],
  select: ['reason'],
  not_select: ['reason'],
  record_approval: ['approvalDate', 'approvalReference', 'note'],
  record_not_approved: ['reason'],
  refer_funder: ['funderOrgId', 'note'],
  close_unfunded: ['reason'],
  approve_funding: ['amount', 'model', 'terms', 'milestones'],
  decline_funding: ['reason'],
  start_operation: ['note'],
  complete: ['note'],
  withdraw: ['reason'],
  reopen: [],
};

/** أفعال المتقدم التي يرسل فيها بيانات/مستندات جديدة → تزيد رقم المحاولة. */
function bumpsAttempt(action: ActionName): boolean {
  return action === 'submit' || action === 'resubmit' || action === 'submit_study';
}

function text(v: unknown, field: string, details: ErrorDetail[], opts: { required?: boolean; min?: number; max?: number }): string | undefined {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
    if (opts.required) details.push({ field, issue: 'required' });
    return undefined;
  }
  if (typeof v !== 'string') { details.push({ field, issue: 'must be a string' }); return undefined; }
  const t = v.trim();
  if (opts.min && t.length < opts.min) details.push({ field, issue: `min length ${opts.min}` });
  if (t.length > (opts.max ?? 2000)) details.push({ field, issue: `max length ${opts.max ?? 2000}` });
  return t;
}

function parseDeficiencies(raw: unknown, allowed: Set<string>, details: ErrorDetail[]): Deficiency[] {
  if (!Array.isArray(raw) || raw.length === 0) { details.push({ field: 'deficiencies', issue: 'required (non-empty list of { field, note })' }); return []; }
  if (raw.length > 60) { details.push({ field: 'deficiencies', issue: 'max 60 items' }); return []; }
  const out: Deficiency[] = [];
  const seen = new Set<string>();
  raw.forEach((d, i) => {
    if (!isObj(d) || Object.keys(d).some((k) => k !== 'field' && k !== 'note')) { details.push({ field: `deficiencies[${i}]`, issue: 'must be { field, note }' }); return; }
    const field = typeof d.field === 'string' ? d.field : '';
    if (!allowed.has(field)) { details.push({ field: `deficiencies[${i}].field`, issue: 'unknown field' }); return; }
    const note = text(d.note, `deficiencies[${i}].note`, details, { required: true, max: 1000 });
    if (seen.has(field)) return;
    seen.add(field);
    out.push({ field, note: note ?? '' });
  });
  return out;
}

function parseMilestones(raw: unknown, details: ErrorDetail[]): MilestoneInput[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > policy.study.maxPlanRows) {
    details.push({ field: 'milestones', issue: `must be a list of 1..${policy.study.maxPlanRows} { title, dueDate?, amount }` });
    return undefined;
  }
  return raw.map((m, i) => {
    if (!isObj(m) || Object.keys(m).some((k) => !['title', 'dueDate', 'amount'].includes(k))) { details.push({ field: `milestones[${i}]`, issue: 'must be { title, dueDate?, amount }' }); return { title: '', dueDate: null, amount: 0 }; }
    const title = text(m.title, `milestones[${i}].title`, details, { required: true, max: 200 }) ?? '';
    const dueDate = m.dueDate === undefined || m.dueDate === null || m.dueDate === '' ? null : (isIsoDate(m.dueDate) ? m.dueDate : (details.push({ field: `milestones[${i}].dueDate`, issue: 'must be YYYY-MM-DD' }), null));
    const amount = typeof m.amount === 'number' && Number.isFinite(m.amount) && m.amount >= 0 ? m.amount : (details.push({ field: `milestones[${i}].amount`, issue: 'must be a non-negative number' }), 0);
    return { title, dueDate, amount };
  });
}

function parsePayload(action: ActionName, from: ApplicationState, body: unknown, requiresReason: boolean): Payload {
  const allowed = ['expectedVersion', ...ACTION_FIELDS[action]];
  const b: Obj = onlyKeys(body ?? {}, allowed);
  const details: ErrorDetail[] = [];
  const ev = b.expectedVersion;
  if (typeof ev !== 'number' || !Number.isInteger(ev) || ev < 1) details.push({ field: 'expectedVersion', issue: 'required integer' });
  const p: Payload = { expectedVersion: Number(ev) };

  if (ACTION_FIELDS[action].includes('reason')) p.reason = text(b.reason, 'reason', details, { required: requiresReason, min: requiresReason ? 3 : undefined });
  if (ACTION_FIELDS[action].includes('note')) p.note = text(b.note, 'note', details, { max: 2000 });
  if (action === 'request_correction') {
    p.deficiencies = parseDeficiencies(b.deficiencies, deficiencyFieldsOf(from === 'STUDY_REVIEW' ? 'study' : 'application'), details);
  }
  if (action === 'record_approval') {
    if (!isIsoDate(b.approvalDate)) details.push({ field: 'approvalDate', issue: 'required date YYYY-MM-DD' }); else p.approvalDate = b.approvalDate;
    p.approvalReference = text(b.approvalReference, 'approvalReference', details, { required: true, min: 2, max: 200 });
  }
  if (action === 'refer_funder') p.funderOrgId = text(b.funderOrgId, 'funderOrgId', details, { required: true, max: 100 });
  if (action === 'approve_funding') {
    const amt = typeof b.amount === 'number' ? b.amount : NaN;
    if (!Number.isFinite(amt) || amt <= 0 || amt > 1e12) details.push({ field: 'amount', issue: 'required positive number (EGP)' }); else p.amount = amt;
    if (!policy.financingModels.some((m) => m.value === b.model)) details.push({ field: 'model', issue: `must be one of ${policy.financingModels.map((m) => m.value).join(', ')}` });
    else p.model = b.model as FinancingModel;
    p.terms = text(b.terms, 'terms', details, { required: true, min: 3, max: 4000 });
    p.milestones = parseMilestones(b.milestones, details);
  }
  if (details.length) throw Errors.validation(details);
  return p;
}

/** يجمع آخر نسخة من أقسام الفورم (بما فيها غير المُرسل) — أساس فحص الاكتمال. */
export async function pendingFormData(appId: string, sections: readonly FormSection[]): Promise<FormData> {
  const data: FormData = {};
  for (const s of sections) data[s] = await getSection(appId, s) ?? {};
  return data;
}

function versionConflict(): AppError {
  return Errors.conflict('VERSION_CONFLICT', 'تم تحديث الطلب بواسطة مستخدم آخر — أعد تحميل الصفحة.', 'The application was updated by someone else. Reload and try again.');
}

function mapUniqueError(e: unknown): never {
  const msg = (e as Error)?.message ?? '';
  if (msg.includes('applications.nationalId')) {
    throw Errors.conflict('DUPLICATE_NATIONAL_ID', 'يوجد طلب مفتوح آخر بنفس الرقم القومي.', 'Another open application uses this national ID.');
  }
  if (msg.includes('applications.applicantId')) {
    throw Errors.conflict('OPEN_APPLICATION_EXISTS', 'لدى المتقدم طلب مفتوح بالفعل.', 'The applicant already has an open application.');
  }
  throw e;
}

/** هل يوجد مشروع أعلى درجة مستوفٍ للحدود ولم يُبت فيه بعد؟ (الاختيار خارج الترتيب يحتاج سببًا ★). */
export async function isOutOfRank(app: AppRow): Promise<boolean> {
  return (await cohortRanking(app.cohortId, ['EVALUATED'])).some((o) => o.id !== app.id && o.passedMinimums === true && (o.score ?? 0) > (app.score ?? 0));
}

/** عدد المختارين في الدورة (كل من دخل SELECTED). */
export async function selectedCount(cohortId: string): Promise<number> {
  return await countCohortEntered(cohortId, 'SELECTED');
}

/** مراحل الصرف الافتراضية من خطة التنفيذ في الدراسة: المواعيد تراكمية بالأسابيع من اليوم. */
async function milestonesFromPlan(appId: string, attempt: number): Promise<MilestoneInput[]> {
  const phases = ((await getSection(appId, 'study_plan', attempt))?.phases ?? []) as Array<{ title?: string; weeks?: number; amount?: number }>;
  let at = Date.now();
  return phases.map((ph) => {
    at += (Number(ph.weeks) || 0) * 7 * 86_400_000;
    return { title: String(ph.title ?? ''), dueDate: new Date(at).toISOString().slice(0, 10), amount: Number(ph.amount) || 0 };
  });
}

export interface ActionContext { ip: string }

export async function performAction(user: UserInternal, appId: string, actionRaw: string, body: unknown, ctx: ActionContext): Promise<AppRow> {
  if (!(ACTIONS as readonly string[]).includes(actionRaw) || actionRaw === 'reopen') throw Errors.notFound('الإجراء غير معروف.', 'Unknown action.');
  const action = actionRaw as ActionName;
  const app = await getApplication(appId);
  if (!app || !await canSeeApplication(user, app)) throw Errors.notFound('الطلب غير موجود.', 'Application not found.');
  const sentVersion = isObj(body) ? body.expectedVersion : undefined;
  if (typeof sentVersion === 'number' && sentVersion !== app.version && !isTerminal(app.state)) throw versionConflict();

  if (isTerminal(app.state)) {
    throw Errors.conflict('INVALID_STATE', 'الطلب في حالة نهائية ولا يقبل أي إجراء.', 'The application is in a final state and accepts no actions.');
  }
  const defs = transitionsFrom(app.state, action);
  if (!defs.length) {
    const roleHasAction = TRANSITIONS.some((t) => t.action === action && t.actorRole === user.role);
    if (!roleHasAction) throw new AppError(403, 'ACTION_NOT_ALLOWED', 'هذا الإجراء غير مسموح لدورك.', 'This action is not allowed for your role.');
    throw Errors.conflict('INVALID_STATE', 'الإجراء غير متاح في الحالة الحالية للطلب.', 'This action is not available in the current state.');
  }
  const def = defs.find((d) => actorOwnsRow(user, app, d));
  if (!def) throw new AppError(403, 'ACTION_NOT_ALLOWED', 'هذا الإجراء غير مسموح لك على هذا الطلب.', 'You are not allowed to perform this action on this application.');

  const req = def.requires ?? {};
  const outOfRank = action === 'select' && policy.requireReasonForOutOfRankSelection && app.passedMinimums === true && await isOutOfRank(app);
  const p = parsePayload(action, app.state, body, Boolean(req.reason) || outOfRank);
  if (p.expectedVersion !== app.version) throw versionConflict();
  const pending = app.attempt + 1;
  const cohort = (await getCohort(app.cohortId))!;

  // ── فحوص ما قبل المعاملة ──
  let appData: FormData | null = null;
  let studyData: FormData | null = null;
  if (req.completeApplication) {
    appData = await pendingFormData(app.id, APPLICATION_SECTIONS);
    const issues = completenessIssues('application', appData, await countActiveByKind(app.id, pending));
    if (issues.length) throw new AppError(422, 'INCOMPLETE_APPLICATION', 'الاستمارة غير مكتملة — استكمل الحقول والمستندات المطلوبة.', 'The application is incomplete.', issues);
    const personal = appData.personal!;
    // شرط السن (الشرط 1): العمر عند إغلاق باب التقديم (أو عند التقديم حسب إعداد الدورة).
    const ref = cohort.ageReference === 'cohort_close' ? cohort.closesAt : today();
    const age = ageOn(String(personal.birthDate), ref);
    if (age > cohort.maxAge) {
      throw new AppError(422, 'AGE_LIMIT_EXCEEDED', `يشترط ألا يزيد عمر المتقدم عن ${cohort.maxAge} عامًا ${cohort.ageReference === 'cohort_close' ? 'عند إغلاق باب التقديم' : 'عند التقديم'} (عمرك ${age}).`,
        `The applicant must be at most ${cohort.maxAge} years old (age ${age}).`, [{ field: 'birthDate', issue: 'age limit exceeded' }]);
    }
    if (action === 'submit' && cohortStatus(cohort) !== 'open') {
      throw Errors.conflict('COHORT_CLOSED', 'أُغلق باب التقديم لهذه الدورة — لا يمكن إرسال طلبات جديدة.', 'Applications for this cohort are closed.');
    }
    const holder = await findOpenSubmittedByNationalId(String(personal.nationalId), app.id);
    if (holder) {
      throw Errors.conflict('DUPLICATE_NATIONAL_ID', 'يوجد طلب مفتوح آخر بنفس الرقم القومي — لا يُسمح إلا بطلب مفتوح واحد لكل متقدم. بياناتك محفوظة.',
        'Another open application uses this national ID. Your data is saved.', [{ field: 'nationalId', issue: 'duplicate' }]);
    }
  }
  if (req.completeStudy) {
    studyData = await pendingFormData(app.id, STUDY_SECTIONS);
    const issues = completenessIssues('study', studyData, await countActiveByKind(app.id, pending));
    if (issues.length) throw new AppError(422, 'INCOMPLETE_STUDY', 'دراسة الجدوى غير مكتملة — استكمل البنود المطلوبة.', 'The feasibility study is incomplete.', issues);
  }
  const assignments = (await activeAssignments(app.id)).filter((a) => a.status !== 'conflict');
  if (req.assignedEvaluators && assignments.length === 0) {
    throw new AppError(422, 'NO_EVALUATORS', 'أسند مقيّمًا واحدًا على الأقل من لجنة التقييم قبل الإحالة.', 'Assign at least one evaluator before referring.', [{ field: 'evaluators', issue: 'required' }]);
  }
  if (req.evaluationsComplete) {
    const submitted = assignments.filter((a) => a.status === 'submitted').length;
    if (submitted < assignments.length || submitted < cohort.minEvaluators) {
      throw new AppError(422, 'EVALUATIONS_INCOMPLETE', `لم يكتمل التقييم: سلّم ${submitted} من ${assignments.length} مقيّم (الحد الأدنى ${cohort.minEvaluators}).`,
        `Evaluation incomplete: ${submitted} of ${assignments.length} submitted (minimum ${cohort.minEvaluators}).`, [{ field: 'evaluators', issue: 'incomplete' }]);
    }
  }
  if (req.selectable) {
    if (app.passedMinimums !== true) {
      throw new AppError(422, 'BELOW_MINIMUM', 'لم يجتز المشروع الحد الأدنى للجدوى الفنية والمالية — لا يمكن اختياره.', 'The project did not pass the minimum thresholds.', [{ field: 'score', issue: 'below minimum' }]);
    }
    if (await selectedCount(app.cohortId) >= cohort.selectionTarget) {
      throw Errors.conflict('SELECTION_TARGET_REACHED', `اكتمل مستهدف الاختيار للدورة (${cohort.selectionTarget} مشروعًا).`, `The cohort selection target (${cohort.selectionTarget}) is reached.`);
    }
  }
  if (req.approval && !(await activeDocsAt(app.id, Math.max(app.attempt, 1))).some((d) => d.kind === 'approvalFile')) {
    throw new AppError(422, 'DOCUMENT_REQUIRED', 'ارفع مستند قرار الاعتماد قبل التسجيل.', 'Upload the approval decision document first.', [{ field: 'approvalFile', issue: 'required file' }]);
  }
  if (req.funderOrgId) {
    const org = await getOrganization(p.funderOrgId!);
    if (!org || org.type !== 'funder' || !org.isActive || await activeStaffCount(org.id) === 0) {
      throw new AppError(422, 'FUNDER_INVALID', 'جهة التمويل غير متاحة (غير نشطة أو لا يوجد فيها مستخدم نشط).', 'The funder is not available.', [{ field: 'funderOrgId', issue: 'unknown or inactive funder' }]);
    }
    if ((await listReferrals(app.id)).some((r) => r.funderOrgId === org.id && r.status === 'declined')) {
      throw new AppError(422, 'FUNDER_ALREADY_DECLINED', 'اعتذرت هذه الجهة عن تمويل المشروع من قبل — اختر جهة أخرى.', 'This funder already declined the project.', [{ field: 'funderOrgId', issue: 'already declined' }]);
    }
  }
  let milestones: MilestoneInput[] | undefined;
  if (req.funding) {
    milestones = p.milestones ?? await milestonesFromPlan(app.id, app.attempt);
    const sum = milestones.reduce((s, m) => s + m.amount, 0);
    if (!milestones.length || Math.abs(sum - p.amount!) > 1) {
      throw new AppError(422, 'MILESTONES_MISMATCH',
        `مجموع دفعات مراحل الصرف (${sum.toLocaleString('en-US')}) يجب أن يساوي مبلغ التمويل (${p.amount!.toLocaleString('en-US')}). حدّد المراحل يدويًا.`,
        'Milestone amounts must add up to the funding amount.', [{ field: 'milestones', issue: 'sum mismatch' }]);
    }
  }

  const now = nowIso();
  const actor = { actorUserId: user.id, actorRole: user.role, actorOrgId: user.organizationId, actorName: user.nameAr };
  let funderNameAr: string | undefined;

  await tx(async () => {
    const cur = (await getApplication(app.id))!;
    if (cur.version !== p.expectedVersion || cur.state !== app.state) throw versionConflict();
    const db = getDb();
    const nextAttempt = bumpsAttempt(action) ? pending : cur.attempt;
    const sets: string[] = ['state = ?', 'version = version + 1', 'attempt = ?', 'stateEnteredAt = ?', 'updatedAt = ?'];
    const vals: Array<string | number | null> = [def.to, nextAttempt, now, now];
    if (isTerminal(def.to)) { sets.push('closedAt = ?'); vals.push(now); }

    if (appData) {
      const pr = appData.personal!; const pj = appData.project!; const rd = appData.readiness!;
      const partners = Array.isArray(appData.team?.partners) ? appData.team!.partners as unknown[] : [];
      sets.push('applicantName = ?', 'projectName = ?', 'sector = ?', 'governorate = ?', 'nationalId = ?', 'birthDate = ?', 'teamSize = ?', 'estimatedCost = ?', 'requestedFunding = ?');
      vals.push(String(pr.fullName), String(pj.projectName), String(pj.sector), String(pj.projectGovernorate), String(pr.nationalId), String(pr.birthDate),
        appData.team?.applicationType === 'team' ? 1 + partners.length : 1, Number(rd.estimatedCost) || 0, Number(rd.requestedFunding) || 0);
    }
    if (studyData) {
      const totals = studyTotals(studyData);
      sets.push('totalInvestment = ?', 'expectedJobs = ?', 'expertId = ?');
      vals.push(totals.totalInvestment, totals.totalJobs, typeof studyData.expert?.expertId === 'string' ? studyData.expert.expertId : null);
    }
    if (action === 'submit') {
      if (!cur.number) { sets.push('number = ?'); vals.push(await nextApplicationNumber()); }
      sets.push('submittedAt = COALESCE(submittedAt, ?)'); vals.push(now);
    }
    if (action === 'refer_funder') { sets.push('funderOrgId = ?'); vals.push(p.funderOrgId!); }
    if (action === 'decline_funding') { sets.push('funderOrgId = NULL'); }
    if (action === 'complete_evaluation') {
      const agg = aggregate(await activeAssignments(cur.id));
      const passed = agg.score !== null && agg.score >= cohort.minTotalScore
        && (agg.perCriterion.financial ?? 0) >= cohort.minFinancialScore && (agg.perCriterion.technical ?? 0) >= cohort.minTechnicalScore;
      await setApplicationScore(cur.id, agg.score, passed);
    }

    try {
      const r = await db.prepare(`UPDATE sona3_applications SET ${sets.join(', ')} WHERE id = ? AND version = ?`).run(...vals, cur.id, p.expectedVersion);
      if (Number(r.changes) !== 1) throw versionConflict();
    } catch (e) {
      if (e instanceof AppError) throw e;
      mapUniqueError(e);
    }

    const after0 = (await getApplication(cur.id))!;
    const t = await insertTransition({
      applicationId: cur.id, fromState: cur.state, toState: def.to, action, ...actor,
      reason: p.reason ?? p.note ?? '', attempt: nextAttempt,
      payload: {
        ...(p.deficiencies ? { deficiencies: p.deficiencies } : {}),
        ...(p.funderOrgId ? { funderOrgId: p.funderOrgId } : {}),
        ...(action === 'decline_funding' || (action === 'withdraw' && cur.state === 'FUNDER_REVIEW') ? { funderOrgId: cur.funderOrgId } : {}),
        ...(action === 'complete_evaluation' ? { score: after0.score, passedMinimums: after0.passedMinimums } : {}),
        ...(action === 'select' || action === 'not_select' ? { score: cur.score, outOfRank } : {}),
        ...(p.amount ? { amount: p.amount, model: p.model } : {}),
        ...(p.approvalDate ? { approvalDate: p.approvalDate, approvalReference: p.approvalReference } : {}),
      },
    });

    if (p.deficiencies && action === 'request_correction') {
      for (const d of p.deficiencies) await insertDeficiency(cur.id, t.id, cur.state, d.field, d.note || (p.reason ?? ''));
    }
    if (bumpsAttempt(action) && (await openDeficiencies(cur.id)).length) await resolveDeficiencies(cur.id, t.id);

    if (action === 'record_approval') {
      await writeSection(cur.id, 'approval', Math.max(1, nextAttempt), { approvalDate: p.approvalDate, approvalReference: p.approvalReference, note: p.note ?? '' }, user.id);
    }
    if (action === 'refer_funder') {
      await insertReferral(cur.id, p.funderOrgId!, user.id, p.note ?? '');
      funderNameAr = (await getOrganization(p.funderOrgId!))?.nameAr;
    }
    if (action === 'approve_funding' || action === 'decline_funding' || (action === 'withdraw' && cur.state === 'FUNDER_REVIEW')) {
      const ref = await pendingReferral(cur.id);
      if (ref) {
        funderNameAr = (await getOrganization(ref.funderOrgId))?.nameAr;
        if (action === 'approve_funding') await decideReferral(ref.id, user.id, { status: 'approved', amount: p.amount!, model: p.model!, terms: p.terms! });
        else await decideReferral(ref.id, user.id, { status: 'declined', reason: action === 'withdraw' ? `انسحاب المتقدم: ${p.reason}` : p.reason! });
      }
    }
    if (action === 'approve_funding') await insertMilestones(cur.id, milestones!);

    const after = (await getApplication(cur.id))!;
    await addAuditLog({
      actorType: 'user', ...actor, ip: ctx.ip, action: `application.${action}`, entityType: 'application', entityId: cur.id, applicationId: cur.id,
      summaryAr: `${def.labelAr}: ${STATE_LABELS[cur.state].ar} ← ${STATE_LABELS[def.to].ar}`,
      details: { fromState: cur.state, toState: def.to, attempt: nextAttempt, version: after.version, transitionId: t.id, deficiencies: p.deficiencies?.length ?? 0 },
    });
    await notifyTransition({
      app: after, def, transition: t, reason: p.reason,
      deficiencies: p.deficiencies ? deficiencyLabels(p.deficiencies) : undefined,
      funderNameAr, amount: p.amount, modelAr: p.model ? policy.financingModels.find((m) => m.value === p.model)?.labelAr : undefined,
    });
    const eventId = randomUUID();
    await enqueueWebhook(eventId, 'application.state_changed', t.id, {
      id: eventId, type: 'application.state_changed', occurredAt: now,
      data: { applicationId: after.id, number: after.number, fromState: cur.state, toState: def.to, action, actorRole: user.role, actorOrgId: user.organizationId, attempt: nextAttempt, version: after.version },
    }, !(config.platformWebhookUrl && config.platformWebhookSecret));
  });

  return (await getApplication(app.id))!;
}
