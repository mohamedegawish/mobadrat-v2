/** التنفيذ والمتابعة (07–08): مراحل الصرف، وتقارير الأثر، وعلامة التعثر، والتظلمات (docs/SONA3_DESIGN.md §5، §11). */
import { tx, getDb, nowIso } from '../db/sqlite.js';
import { AppError, Errors, type ErrorDetail } from '../http/errors.js';
import { isIsoDate, onlyKeys } from '../http/validate.js';
import type { UserInternal } from '../store/users.js';
import { getApplication, getTransition, insertTransition, listTransitions, setStalled, type AppRow } from '../store/applications.js';
import { addDocumentVersion } from '../store/documents.js';
import {
  getMilestone, reportMilestone, reviewMilestone, disburseMilestone, insertImpactReport, getAppeal, insertAppeal, decideAppeal, type Milestone,
} from '../store/lifecycle.js';
import { addAuditLog } from '../store/audit.js';
import { canSeeApplication, isApplicantOf } from '../access/visibility.js';
import { acceptPdf, discardUpload } from '../http/upload.js';
import { applicantRecipients, baseVars, dispatch, dispatchToOrg, imcRecipients } from '../notifications/notify.js';
import { policy } from '../config/initiativePolicy.js';
import { ORG_IDS } from '../domain.js';
import { APPEALABLE_STATES, STATE_LABELS, type ApplicationState } from './workflow.js';

async function load(user: UserInternal, appId: string): Promise<AppRow> {
  const app = await getApplication(appId);
  if (!app || !await canSeeApplication(user, app)) throw Errors.notFound('الطلب غير موجود.', 'Application not found.');
  return app;
}

async function audit(user: UserInternal, ip: string, action: string, app: AppRow, summaryAr: string, details: Record<string, unknown> = {}) {
  await addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, actorRole: user.role, actorOrgId: user.organizationId, ip,
    action, entityType: 'application', entityId: app.id, applicationId: app.id, summaryAr, details });
}

function isImc(user: UserInternal): boolean { return user.role === 'imc_officer' && user.organizationId === ORG_IDS.imc; }

async function loadMilestone(app: AppRow, id: string): Promise<Milestone> {
  const m = await getMilestone(app.id, id);
  if (!m) throw Errors.notFound('المرحلة غير موجودة.', 'Milestone not found.');
  return m;
}

async function bumpVersion(appId: string): Promise<void> {
  await getDb().prepare('UPDATE sona3_applications SET version = version + 1, updatedAt = ? WHERE id = ?').run(nowIso(), appId);
}

/** المتقدم يبلغ عن إنجاز مرحلة مع دليل PDF إجباري. */
export async function reportMilestoneDone(user: UserInternal, appId: string, milestoneId: string, note: unknown, file: Express.Multer.File | undefined, ip: string): Promise<Milestone> {
  let app: AppRow;
  try {
    app = await load(user, appId);
    if (!isApplicantOf(user, app)) throw Errors.forbidden();
    if (app.state !== 'IMPLEMENTATION') throw Errors.conflict('INVALID_STATE', 'الإبلاغ عن المراحل متاح أثناء التنفيذ فقط.', 'Milestones can be reported only during implementation.');
  } catch (e) { discardUpload(file); throw e; }
  const m = await loadMilestone(app, milestoneId);
  if (m.status !== 'planned' && m.status !== 'returned') { discardUpload(file); throw Errors.conflict('INVALID_STATE', 'المرحلة أُبلغ عنها بالفعل.', 'The milestone was already reported.'); }
  const n = typeof note === 'string' ? note.trim() : '';
  if (n.length < 3 || n.length > 2000) { discardUpload(file); throw Errors.validation([{ field: 'note', issue: 'required (3..2000)' }]); }
  if (!file) throw Errors.validation([{ field: 'file', issue: 'evidence PDF required' }]);
  const stored = acceptPdf(file);
  return await tx(async () => {
    const doc = await addDocumentVersion({
      applicationId: app.id, kind: 'milestoneEvidence', attempt: Math.max(app.attempt, 1), uploadedInState: app.state, originalName: stored.originalName,
      storedName: stored.storedName, sizeBytes: stored.sizeBytes, sha256: stored.sha256, uploadedBy: user.id,
    }, true);
    await reportMilestone(m.id, user.id, n, doc.id);
    await bumpVersion(app.id);
    await audit(user, ip, 'milestone.report', app, `إبلاغ عن إنجاز: ${m.title}`, { milestoneId: m.id, documentId: doc.id });
    await dispatch('app.milestone_reported', { ...baseVars(app), milestoneTitle: m.title }, await imcRecipients(), { dedupePrefix: `mst-rep:${m.id}:${doc.id}`, applicationId: app.id });
    return (await getMilestone(app.id, m.id))!;
  });
}

