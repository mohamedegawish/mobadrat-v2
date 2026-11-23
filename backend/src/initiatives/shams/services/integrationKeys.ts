/**
 * H1 (القرار 3): خدمة مفاتيح الربط — الإنشاء والتدوير والإلغاء والاعتماد. نفس القاعدة تُطبَّق هنا (الإنشاء) وفي كل طلب
 * (integration/router.ts → keyAllows)، فلا يعمل مفتاح قديم بنطاق ممنوع.
 *  - نطاقات البيانات (read_full, read_documents, read_audit) معطلة ما دام INTEGRATION_DATA_SCOPES_ENABLED ≠ 1 → 403.
 *  - عند تفعيلها: المفتاح بها يبقى pending_approval حتى توافق PMU.
 *  - PMU تُبلَّغ بكل إنشاء وتدوير وإلغاء.
 */
import { tx } from '../db/database.js';
import { AppError, Errors } from '../http/errors.js';
import { Checker, onlyKeys } from '../http/validate.js';
import { shamsPolicy } from '../config/shamsPolicy.js';
import {
  createIntegrationKey, getIntegrationKey, isDataScope, listIntegrationKeys, revokeIntegrationKey, setKeyApproval,
  INTEGRATION_SCOPES, type IntegrationKey, type IntegrationScope,
} from '../store/integrationKeys.js';
import { addAuditLog, type AuditActor } from '../store/audit.js';
import { dispatch } from '../notifications/notify.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { pmuRecipients } from './accounts.js';
import type { UserInternal } from '../store/users.js';
import { ORG_IDS } from '../domain.js';

export function dataScopesDisabledError(scopes: IntegrationScope[]): AppError {
  return new AppError(403, 'DATA_SCOPES_DISABLED',
    'نطاقات البيانات الكاملة في API الربط معطلة بقرار المشروع (بيانات وصفية فقط).',
    'Full-data integration scopes are disabled by project decision (metadata only).',
    scopes.filter(isDataScope).map((s) => ({ field: 'scopes', issue: `${s} is disabled` })));
}

/** القاعدة في كل طلب: النطاق موجود في المفتاح، ونطاق البيانات مسموح فقط عند التفعيل. */
export function keyAllows(key: IntegrationKey, scope: IntegrationScope): 'ok' | 'missing' | 'data_disabled' {
  if (!key.scopes.includes(scope)) return 'missing';
  if (isDataScope(scope) && !shamsPolicy.integrationDataScopesEnabled) return 'data_disabled';
  return 'ok';
}

async function notifyPmu(key: IntegrationKey, eventAr: string, eventEn: string, dedupe: string): Promise<void> {
  await dispatch('ops.integration_key', { keyName: key.name, scopes: key.scopes.join(', '), eventAr, eventEn }, await pmuRecipients(), { dedupePrefix: dedupe, channels: ['email'] });
}

export function cleanKeyInput(body: unknown) {
  const b = onlyKeys(body, ['name', 'scopes', 'rateLimitPerMinute']);
  const c = new Checker();
  const name = c.text(b, 'name', { required: true, min: 2, max: 120 });
  const scopes = Array.isArray(b.scopes) ? b.scopes : [];
  if (!scopes.length || scopes.some((s) => !(INTEGRATION_SCOPES as readonly string[]).includes(s))) c.add('scopes', `non-empty subset of ${INTEGRATION_SCOPES.join(', ')}`);
  const rate = b.rateLimitPerMinute === undefined ? 60 : Number(b.rateLimitPerMinute);
  if (!Number.isInteger(rate) || rate < 1 || rate > 10000) c.add('rateLimitPerMinute', 'integer 1..10000');
  c.throwIfAny();
  return { name: name!, scopes: [...new Set(scopes as IntegrationScope[])], rateLimitPerMinute: rate };
}

export async function createKey(actor: AuditActor & { actorUserId: string }, body: unknown): Promise<{ key: IntegrationKey; plaintext: string }> {
  const input = cleanKeyInput(body);
  const wantsData = input.scopes.some(isDataScope);
  if (wantsData && !shamsPolicy.integrationDataScopesEnabled) throw dataScopesDisabledError(input.scopes);
  const out = await tx(async () => {
    const r = await createIntegrationKey({ ...input, createdBy: actor.actorUserId, approvalStatus: wantsData ? 'pending_approval' : 'active' });
    await addAuditLog({ ...actor, action: 'integration_key.create', entityType: 'integration_key', entityId: r.key.id, summaryAr: `إنشاء مفتاح ربط: ${r.key.name}`,
      details: { scopes: r.key.scopes, prefix: r.key.keyPrefix, approvalStatus: r.key.approvalStatus } });
    await notifyPmu(r.key, wantsData ? 'إنشاء مفتاح بنطاقات بيانات — بانتظار موافقتكم' : 'إنشاء مفتاح ربط', wantsData ? 'key with data scopes created — awaiting PMU approval' : 'key created', `ik-create:${r.key.id}`);
    return r;
  });
  kickNotificationWorker();
  return out;
}

