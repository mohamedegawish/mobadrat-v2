import { randomUUID } from 'node:crypto';
import type { Request } from 'express';

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/** Params accepted by the database layer's prepared statements (MySQL). */
export type SqlParam = string | number | bigint | null | NodeJS.ArrayBufferView;

/**
 * `Array.map` / `Array.filter` for async callbacks, one item at a time (in order). Sequential on purpose: it keeps the
 * one-query-at-a-time pattern the synchronous code had, so a single request never floods the database pool.
 */
export async function mapSeq<T, R>(items: readonly T[], fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i++) out.push(await fn(items[i], i));
  return out;
}

export async function filterSeq<T>(items: readonly T[], fn: (item: T, index: number) => Promise<boolean>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) if (await fn(items[i], i)) out.push(items[i]);
  return out;
}

/** A page number from the query string: a whole number from 1, capped (an absurd page must not reach SQL as 1e+22). */
export const MAX_PAGE = 1_000_000;
export function normPage(page: unknown, fallback = 1): number {
  const n = Number(page);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), MAX_PAGE) : fallback;
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
