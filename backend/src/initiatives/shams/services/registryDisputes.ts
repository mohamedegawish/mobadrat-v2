/**
 * نزاع رقم السجل الصناعي (القاعدة الإضافية G + القرار 4) — الجهة الوحيدة التي تحدد المصنع المخوَّل بالرقم هي PMU:
 *  - المصنع المتضرر (محظور رقمه أو محجوز لطلب غيره) يرفع اعتراضًا بمستند PDF (`submitObjection`).
 *  - PMU تقبل الاعتراض أو ترفضه، أو تحسم النزاع مباشرة بتسمية المصنع المخوَّل (`decideDispute`) بسبب ومرجع إجباريين.
 *  - كل قرار يُدقق ويُبلَّغ أطرافه، والتاريخ كله محفوظ (التعارضات، الحظر وكيف رُفع، الاعتراضات) ويُعرض مجمعًا (`listDisputes`).
 *  - أثناء النزاع يبقى الرقم محظورًا/محجوزًا (registryAccess) فلا تسجيل مكرر؛ بعد القرار لا يستخدمه إلا المصنع المسمّى.
 * طلب مفتوح لمصنع آخر يحجز الرقم لا يُغلق آليًا: القرار يُبلَّغ لـIMC لتتخذ قرارها على ذلك الطلب.
 */
import { getDb, nowIso, tx } from '../db/database.js';
import { mapSeq } from '../http/helpers.js';
import { AppError, Errors } from '../http/errors.js';
import { Checker, onlyKeys, type Obj } from '../http/validate.js';
import { acceptPdf, discardUpload } from '../http/upload.js';
import { normalizeRegistryNumber } from '../workflow/validate.js';
import { ORG_IDS } from '../domain.js';
import { addAuditLog, type AuditActor } from '../store/audit.js';
import { getFactory, getFactoryByOrg } from '../store/factories.js';
import { findOpenApplicationForFactory, findOpenSubmittedByRegistry, getApplication, insertTransition, type AppRow } from '../store/applications.js';
import { enqueueWebhook } from '../store/outbox.js';
import { syncFactoryAccount } from './factoryAccount.js';
import { config } from '../config.js';
import { randomUUID } from 'node:crypto';
import { activeUsersOf, type UserInternal } from '../store/users.js';
import {
  activeBlocks, decideObjection as storeDecideObjection, getObjection, insertBlock, insertObjection, listBlocks, listObjections,
  pendingObjection, registryAccess, releaseNumber, type RegistryObjectionRow,
} from '../store/registry.js';
import { dispatch, factoryRecipients, orgRecipients, type Recipient } from '../notifications/notify.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { shamsPolicy } from '../config/shamsPolicy.js';

function userActor(u: UserInternal, ip: string): AuditActor {
  return { actorType: 'user', actorUserId: u.id, actorName: u.nameAr, actorRole: u.role, actorOrgId: u.organizationId, ip };
}

function isApprover(u: UserInternal): boolean {
  return shamsPolicy.registryObjectionReviewerRoles.includes(u.role) && u.organizationId === ORG_IDS.pmu && u.isActive;
}

async function factoryUsers(factoryId: string): Promise<Recipient[]> {
  const f = await getFactory(factoryId);
  if (!f) return [];
  return (await activeUsersOf(f.organizationId, 'factory_owner')).filter((u) => u.emailVerifiedAt).map((u) => ({ userId: u.id, email: u.email, phone: u.phone || undefined }));
}

async function conflictsOf(registryNumber: string): Promise<Array<{ id: string; attemptedFactoryId: string; attemptedApplicationId: string; holdingApplicationId: string; attempts: number; createdAt: string; lastAttemptAt: string }>> {
  return await getDb().prepare('SELECT id, attemptedFactoryId, attemptedApplicationId, holdingApplicationId, attempts, createdAt, lastAttemptAt FROM shams_registry_conflicts WHERE registryNumber = ? ORDER BY createdAt')
    .all(registryNumber) as never;
}

