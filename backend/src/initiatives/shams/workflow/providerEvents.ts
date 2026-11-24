/**
 * أثر إيقاف مقدم الخدمة على الطلبات التي اختارته (القاعدة الإضافية F + القرار 6) — يُستدعى داخل معاملة الإيقاف نفسها:
 *  - قبل إرسال العرض (OFFER_UPLOAD) — D6: يعود الطلب آليًا إلى «اختيار مقدم الخدمة» بقيد في السجل وإشعار للمصنع.
 *  - أثناء مراجعة العرض أو تصحيحه (OFFER_REVIEW / OFFER_CORRECTION): يعود الطلب تلقائيًا إلى OFFER_UPLOAD
 *    بانتقال نظامي مُسجَّل (action = provider_suspended_return) ويُطلب عرض جديد من مقدم خدمة معتمد.
 *  - بعد قبول العرض — D7: لا تتغير الحالة؛ تنبيه للمصنع وPMU داخل المنصة وبالبريد، وقيد في السجل.
 * المنفِّذ في السجل هو من أوقف المقدم (مساءلة)، والوصف يوضح أن الانتقال آلي.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { getDb, nowIso } from '../db/database.js';
import { ORG_IDS } from '../domain.js';
import { addAuditLog, type AuditActor } from '../store/audit.js';
import { getApplication, insertTransition } from '../store/applications.js';
import { enqueueWebhook } from '../store/outbox.js';
import { dispatch, factoryRecipients, orgRecipients } from '../notifications/notify.js';
import type { ApplicationState } from './shamsWorkflow.js';
import type { UserInternal } from '../store/users.js';

export const PROVIDER_RETURN_ACTION = 'provider_suspended_return' as const;
export const PROVIDER_RESELECT_ACTION = 'provider_suspended_reselect' as const;
export const PROVIDER_WARNING_ACTION = 'provider_suspended_warning' as const;

/** حالات ما بعد قبول العرض — تنبيه فقط. */
const AFTER_OFFER_ACCEPTED: ApplicationState[] = ['ELECTRICITY_UPLOAD', 'ELECTRICITY_REVIEW', 'BANK_STUDY', 'CONTRACT_OUTCOME', 'DISTRIBUTION_UPLOAD', 'DISTRIBUTION_REVIEW'];
const RETURN_STATES: ApplicationState[] = ['OFFER_REVIEW', 'OFFER_CORRECTION'];

export interface ProviderSuspensionResult { returned: string[]; notifiedBeforeOffer: string[]; alertedAfterAcceptance: string[] }

/**
 * F-06: مصدر الحدث وحالتا المقدم قبله وبعده. المعالجة نفسها لحدثين مختلفين اليوم (إيقاف PMU وإلغاء تفعيل ENCPC)؛
 * هذا التوثيق يُميّزهما في التدقيق والسجل التاريخي دون تغيير الأثر، والسياسة النهائية قرار مفتوح للجهة المالكة (D16).
 */
export type ProviderEventSource = 'pmu_suspend' | 'encpc_deactivate';
export interface ProviderSnapshot { status: string; isActive: boolean }
export interface ProviderEvent { source: ProviderEventSource; before: ProviderSnapshot; after: ProviderSnapshot }

