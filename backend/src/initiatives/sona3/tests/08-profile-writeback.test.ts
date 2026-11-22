// Shared person profile write-back: after a successful submit (never on drafts), the submitted personal section updates
// the applicant's person profile; identity data (national ID, birth date) already in the profile is never overwritten.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, buildWorld, newApplicant, createCompleteDraft, act, ok, q, nationalIdFor, type Started } from './helpers.js';

const env = isolateTestEnv('writeback');
let srv: Started;

before(async () => { srv = await startServer(); await buildWorld(srv); });
after(async () => { await srv.close(); await env.cleanup(); });

async function ownerOf(appId: string): Promise<string> {
  const [r] = await q<{ userId: string }>(
    `SELECT m.userId FROM sona3_applications a JOIN sona3_applicants p ON p.id = a.applicantId
       JOIN initiative_memberships m ON m.organizationId = p.organizationId AND m.initiativeId = 'sona3' WHERE a.id = ?`, appId);
  return r.userId;
}
const profile = async (userId: string) => (await q<Record<string, any>>('SELECT * FROM person_profiles WHERE userId = ?', userId))[0];

test('W-1 the draft leaves the profile alone; submit fills the person profile from the personal section (audited)', async () => {
  const a = await newApplicant(srv);
  const nid = nationalIdFor('1996-03-20');
  const id = await createCompleteDraft(a, { birthDate: '1996-03-20', nationalId: nid });
  const userId = await ownerOf(id);
  const draft = await profile(userId);
  assert.ok(!draft || !draft.nationalId, 'saving the draft does not write the profile');

  ok(await act(a, id, 'submit'), 'submit');
  const p = await profile(userId);
  assert.equal(p.nationalId, nid);
  assert.equal(p.birthDate, '1996-03-20');
  assert.equal(p.governorate, 'cairo');
  assert.equal(p.qualification, 'بكالوريوس هندسة ميكانيكا');
  const audit = await q<{ initiativeId: string; entityType: string }>("SELECT initiativeId, entityType FROM audit_logs WHERE action = 'profile.writeback' AND entityId = ?", userId);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].initiativeId, 'sona3');
  assert.equal(audit[0].entityType, 'person_profile');
});

test('W-2 identity already in the profile is not overwritten; the other submitted fields are', async () => {
  const a = await newApplicant(srv);
  const id = await createCompleteDraft(a, { birthDate: '1997-07-07', nationalId: nationalIdFor('1997-07-07') });
  const userId = await ownerOf(id);
  const kept = nationalIdFor('1990-01-01');
  const now = new Date().toISOString();
  await q('INSERT INTO person_profiles (userId, nationalId, birthDate, address, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)', userId, kept, '1990-01-01', 'عنوان قديم', now, now);

  ok(await act(a, id, 'submit'), 'submit');
  const p = await profile(userId);
  assert.equal(p.nationalId, kept, 'the locked national ID stays');
  assert.equal(p.birthDate, '1990-01-01', 'the locked birth date stays');
  assert.equal(p.address, '12 شارع التحرير، القاهرة', 'a regular field takes the submitted value');
});