export async function revokeKey(actor: AuditActor & { actorUserId: string }, id: string): Promise<IntegrationKey> {
  const key = await getIntegrationKey(id);
  if (!key) throw Errors.notFound();
  await tx(async () => {
    await revokeIntegrationKey(key.id, actor.actorUserId);
    await addAuditLog({ ...actor, action: 'integration_key.revoke', entityType: 'integration_key', entityId: key.id, summaryAr: `إلغاء مفتاح ربط: ${key.name}` });
    await notifyPmu(key, 'إلغاء مفتاح ربط', 'key revoked', `ik-revoke:${key.id}`);
  });
  kickNotificationWorker();
  return (await getIntegrationKey(key.id))!;
}

/**
 * التدوير: مفتاح جديد بنفس النطاقات والحد، وإلغاء القديم فورًا. نطاقات البيانات تُفحص مجددًا الآن؛
 * المفتاح المعتمد يرث الاعتماد (حامل النص هو نفسه)، وغير المعتمد يبقى بانتظار PMU.
 */
export async function rotateKey(actor: AuditActor & { actorUserId: string }, id: string): Promise<{ key: IntegrationKey; plaintext: string }> {
  const old = await getIntegrationKey(id);
  if (!old) throw Errors.notFound();
  if (old.revokedAt) throw Errors.conflict('KEY_REVOKED', 'المفتاح ملغى بالفعل.', 'The key is already revoked.');
  if (old.scopes.some(isDataScope) && !shamsPolicy.integrationDataScopesEnabled) throw dataScopesDisabledError(old.scopes);
  const out = await tx(async () => {
    const r = await createIntegrationKey({
      name: old.name, scopes: old.scopes, rateLimitPerMinute: old.rateLimitPerMinute, createdBy: actor.actorUserId, rotatedFromId: old.id,
      approvalStatus: old.approvalStatus === 'active' ? 'active' : 'pending_approval', approvedBy: old.approvedBy, approvedAt: old.approvedAt,
    });
    await revokeIntegrationKey(old.id, actor.actorUserId);
    await addAuditLog({ ...actor, action: 'integration_key.rotate', entityType: 'integration_key', entityId: r.key.id, summaryAr: `تدوير مفتاح ربط: ${r.key.name}`, details: { rotatedFromId: old.id } });
    await notifyPmu(r.key, 'تدوير مفتاح ربط', 'key rotated', `ik-rotate:${r.key.id}`);
    return r;
  });
  kickNotificationWorker();
  return out;
}

function assertApprover(user: UserInternal): void {
  if (!(shamsPolicy.integrationKeyApproverRoles.includes(user.role) && user.organizationId === ORG_IDS.pmu)) throw Errors.forbidden();
}

export async function pendingKeys(user: UserInternal): Promise<IntegrationKey[]> {
  assertApprover(user);
  return await listIntegrationKeys({ approvalStatus: 'pending_approval' });
}

export async function decideKey(user: UserInternal, id: string, approve: boolean, body: unknown, actor: AuditActor): Promise<IntegrationKey> {
  assertApprover(user);
  const key = await getIntegrationKey(id);
  if (!key || key.revokedAt) throw Errors.notFound();
  if (key.approvalStatus !== 'pending_approval') throw Errors.conflict('ALREADY_DECIDED', 'تم البت في هذا المفتاح بالفعل.', 'This key was already decided.');
  if (key.createdBy === user.id) throw Errors.forbidden();
  if (approve && !shamsPolicy.integrationDataScopesEnabled) throw dataScopesDisabledError(key.scopes);
  const b = onlyKeys(body ?? {}, ['reason']);
  const c = new Checker();
  const reason = c.text(b, 'reason', { required: !approve, min: approve ? undefined : 3, max: 1000 });
  c.throwIfAny();
  await tx(async () => {
    if (!await setKeyApproval(key.id, approve ? 'active' : 'rejected', user.id)) throw Errors.conflict('ALREADY_DECIDED', 'تم البت في هذا المفتاح بالفعل.', 'This key was already decided.');
    await addAuditLog({ ...actor, action: approve ? 'integration_key.approve' : 'integration_key.reject', entityType: 'integration_key', entityId: key.id,
      summaryAr: `${approve ? 'موافقة PMU على' : 'رفض PMU'} مفتاح ربط: ${key.name}`, details: { scopes: key.scopes, reason: reason ?? '' } });
  });
  return (await getIntegrationKey(key.id))!;
}
