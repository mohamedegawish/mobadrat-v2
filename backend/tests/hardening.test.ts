// Hard tests of the platform layer (the initiative modules have their own: IDOR, escalation, races, uploads, headers).
// Forged tokens, immediate session revocation, isolation between initiatives, mass assignment, hostile input,
// uploads, account enumeration, races on platform writes, security headers / CORS / cookies, and the real rate limits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { Client, isolateTestEnv, newPerson, PASSWORD, pdf, sentMails, flushMail, startServer } from './helpers.js';

const env = isolateTestEnv('hardening');
let srv: Awaited<ReturnType<typeof startServer>>;
let admin: Client;
before(async () => { srv = await startServer(); admin = await new Client(srv.base).login('admin@mobadrat.local'); });
after(async () => { await srv.close(); await env.cleanup(); });

const raw = (p: string, init: RequestInit = {}) => fetch(`${srv.base}${p}`, init);
const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });
let n = 0;
const email = (tag: string) => `hard.${tag}.${Date.now()}.${++n}@test.local`;
async function userId(c: Client): Promise<string> { return (await c.get('/me')).json.data.user.id; }

test('H-01 forged, tampered, expired, mistyped and revoked tokens are refused everywhere', async () => {
  const { config } = await import('../src/config.js');
  const person = await newPerson(srv.base, email('tok'));
  const id = await userId(person);
  const good = person.token!;
  const claims = { sub: id, typ: 'access', tv: 0 };
  const forged: Record<string, string> = {
    garbage: 'not-a-token',
    wrongSecret: jwt.sign(claims, 'another-secret-entirely-another-secret', { expiresIn: 600 }),
    algNone: `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.`,
    hs512: jwt.sign(claims, config.jwtSecret, { algorithm: 'HS512', expiresIn: 600 }),
    refreshAsAccess: jwt.sign({ sub: id, jti: 'x', typ: 'refresh' }, config.jwtSecret, { expiresIn: 600 }),
    expired: jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 }, config.jwtSecret),
    unknownUser: jwt.sign({ ...claims, sub: 'usr-does-not-exist' }, config.jwtSecret, { expiresIn: 600 }),
    oldVersion: jwt.sign({ ...claims, tv: 99 }, config.jwtSecret, { expiresIn: 600 }),
    tamperedPayload: (() => { const [h, , s] = good.split('.'); return `${h}.${Buffer.from(JSON.stringify({ ...claims, sub: 'usr-admin-x', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.${s}`; })(),
  };
  for (const p of ['/me', '/me/profile', '/admin/bodies', '/admin/stats', '/i/shams/applications', '/i/sona3/applications', '/me/notifications']) {
    assert.equal((await raw(p)).status, 401, `no token ${p}`);
    for (const [name, t] of Object.entries(forged)) assert.equal((await raw(p, bearer(t))).status, 401, `${name} → ${p}`);
    assert.equal((await raw(p, { headers: { Authorization: good } })).status, 401, `token without "Bearer" → ${p}`);
  }
  assert.equal((await raw('/me', bearer(good))).status, 200, 'the genuine token still works');
});