/** المصانع المعنية بالرقم: طرف تعارض، صاحب طلب يحجزه، صاحب حظر، أو معترض. فقط من بينها يُسمّى المخوَّل. */
async function involvedFactoryIds(registryNumber: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const c of await conflictsOf(registryNumber)) {
    ids.add(c.attemptedFactoryId);
    const holder = await getDb().prepare('SELECT factoryId AS fid FROM shams_applications WHERE id = ?').get(c.holdingApplicationId) as { fid: string } | undefined;
    if (holder) ids.add(holder.fid);
  }
  const holderNow = await findOpenSubmittedByRegistry(registryNumber, '');
  if (holderNow) ids.add(holderNow.factoryId);
  for (const b of await listBlocks(false)) if (b.registryNumber === registryNumber && b.factoryId) ids.add(b.factoryId);
  for (const o of await listObjections()) if (o.registryNumber === registryNumber) ids.add(o.factoryId);
  return [...ids];
}

// ── اعتراض المصنع ───────────────────────────────────────────────────────────

export async function submitObjection(user: UserInternal, body: unknown, file: Express.Multer.File | undefined, ip: string): Promise<RegistryObjectionRow> {
  const fail = (e: AppError): never => { discardUpload(file); throw e; };
  if (user.role !== 'factory_owner') return fail(Errors.forbidden());
  const factory = await getFactoryByOrg(user.organizationId);
  if (!factory) return fail(Errors.forbidden());
  let b: Obj;
  try { b = onlyKeys(body ?? {}, ['registryNumber', 'note']); } catch (e) { discardUpload(file); throw e; }
  const c = new Checker();
  const raw = c.text(b, 'registryNumber', { required: true, max: 50 });
  const note = c.text(b, 'note', { max: 1000 });
  if (c.details.length) return fail(Errors.validation(c.details));
  const registryNumber = normalizeRegistryNumber(raw!);
  // الاعتراض لمن تضرر فعلًا: الرقم محظور/محجوز لغيره، أو سبق أن تعارض طلبه مع طلب آخر على الرقم.
  const blocked = !(await registryAccess(registryNumber, factory.id)).allowed;
  const hadConflict = (await conflictsOf(registryNumber)).some((x) => x.attemptedFactoryId === factory.id);
  // F2 / D3: a factory whose own draft holds a number another factory's open application uses may object right away,
  // without first being refused on submit.
  const holder = await findOpenSubmittedByRegistry(registryNumber, '');
  const heldByOther = Boolean(holder && holder.factoryId !== factory.id);
  if (!blocked && !hadConflict && !heldByOther) {
    return fail(Errors.conflict('OBJECTION_NOT_APPLICABLE', 'لا يوجد حظر ولا تعارض على هذا الرقم يخص منشأتك.', 'There is no block or conflict on this number involving your facility.'));
  }
  if (await pendingObjection(factory.id, registryNumber)) {
    return fail(Errors.conflict('OBJECTION_PENDING', 'لديك اعتراض قيد المراجعة على هذا الرقم.', 'You already have an objection under review for this number.'));
  }
  const stored = acceptPdf(file);
  const out = await tx(async () => {
    const o = await insertObjection({ registryNumber, factoryId: factory.id, submittedBy: user.id, note: note ?? '', originalName: stored.originalName, storedName: stored.storedName, sizeBytes: stored.sizeBytes, sha256: stored.sha256 });
    await addAuditLog({ ...userActor(user, ip), action: 'registry_objection.submit', entityType: 'registry_objection', entityId: o.id,
      summaryAr: `اعتراض على رقم السجل ${registryNumber} من ${factory.companyName}`, details: { registryNumber, factoryId: factory.id, documentSha256: stored.sha256 } });
    await dispatch('ops.registry_objection', { registryNumber, companyName: factory.companyName }, await orgRecipients(ORG_IDS.pmu, 'pmu_reviewer'), { dedupePrefix: `rob:${o.id}`, channels: ['email'] });
    return o;
  });
  kickNotificationWorker();
  return out;
}

export async function publicObjection(o: RegistryObjectionRow & { companyName?: string }) {
  return {
    id: o.id, registryNumber: o.registryNumber, factoryId: o.factoryId, companyName: o.companyName ?? (await getFactory(o.factoryId))?.companyName ?? '',
    note: o.note, document: { originalName: o.originalName, sizeBytes: o.sizeBytes, sha256: o.sha256 }, status: o.status,
    decidedAt: o.decidedAt, decisionReason: o.decisionReason, decisionReference: o.decisionReference, createdAt: o.createdAt,
  };
}

export async function listObjectionsFor(user: UserInternal) {
  if (user.role === 'factory_owner') {
    const f = await getFactoryByOrg(user.organizationId);
    return f ? mapSeq(await listObjections({ factoryId: f.id }), (o) => publicObjection(o)) : [];
  }
  if (!isApprover(user)) throw Errors.forbidden();
  return mapSeq(await listObjections(), (o) => publicObjection(o));
}

