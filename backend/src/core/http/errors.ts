import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { GENERIC_VALIDATION_AR, localizeValidation, scopeOfUrl } from './validationText.js';

export interface ErrorDetail { field: string; issue: string }

/**
 * يغلف كل الردود الفاشلة بشكل ApiError الموحد { code, messageAr, messageEn, details? }.
 * F7: رفض التحقق في مبادرة سجّلت أسماء حقولها يسمّي كل حقل بالعربية — لكل تفصيل رسالته، والرسالة العامة تُستبدل
 * برسائل الحقول (الرسالة المكتوبة خصيصًا للرفض تبقى). المبادرة التي لم تسجّل أسماءً تُرد كما كانت (core/http/validationText.ts).
 */
export function apiError(res: Response, http: number, code: string, messageAr: string, messageEn: string, details?: ErrorDetail[]) {
  if (code === 'VALIDATION_ERROR' && details?.length) {
    const local = localizeValidation(scopeOfUrl(res.req?.originalUrl), details);
    if (local) {
      details = local.details;
      if (messageAr === GENERIC_VALIDATION_AR) { messageAr = local.messageAr; messageEn = local.messageEn; }
    }
  }
  return res.status(http).json({ code, messageAr, messageEn, ...(details && details.length ? { details } : {}) });
}

/** الرد الناجح الموحد { message, status: 'ok', data }. */
export function okMessage(res: Response, http: number, message: string, data?: unknown) {
  return res.status(http).json({ message, status: 'ok' as const, ...(data !== undefined ? { data } : {}) });
}

/** خطأ يُرمى من الخدمات ويُحوَّل إلى ApiError في معالج الأخطاء الأخير. */
export class AppError extends Error {
  constructor(
    public http: number,
    public code: string,
    public messageAr: string,
    public messageEn: string,
    public details?: ErrorDetail[],
  ) {
    super(code);
  }
}

export const Errors = {
  validation: (details: ErrorDetail[], ar = GENERIC_VALIDATION_AR, en = 'Invalid request data.') =>
    new AppError(400, 'VALIDATION_ERROR', ar, en, details),
  notFound: (ar = 'العنصر غير موجود.', en = 'Not found.') => new AppError(404, 'NOT_FOUND', ar, en),
  forbidden: (ar = 'ليست لديك صلاحية لهذا الإجراء.', en = 'You are not allowed to perform this action.') =>
    new AppError(403, 'FORBIDDEN', ar, en),
  conflict: (code: string, ar: string, en: string, details?: ErrorDetail[]) => new AppError(409, code, ar, en, details),
};

/** Express 4 لا يلتقط أخطاء async — يمررها هذا الغلاف إلى next(). */
export function ah(fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler {
  return (req, res, next) => {
    try {
      const r = fn(req, res, next);
      if (r && typeof (r as Promise<unknown>).then === 'function') (r as Promise<unknown>).catch(next);
    } catch (e) {
      next(e);
    }
  };
}

export const rateLimitedBody = (messageAr = 'طلبات كثيرة — حاول لاحقًا.', messageEn = 'Too many requests, try again later.') =>
  ({ code: 'RATE_LIMITED', messageAr, messageEn });