test('H-02 revocation is immediate: deactivating an account, changing a password, suspending a membership', async () => {
  // Deactivated by the platform: the live access token and the refresh cookie stop working at once.
  const p = await newPerson(srv.base, email('deact'));
  const id = await userId(p);
  assert.equal((await admin.put(`/admin/users/${id}`, { isActive: false })).status, 200);
  assert.equal((await p.get('/me')).status, 401);
  assert.equal((await p.post('/auth/refresh')).status, 401);
  // With the right password only (no enumeration): «the account is disabled».
  const relog = await new Client(srv.base).post('/auth/login', { email: (await admin.get(`/admin/users/${id}`)).json.data.email, password: PASSWORD });
  assert.equal(relog.status, 403);
  assert.equal(relog.json.code, 'ACCOUNT_DISABLED');
  const wrong = await new Client(srv.base).post('/auth/login', { email: (await admin.get(`/admin/users/${id}`)).json.data.email, password: 'Wrong2026x' });
  assert.equal(wrong.json.code, 'INVALID_CREDENTIALS', 'a wrong password does not reveal the account state');
  assert.equal((await admin.put(`/admin/users/${id}`, { isActive: true })).status, 200);

  // A password change ends every other session of the account.
  const mail = email('pwd');
  const a = await newPerson(srv.base, mail);
  const b = await new Client(srv.base).login(mail);
  const r = await a.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Changed2026x' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await b.get('/me')).status, 401, 'the other session\'s access token is revoked');
  assert.equal((await b.post('/auth/refresh')).status, 401, 'and its refresh token');
  const oldToken = a.token!;
  a.token = r.json.data.accessToken;
  assert.ok(a.token && a.token !== oldToken, 'the session that changed it gets a fresh token');
  assert.equal((await a.get('/me')).status, 200, 'and continues with it');
  assert.equal((await raw('/me', bearer(oldToken))).status, 401, 'its previous token is revoked too');

  // A suspended membership closes that initiative only, at once.
  const imc = await new Client(srv.base).login('imc1@shams.local');
  const membership = (await admin.get('/admin/users?q=imc1%40shams.local')).json.data.items[0].memberships.find((m: any) => m.initiativeId === 'shams');
  assert.equal((await imc.get('/i/shams/applications')).status, 200);
  assert.equal((await admin.put(`/admin/memberships/${membership.id}`, { status: 'suspended' })).status, 200);
  assert.equal((await imc.get('/i/shams/applications')).status, 403);
  assert.equal((await imc.get('/me')).status, 200, 'the platform account itself stays usable');
  assert.equal((await admin.put(`/admin/memberships/${membership.id}`, { status: 'active' })).status, 200);
  assert.equal((await imc.get('/i/shams/applications')).status, 200);
});

test('H-03 isolation between initiatives and between platform and initiative roles', async () => {
  const shamsStaff = await new Client(srv.base).login('imc1@shams.local');
  const sona3Applicant = await new Client(srv.base).login('applicant@sona3.local');
  const ministry = await new Client(srv.base).login('ministry@mobadrat.local');
  const shamsAdmin = await new Client(srv.base).login('admin@shams.local');
  const nobody = await newPerson(srv.base, email('nobody'));
  // Staff of one initiative: nothing in the other, read or write.
  assert.equal((await shamsStaff.get('/i/sona3/applications')).status, 403);
  assert.equal((await shamsStaff.post('/i/sona3/applications/app-x/actions/accept', { expectedVersion: 1 })).status, 403);
  assert.equal((await sona3Applicant.get('/i/shams/applications')).status, 403);
  assert.equal((await sona3Applicant.post('/i/shams/applications', {})).status, 403);
  // A Shams application id asked through Sona3 (by its own staff) does not exist there.
  const shamsAppId = (await shamsStaff.get('/i/shams/applications')).json.data.items[0]?.id;
  const sona3Imc = await new Client(srv.base).login('imc@sona3.local');
  if (shamsAppId) assert.equal((await sona3Imc.get(`/i/sona3/applications/${shamsAppId}`)).status, 404);
  // Platform viewers have no initiative membership: no initiative data through module APIs.
  assert.equal((await ministry.get('/i/shams/applications')).status, 403);
  assert.equal((await ministry.get('/admin/stats')).status, 200);
  // An initiative's administrator is not a platform administrator.
  for (const p of ['/admin/users', '/admin/stats', '/admin/bodies', '/admin/audit-logs', '/admin/readiness']) assert.equal((await shamsAdmin.get(p)).status, 403, p);
  // A person without any membership: refused by every initiative until enrolled through the platform.
  assert.equal((await nobody.get('/i/shams/applications')).status, 403);
  assert.equal((await nobody.get('/i/sona3/applications')).status, 403);
  assert.equal((await nobody.post('/i/sona3/applications', {})).status, 403);
});

