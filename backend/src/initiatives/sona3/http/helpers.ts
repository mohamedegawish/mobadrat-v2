import { randomUUID } from 'node:crypto';
import type { Request } from 'express';

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/** Params accepted by node:sqlite prepared statements. */
export type SqlParam = string | number | bigint | null | NodeJS.ArrayBufferView;

export function normPage(page: unknown, fallback = 1): number {
  const n = Number(page);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

export function normPageSize(pageSize: unknown, fallback = 20, max = 100): number {
  const n = Number(pageSize);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

export function paginate<T>(rows: T[], total: number, page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { items: rows, page, pageSize, total, totalPages };
}

/** LIKE escape for % _ \ in user search strings (use with ESCAPE '\'). */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** عنوان العميل كما تحسبه Express (يحترم TRUST_PROXY) — لا نقرأ X-Forwarded-For يدويًا. */
export function clientIp(req: Request): string {
  return (req.ip ?? req.socket.remoteAddress ?? '').slice(0, 64);
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
