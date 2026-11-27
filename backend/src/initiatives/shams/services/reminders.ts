/**
 * D17: PMU's reminder to the party an overdue application is waiting for. E-mail and in-app, at most once a day per
 * application and stage (the outbox dedupe key carries the date); nothing about the application changes.
 */
import { nowIso, tx } from '../db/database.js';
import { AppError, Errors } from '../http/errors.js';
import { getApplication, listApplications, type AppRow } from '../store/applications.js';
import { addAuditLog } from '../store/audit.js';
import type { UserInternal } from '../store/users.js';
import { dispatch, factoryRecipients, orgRecipients } from '../notifications/notify.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { slaInfo } from '../workflow/applicationView.js';
import { NON_TERMINAL_STATES, RESPONSIBLE_LABELS, STATE_LABELS, STATE_RESPONSIBLE, responsibleOrgId } from '../workflow/shamsWorkflow.js';

/** Sends the reminder for one overdue application. 0 = already reminded today. */
async function send(user: UserInternal, app: AppRow, ip: string): Promise<number> {
  const sla = slaInfo(app);
  const party = STATE_RESPONSIBLE[app.state];
  const recipients = party === 'factory' ? await factoryRecipients(app) : await orgRecipients(responsibleOrgId(app));
  if (!recipients.length) {
    throw new AppError(422, 'NO_RECIPIENTS', 'لا يوجد مستخدم نشط في الجهة المتأخرة يصله التنبيه.', 'The late party has no active user to remind.');
  }
  return await tx(async () => {
    const n = await dispatch('app.sla_reminder', {
      appId: app.id, number: app.number, companyName: app.companyName, stateAr: STATE_LABELS[app.state].ar, stateEn: STATE_LABELS[app.state].en,
      daysOverdue: Math.max(1, Math.floor((Date.now() - Date.parse(sla.dueAt!)) / 86_400_000)),
    }, recipients, { dedupePrefix: `remind:${app.id}:${app.state}:${nowIso().slice(0, 10)}`, applicationId: app.id });
    if (n) {
      await addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, actorRole: user.role, actorOrgId: user.organizationId, ip,
        action: 'application.sla_reminder', entityType: 'application', entityId: app.id, applicationId: app.id,
        summaryAr: `تنبيه تأخر إلى ${RESPONSIBLE_LABELS[party].ar}`, details: { state: app.state, dueAt: sla.dueAt } });
    }
    return n;
  });
}

export async function remindResponsible(user: UserInternal, appId: string, ip: string): Promise<void> {
  const app = await getApplication(appId);
  if (!app) throw Errors.notFound('الطلب غير موجود.', 'Application not found.');
  if (!slaInfo(app).overdue) throw Errors.conflict('NOT_OVERDUE', 'الطلب لم يتجاوز مهلته بعد.', 'The application is not overdue.');
  if (!await send(user, app, ip)) throw Errors.conflict('ALREADY_REMINDED', 'أُرسل تنبيه لهذه المرحلة اليوم بالفعل.', 'A reminder for this stage was already sent today.');
  kickNotificationWorker();
}

export async function remindOverdue(user: UserInternal, ip: string): Promise<{ overdue: number; sent: number; alreadyReminded: number; noRecipients: number }> {
  const apps = (await listApplications({ scopeSql: '1 = 1', scopeParams: [], states: [...NON_TERMINAL_STATES] }, 1, 1, true)).rows
    .filter((a) => slaInfo(a).overdue);
  const out = { overdue: apps.length, sent: 0, alreadyReminded: 0, noRecipients: 0 };
  for (const app of apps) {
    try { if (await send(user, app, ip)) out.sent++; else out.alreadyReminded++; }
    catch (e) { if (e instanceof AppError && e.code === 'NO_RECIPIENTS') out.noRecipients++; else throw e; }
  }
  if (out.sent) kickNotificationWorker();
  return out;
}