export async function applyProviderSuspension(provider: { id: string; nameAr: string; suspendedAt: string | null }, user: UserInternal, ip: string, event: ProviderEvent): Promise<ProviderSuspensionResult> {
  const db = getDb();
  const result: ProviderSuspensionResult = { returned: [], notifiedBeforeOffer: [], alertedAfterAcceptance: [] };
  const watched: ApplicationState[] = ['OFFER_UPLOAD', ...RETURN_STATES, ...AFTER_OFFER_ACCEPTED];
  const rows = await db.prepare(`SELECT id FROM shams_applications WHERE providerId = ? AND state IN (${watched.map(() => '?').join(',')})`).all(provider.id, ...watched) as Array<{ id: string }>;
  const actor: AuditActor = { actorType: 'user', actorUserId: user.id, actorName: user.nameAr, actorRole: user.role, actorOrgId: user.organizationId, ip };
  const stamp = provider.suspendedAt ?? nowIso();

  const providerEvent = { source: event.source, providerId: provider.id, before: event.before, after: event.after };
  /** الطلب لم يتحرك (قبل إرسال العرض أو بعد قبوله): لا انتقال، لكن الحدث ومصدره وحالتا المقدم مسجلة على الطلب. */
  const auditUnavailable = async (appId: string, state: ApplicationState, effect: 'notified_before_offer' | 'alert_only') => {
    await addAuditLog({ ...actor, action: 'application.provider_unavailable', entityType: 'application', entityId: appId, applicationId: appId,
      summaryAr: `مقدم الخدمة ${provider.nameAr} لم يعد متاحًا (${event.source === 'pmu_suspend' ? 'إيقاف PMU' : 'إلغاء تفعيل ENCPC'}) — الطلب لم يتحرك`,
      details: { source: event.source, effect, providerEvent, stateBefore: state, stateAfter: state } });
  };

  for (const { id } of rows) {
    const cur = await getApplication(id);
    if (!cur) continue;
    const vars = { appId: cur.id, number: cur.number, companyName: cur.companyName, providerNameAr: provider.nameAr };
    const opts = { dedupePrefix: `sp:${provider.id}:${cur.id}:${stamp}`, applicationId: cur.id };

    if (RETURN_STATES.includes(cur.state)) {
      const now = nowIso();
      const changed = await db.prepare(`UPDATE shams_applications SET state = 'OFFER_UPLOAD', version = version + 1, stateEnteredAt = ?, updatedAt = ?
        WHERE id = ? AND version = ? AND state = ?`).run(now, now, cur.id, cur.version, cur.state);
      if (Number(changed.changes) !== 1) continue; // تغيّر الطلب في الأثناء — المعاملة نفسها تمنع هذا عمليًا
      const reason = `أُوقف مقدم الخدمة «${provider.nameAr}» أثناء ${cur.state === 'OFFER_REVIEW' ? 'مراجعة العرض الفني' : 'تصحيح العرض الفني'} — أُعيد الطلب آليًا لرفع عرض جديد من مقدم خدمة معتمد.`;
      const t = await insertTransition({
        applicationId: cur.id, fromState: cur.state, toState: 'OFFER_UPLOAD', action: PROVIDER_RETURN_ACTION,
        actorUserId: user.id, actorRole: user.role, actorOrgId: user.organizationId, actorName: user.nameAr, reason, attempt: cur.attempt,
        payload: { providerId: provider.id, automatic: true, providerEvent, stateBefore: cur.state, stateAfter: 'OFFER_UPLOAD' },
      });
      await addAuditLog({ ...actor, action: 'application.provider_suspended_return', entityType: 'application', entityId: cur.id, applicationId: cur.id,
        summaryAr: `إرجاع آلي إلى رفع العرض بعد إيقاف مقدم الخدمة ${provider.nameAr}`,
        details: { fromState: cur.state, toState: 'OFFER_UPLOAD', providerId: provider.id, transitionId: t.id, source: event.source, providerEvent, stateBefore: cur.state, stateAfter: 'OFFER_UPLOAD' } });
      const eventId = randomUUID();
      await enqueueWebhook(eventId, 'application.state_changed', t.id, {
        id: eventId, type: 'application.state_changed', occurredAt: now,
        data: { applicationId: cur.id, number: cur.number, fromState: cur.state, toState: 'OFFER_UPLOAD', action: PROVIDER_RETURN_ACTION, actorRole: user.role, actorOrgId: user.organizationId, attempt: cur.attempt, version: cur.version + 1 },
      }, !(config.platformWebhookUrl && config.platformWebhookSecret));
      await dispatch('app.provider_suspended', { ...vars, returned: true }, [...await factoryRecipients(cur), ...await orgRecipients(ORG_IDS.pmu, 'pmu_reviewer')], opts);
      result.returned.push(cur.id);
    } else if (cur.state === 'OFFER_UPLOAD') {
      // D6 (QA 2026-11-23): before the offer is sent, the application returns to provider selection — recorded and notified.
      const now = nowIso();
      const changed = await db.prepare(`UPDATE shams_applications SET state = 'PROVIDER_SELECTION', version = version + 1, stateEnteredAt = ?, updatedAt = ?
        WHERE id = ? AND version = ? AND state = 'OFFER_UPLOAD'`).run(now, now, cur.id, cur.version);
      if (Number(changed.changes) !== 1) continue;
      const reason = `أُوقف مقدم الخدمة «${provider.nameAr}» قبل إرسال العرض الفني — عاد الطلب آليًا لاختيار مقدم خدمة معتمد آخر.`;
      const t = await insertTransition({
        applicationId: cur.id, fromState: 'OFFER_UPLOAD', toState: 'PROVIDER_SELECTION', action: PROVIDER_RESELECT_ACTION,
        actorUserId: user.id, actorRole: user.role, actorOrgId: user.organizationId, actorName: user.nameAr, reason, attempt: cur.attempt,
        payload: { providerId: provider.id, automatic: true, providerEvent, stateBefore: 'OFFER_UPLOAD', stateAfter: 'PROVIDER_SELECTION' },
      });
      await addAuditLog({ ...actor, action: 'application.provider_suspended_reselect', entityType: 'application', entityId: cur.id, applicationId: cur.id,
        summaryAr: `عودة آلية لاختيار مقدم الخدمة بعد إيقاف ${provider.nameAr}`,
        details: { fromState: 'OFFER_UPLOAD', toState: 'PROVIDER_SELECTION', providerId: provider.id, transitionId: t.id, source: event.source, providerEvent } });
      const eventId = randomUUID();
      await enqueueWebhook(eventId, 'application.state_changed', t.id, {
        id: eventId, type: 'application.state_changed', occurredAt: now,
        data: { applicationId: cur.id, number: cur.number, fromState: 'OFFER_UPLOAD', toState: 'PROVIDER_SELECTION', action: PROVIDER_RESELECT_ACTION, actorRole: user.role, actorOrgId: user.organizationId, attempt: cur.attempt, version: cur.version + 1 },
      }, !(config.platformWebhookUrl && config.platformWebhookSecret));
      await dispatch('app.provider_suspended', { ...vars, reselect: true }, [...await factoryRecipients(cur), ...await orgRecipients(ORG_IDS.pmu, 'pmu_reviewer')], opts);
      result.notifiedBeforeOffer.push(cur.id);
    } else {
      // D7 (QA 2026-11-23): after the offer was accepted the path does not change — the factory and PMU are warned (in-app and
      // e-mail) and the application history records it.
      await insertTransition({
        applicationId: cur.id, fromState: cur.state, toState: cur.state, action: PROVIDER_WARNING_ACTION,
        actorUserId: user.id, actorRole: user.role, actorOrgId: user.organizationId, actorName: user.nameAr, attempt: cur.attempt,
        reason: `أُوقف مقدم الخدمة «${provider.nameAr}» بعد قبول العرض الفني — للعلم فقط، لا يتغير مسار الطلب.`,
        payload: { providerId: provider.id, automatic: true, providerEvent, stateBefore: cur.state, stateAfter: cur.state },
      });
      await dispatch('app.provider_suspended', { ...vars, alertOnly: true }, [...await factoryRecipients(cur), ...await orgRecipients(ORG_IDS.pmu, 'pmu_reviewer')], opts);
      await auditUnavailable(cur.id, cur.state, 'alert_only');
      result.alertedAfterAcceptance.push(cur.id);
    }
  }
  return result;
}