test('H-04 mass assignment: privileged or unknown fields are refused on platform endpoints and change nothing', async () => {
  const mail = email('mass');
  let r = await new Client(srv.base).post('/auth/register', { fullName: 'مهاجم', email: mail, mobile: '01011112222', password: PASSWORD, platformRole: 'super_admin', isActive: true, emailVerified: true });
  assert.equal(r.status, 400);
  assert.equal((await admin.get(`/admin/users?q=${encodeURIComponent(mail)}`)).json.data.items.length, 0, 'no account created');
  const p = await newPerson(srv.base, email('mass2'));
  r = await p.put('/me/profile', { values: { 'person.platformRole': 'super_admin' } });
  assert.equal(r.status, 400);
  r = await p.put('/me/profile', { values: { 'factory.companyName': 'منشأة' } });
  assert.equal(r.status, 400, 'a factory key is not a person field');
  r = await p.post('/me/initiatives/sona3/enroll', { role: 'imc_officer', organizationId: 'org-imc' });
  assert.equal(r.status, 400);
  const id = await userId(p);
  r = await admin.put(`/admin/users/${id}`, { passwordHash: 'x', email: 'other@test.local', tokenVersion: 0 });
  assert.equal(r.status, 400);
  const me = (await p.get('/me')).json.data;
  assert.equal(me.user.platformRole, null);
  assert.deepEqual(me.memberships, []);
});

test('H-05 hostile input: oversized and malformed bodies, prototype pollution, injection strings, control characters, HTML in names', async () => {
  const big = JSON.stringify({ fullName: 'x'.repeat(2 * 1024 * 1024), email: 'big@test.local', mobile: '01011112222', password: PASSWORD });
  let r = await raw('/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big });
  assert.equal(r.status, 413);
  assert.ok(!(await r.text()).includes('at '), 'no stack trace');
  r = await raw('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email": "a@b.c", "password": ' });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.ok(body.code && !JSON.stringify(body).includes('SyntaxError'), JSON.stringify(body));
  // Prototype pollution through JSON keys.
  await raw('/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"__proto__": {"polluted": "yes"}, "constructor": {"prototype": {"polluted2": "yes"}}, "fullName": "x"}' });
  const p = await newPerson(srv.base, email('proto'));
  await p.put('/me/profile', JSON.parse('{"values": {"__proto__": {"polluted3": "yes"}}}'));
  assert.equal(({} as any).polluted, undefined);
  assert.equal(({} as any).polluted2, undefined);
  assert.equal(({} as any).polluted3, undefined);
  // Injection-like and absurd query strings: answered, never a server error.
  for (const q of ["' OR 1=1 --", '%" UNION SELECT * FROM users --', '\\', '%_%', 'ا'.repeat(3000), '<script>', '\u0000']) {
    for (const path of ['/admin/users', '/admin/bodies', '/admin/audit-logs']) {
      const res = await admin.get(`${path}?q=${encodeURIComponent(q)}`);
      // 431/414: a URL longer than the server accepts is refused by the HTTP layer itself (never reaches the app).
      assert.ok([200, 400, 414, 431].includes(res.status), `${path} q=${JSON.stringify(q.slice(0, 20))} → ${res.status}`);
    }
  }
  const shamsImc = await new Client(srv.base).login('imc1@shams.local');
  const sona3Imc = await new Client(srv.base).login('imc@sona3.local');
  for (const page of ['-1', '0', 'abc', '1e9', '99999999999999999999', 'Infinity', '1.5']) {
    for (const [c, path] of [[admin, '/admin/users'], [admin, '/admin/audit-logs'], [shamsImc, '/i/shams/applications'], [sona3Imc, '/i/sona3/applications']] as Array<[Client, string]>) {
      const res = await c.get(`${path}?page=${page}&pageSize=${page}`);
      assert.equal(res.status, 200, `${path} page=${page}`);
    }
  }
  // HTML and bidi control characters in a name: stored as text, escaped in the e-mail sent to the person.
  const mail = email('html');
  r = await raw('/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: '<img src=x onerror=alert(1)>‮', email: mail, mobile: '01011112222', password: PASSWORD }) });
  assert.ok(r.status === 201 || r.status === 400, `status ${r.status}`);
  if (r.status === 201) {
    await flushMail();
    const m = [...sentMails].reverse().find((x) => x.to.includes(mail));
    assert.ok(m, 'verification mail sent');
    assert.ok(!m!.html.includes('<img src=x'), 'the name is escaped in the e-mail');
  }
  // Unknown API route: a guest learns nothing (401, like any protected route); a signed-in user gets a JSON 404.
  r = await raw('/no-such-route');
  assert.equal(r.status, 401);
  assert.match(r.headers.get('content-type') ?? '', /json/);
  r = await raw('/no-such-route', bearer(p.token!));
  assert.equal(r.status, 404);
  assert.match(r.headers.get('content-type') ?? '', /json/);
});

