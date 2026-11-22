/**
 * Audit log — the platform's single append-only log, scoped to this initiative (initiativeId = MODULE_ID).
 */
import type { Request } from 'express';
import * as core from '../../../core/store/audit.js';
import { MODULE_ID } from '../config.js';

export type AuditActorType = core.AuditActorType;
export type AuditActor = core.AuditActor;
export type AuditEntry = Omit<core.AuditEntry, 'initiativeId'>;
export type AuditRow = core.AuditRow;
export type AuditFilter = Omit<core.AuditFilter, 'initiativeId'>;

export const redact = core.redact;

export async function addAuditLog(e: AuditEntry): Promise<void> {
  return await core.addAuditLog({ ...e, initiativeId: MODULE_ID });
}

export function actorFromReq(req: Request): AuditActor {
  return core.actorFromReq(req);
}

export async function listAuditLogs(f: AuditFilter, page: number, pageSize: number): Promise<{ rows: AuditRow[]; total: number }> {
  return await core.listAuditLogs({ ...f, initiativeId: MODULE_ID }, page, pageSize);
}
