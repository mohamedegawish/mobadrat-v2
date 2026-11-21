/**
 * البيانات المرجعية (لا بيانات تطوير): تُزرع عند كل تشغيل في كل البيئات بما فيها الإنتاج — على عكس db/seed.ts (تطوير فقط).
 * حاليًا: المناطق الصناعية لكل محافظة (reference/industrialZones.ts → جدول industrial_zones).
 *
 * idempotent: يضيف الناقص، ويحدّث الأسماء والتبعية والترتيب لصفوف source='seed'، ويُعلِّم الصف الذي حُذف من القائمة
 * isActive=0 — لا يحذف صفًا أبدًا (القيمة مخزنة في طلبات قائمة). صفوف source≠'seed' لا تُلمس.
 * على MySQL يعمل تحت قفل (withJobLock) فلا تتسابق نسختان تبدآن معًا؛ النسخة التي لم تأخذ القفل تكتفي بقراءة الجدول.
 */
import { randomUUID } from 'node:crypto';
import { getDb, nowIso, tx, withJobLock } from './index.js';
import { INDUSTRIAL_ZONES } from './reference/industrialZones.js';
import { setZoneCache, type ZoneRecord } from '../config/locations.js';

interface ZoneRow { id: string; governorate: string; value: string; labelAr: string; labelEn: string; authority: string; sortOrder: number; isActive: number; source: string }

export interface ReferenceSeedResult { inserted: number; updated: number; deactivated: number }

export async function seedIndustrialZones(): Promise<ReferenceSeedResult> {
  const db = getDb();
  return await tx(async () => {
    const existing = await db.prepare('SELECT id, governorate, value, labelAr, labelEn, authority, sortOrder, isActive, source FROM industrial_zones').all() as unknown as ZoneRow[];
    const byKey = new Map(existing.map((r) => [`${r.governorate}|${r.value}`, r]));
    const wanted = new Set<string>();
    const now = nowIso();
    const result: ReferenceSeedResult = { inserted: 0, updated: 0, deactivated: 0 };
    let order = 0;
    for (const z of INDUSTRIAL_ZONES) {
      const key = `${z.governorate}|${z.value}`;
      wanted.add(key);
      order += 10;
      const row = byKey.get(key);
      if (!row) {
        await db.prepare(`INSERT INTO industrial_zones (id, governorate, value, labelAr, labelEn, authority, sortOrder, isActive, source, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'seed', ?, ?)`).run(`zone-${randomUUID()}`, z.governorate, z.value, z.labelAr, z.labelEn, z.authority, order, now, now);
        result.inserted++;
      } else if (row.source === 'seed' && (row.labelAr !== z.labelAr || row.labelEn !== z.labelEn || row.authority !== z.authority || Number(row.sortOrder) !== order || Number(row.isActive) !== 1)) {
        await db.prepare('UPDATE industrial_zones SET labelAr = ?, labelEn = ?, authority = ?, sortOrder = ?, isActive = 1, updatedAt = ? WHERE id = ?')
          .run(z.labelAr, z.labelEn, z.authority, order, now, row.id);
        result.updated++;
      }
    }
    for (const r of existing) {
      if (r.source === 'seed' && Number(r.isActive) === 1 && !wanted.has(`${r.governorate}|${r.value}`)) {
        await db.prepare('UPDATE industrial_zones SET isActive = 0, updatedAt = ? WHERE id = ?').run(now, r.id);
        result.deactivated++;
      }
    }
    return result;
  });
}

/** يقرأ الجدول إلى الذاكرة (القائمة المعروضة والتحقق). جدول فارغ = تبقى القائمة المضمّنة في الكود. */
export async function loadZoneCache(): Promise<number> {
  const rows = await getDb().prepare('SELECT governorate, value, labelAr, labelEn, authority, isActive FROM industrial_zones ORDER BY governorate, sortOrder, value').all() as unknown as Array<ZoneRecord & { isActive: number }>;
  if (rows.length) setZoneCache(rows.map((r) => ({ governorate: r.governorate, value: r.value, labelAr: r.labelAr, labelEn: r.labelEn, authority: r.authority, active: Number(r.isActive) === 1 })));
  return rows.length;
}

/** يُستدعى من initDb بعد الـ migrations — مرة عند كل تشغيل. */
export async function seedReferenceData(): Promise<ReferenceSeedResult | undefined> {
  const result = await withJobLock('reference-seed', () => seedIndustrialZones());
  await loadZoneCache();
  return result;
}