test('H-06 profile documents: PDFs only, size limit, hostile names, owner only', async () => {
  const a = await newPerson(srv.base, email('docs'));
  const b = await newPerson(srv.base, email('docs2'));
  let r = await a.upload('/me/profile-documents', { kind: 'nationalIdFile' }, Buffer.from('MZ\x90\x00 not a pdf'), 'id.pdf');
  assert.ok(r.status === 400 || r.status === 422, `fake PDF → ${r.status}`);
  r = await a.upload('/me/profile-documents', { kind: 'nationalIdFile' }, pdf('ok'), 'id.exe');
  assert.ok(r.status === 400 || r.status === 422, `wrong extension → ${r.status}`);
  r = await a.upload('/me/profile-documents', { kind: 'notAKind' }, pdf('ok'));
  assert.ok(r.status === 400 || r.status === 422, `unknown kind → ${r.status}`);
  r = await a.upload('/me/profile-documents', { kind: 'commercialRegisterFile', ownerId: 'fac-of-someone-else' }, pdf('ok'));
  assert.ok(r.status === 403 || r.status === 404, `someone else's factory → ${r.status}`);
  const prev = process.env.MAX_FILE_SIZE_MB;
  process.env.MAX_FILE_SIZE_MB = '1';
  try {
    r = await a.upload('/me/profile-documents', { kind: 'nationalIdFile' }, Buffer.concat([pdf('big'), Buffer.alloc(1_200_000, 32)]));
    assert.equal(r.status, 413);
  } finally { if (prev === undefined) delete process.env.MAX_FILE_SIZE_MB; else process.env.MAX_FILE_SIZE_MB = prev; }
  r = await a.upload('/me/profile-documents', { kind: 'nationalIdFile' }, pdf('hostile'), '..\\..\\evil\r\nX-Injected: 1.pdf');
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const docId = r.json.data.id ?? r.json.data.document?.id;
  assert.ok(docId, JSON.stringify(r.json.data));
  const dl = await raw(`/me/profile-documents/${docId}/download`, bearer(a.token!));
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('x-injected'), null, 'no header injection through the file name');
  assert.match(dl.headers.get('content-type') ?? '', /application\/pdf/);
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await raw(`/me/profile-documents/${docId}/download`, bearer(b.token!))).status, 404, 'another person cannot download it');
});

