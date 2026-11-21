import type { Request } from 'express';
import { getDb, nowIso, parseJson } from '../db/sqlite.js';
import { newId, clientIp, likePattern, type SqlParam } from '../http/helpers.js';

export type AuditActorType = 'user' | 'integration_key' | 'system' | 'anonymous';

export interface AuditActor {
  actorType: AuditActorType;
  actorUserId?: string | null;
  actorName?: string;
  actorRole?: string;
  actorOrgId?: string | null;
  integrationKeyId?: string | null;
  ip?: string;
}

export interface AuditEntry extends AuditActor {
  action: string;
  entityType: string;
  entityId?: string;
  applicationId?: string | null;
  summaryAr?: string;
  details?: Record<string, unknown>;
}

const SECRET_KEY_RE = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|hash/i;

/** يزيل الأسرار من تفاصيل التدقيق (كلمات السر، التوكنات، المفاتيح). */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 1000) return `${value.slice(0, 1000)}…`;
  return value;
}

export async function addAuditLog(e: AuditEntry): Promise<void> {
  await getDb().prepare(`INSERT INTO audit_logs (id, at, actorType, actorUserId, actorName, actorRole, actorOrgId, integrationKeyId,
      action, entityType, entityId, applicationId, summaryAr, details, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    newId('aud'), nowIso(), e.actorType, e.actorUserId ?? null, e.actorName ?? '', e.actorRole ?? '', e.actorOrgId ?? null,
    e.integrationKeyId ?? null, e.action, e.entityType, e.entityId ?? '', e.applicationId ?? null, e.summaryAr ?? '',
    JSON.stringify(redact(e.details ?? {})), (e.ip ?? '').slice(0, 64),
  );
}

/** الفاعل من الطلب: مستخدم مسجل، أو مفتاح ربط، أو مجهول. */
export function actorFromReq(req: Request): AuditActor {
  const r = req as Request & { user?: { id: string; nameAr: string; role: string; organizationId: string }; integrationKey?: { id: string; name: string } };
  if (r.user) return { actorType: 'user', actorUserId: r.user.id, actorName: r.user.nameAr, actorRole: r.user.role, actorOrgId: r.user.organizationId, ip: clientIp(req) };
  if (r.integrationKey) return { actorType: 'integration_key', integrationKeyId: r.integrationKey.id, actorName: r.integrationKey.name, ip: clientIp(req) };
  return { actorType: 'anonymous', ip: clientIp(req) };
}

export interface AuditRow {
  id: string; at: string; actorType: AuditActorType; actorUserId: string | null; actorName: string; actorRole: string;
  actorOrgId: string | null; integrationKeyId: string | null; action: string; entityType: string; entityId: string;
  applicationId: string | null; summaryAr: string; details: Record<string, unknown>; ip: string;
}

export interface AuditFilter { q?: string; action?: string; entityType?: string; applicationId?: string; from?: string; to?: string }

export async function listAuditLogs(f: AuditFilter, page: number, pageSize: number): Promise<{ rows: AuditRow[]; total: number }> {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (f.action) { where.push('action = ?'); params.push(f.action); }
  if (f.entityType) { where.push('entityType = ?'); params.push(f.entityType); }
  if (f.applicationId) { where.push('applicationId = ?'); params.push(f.applicationId); }
  if (f.from) { where.push('at >= ?'); params.push(f.from); }
  if (f.to) { where.push('at <= ?'); params.push(f.to); }
  if (f.q) {
    where.push("(actorName LIKE ? ESCAPE '\\' OR summaryAr LIKE ? ESCAPE '\\' OR entityId LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\')");
    const p = likePattern(f.q); params.push(p, p, p, p);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM audit_logs ${w}`).get(...params) as { n: number }).n;
  const rows = await db.prepare(`SELECT * FROM audit_logs ${w} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>;
  return { total, rows: rows.map((r) => ({ ...(r as unknown as AuditRow), details: parseJson(r.details, {}) })) };
}
