/**
 * Module side of authentication. The platform authenticates the request and moduleAuth puts the Sona3 actor
 * (store/users.ts UserInternal: the account + its Sona3 role and organization) on req.user.
 */
import type { NextFunction, Request, Response } from 'express';
import type { UserInternal } from '../store/users.js';
import { apiError } from '../http/errors.js';
import type { Role } from '../domain.js';

export interface AuthedRequest extends Request {
  user?: UserInternal;
}

/** The current Sona3 actor — only after the platform's moduleAuth middleware. */
export function currentUser(req: Request): UserInternal {
  const u = (req as AuthedRequest).user;
  if (!u) throw new Error('auth middleware missing');
  return u;
}

/** The membership/organization must be active. */
export function sona3ActorGuard(req: Request, res: Response, next: NextFunction) {
  const u = (req as AuthedRequest).user;
  if (!u || !u.isActive || !u.organizationActive) {
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
