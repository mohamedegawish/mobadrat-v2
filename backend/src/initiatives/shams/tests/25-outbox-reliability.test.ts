// Production-readiness: notification outbox reliability with fake providers only (no real SMTP/SMS). Covers retry with
// backoff, the retry limit and failed state, admin requeue, idempotency of logical notifications, claim exclusivity,
// workflow state independence from delivery, and a hung SMTP server (real nodemailer against a local socket that never answers).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { isolateTestEnv, startServer, clients, advanceTo, q, sentMails, type Started } from './helpers.js';

const env = isolateTestEnv('outbox');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => {
  const { setMailSenderForTests } = await import('../src/mail/mailer.js');
  setMailSenderForTests(null);
  await srv.close(); await env.cleanup();
});

/** Simulates the passage of time for due rows (the worker reads the real clock). */
async function makeDue(ids: string[]) {
  const { getDb } = await import('../src/db/sqlite.js');
  for (const id of ids) await getDb().prepare("UPDATE notification_outbox SET nextAttemptAt = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(id);
}

test('OB-1 failed email delivery: retried with backoff on the same row, failed after the limit, requeued by the admin, delivered once — workflow untouched', async () => {
  const { processNotifications } = await import('../src/jobs/notificationWorker.js');
  const { setMailSenderForTests } = await import('../src/mail/mailer.js');
  const { MAX_ATTEMPTS } = await import('../src/store/outbox.js');
  await processNotifications(500); // drain everything produced by logins/seed so only the new rows matter
  let failing = true;
  let calls = 0;
  setMailSenderForTests(async (m) => { calls++; if (failing) throw new Error('SMTP 451 temporary failure (fake)'); sentMails.push({ to: m.to, subject: m.subject, html: m.html, text: m.text, attachments: [] }); return 'sent'; });

  const id = await advanceTo('IMC_REVIEW', c, 'IND-OB-1');
  const app0 = (await q<any>('SELECT state, version FROM applications WHERE id = ?', id))[0];
  const rows0 = await q<any>("SELECT id FROM notification_outbox WHERE applicationId = ? AND channel = 'email' AND status = 'pending'", id);
  assert.ok(rows0.length >= 1, 'the submission produced email notifications');
  const ids = rows0.map((r) => r.id);
  const inClause = `(${ids.map(() => '?').join(',')})`;

  const t0 = Date.now();
  let r = await processNotifications(500);
  assert.equal(r.retried, ids.length);
  let rows = await q<any>(`SELECT * FROM notification_outbox WHERE id IN ${inClause}`, ...ids);
  for (const row of rows) {
    assert.equal(row.status, 'pending'); assert.equal(row.attempts, 1);
    assert.match(row.lastError, /451/);
    const wait = Date.parse(row.nextAttemptAt) - t0;
    assert.ok(wait >= 55_000 && wait <= 70_000, `first backoff about 1 minute (got ${wait} ms)`);
  }
  // not due yet: the next sweep does not hammer the provider
  const callsBefore = calls;
  r = await processNotifications(500);
  assert.equal(calls, callsBefore, 'backoff respected');

  for (let i = 2; i <= MAX_ATTEMPTS; i++) { await makeDue(ids); await processNotifications(500); }
  rows = await q<any>(`SELECT * FROM notification_outbox WHERE id IN ${inClause}`, ...ids);
  for (const row of rows) { assert.equal(row.status, 'failed'); assert.equal(row.attempts, MAX_ATTEMPTS); }
  await makeDue(ids);
  const callsAtFailed = calls;
  await processNotifications(500);
  assert.equal(calls, callsAtFailed, 'a failed row is not retried automatically');
  // no new logical notification was created by the retries
  assert.equal((await q("SELECT 1 FROM notification_outbox WHERE applicationId = ? AND channel = 'email'", id)).length, rows0.length);
  // delivery failures did not touch the workflow
  const app1 = (await q<any>('SELECT state, version FROM applications WHERE id = ?', id))[0];
  assert.deepEqual(app1, app0);

  // admin requeue → delivered exactly once
  failing = false;
  for (const nid of ids) assert.equal((await c.admin.post(`/admin/notifications/${nid}/retry`, {})).status, 200);
  const sentBefore = sentMails.length;
  r = await processNotifications(500);
  assert.equal(r.sent, ids.length);
  assert.equal(sentMails.length - sentBefore, ids.length);
  rows = await q<any>(`SELECT * FROM notification_outbox WHERE id IN ${inClause}`, ...ids);
  for (const row of rows) { assert.equal(row.status, 'sent'); assert.ok(row.sentAt); }
  await makeDue(ids);
  r = await processNotifications(500);
  assert.equal(sentMails.length - sentBefore, ids.length, 'a sent row is never sent again');
  // admin cannot requeue a sent row
  assert.notEqual((await c.admin.post(`/admin/notifications/${ids[0]}/retry`, {})).status, 200);
});

test('OB-2 idempotency: dispatching the same logical notification again creates no row (outbox and inbox), and a claim is exclusive', async () => {
  const { dispatch } = await import('../src/notifications/notify.js');
  const { claimNotification } = await import('../src/store/outbox.js');
  const recipients = [{ userId: 'usr-pmu-1', email: 'pmu@shams.local' }];
  const vars = { appId: 'x', number: 'N-1', companyName: 'c', amount: 1, threshold: 0 };
  const n1 = await dispatch('ops.contract_amount_alert', vars, recipients, { dedupePrefix: 'ob2-fixed', channels: ['email'] });
  const n2 = await dispatch('ops.contract_amount_alert', vars, recipients, { dedupePrefix: 'ob2-fixed', channels: ['email'] });
  assert.equal(n1, 1); assert.equal(n2, 0);
  assert.equal((await q("SELECT 1 FROM notification_outbox WHERE dedupeKey LIKE 'ob2-fixed:%'")).length, 1);
  assert.equal((await q("SELECT 1 FROM user_notifications WHERE dedupeKey LIKE 'ob2-fixed:%'")).length, 1);
  const row = (await q<any>("SELECT id FROM notification_outbox WHERE dedupeKey LIKE 'ob2-fixed:%'"))[0];
  assert.equal(await claimNotification(row.id), true);
  assert.equal(await claimNotification(row.id), false, 'a second worker cannot claim the same row');
});

test('OB-3 a hung SMTP server: the attempt fails within the SMTP timeouts, well inside the 10-minute stale-claim window (a thrown send is retried: OB-1)', async () => {
  const { setMailSenderForTests, sendMail, SMTP_TIMEOUTS } = await import('../src/mail/mailer.js');
  const sockets: net.Socket[] = [];
  const hang = net.createServer((s) => { sockets.push(s); }); // accepts the TCP connection and never sends the SMTP greeting
  await new Promise<void>((r) => hang.listen(0, '127.0.0.1', () => r()));
  const port = (hang.address() as net.AddressInfo).port;
  setMailSenderForTests(null);
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), MAIL_FROM_ADDRESS: 'noreply@test.local', MAIL_REDIRECT_TO: 'dev@test.local' });
  const t0 = Date.now();
  try {
    await assert.rejects(sendMail({ to: ['someone@test.local'], subject: 's', html: '<p>x</p>', text: 'x' }), /timeout|Greeting/i);
  } finally {
    for (const k of ['SMTP_HOST', 'SMTP_PORT', 'MAIL_FROM_ADDRESS', 'MAIL_REDIRECT_TO']) delete process.env[k];
    for (const s of sockets) s.destroy();
    hang.close();
  }
  const took = Date.now() - t0;
  console.log(`[OB-3] hung SMTP attempt ended after ${took} ms (greetingTimeout ${SMTP_TIMEOUTS.greetingTimeout} ms)`);
  assert.ok(took < SMTP_TIMEOUTS.greetingTimeout + 5_000, `ended after ${took} ms`);
  assert.ok(SMTP_TIMEOUTS.socketTimeout < 10 * 60_000 / 2, 'every SMTP timeout is far below the stale-claim window');
});
