/**
 * Core authentication: Bearer access token → the platform user (req.coreUser).
 * Module access: moduleAuth(module) loads the person's membership in the initiative and sets req.user to the module
 * "actor" — the role/organization-shaped user the module's own code (visibility rules, workflow) was written for.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { verifyAccess } from '../auth/jwt.js';
import { getUserById, type CoreUser, type PlatformRole } from '../store/users.js';
import { getMembership, type Membership } from '../store/memberships.js';
import { ah, apiError } from '../http/errors.js';
import type { InitiativeModule } from '../../initiatives/contract.js';

export interface CoreRequest extends Request {
  coreUser?: CoreUser;
  membership?: Membership | null;
  /** The module actor (module-shaped user). Set by moduleAuth. */
  user?: unknown;
}

export function coreUserOf(req: Request): CoreUser {
  const u = (req as CoreRequest).coreUser;
  if (!u) throw new Error('auth middleware missing');
  return u;
}

async function authenticate(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return apiError(res, 401, 'UNAUTHORIZED', 'يجب تسجيل الدخول.', 'Authentication required.');
  const claims = verifyAccess(h.slice(7).trim());
  if (!claims) return apiError(res, 401, 'TOKEN_INVALID', 'انتهت الجلسة — سجّل الدخول من جديد.', 'Session expired, please sign in again.');
  const user = await getUserById(claims.sub);
  if (!user || !user.isActive) return apiError(res, 401, 'UNAUTHORIZED', 'الحساب غير مفعل.', 'Account is not active.');
  // A token issued before the last session revocation (password change/reset, recovery) is refused immediately.
  if ((claims.tv ?? 0) !== user.tokenVersion) return apiError(res, 401, 'TOKEN_REVOKED', 'انتهت الجلسة — سجّل الدخول من جديد.', 'Session revoked, please sign in again.');
  if (!user.emailVerifiedAt) return apiError(res, 401, 'EMAIL_NOT_VERIFIED', 'يجب تفعيل البريد الإلكتروني أولًا.', 'Please verify your email first.');
  (req as CoreRequest).coreUser = user;
  next();
}

export const auth: RequestHandler = ah(authenticate);

/** Optional authentication on public routes (no error when absent or invalid). */
export const optionalAuth: RequestHandler = ah(async (req, _res, next) => {
  const h = req.headers.authorization;
  const claims = h?.startsWith('Bearer ') ? verifyAccess(h.slice(7).trim()) : null;
  if (claims) {
    const user = await getUserById(claims.sub);
    if (user && user.isActive && user.emailVerifiedAt && (claims.tv ?? 0) === user.tokenVersion) (req as CoreRequest).coreUser = user;
  }
  next();
});

/** Blocks everything until a temporary password is changed (server-side, not only in the UI). */
export function requirePasswordChanged(req: Request, res: Response, next: NextFunction) {
  if ((req as CoreRequest).coreUser?.mustChangePassword) {
    return apiError(res, 403, 'PASSWORD_CHANGE_REQUIRED', 'يجب تغيير كلمة المرور المؤقتة أولًا.', 'You must change your temporary password first.');
  }
  next();
}

export function requirePlatformRole(...allowed: PlatformRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const u = (req as CoreRequest).coreUser;
    if (!u || !u.platformRole || !allowed.includes(u.platformRole)) {
      return apiError(res, 403, 'FORBIDDEN', 'ليست لديك صلاحية لهذا الإجراء.', 'You are not allowed to perform this action.');
    }
    next();
  };
}

/**
 * Membership gate of a module router. A platform super_admin enters every module as its admin role without a membership.
 * A suspended/revoked membership (or none) gets 403 NOT_ENROLLED; the module's resolveActor may also refuse (null).
 */
export function moduleAuth(module: InitiativeModule): RequestHandler {
  return ah(async (req, res, next) => {
    const user = coreUserOf(req);
    const m = await getMembership(user.id, module.id);
    const active = m && m.status === 'active' ? m : null;
    if (!active && user.platformRole !== 'super_admin') {
      return apiError(res, 403, 'NOT_ENROLLED', 'لست مسجلًا في هذه المبادرة — قدّم عليها من صفحتها على المنصة.', 'You are not enrolled in this initiative — apply from its page on the platform.');
    }
    const actor = await module.resolveActor(user, active);
    if (!actor) return apiError(res, 403, 'NOT_ENROLLED', 'لا يمكنك الدخول على هذه المبادرة.', 'You cannot access this initiative.');
    (req as CoreRequest).membership = active;
    (req as CoreRequest).user = actor;
    next();
  });
}