/** المستند: PMU (المراجِع) والمصنع صاحب الاعتراض فقط؛ غيرهم 404 دون كشف. */
export async function objectionDocument(user: UserInternal, id: string): Promise<RegistryObjectionRow> {
  const o = await getObjection(id);
  if (!o) throw Errors.notFound();
  const owner = user.role === 'factory_owner' && (await getFactoryByOrg(user.organizationId))?.id === o.factoryId;
  if (!owner && !isApprover(user)) throw Errors.notFound();
  return o;
}

// ── قرارات PMU ──────────────────────────────────────────────────────────────

function cleanDecision(body: unknown, withFactory: boolean) {
  const b: Obj = onlyKeys(body ?? {}, withFactory ? ['registryNumber', 'allowedFactoryId', 'reason', 'reference'] : ['reason', 'reference']);
  const c = new Checker();
  const reason = c.text(b, 'reason', { required: true, min: 10, max: 1000 });
  const reference = c.text(b, 'reference', { required: true, min: 3, max: 120 });
  const registryNumber = withFactory ? c.text(b, 'registryNumber', { required: true, max: 50 }) : undefined;
  const allowedFactoryId = withFactory ? c.text(b, 'allowedFactoryId', { required: true, max: 80 }) : undefined;
  c.throwIfAny();
  return { reason: reason!, reference: reference!, registryNumber: registryNumber ? normalizeRegistryNumber(registryNumber) : undefined, allowedFactoryId };
}

/** يحجز الرقم للمصنع المسمّى (يرفع الحظر النشط أو يسجل قرارًا مباشرًا) ويُبلغ الأطراف. داخل معاملة المستدعي. */
async function reserveFor(user: UserInternal, registryNumber: string, allowedFactoryId: string, reason: string, reference: string, source: 'objection' | 'pmu_dispute') {
  if ((await activeBlocks(registryNumber)).length) await releaseNumber(registryNumber, user.id, reason, reference, allowedFactoryId);
  else await insertBlock({ registryNumber, factoryId: null, applicationId: null, transitionId: null, source, createdBy: user.id, release: { allowedFactoryId, reason, reference } });
}

/**
 * D5: the authorised factory gets the decision for its own facility; every other party gets the decision, the reason and the
 * reference without the other company's name; IMC and PMU see both names. `skipWinner` when the winner already got its own
 * objection decision.
 */
async function notifyDecision(registryNumber: string, allowedFactoryId: string, reason: string, reference: string, skipWinner = false) {
  const allowed = await getFactory(allowedFactoryId);
  const parties = await involvedFactoryIds(registryNumber);
  const prefix = `rdec:${registryNumber}:${allowedFactoryId}:${nowIso()}`;
  if (!skipWinner) {
    await dispatch('registry.released', { registryNumber, companyName: allowed?.companyName ?? '', reference, reason }, await factoryUsers(allowedFactoryId), { dedupePrefix: `${prefix}:win`, channels: ['email'] });
  }
  const losers: Recipient[] = [];
  for (const fid of parties) if (fid !== allowedFactoryId) losers.push(...await factoryUsers(fid));
  if (losers.length) await dispatch('registry.decision_lost', { registryNumber, reference, reason }, losers, { dedupePrefix: `${prefix}:lost`, channels: ['email'] });
  const others = (await mapSeq(parties.filter((f) => f !== allowedFactoryId), getFactory)).map((f) => f?.companyName).filter(Boolean).join('، ');
  const staff = [...await orgRecipients(ORG_IDS.imc, 'imc_reviewer'), ...await orgRecipients(ORG_IDS.pmu, 'pmu_reviewer')];
  await dispatch('registry.released', { registryNumber, companyName: allowed?.companyName ?? '', otherCompanyName: others, reference, reason }, staff, { dedupePrefix: `${prefix}:staff`, channels: ['email'] });
}

/**
 * D4: PMU authorised another factory, so the holder's open application closes as Rejected (reason code REGISTRY_OWNERSHIP) at
 * any stage, in its history, with a webhook and a notice to the factory (D5: the reason never names the other company).
 */
