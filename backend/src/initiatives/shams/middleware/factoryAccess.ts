/**
 * مصنع لم يُقبل حسابه بعد (factories.accountStatus ≠ approved): القيد على السيرفر نفسه لا في الواجهة فقط.
 * - pending / correction: يرى طلبه ويعدّله (البنود المسموحة يحصرها editableKeys/uploadableKinds كالمعتاد) ويرسله فقط.
 * - under_review / rejected: لا شيء (لا يحصل على جلسة أصلًا؛ هذا لتوكن ساري صدر قبل تغيّر الحالة).
 * مسارات /auth (me، logout، change-password) خارج هذا الـ middleware.
 */
import type { NextFunction, Request, Response } from 'express';
import { apiError } from '../http/errors.js';
import type { AuthedRequest } from './auth.js';
import { accountLoginBlock, isRestrictedFactory } from '../services/factoryAccount.js';

const ALLOWED: Array<[string, RegExp]> = [
  ['GET', /^\/factory\/profile$/],
  ['GET', /^\/applications\/[^/]+$/],
  ['PUT', /^\/applications\/[^/]+\/data\/[^/]+$/],
  ['POST', /^\/applications\/[^/]+\/documents$/],
  ['DELETE', /^\/applications\/[^/]+\/documents\/[^/]+$/],
  ['GET', /^\/applications\/[^/]+\/documents\/[^/]+\/download$/],
  ['POST', /^\/applications\/[^/]+\/actions\/(submit|resubmit)$/],
];

export function restrictUnapprovedFactory(req: Request, res: Response, next: NextFunction) {
  const u = (req as AuthedRequest).user;
  if (!u || !isRestrictedFactory(u)) return next();
  const blocked = accountLoginBlock(u.factoryAccountStatus);
  if (blocked) return apiError(res, 403, blocked.code, blocked.ar, blocked.en);
  if (ALLOWED.some(([m, re]) => m === req.method && re.test(req.path))) return next();
  return apiError(res, 403, 'ACCOUNT_RESTRICTED', 'حسابكم لم يُقبل بعد — المتاح الآن تعديل بيانات طلب التسجيل المطلوبة وإعادة إرساله فقط.',
    'Your account is not approved yet — you can only edit the requested registration data and resubmit it.');
}