test('H-07 no account enumeration: register, forgot, resend and login answer the same for known and unknown e-mails', async () => {
  const known = email('known');
  await newPerson(srv.base, known);
  const unknown = email('unknown');
  const c = new Client(srv.base);
  const strip = (j: any) => JSON.stringify({ ...j, data: j.data ? { ...j.data, email: undefined } : undefined });
  const reg = await Promise.all([known, unknown].map((e) => c.post('/auth/register', { fullName: 'مواطن', email: e, mobile: '01011112222', password: PASSWORD })));
  assert.equal(reg[0].status, reg[1].status);
  assert.equal(strip(reg[0].json), strip(reg[1].json));
  for (const p of ['/auth/forgot-password', '/auth/resend-verification']) {
    const [x, y] = await Promise.all([known, unknown].map((e) => c.post(p, { email: e })));
    assert.equal(x.status, y.status, p);
    assert.equal(JSON.stringify(x.json), JSON.stringify(y.json), p);
  }
  const [wrongPw, noUser] = await Promise.all([c.post('/auth/login', { email: known, password: 'Wrong2026x' }), c.post('/auth/login', { email: unknown, password: 'Wrong2026x' })]);
  assert.equal(wrongPw.status, noUser.status);
  assert.equal(wrongPw.json.code, noUser.json.code);
  assert.equal(wrongPw.json.messageAr, noUser.json.messageAr);
});

test('H-08 races on platform writes: one account per e-mail, one membership per enrolment, no lost profile updates', async () => {
  const mail = email('race');
  const results = await Promise.all(Array.from({ length: 8 }, () => new Client(srv.base).post('/auth/register', { fullName: 'سباق', email: mail, mobile: '01011112222', password: PASSWORD })));
  assert.ok(results.every((r) => r.status === 201), JSON.stringify(results.map((r) => r.status)));
  const { getDb } = await import('../src/core/db/index.js');
  const count = Number((await getDb().prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get(mail) as { n: number }).n);
  assert.equal(count, 1, 'exactly one account');
  // The same through an initiative's own registration form.
  const mail2 = email('race-sona3');
  const viaSona3 = await Promise.all(Array.from({ length: 6 }, () => new Client(srv.base).post('/i/sona3/public/register', { fullName: 'سباق صناع', email: mail2, mobile: '01011112222', password: PASSWORD })));
  assert.ok(viaSona3.every((r) => r.status === 201), JSON.stringify(viaSona3.map((r) => r.status)));
  assert.equal(Number((await getDb().prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get(mail2) as { n: number }).n), 1);
  assert.equal(Number((await getDb().prepare("SELECT COUNT(*) AS n FROM initiative_memberships m JOIN users u ON u.id = m.userId WHERE u.email = ? AND m.initiativeId = 'sona3'").get(mail2) as { n: number }).n), 1, 'one membership, one applicant file');

  // Concurrent enrolments of one person into one initiative.
  const p = await newPerson(srv.base, email('enroll'));
  const nid = `29501150100${String(Date.now() % 1000).padStart(3, '0')}`;
  assert.equal((await p.put('/me/profile', { values: { 'person.fullNameAr': 'متقدم السباق', 'person.nationalId': nid.slice(0, 13) + '1', 'person.birthDate': '1995-01-15', 'person.nationality': 'egyptian', 'person.governorate': 'cairo', 'person.address': 'القاهرة', 'person.phone': '01011112222', 'person.qualification': 'هندسة', 'person.experience': 'خبرة' } })).status, 200);
  assert.equal((await p.upload('/me/profile-documents', { kind: 'nationalIdFile' }, pdf('race-nid'))).status, 201);
  const enrolls = await Promise.all(Array.from({ length: 5 }, () => p.post('/me/initiatives/sona3/enroll', {})));
  const created = enrolls.filter((r) => r.status === 201).length;
  assert.equal(created, 1, JSON.stringify(enrolls.map((r) => [r.status, r.json.code])));
  assert.ok(enrolls.every((r) => r.status === 201 || (r.status === 200 && r.json.data.alreadyEnrolled)), JSON.stringify(enrolls.map((r) => r.status)));
  const id = await userId(p);
  assert.equal(Number((await getDb().prepare("SELECT COUNT(*) AS n FROM initiative_memberships WHERE userId = ? AND initiativeId = 'sona3'").get(id) as { n: number }).n), 1);
  assert.equal(Number((await getDb().prepare('SELECT COUNT(*) AS n FROM sona3_applications a JOIN sona3_applicants p ON p.id = a.applicantId WHERE p.userId = ?').get(id) as { n: number }).n), 1);

  // Concurrent profile saves: every save counted (version), the final value is one of them.
  const before = (await p.get('/me/profile')).json.data;
  const phones = ['01000000001', '01000000002', '01000000003', '01000000004', '01000000005'];
  const saves = await Promise.all(phones.map((ph) => p.put('/me/profile', { values: { 'person.phone': ph } })));
  assert.ok(saves.every((r) => r.status === 200));
  const afterProfile = (await p.get('/me/profile')).json.data;
  assert.ok(phones.includes(afterProfile.person?.values?.['person.phone'] ?? afterProfile.values?.['person.phone']));
  const v0 = before.person?.version ?? before.version;
  const v1 = afterProfile.person?.version ?? afterProfile.version;
  if (typeof v0 === 'number' && typeof v1 === 'number') assert.equal(v1, v0 + phones.length, 'no lost update');
});

