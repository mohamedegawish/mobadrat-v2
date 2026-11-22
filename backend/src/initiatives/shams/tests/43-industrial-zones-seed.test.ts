// Industrial zones per governorate: reference data seeded automatically on every boot (initDb → seedReferenceData), in every
// environment including production, idempotently; served by GET /meta and used by the form validation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, q, type Started } from './helpers.js';

const env = isolateTestEnv('zones');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

const LEGACY = [['sharqia', '10th-ramadan'], ['giza', '6th-october'], ['qalyubia', 'obour'], ['qalyubia', 'khanka'], ['monufia', 'sadat-city'], ['suez', 'sczone']];

test('Z-1 the seed data is consistent: 158 zones, known governorates, stable ids, legacy ids kept', async () => {
  const { INDUSTRIAL_ZONES } = await import('../../../core/reference/industrialZones.js');
  const { listGovernorates } = await import('../config/locations.js');
  const govs = new Set(listGovernorates().map((g) => g.value));
  assert.equal(INDUSTRIAL_ZONES.length, 158);
  const keys = new Set<string>();
  for (const z of INDUSTRIAL_ZONES) {
    assert.ok(govs.has(z.governorate), `unknown governorate ${z.governorate}`);
    assert.match(z.value, /^[a-z0-9]+(-[a-z0-9]+)*$/, z.value);
    assert.notEqual(z.value, 'other', 'reserved');
    assert.match(z.labelAr, /[؀-ۿ]/, `${z.value}: Arabic label`);
    assert.ok(z.labelEn.trim() && !/[؀-ۿ]/.test(z.labelEn), `${z.value}: English label`);
    assert.ok(!z.labelAr.includes('(*)') && !/ـ{2,}/.test(z.labelAr), `${z.value}: cleaned`);
    const k = `${z.governorate}|${z.value}`;
    assert.ok(!keys.has(k), `duplicate ${k}`);
    keys.add(k);
  }
  for (const [g, v] of LEGACY) assert.ok(keys.has(`${g}|${v}`), `legacy id ${g}/${v} must stay valid`);
  const perGov = (g: string) => INDUSTRIAL_ZONES.filter((z) => z.governorate === g).length;
  assert.equal(perGov('cairo'), 22);
  assert.equal(perGov('beni-suef'), 13);
  assert.equal(perGov('gharbia'), 0, 'none in the IDA directory');
  assert.equal(new Set(INDUSTRIAL_ZONES.map((z) => z.governorate)).size, 26);
});

test('Z-2 the boot seed fills the table once; running it again changes nothing', async () => {
  const rows = await q<{ n: number }>("SELECT COUNT(*) AS n FROM industrial_zones WHERE source = 'seed' AND isActive = 1");
  assert.equal(rows[0].n, 158, 'seeded at start-up');
  const { seedIndustrialZones } = await import('../../../core/reference/referenceSeed.js');
  assert.deepEqual(await seedIndustrialZones(), { inserted: 0, updated: 0, deactivated: 0 });
  // initDb (the production boot path) runs it too, still a no-op.
  const { initDb } = await import('../db/sqlite.js');
  await initDb();
  assert.equal((await q<{ n: number }>('SELECT COUNT(*) AS n FROM industrial_zones'))[0].n, 158);
});

test('Z-3 re-seeding repairs edited seed rows, deactivates removed ones (never deletes), and leaves non-seed rows alone', async () => {
  const { getDb } = await import('../db/sqlite.js');
  const { seedIndustrialZones, loadZoneCache } = await import('../../../core/reference/referenceSeed.js');
  const { isValidZone, findGovernorate, zoneLabel } = await import('../config/locations.js');
  const db = getDb();
  const now = new Date().toISOString();
  await db.prepare("UPDATE industrial_zones SET labelAr = 'اسم قديم' WHERE governorate = 'giza' AND value = 'abu-rawash'").run();
  await db.prepare("INSERT INTO industrial_zones (id, governorate, value, labelAr, labelEn, authority, sortOrder, isActive, source, createdAt, updatedAt) VALUES ('zone-old', 'giza', 'retired-zone', 'منطقة ملغاة', 'Retired zone', 'governorate', 999, 1, 'seed', ?, ?)").run(now, now);
  await db.prepare("INSERT INTO industrial_zones (id, governorate, value, labelAr, labelEn, authority, sortOrder, isActive, source, createdAt, updatedAt) VALUES ('zone-admin', 'gharbia', 'mahalla', 'المنطقة الصناعية بالمحلة', 'Mahalla', 'governorate', 5, 1, 'admin', ?, ?)").run(now, now);

  assert.deepEqual(await seedIndustrialZones(), { inserted: 0, updated: 1, deactivated: 1 });
  assert.equal((await q<{ l: string }>("SELECT labelAr AS l FROM industrial_zones WHERE value = 'abu-rawash'"))[0].l, 'المنطقة الصناعية بأبو رواش وتوسعاتها');
  const retired = await q<{ isActive: number }>("SELECT isActive FROM industrial_zones WHERE id = 'zone-old'");
  assert.equal(retired.length, 1, 'kept, not deleted');
  assert.equal(Number(retired[0].isActive), 0);
  assert.equal(Number((await q<{ isActive: number }>("SELECT isActive FROM industrial_zones WHERE id = 'zone-admin'"))[0].isActive), 1, 'non-seed row untouched');

  await loadZoneCache();
  const giza = findGovernorate('giza')!.zones.map((z) => z.value);
  assert.ok(!giza.includes('retired-zone'), 'a retired zone is not offered');
  assert.ok(isValidZone('giza', 'retired-zone'), 'but an application that stored it stays valid');
  assert.equal(zoneLabel('giza', 'retired-zone')?.ar, 'منطقة ملغاة', 'and still has a label in reports');
  assert.ok(findGovernorate('gharbia')!.zones.some((z) => z.value === 'mahalla'));

  await db.prepare("DELETE FROM industrial_zones WHERE id IN ('zone-old', 'zone-admin')").run();
  await loadZoneCache();
});

test('Z-4 GET /meta lists each governorate with its zones plus «أخرى»; the form accepts a listed zone and refuses another governorate’s', async () => {
  const meta = (await c.factory.get('/meta')).json.data;
  assert.equal(meta.governorates.length, 27);
  const gov = (v: string) => meta.governorates.find((g: any) => g.value === v);
  assert.equal(gov('cairo').zones.length, 23);
  assert.deepEqual(gov('gharbia').zones.map((z: any) => z.value), ['other']);
  assert.equal(gov('giza').zones.at(-1).value, 'other', '«أخرى» last');
  assert.ok(gov('sohag').zones.some((z: any) => z.labelAr === 'المنطقة الصناعية الاستثمارية بالمطاهير'));
  for (const g of meta.governorates) for (const z of g.zones) assert.ok(z.labelAr && z.labelEn && z.value, `${g.value}/${z.value}`);

  const open = (await c.factory.get('/factory/profile')).json.data.openApplicationId;
  const id = open ?? (await c.factory.post('/applications', {})).json.data.id;
  const ok = await c.factory.put(`/applications/${id}/data/general`, { governorate: 'giza', industrialZone: 'abu-rawash' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.data.data.industrialZone, 'abu-rawash');
  const wrong = await c.factory.put(`/applications/${id}/data/general`, { governorate: 'giza', industrialZone: 'kawthar' });
  assert.equal(wrong.status, 400, 'a Sohag zone is not a Giza zone');
  assert.equal((await c.factory.put(`/applications/${id}/data/general`, { governorate: 'gharbia', industrialZone: 'other' })).status, 200);
});