async function closeHolder(user: UserInternal, ip: string, app: AppRow, registryNumber: string, reason: string, reference: string): Promise<void> {
  const now = nowIso();
  const r = await getDb().prepare(`UPDATE shams_applications SET state = 'REJECTED', version = version + 1, stateEnteredAt = ?, closedAt = ?, updatedAt = ?
    WHERE id = ? AND version = ? AND state = ?`).run(now, now, now, app.id, app.version, app.state);
  if (Number(r.changes) !== 1) throw Errors.conflict('VERSION_CONFLICT', 'تغيّر طلب صاحب الرقم أثناء القرار — أعد المحاولة.', "The holder's application changed during the decision — try again.");
  const text = `قررت وحدة إدارة المبادرة في نزاع رقم السجل ${registryNumber} أن الرقم لمنشأة أخرى، فأُغلق الطلب: ${reason} (مرجع ${reference})`;
  const t = await insertTransition({
    applicationId: app.id, fromState: app.state, toState: 'REJECTED', action: 'registry_dispute_reject',
    actorUserId: user.id, actorRole: user.role, actorOrgId: user.organizationId, actorName: user.nameAr, reason: text, attempt: app.attempt,
    payload: { reasonCode: shamsPolicy.registryDispute.closeHolderReasonCode, registryNumber, reference, automatic: true },
  });
  await addAuditLog({ ...userActor(user, ip), action: 'application.registry_dispute_reject', entityType: 'application', entityId: app.id, applicationId: app.id,
    summaryAr: `إغلاق الطلب ${app.number ?? app.id} بقرار PMU في نزاع رقم السجل ${registryNumber}`, details: { fromState: app.state, transitionId: t.id, registryNumber, reference } });
  const eventId = randomUUID();
  await enqueueWebhook(eventId, 'application.state_changed', t.id, {
    id: eventId, type: 'application.state_changed', occurredAt: now,
    data: { applicationId: app.id, number: app.number, fromState: app.state, toState: 'REJECTED', action: 'registry_dispute_reject', actorRole: user.role, actorOrgId: user.organizationId, attempt: app.attempt, version: app.version + 1 },
  }, !(config.platformWebhookUrl && config.platformWebhookSecret));
  const after = (await getApplication(app.id))!;
  const accountEvent = await syncFactoryAccount(after, app.state, 'REJECTED', 'reject', user, ip);
  await dispatch(accountEvent === 'rejected' ? 'account.rejected' : 'app.rejected', { appId: app.id, number: app.number, companyName: app.companyName, reason: text },
    await factoryRecipients(after), { dedupePrefix: t.id, applicationId: app.id });
}

/** D4: applies PMU's decision to every open application on the number, inside the caller's transaction. */
async function applyDecision(user: UserInternal, ip: string, registryNumber: string, allowedFactoryId: string, reason: string, reference: string): Promise<string | null> {
  const holder = await findOpenSubmittedByRegistry(registryNumber, '');
  let closed: string | null = null;
  if (holder && holder.factoryId !== allowedFactoryId) { await closeHolder(user, ip, holder, registryNumber, reason, reference); closed = holder.id; }
  for (const fid of await involvedFactoryIds(registryNumber)) {
    const app = await findOpenApplicationForFactory(fid);
    if (!app || app.id === closed) continue;
    const won = fid === allowedFactoryId;
    await insertTransition({
      applicationId: app.id, fromState: app.state, toState: app.state, action: 'registry_dispute_decided',
      actorUserId: user.id, actorRole: user.role, actorOrgId: user.organizationId, actorName: user.nameAr, attempt: app.attempt,
      reason: `${won ? `قررت وحدة إدارة المبادرة أن رقم السجل ${registryNumber} لمنشأتكم` : `قررت وحدة إدارة المبادرة أن رقم السجل ${registryNumber} لمنشأة أخرى`}: ${reason} (مرجع ${reference})`,
      payload: { registryNumber, reference, authorised: won },
    });
  }
  return closed;
}