/** IMC يتحقق من الإنجاز أو يعيده للاستكمال. */
export async function reviewMilestoneDone(user: UserInternal, appId: string, milestoneId: string, body: unknown, ip: string): Promise<Milestone> {
  const app = await load(user, appId);
  if (!isImc(user)) throw Errors.forbidden();
  const b = onlyKeys(body, ['verified', 'note']);
  if (typeof b.verified !== 'boolean') throw Errors.validation([{ field: 'verified', issue: 'must be true or false' }]);
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 2000) : '';
  if (!b.verified && note.length < 3) throw Errors.validation([{ field: 'note', issue: 'required when returning a milestone' }]);
  const m = await loadMilestone(app, milestoneId);
  if (m.status !== 'reported') throw Errors.conflict('INVALID_STATE', 'المرحلة ليست بانتظار التحقق.', 'The milestone is not awaiting verification.');
  return await tx(async () => {
    await reviewMilestone(m.id, user.id, b.verified as boolean, note);
    await bumpVersion(app.id);
    await audit(user, ip, b.verified ? 'milestone.verify' : 'milestone.return', app, `${b.verified ? 'تحقق من' : 'إعادة'} مرحلة: ${m.title}`, { milestoneId: m.id });
    const vars = { ...baseVars(app), milestoneTitle: m.title, verified: b.verified as boolean, reason: note, amount: m.amount };
    const opts = { dedupePrefix: `mst-rev:${m.id}:${nowIso()}`, applicationId: app.id };
    await dispatch('app.milestone_reviewed', vars, await applicantRecipients(app), opts);
    if (b.verified) await dispatchToOrg('app.milestone_verified', vars, app.funderOrgId, 'funder_reviewer', opts);
    return (await getMilestone(app.id, m.id))!;
  });
}

/** جهة التمويل تسجل صرف دفعة مرحلة متحقق منها. */
export async function disburse(user: UserInternal, appId: string, milestoneId: string, body: unknown, ip: string): Promise<Milestone> {
  const app = await load(user, appId);
  if (user.role !== 'funder_reviewer' || app.funderOrgId !== user.organizationId) throw Errors.forbidden();
  const b = onlyKeys(body, ['reference']);
  const ref = typeof b.reference === 'string' ? b.reference.trim() : '';
  if (ref.length < 2 || ref.length > 200) throw Errors.validation([{ field: 'reference', issue: 'required (2..200)' }]);
  const m = await loadMilestone(app, milestoneId);
  if (m.status !== 'verified') throw Errors.conflict('INVALID_STATE', 'لا يُصرف إلا لمرحلة تحقق منها فريق المبادرة.', 'Only verified milestones can be disbursed.');
  return await tx(async () => {
    await disburseMilestone(m.id, user.id, ref);
    await bumpVersion(app.id);
    await audit(user, ip, 'milestone.disburse', app, `صرف دفعة: ${m.title}`, { milestoneId: m.id, amount: m.amount, reference: ref });
    const opts = { dedupePrefix: `mst-pay:${m.id}`, applicationId: app.id };
    await dispatch('app.milestone_disbursed', { ...baseVars(app), milestoneTitle: m.title, amount: m.amount }, [...await applicantRecipients(app), ...await imcRecipients()], opts);
    return (await getMilestone(app.id, m.id))!;
  });
}

