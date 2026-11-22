/**
 * مراقبة المهل: عند تجاوز مهلة الحالة (shamsPolicy.slaDays) يُرسل إشعار مرة واحدة للجهة المسؤولة وPMU.
 * لا رفض ولا إغلاق تلقائي — إشعار وعلامة تأخر فقط.
 */
import { config } from '../config.js';
import { getDb, withJobLock } from '../db/sqlite.js';
import { shamsPolicy } from '../config/shamsPolicy.js';
import { getApplication } from '../store/applications.js';
import { dispatch, factoryRecipients, orgRecipients } from '../notifications/notify.js';
import { STATE_LABELS, STATE_RESPONSIBLE, responsibleOrgId, type ApplicationState } from '../workflow/shamsWorkflow.js';
import { slaInfo } from '../workflow/applicationView.js';
import { ORG_IDS } from '../domain.js';
import { kickNotificationWorker } from './notificationWorker.js';
import { trackJob } from './inflight.js';

let timer: NodeJS.Timeout | null = null;

export async function runSlaSweep(now = Date.now()): Promise<number> {
  const states = (Object.entries(shamsPolicy.slaDays) as Array<[ApplicationState, number | null]>)
    .filter(([, d]) => d !== null && d !== undefined).map(([s]) => s);
  if (!states.length) return 0;
  const rows = await getDb().prepare(`SELECT id FROM shams_applications WHERE state IN (${states.map(() => '?').join(',')})`).all(...states) as Array<{ id: string }>;
  let n = 0;
  for (const { id } of rows) {
    const app = await getApplication(id);
    if (!app) continue;
    const sla = slaInfo(app, now);
    if (!sla.overdue || !sla.dueAt) continue;
    const daysOverdue = Math.max(1, Math.floor((now - Date.parse(sla.dueAt)) / 86_400_000));
    const responsible = STATE_RESPONSIBLE[app.state] === 'factory' ? await factoryRecipients(app) : await orgRecipients(responsibleOrgId(app));
    const recipients = [...responsible, ...(responsibleOrgId(app) === ORG_IDS.pmu ? [] : await orgRecipients(ORG_IDS.pmu, 'pmu_reviewer'))];
    n += await dispatch('app.sla_overdue', {
      appId: app.id, number: app.number, companyName: app.companyName,
      stateAr: STATE_LABELS[app.state].ar, stateEn: STATE_LABELS[app.state].en, daysOverdue,
    }, recipients, { dedupePrefix: `sla:${app.id}:${app.state}:${app.stateEnteredAt}`, applicationId: app.id });
  }
  if (n) kickNotificationWorker();
  return n;
}

export function startSlaMonitor(): void {
  if (timer) return;
  timer = setInterval(() => {
    void trackJob((async () => {
      try { await withJobLock('sla', () => runSlaSweep()); } catch (e) { console.error('[sla] sweep error:', (e as Error).message); }
    })());
  }, config.slaSweepMs);
  timer.unref();
}

export function stopSlaMonitor(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