export async function decideObjection(user: UserInternal, id: string, accept: boolean, body: unknown, ip: string) {
  if (!isApprover(user)) throw Errors.forbidden();
  const o = await getObjection(id);
  if (!o) throw Errors.notFound();
  if (o.status !== 'pending') throw Errors.conflict('ALREADY_DECIDED', 'تم البت في هذا الاعتراض بالفعل.', 'This objection was already decided.');
  const d = cleanDecision(body, false);
  const holderOpen = await findOpenSubmittedByRegistry(o.registryNumber, '');
  const holderOther = holderOpen && holderOpen.factoryId !== o.factoryId ? holderOpen : null;
  const result = await tx(async () => {
    if (!await storeDecideObjection(id, accept ? 'accepted' : 'rejected', user.id, d.reason, d.reference)) {
      throw Errors.conflict('ALREADY_DECIDED', 'تم البت في هذا الاعتراض بالفعل.', 'This objection was already decided.');
    }
    // D4: accepting authorises the objector (the holder's open application closes); rejecting keeps the number with the holder
    // and the objector stays blocked.
    if (accept) await reserveFor(user, o.registryNumber, o.factoryId, d.reason, d.reference, 'objection');
    else if (holderOther) await reserveFor(user, o.registryNumber, holderOther.factoryId, d.reason, d.reference, 'objection');
    const winner = accept ? o.factoryId : holderOther?.factoryId ?? null;
    if (winner) await applyDecision(user, ip, o.registryNumber, winner, d.reason, d.reference);
    await addAuditLog({ ...userActor(user, ip), action: accept ? 'registry_objection.accept' : 'registry_objection.reject', entityType: 'registry_objection', entityId: id,
      summaryAr: `${accept ? 'قبول' : 'رفض'} اعتراض على رقم السجل ${o.registryNumber} (مرجع ${d.reference})`,
      details: { registryNumber: o.registryNumber, factoryId: o.factoryId, reason: d.reason, reference: d.reference, holderApplicationId: holderOther?.id ?? null } });
    await dispatch('registry.objection_decided', { registryNumber: o.registryNumber, decision: accept ? 'accepted' : 'rejected', reason: d.reason }, await factoryUsers(o.factoryId), { dedupePrefix: `robd:${id}`, channels: ['email'] });
    if (winner) await notifyDecision(o.registryNumber, winner, d.reason, d.reference, winner === o.factoryId);
    return (await getObjection(id))!;
  });
  kickNotificationWorker();
  return { objection: await publicObjection(result), heldByOtherApplication: holderOther ? { id: holderOther.id, number: holderOther.number, companyName: holderOther.companyName, state: holderOther.state } : null };
}

/** حسم نزاع مباشرة: PMU تسمّي المصنع المخوَّل بالرقم من بين المصانع المعنية. الاعتراضات المعلقة على الرقم تُغلق بالقرار نفسه. */
export async function decideDispute(user: UserInternal, body: unknown, ip: string) {
  if (!isApprover(user)) throw Errors.forbidden();
  const d = cleanDecision(body, true);
  const registryNumber = d.registryNumber!;
  const allowedFactoryId = d.allowedFactoryId!;
  if (!await getFactory(allowedFactoryId)) throw Errors.validation([{ field: 'allowedFactoryId', issue: 'unknown factory' }]);
  const involved = await involvedFactoryIds(registryNumber);
  if (!involved.length) throw Errors.notFound('لا يوجد نزاع أو حظر على هذا الرقم.', 'No dispute or block exists for this number.');
  if (!involved.includes(allowedFactoryId)) throw Errors.validation([{ field: 'allowedFactoryId', issue: 'factory is not a party to this dispute' }]);
  const holderOpen = await findOpenSubmittedByRegistry(registryNumber, '');
  const holderOther = holderOpen && holderOpen.factoryId !== allowedFactoryId ? holderOpen : null;
  const closed: string[] = [];
  await tx(async () => {
    await reserveFor(user, registryNumber, allowedFactoryId, d.reason, d.reference, 'pmu_dispute');
    await applyDecision(user, ip, registryNumber, allowedFactoryId, d.reason, d.reference);
    for (const o of (await listObjections()).filter((x) => x.registryNumber === registryNumber && x.status === 'pending')) {
      const win = o.factoryId === allowedFactoryId;
      if (await storeDecideObjection(o.id, win ? 'accepted' : 'rejected', user.id, d.reason, d.reference)) {
        closed.push(o.id);
        await dispatch('registry.objection_decided', { registryNumber, decision: win ? 'accepted' : 'rejected', reason: d.reason }, await factoryUsers(o.factoryId), { dedupePrefix: `robd:${o.id}`, channels: ['email'] });
      }
    }
    await addAuditLog({ ...userActor(user, ip), action: 'registry_dispute.decide', entityType: 'registry_number', entityId: registryNumber,
      summaryAr: `قرار PMU في نزاع رقم السجل ${registryNumber}: المخوَّل ${(await getFactory(allowedFactoryId))?.companyName} (مرجع ${d.reference})`,
      details: { registryNumber, allowedFactoryId, reason: d.reason, reference: d.reference, closedObjections: closed, holderApplicationId: holderOther?.id ?? null } });
    await notifyDecision(registryNumber, allowedFactoryId, d.reason, d.reference);
  });
  kickNotificationWorker();
  return { dispute: (await listDisputes()).find((x) => x.registryNumber === registryNumber) ?? null, heldByOtherApplication: holderOther ? { id: holderOther.id, number: holderOther.number, companyName: holderOther.companyName, state: holderOther.state } : null };
}