/** تقرير أثر دوري من المتقدم أثناء التشغيل. */
export async function submitImpactReport(user: UserInternal, appId: string, body: unknown, ip: string) {
  const app = await load(user, appId);
  if (!isApplicantOf(user, app)) throw Errors.forbidden();
  if (app.state !== 'OPERATING') throw Errors.conflict('INVALID_STATE', 'تقارير الأثر متاحة بعد بدء التشغيل.', 'Impact reports are available once operating.');
  const b = onlyKeys(body, ['periodStart', 'periodEnd', 'revenue', 'costs', 'production', 'directJobs', 'indirectJobs', 'issues']);
  const details: ErrorDetail[] = [];
  const date = (k: string) => (isIsoDate(b[k]) ? (b[k] as string) : (details.push({ field: k, issue: 'required date YYYY-MM-DD' }), ''));
  const nonNeg = (k: string, int: boolean) => {
    const v = b[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (int && !Number.isInteger(v))) { details.push({ field: k, issue: int ? 'non-negative integer' : 'non-negative number' }); return 0; }
    return v;
  };
  const txt = (k: string, max: number) => (typeof b[k] === 'string' ? (b[k] as string).trim().slice(0, max) : '');
  const r = {
    periodStart: date('periodStart'), periodEnd: date('periodEnd'), revenue: nonNeg('revenue', false), costs: nonNeg('costs', false),
    production: txt('production', 2000), directJobs: nonNeg('directJobs', true), indirectJobs: nonNeg('indirectJobs', true), issues: txt('issues', 4000),
    submittedBy: user.id,
  };
  if (r.periodStart && r.periodEnd && r.periodEnd < r.periodStart) details.push({ field: 'periodEnd', issue: 'must be on or after periodStart' });
  if (details.length) throw Errors.validation(details);
  return await tx(async () => {
    const rep = await insertImpactReport(app.id, r);
    await bumpVersion(app.id);
    await audit(user, ip, 'impact.report', app, `تقرير أثر ${r.periodStart} — ${r.periodEnd}`, { reportId: rep.id });
    return rep;
  });
}

/** IMC يضع/يرفع علامة التعثر مع خطة معالجة (المقترح — المخاطر: «خطط معالجة مبكرة»). */
export async function markStalled(user: UserInternal, appId: string, body: unknown, ip: string): Promise<AppRow> {
  const app = await load(user, appId);
  if (!isImc(user)) throw Errors.forbidden();
  if (app.state !== 'IMPLEMENTATION' && app.state !== 'OPERATING') throw Errors.conflict('INVALID_STATE', 'علامة التعثر للمشروعات في التنفيذ أو التشغيل فقط.', 'Only for projects in implementation or operation.');
  const b = onlyKeys(body, ['stalled', 'note']);
  if (typeof b.stalled !== 'boolean') throw Errors.validation([{ field: 'stalled', issue: 'must be true or false' }]);
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 2000) : '';
  if (b.stalled && note.length < 3) throw Errors.validation([{ field: 'note', issue: 'remediation plan required' }]);
  return await tx(async () => {
    await setStalled(app.id, b.stalled as boolean, b.stalled ? note : '');
    await audit(user, ip, b.stalled ? 'project.stalled' : 'project.recovered', app, b.stalled ? 'تعليم المشروع متعثرًا' : 'رفع علامة التعثر', { note });
    return (await getApplication(app.id))!;
  });
}

// ── التظلمات ────────────────────────────────────────────────────────────────

/** قرار الرفض/عدم الاختيار الأخير وحالة المراجعة التي صدر منها. */
async function decisionTransition(app: AppRow) {
  return (await listTransitions(app.id)).filter((t) => t.toState === app.state && t.fromState !== t.toState).at(-1) ?? null;
}

export async function appealInfo(user: UserInternal, app: AppRow) {
  const appeal = await getAppeal(app.id);
  const isOwner = isApplicantOf(user, app);
  if (!isOwner && !isImc(user)) return null;
  let canAppeal = false;
  let deadline: string | null = null;
  if (APPEALABLE_STATES.includes(app.state) && app.closedAt && !appeal) {
    deadline = new Date(Date.parse(app.closedAt) + policy.appealWindowDays * 86_400_000).toISOString();
    canAppeal = isOwner && Date.now() <= Date.parse(deadline);
  }
  return {
    canAppeal, deadline, windowDays: policy.appealWindowDays,
    appeal: appeal ? { id: appeal.id, reason: appeal.reason, status: appeal.status, createdAt: appeal.createdAt, decidedAt: appeal.decidedAt, decisionNote: appeal.decisionNote } : null,
    canDecide: isImc(user) && appeal?.status === 'pending',
  };
}