test('H-09 security headers, CORS and the session cookie', async () => {
  let r = await raw('/initiatives');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.ok(r.headers.get('x-frame-options'), 'clickjacking protection');
  r = await raw('/initiatives', { headers: { Origin: 'https://evil.example' } });
  assert.equal(r.headers.get('access-control-allow-origin'), null, 'a foreign origin is not allowed');
  r = await raw('/initiatives', { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(r.headers.get('access-control-allow-credentials'), 'true');
  const pre = await raw('/auth/login', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), null, 'no preflight for a foreign origin');
  r = await raw('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@mobadrat.local', password: PASSWORD }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie') ?? '';
  assert.match(cookie, /mobadrat_refresh=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Path=\/api\/v1\/auth/i);
  const j = await r.json();
  assert.ok(!JSON.stringify(j).includes(cookie.split(';')[0].split('=')[1]), 'the refresh token is never in the body');
  assert.ok(!('passwordHash' in (j.data.user ?? {})), 'no password hash in the user');
});

test('H-10 the real rate limits: sign-in, registration, e-mail flows and public reads (scale 1)', async () => {
  const prev = process.env.RATE_LIMIT_SCALE;
  process.env.RATE_LIMIT_SCALE = '1';
  try {
    const c = new Client(srv.base);
    const burst = async (count: number, call: (i: number) => Promise<{ status: number; json: any }>) => {
      const out: number[] = [];
      for (let i = 0; i < count; i++) {
        const r = await call(i);
        out.push(r.status);
        if (r.status === 429) { assert.equal(r.json.code, 'RATE_LIMITED'); break; }
      }
      return out;
    };
    // Different e-mails each time (the per-account throttle is a separate, escalating delay).
    let s = await burst(55, (i) => c.post('/auth/login', { email: `flood${i}@test.local`, password: 'Wrong2026x' }));
    assert.equal(s[s.length - 1], 429, `login: ${s.length} attempts`);
    s = await burst(25, (i) => c.post('/auth/register', { fullName: 'فيضان', email: `flood.reg${i}.${Date.now()}@test.local`, mobile: '01011112222', password: PASSWORD }));
    assert.equal(s[s.length - 1], 429, `register: ${s.length} attempts`);
    s = await burst(25, (i) => c.post('/auth/forgot-password', { email: `flood.fp${i}@test.local` }));
    assert.equal(s[s.length - 1], 429, `forgot: ${s.length} attempts`);
    const meta = async () => { const r = await raw('/meta/profile'); return { status: r.status, json: await r.json() }; };
    s = await burst(130, () => meta());
    assert.equal(s[s.length - 1], 429, `public reads: ${s.length} requests`);
  } finally {
    if (prev === undefined) delete process.env.RATE_LIMIT_SCALE; else process.env.RATE_LIMIT_SCALE = prev;
  }
});
