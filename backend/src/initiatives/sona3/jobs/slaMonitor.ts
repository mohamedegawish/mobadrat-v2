/**
 * مراقبة المهل: عند تجاوز مهلة الحالة (policy.slaDays) يُرسل إشعار مرة واحدة للجهة المسؤولة وIMC.
 * لا رفض ولا إغلاق تلقائي — إشعار وعلامة تأخر فقط.
 */
import { config } from '../config.js';
import { getDb } from '../db/sqlite.js';
import { policy } from '../config/initiativePolicy.js';
import { getApplication } from '../store/applications.js';
import { dispatch, applicantRecipients, orgRecipients, imcRecipients } from '../notifications/notify.js';
import { STATE_LABELS, STATE_RESPONSIBLE, responsibleOrgId, type ApplicationState } from '../workflow/workflow.js';
import { slaInfo } from '../workflow/applicationView.js';
import { ORG_IDS } from '../domain.js';
import { kickNotificationWorker } from './notificationWorker.js';

let timer: NodeJS.Timeout | null = null;

export function runSlaSweep(now = Date.now()): number {
  const states = (Object.entries(policy.slaDays) as Array<[ApplicationState, number | null]>)
    .filter(([, d]) => d !== null && d !== undefined).map(([s]) => s);
  if (!states.length) return 0;
  const rows = getDb().prepare(`SELECT id FROM applications WHERE state IN (${states.map(() => '?').join(',')})`).all(...states) as Array<{ id: string }>;
  let n = 0;
  for (const { id } of rows) {
    const app = getApplication(id);
    if (!app) continue;
    const sla = slaInfo(app, now);
    if (!sla.overdue || !sla.dueAt) continue;
    const daysOverdue = Math.max(1, Math.floor((now - Date.parse(sla.dueAt)) / 86_400_000));
    const responsible = STATE_RESPONSIBLE[app.state] === 'applicant' ? applicantRecipients(app) : orgRecipients(responsibleOrgId(app));
    const recipients = [...responsible, ...(responsibleOrgId(app) === ORG_IDS.imc ? [] : imcRecipients())];
    n += dispatch('app.sla_overdue', {
      appId: app.id, number: app.number, projectName: app.projectName,
      stateAr: STATE_LABELS[app.state].ar, stateEn: STATE_LABELS[app.state].en, daysOverdue,
    }, recipients, { dedupePrefix: `sla:${app.id}:${app.state}:${app.stateEnteredAt}`, applicationId: app.id });
  }
  if (n) kickNotificationWorker();
  return n;
}

export function startSlaMonitor(): void {
  if (timer) return;
  timer = setInterval(() => {
    try { runSlaSweep(); } catch (e) { console.error('[sla] sweep error:', (e as Error).message); }
  }, config.slaSweepMs);
  timer.unref();
}

export function stopSlaMonitor(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
