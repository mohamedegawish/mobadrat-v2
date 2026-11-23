import { getDb, nowIso } from '../db/database.js';
import { newId, likePattern, type SqlParam } from '../http/helpers.js';
import { shamsPolicy } from '../config/shamsPolicy.js';

/** اعتماد PMU (★ المخطط 5.0): pending → approved ↔ suspended. لا يعني الظهور وحده: انظر isSelectable. */
export type ProviderStatus = 'pending' | 'approved' | 'suspended';

export interface ServiceProvider {
  id: string; nameAr: string; nameEn: string; description: string; contactName: string; contactPhone: string; contactEmail: string; website: string;
  notes: string; status: ProviderStatus; approvedBy: string | null; approvedAt: string | null; suspendedBy: string | null;
  suspendedAt: string | null;
  /** تفعيل الظهور للمصانع (ENCPC): 1 = مفعّل، 0 = غير مفعّل. */
  isActive: number; deactivatedBy: string | null; deactivatedAt: string | null;
  logoStoredName: string | null; logoMime: string | null; logoSha256: string | null; logoUpdatedAt: string | null;
  createdBy: string | null; createdAt: string; updatedAt: string;
}

export const PROVIDER_FIELDS = ['nameAr', 'nameEn', 'description', 'contactName', 'contactPhone', 'contactEmail', 'website', 'notes'] as const;
export type ProviderInput = Partial<Record<(typeof PROVIDER_FIELDS)[number], string>>;

/**
 * القاعدة الوحيدة لـ«هل يستطيع المصنع اختيار هذا المقدم؟» — تُستخدم في الاختيار، وإرسال العرض، والبريد، والجاهزية:
 * مفعّل من ENCPC، ومعتمد من PMU ما دام shamsPolicy.providerApprovalRequired (★ مقترح، افتراضيًا مطلوب).
 */
export function isSelectable(p: Pick<ServiceProvider, 'isActive' | 'status'> | null | undefined): boolean {
  if (!p || p.isActive !== 1) return false;
  return shamsPolicy.providerApprovalRequired ? p.status === 'approved' : p.status !== 'suspended';
}

export async function getProvider(id: string): Promise<ServiceProvider | null> {
  return (await getDb().prepare('SELECT * FROM shams_service_providers WHERE id = ?').get(id) as unknown as ServiceProvider | undefined) ?? null;
}

