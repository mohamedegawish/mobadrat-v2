/**
 * Module side of authentication. The platform authenticates the request (core/middleware/auth.ts) and moduleAuth puts the
 * Shams actor (store/users.ts UserInternal: the account + its Shams role and organization) on req.user.
 */
import type { NextFunction, Request, Response } from 'express';
import type { UserInternal } from '../store/users.js';
import { apiError } from '../http/errors.js';
import { isRetiredRole, type Role } from '../domain.js';

export interface AuthedRequest extends Request {
  user?: UserInternal;
}

/** The current Shams actor — only after the platform's moduleAuth middleware. */
export function currentUser(req: Request): UserInternal {
  const u = (req as AuthedRequest).user;
  if (!u) throw new Error('auth middleware missing');
  return u;
}

/**
 * Account checks specific to Shams, applied after moduleAuth: the membership/organization must be active and a retired
 * role (bank reviewer) never gets access.
 */
export function shamsActorGuard(req: Request, res: Response, next: NextFunction) {
  const u = (req as AuthedRequest).user;
  if (!u || !u.isActive || !u.organizationActive || isRetiredRole(u.role)) {
    return apiError(res, 403, 'ACCOUNT_DISABLED', 'صلاحيتك في هذه المبادرة موقوفة — تواصل مع إدارة المبادرة.', 'Your access to this initiative is disabled.');
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
