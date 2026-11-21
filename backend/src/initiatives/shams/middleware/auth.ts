import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { verifyAccess } from '../auth/jwt.js';
import { getUserById, type UserInternal } from '../store/users.js';
import { ah, apiError } from '../http/errors.js';
import { isRetiredRole, type Role } from '../domain.js';

export interface AuthedRequest extends Request {
  user?: UserInternal;
}

/** المستخدم الحالي — يُستدعى فقط بعد middleware `auth`. */
export function currentUser(req: Request): UserInternal {
  const u = (req as AuthedRequest).user;
  if (!u) throw new Error('auth middleware missing');
  return u;
}

/** Bearer JWT فقط. لا توجد مصادقة تجريبية في هذا المشروع. يُحمّل المستخدم من القاعدة في كل طلب. */
async function authenticate(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) {
    return apiError(res, 401, 'UNAUTHORIZED', 'يجب تسجيل الدخول.', 'Authentication required.');
  }
  const claims = verifyAccess(h.slice(7).trim());
  if (!claims) return apiError(res, 401, 'TOKEN_INVALID', 'انتهت الجلسة — سجّل الدخول من جديد.', 'Session expired, please sign in again.');
  const user = await getUserById(claims.sub);
  // G-02: دور البنك ملغى — حتى لو بقي حساب نشط بالخطأ لا يحصل على جلسة.
  if (!user || !user.isActive || !user.organizationActive || isRetiredRole(user.role)) {
    return apiError(res, 401, 'UNAUTHORIZED', 'الحساب غير مفعل.', 'Account is not active.');
  }
  // M1: توكن صادر قبل آخر إنهاء للجلسات (استعادة/تغيير كلمة المرور، إعادة تعيين، استرداد) = مرفوض فورًا.
  if ((claims.tv ?? 0) !== user.tokenVersion) {
    return apiError(res, 401, 'TOKEN_REVOKED', 'انتهت الجلسة — سجّل الدخول من جديد.', 'Session revoked, please sign in again.');
  }
  // بريد غير مفعّل (مثل بعد الاسترداد الإداري بتغيير البريد I10) = لا جلسة، حتى للتوكن الساري.
  if (!user.emailVerifiedAt) return apiError(res, 401, 'EMAIL_NOT_VERIFIED', 'يجب تفعيل البريد الإلكتروني أولًا.', 'Please verify your email first.');
  (req as AuthedRequest).user = user;
  next();
}

/** The user is loaded from the database (async); a database error reaches the error handler through ah(). */
export const auth: RequestHandler = ah(authenticate);

/** يمنع كل العمليات حتى تغيير كلمة المرور المؤقتة (مطبق على السيرفر، لا في الواجهة فقط). */
export function requirePasswordChanged(req: Request, res: Response, next: NextFunction) {
  const u = (req as AuthedRequest).user;
  if (u?.mustChangePassword) {
    return apiError(res, 403, 'PASSWORD_CHANGE_REQUIRED', 'يجب تغيير كلمة المرور المؤقتة أولًا.', 'You must change your temporary password first.');
  }
  next();
}

export function requireRole(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const u = (req as AuthedRequest).user;
    if (!u || !allowed.includes(u.role)) {
      return apiError(res, 403, 'FORBIDDEN', 'ليست لديك صلاحية لهذا الإجراء.', 'You are not allowed to perform this action.');
    }
    next();
  };
}