// ── العرض المجمّع للنزاعات (PMU) ────────────────────────────────────────────

export async function listDisputes() {
  const db = getDb();
  const numbers = new Set<string>();
  for (const r of await db.prepare('SELECT DISTINCT registryNumber AS n FROM shams_registry_conflicts').all() as Array<{ n: string }>) numbers.add(r.n);
  for (const r of await db.prepare('SELECT DISTINCT registryNumber AS n FROM shams_registry_blocks').all() as Array<{ n: string }>) numbers.add(r.n);
  for (const r of await db.prepare('SELECT DISTINCT registryNumber AS n FROM shams_registry_objections').all() as Array<{ n: string }>) numbers.add(r.n);
  const allBlocks = await listBlocks(false);
  const allObjections = await listObjections();
  const name = async (fid: string | null) => (fid ? (await getFactory(fid))?.companyName ?? fid : null);

  const items = await mapSeq([...numbers], async (registryNumber) => {
    const blocks = allBlocks.filter((b) => b.registryNumber === registryNumber);
    const objections = allObjections.filter((o) => o.registryNumber === registryNumber);
    const conflicts = await conflictsOf(registryNumber);
    const holder = await findOpenSubmittedByRegistry(registryNumber, '');
    const activeBlock = blocks.some((b) => !b.releasedAt);
    const pending = objections.some((o) => o.status === 'pending');
    const lastRelease = [...blocks].filter((b) => b.releasedAt).sort((a, b) => String(b.releasedAt).localeCompare(String(a.releasedAt)))[0] ?? null;
    const unresolvedConflict = conflicts.length > 0 && !lastRelease && Boolean(holder);
    const status: 'open' | 'decided' = activeBlock || pending || unresolvedConflict ? 'open' : 'decided';
    const lastActivity = [...conflicts.map((c) => c.lastAttemptAt), ...blocks.map((b) => b.releasedAt ?? b.createdAt), ...objections.map((o) => o.decidedAt ?? o.createdAt)].sort().at(-1) ?? '';
    return {
      registryNumber, status, lastActivity,
      holderApplication: holder ? { id: holder.id, number: holder.number, companyName: holder.companyName, state: holder.state } : null,
      allowedFactory: lastRelease && !activeBlock ? { id: lastRelease.allowedFactoryId, companyName: await name(lastRelease.allowedFactoryId), reason: lastRelease.releaseReason, reference: lastRelease.releaseReference, decidedAt: lastRelease.releasedAt } : null,
      parties: await mapSeq(await involvedFactoryIds(registryNumber), async (id) => ({ id, companyName: await name(id) })),
      conflicts: await mapSeq(conflicts, async (c) => ({ id: c.id, attemptedFactoryId: c.attemptedFactoryId, companyName: await name(c.attemptedFactoryId), attemptedApplicationId: c.attemptedApplicationId, attempts: c.attempts, firstAttemptAt: c.createdAt, lastAttemptAt: c.lastAttemptAt })),
      blocks: blocks.map((b) => ({ id: b.id, source: b.source, companyName: b.companyName, createdAt: b.createdAt, active: !b.releasedAt, releasedAt: b.releasedAt, allowedFactoryId: b.allowedFactoryId, allowedCompanyName: b.allowedCompanyName, releaseReason: b.releaseReason, releaseReference: b.releaseReference })),
      objections: await mapSeq(objections, (o) => publicObjection(o)),
    };
  });
  return items.sort((a, b) => (a.status === b.status ? b.lastActivity.localeCompare(a.lastActivity) : a.status === 'open' ? -1 : 1)).slice(0, 200);
}

export async function disputesFor(user: UserInternal) {
  if (!isApprover(user)) throw Errors.forbidden();
  return await listDisputes();
}
