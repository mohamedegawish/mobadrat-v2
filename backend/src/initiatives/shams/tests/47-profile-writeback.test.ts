// Shared factory profile write-back: after a successful submit (never on drafts), the submitted Shams form updates the
// person's factory profile so the next initiative is prefilled; identity data (industrial registry number) is never
// overwritten silently; the change is audited with the initiative id.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, createCompleteDraft, q, type Started } from './helpers.js';

const env = isolateTestEnv('writeback');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function profileOfFactoryUser(email: string) {
  const [row] = await q<{ factoryProfileId: string | null; userId: string }>(
    `SELECT f.factoryProfileId, u.id AS userId FROM users u
       JOIN initiative_memberships m ON m.userId = u.id AND m.initiativeId = 'shams'
       JOIN shams_factories f ON f.organizationId = m.organizationId
      WHERE u.email = ?`, email);
  return row;
}

test('W-1 a draft never touches the profile; submit writes the submitted data back; the registry number stays locked', async () => {
  const open = (await c.factory.get('/factory/profile')).json.data.openApplicationId;
  if (open) await act(c.factory, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });

  const link = await profileOfFactoryUser('factory@shams.local');
  assert.ok(link.factoryProfileId, 'the seeded Shams factory is linked to a shared factory profile');
  const [before] = await q<{ website: string; phone2: string; industrialRegistryNumber: string; version: number }>(
    'SELECT website, phone2, industrialRegistryNumber, version FROM factory_profiles WHERE id = ?', link.factoryProfileId!);
  assert.ok(before.industrialRegistryNumber, 'the seeded profile already has a registry number');

  const id = await createCompleteDraft(c.factory, 'IND-WB-0001');
  const general = { companyName: 'مصنع تجريبي للصناعات المعدنية', governorate: 'sharqia', industrialZone: '10th-ramadan', address: 'المنطقة الصناعية الثالثة', phone1: '0221234567', phone2: '0227654321', website: 'www.writeback.test' };
  assert.equal((await c.factory.put(`/applications/${id}/data/general`, general)).status, 200);

  const [draftState] = await q<{ website: string; version: number }>('SELECT website, version FROM factory_profiles WHERE id = ?', link.factoryProfileId!);
  assert.equal(draftState.website, before.website, 'saving a draft does not write to the profile');
  assert.equal(draftState.version, before.version);

  const r = await act(c.factory, id, 'submit');
  assert.equal(r.status, 200, JSON.stringify(r.json));

  const [afterSubmit] = await q<{ website: string; phone2: string; industrialRegistryNumber: string; version: number }>(
    'SELECT website, phone2, industrialRegistryNumber, version FROM factory_profiles WHERE id = ?', link.factoryProfileId!);
  assert.equal(afterSubmit.website, 'https://www.writeback.test', 'the profile keeps the normalized URL');
  assert.equal(afterSubmit.phone2, '0227654321');
  assert.equal(afterSubmit.industrialRegistryNumber, before.industrialRegistryNumber, 'a locked identity field is not overwritten');
  assert.ok(afterSubmit.version > before.version);

  const audit = await q<{ initiativeId: string; details: string; actorUserId: string }>(
    "SELECT initiativeId, details, actorUserId FROM audit_logs WHERE action = 'profile.writeback' AND entityId = ?", link.factoryProfileId!);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].initiativeId, 'shams');
  assert.equal(audit[0].actorUserId, link.userId);
  const fields = JSON.parse(audit[0].details).fields as string[];
  assert.ok(fields.includes('factory.website') && fields.includes('factory.phone2'));
  assert.ok(!fields.includes('factory.industrialRegistryNumber'));

  await act(c.factory, id, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
});

test('W-2 a Shams file without a shared profile (older data) gets one on submit', async () => {
  const open = (await c.factory2.get('/factory/profile')).json.data.openApplicationId;
  if (open) await act(c.factory2, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
  const link = await profileOfFactoryUser('factory2@shams.local');
  await q('UPDATE shams_factories f JOIN initiative_memberships m ON m.organizationId = f.organizationId SET f.factoryProfileId = NULL WHERE m.userId = ? AND m.initiativeId = \'shams\'', link.userId);

  const id = await createCompleteDraft(c.factory2, 'IND-WB-0002');
  const r = await act(c.factory2, id, 'submit');
  assert.equal(r.status, 200, JSON.stringify(r.json));

  const relinked = await profileOfFactoryUser('factory2@shams.local');
  assert.ok(relinked.factoryProfileId && relinked.factoryProfileId !== link.factoryProfileId, 'a new shared factory profile was created and linked');
  const [p] = await q<{ companyName: string; industrialRegistryNumber: string }>('SELECT companyName, industrialRegistryNumber FROM factory_profiles WHERE id = ?', relinked.factoryProfileId!);
  assert.equal(p.companyName, 'مصنع تجريبي للصناعات المعدنية');
  assert.equal(p.industrialRegistryNumber, 'IND-WB-0002', 'an empty locked field is filled once from the submission');
  const [owner] = await q<{ role: string }>('SELECT role FROM factory_profile_members WHERE factoryProfileId = ? AND userId = ?', relinked.factoryProfileId!, link.userId);
  assert.equal(owner.role, 'owner');
  await act(c.factory2, id, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
});