/** Several providers in one round trip (PERF-3: the application export looked each one up per row). */
export async function getProvidersByIds(ids: Iterable<string>): Promise<Map<string, ServiceProvider>> {
  const uniq = [...new Set([...ids].filter(Boolean))];
  const out = new Map<string, ServiceProvider>();
  for (let i = 0; i < uniq.length; i += 500) {
    const chunk = uniq.slice(i, i + 500);
    const rows = await getDb().prepare(`SELECT * FROM shams_service_providers WHERE id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as unknown as ServiceProvider[];
    for (const r of rows) out.set(r.id, r);
  }
  return out;
}

export async function listProviders(f: { status?: ProviderStatus; q?: string; selectable?: boolean; active?: boolean } = {}): Promise<ServiceProvider[]> {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (f.status) { where.push('status = ?'); params.push(f.status); }
  if (f.active !== undefined) { where.push('isActive = ?'); params.push(f.active ? 1 : 0); }
  if (f.selectable) {
    where.push(shamsPolicy.providerApprovalRequired ? "isActive = 1 AND status = 'approved'" : "isActive = 1 AND status <> 'suspended'");
  }
  if (f.q) { where.push("(nameAr LIKE ? ESCAPE '\\' OR nameEn LIKE ? ESCAPE '\\')"); const p = likePattern(f.q); params.push(p, p); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return await getDb().prepare(`SELECT * FROM shams_service_providers ${w} ORDER BY isActive DESC, status = 'approved' DESC, nameAr LIMIT 500`).all(...params) as unknown as ServiceProvider[];
}

/** مقدمو الخدمة الذين يراهم المصنع ويختار منهم الآن. */
export async function listSelectableProviders(): Promise<ServiceProvider[]> {
  return await listProviders({ selectable: true });
}

/**
 * مقدم جديد: غير مفعّل افتراضيًا (لا يظهر للمصانع قبل أن تكتمل بياناته ويفعّله ENCPC صراحة).
 * الإضافة عبر الربط تبقى غير مفعّلة دائمًا — التفعيل قرار ENCPC لا قرار التكامل.
 */
export async function createProvider(input: ProviderInput & { nameAr: string }, createdBy: string | null): Promise<ServiceProvider> {
  const id = newId('sp');
  const now = nowIso();
  await getDb().prepare(`INSERT INTO shams_service_providers (id, nameAr, nameEn, description, contactName, contactPhone, contactEmail, website, notes, status, isActive, createdBy, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`).run(
    id, input.nameAr, input.nameEn ?? '', input.description ?? '', input.contactName ?? '', input.contactPhone ?? '', input.contactEmail ?? '', input.website ?? '',
    input.notes ?? '', createdBy, now, now,
  );
  return (await getProvider(id))!;
}

export async function updateProvider(id: string, patch: ProviderInput): Promise<ServiceProvider | null> {
  const cur = await getProvider(id);
  if (!cur) return null;
  const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  await getDb().prepare(`UPDATE shams_service_providers SET nameAr = ?, nameEn = ?, description = ?, contactName = ?, contactPhone = ?, contactEmail = ?, website = ?, notes = ?,
    updatedAt = ? WHERE id = ?`).run(next.nameAr, next.nameEn, next.description, next.contactName, next.contactPhone, next.contactEmail, next.website, next.notes, nowIso(), id);
  return await getProvider(id);
}

export async function setProviderStatus(id: string, status: ProviderStatus, userId: string | null): Promise<ServiceProvider | null> {
  const now = nowIso();
  if (status === 'approved') {
    await getDb().prepare("UPDATE shams_service_providers SET status = 'approved', approvedBy = ?, approvedAt = ?, suspendedBy = NULL, suspendedAt = NULL, updatedAt = ? WHERE id = ?").run(userId, now, now, id);
  } else if (status === 'suspended') {
    await getDb().prepare("UPDATE shams_service_providers SET status = 'suspended', suspendedBy = ?, suspendedAt = ?, updatedAt = ? WHERE id = ?").run(userId, now, now, id);
  } else {
    await getDb().prepare("UPDATE shams_service_providers SET status = 'pending', updatedAt = ? WHERE id = ?").run(now, id);
  }
  return await getProvider(id);
}

/** تفعيل/إلغاء تفعيل الظهور (ENCPC). */
export async function setProviderActive(id: string, active: boolean, userId: string | null): Promise<ServiceProvider | null> {
  const now = nowIso();
  if (active) await getDb().prepare('UPDATE shams_service_providers SET isActive = 1, deactivatedBy = NULL, deactivatedAt = NULL, updatedAt = ? WHERE id = ?').run(now, id);
  else await getDb().prepare('UPDATE shams_service_providers SET isActive = 0, deactivatedBy = ?, deactivatedAt = ?, updatedAt = ? WHERE id = ?').run(userId, now, now, id);
  return await getProvider(id);
}

/** يضبط الشعار ويرجع اسم الملف السابق ليحذفه المستدعي بعد نجاح المعاملة. */
export async function setProviderLogo(id: string, logo: { storedName: string; mime: string; sha256: string }): Promise<string | null> {
  const prev = (await getProvider(id))?.logoStoredName ?? null;
  const now = nowIso();
  await getDb().prepare('UPDATE shams_service_providers SET logoStoredName = ?, logoMime = ?, logoSha256 = ?, logoUpdatedAt = ?, updatedAt = ? WHERE id = ?').run(logo.storedName, logo.mime, logo.sha256, now, now, id);
  return prev;
}