export async function fileAppeal(user: UserInternal, appId: string, body: unknown, ip: string) {
  const app = await load(user, appId);
  if (!isApplicantOf(user, app)) throw Errors.forbidden();
  const info = (await appealInfo(user, app))!;
  if (!info.canAppeal) {
    throw Errors.conflict('APPEAL_NOT_ALLOWED', info.appeal ? 'سبق تقديم تظلم على هذا الطلب.' : 'التظلم غير متاح (القرار غير قابل للتظلم أو انتهت المهلة).',
      'An appeal is not available for this application.');
  }
  const b = onlyKeys(body, ['reason']);
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (reason.length < 10 || reason.length > 4000) throw Errors.validation([{ field: 'reason', issue: 'required (10..4000)' }]);
  const decision = await decisionTransition(app);
  if (!decision) throw Errors.conflict('APPEAL_NOT_ALLOWED', 'لا يوجد قرار يمكن التظلم منه.', 'No decision to appeal.');
  return await tx(async () => {
    const a = await insertAppeal(app.id, decision.id, decision.fromState, reason, user.id);
    await bumpVersion(app.id);
    await audit(user, ip, 'appeal.file', app, 'تقديم تظلم', { appealId: a.id });
    await dispatch('app.appeal_submitted', { ...baseVars(app), reason }, await imcRecipients(), { dedupePrefix: `appeal:${a.id}`, applicationId: app.id });
    return a;
  });
}

/** IMC يقرر التظلم. القبول يعيد الطلب لحالة المراجعة التي صدر منها القرار بانتقال `reopen` موثق. */
export async function decideAppealOn(user: UserInternal, appId: string, body: unknown, ip: string): Promise<AppRow> {
  const app = await load(user, appId);
  if (!isImc(user)) throw Errors.forbidden();
  const b = onlyKeys(body, ['accepted', 'note', 'expectedVersion']);
  if (typeof b.accepted !== 'boolean') throw Errors.validation([{ field: 'accepted', issue: 'must be true or false' }]);
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (note.length < 3) throw Errors.validation([{ field: 'note', issue: 'reasoned decision required' }]);
  if (typeof b.expectedVersion === 'number' && b.expectedVersion !== app.version) {
    throw Errors.conflict('VERSION_CONFLICT', 'تم تحديث الطلب بواسطة مستخدم آخر — أعد تحميل الصفحة.', 'Reload and try again.');
  }
  const appeal = await getAppeal(app.id);
  if (!appeal || appeal.status !== 'pending') throw Errors.conflict('INVALID_STATE', 'لا يوجد تظلم بانتظار القرار.', 'No pending appeal.');
  const backTo = appeal.reviewState as ApplicationState;
  try {
    await tx(async () => {
      await decideAppeal(appeal.id, user.id, b.accepted as boolean, note);
      if (b.accepted) {
        const now = nowIso();
        await getDb().prepare('UPDATE sona3_applications SET state = ?, closedAt = NULL, stateEnteredAt = ?, version = version + 1, updatedAt = ? WHERE id = ?')
          .run(backTo, now, now, app.id);
        await insertTransition({
          applicationId: app.id, fromState: app.state, toState: backTo, action: 'reopen', actorUserId: user.id, actorRole: user.role,
          actorOrgId: user.organizationId, actorName: user.nameAr, reason: note, attempt: app.attempt,
          payload: { appealId: appeal.id, decisionTransitionId: appeal.decisionTransitionId, previousDecision: (await getTransition(appeal.decisionTransitionId))?.action ?? null },
        });
      } else {
        await bumpVersion(app.id);
      }
      await audit(user, ip, b.accepted ? 'appeal.accept' : 'appeal.reject', app,
        b.accepted ? `قبول التظلم وإعادة الطلب إلى «${STATE_LABELS[backTo].ar}»` : 'رفض التظلم', { appealId: appeal.id });
      await dispatch('app.appeal_decided', { ...baseVars((await getApplication(app.id))!), accepted: b.accepted as boolean, reason: note }, await applicantRecipients(app),
        { dedupePrefix: `appeal-dec:${appeal.id}`, applicationId: app.id });
    });
  } catch (e) {
    if ((/applications.applicantId|ux_apps_open_applicant/.test(String((e as Error).message ?? '')))) {
      throw new AppError(409, 'OPEN_APPLICATION_EXISTS', 'لدى المتقدم طلب مفتوح آخر — لا يمكن إعادة فتح هذا الطلب.', 'The applicant has another open application.');
    }
    throw e;
  }
  return (await getApplication(app.id))!;
}
