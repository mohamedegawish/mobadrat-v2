/**
 * Platform authentication — one account per person for every initiative.
 * Login is never blocked by an initiative's state (e.g. a factory under review): each module gates its own screens.
 * Initiative-specific registration (with that initiative's form and documents) lives in the module's public router and
 * creates the same core account through core/identity.ts.
 */
import { Router, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { config } from '../../config.js';
import { tx } from '../db/index.js';
import { ah, apiError, okMessage, AppError } from '../http/errors.js';
import { makeLimiter } from '../http/rateLimits.js';
import { clientIp } from '../http/helpers.js';
import { Checker, isEmail, isPhone, isStrongPassword, normalizeDigits, onlyKeys } from '../http/validate.js';
import { burnPasswordCheckAsync, hashPasswordAsync, verifyPasswordAsync, signAccess, signRefresh, verifyRefresh, sha256 } from '../auth/jwt.js';
import { auth, coreUserOf } from '../middleware/auth.js';
import {
  getUserByEmail, getUserById, getUserByTokenHash, markEmailVerified, recordFailedLogin, recordSuccessfulLogin, setPassword,
  setResetToken, toPublicCoreUser, type CoreUser,
} from '../store/users.js';
import { checkRefreshToken, markRotated, revokeAllSessions, revokeRefreshToken, storeRefreshToken } from '../store/refreshTokens.js';
import { pruneThrottle, retryAfterMs, settleAttempt, throttleKey } from '../store/loginThrottle.js';
import { platformPolicy } from '../policy.js';
import { addAuditLog } from '../store/audit.js';
import { dispatchCore } from '../notify/dispatch.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { createAccount, newToken, notifyExistingAccountOnRegister, sendVerification } from '../identity.js';
import { savePersonProfile } from '../profile/store.js';
import { MODULES } from '../../initiatives/registry.js';

export const authRouter = Router();

export const REFRESH_COOKIE = 'mobadrat_refresh';
const COOKIE_PATH = '/api/v1/auth';
const RESET_TTL_MS = platformPolicy.resetTokenHours * 3600_000;

const TOO_MANY_AR = 'محاولات كثيرة — انتظر قليلًا ثم حاول مجددًا.';
const TOO_MANY_EN = 'Too many attempts, please wait and try again.';
const loginLimiter = makeLimiter('login', {}, TOO_MANY_AR, TOO_MANY_EN);
const registerLimiter = makeLimiter('register', {}, TOO_MANY_AR, TOO_MANY_EN);
const emailFlowLimiter = makeLimiter('emailFlow', {}, TOO_MANY_AR, TOO_MANY_EN);
const refreshLimiter = makeLimiter('refresh', {}, TOO_MANY_AR, TOO_MANY_EN);

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, { httpOnly: true, secure: config.isProd, sameSite: 'strict', maxAge: config.jwtRefreshTtlSec * 1000, path: COOKIE_PATH });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: config.isProd, sameSite: 'strict', path: COOKIE_PATH });
}

export function accessTokenFor(u: CoreUser): string {
  return signAccess(u.id, u.platformRole ?? '', '', u.tokenVersion);
}

/** Starts a session: access token in the response (kept in memory), refresh token in an httpOnly cookie only. */
async function issueSession(res: Response, user: CoreUser, familyId = randomUUID()): Promise<string> {
  const { token } = signRefresh(user.id);
  await storeRefreshToken(user.id, token, familyId);
  setRefreshCookie(res, token);
  return accessTokenFor(user);
}

/**
 * Platform registration (no initiative): name, e-mail, mobile, password. The person then completes the shared profile and
 * applies to any initiative from its page. Same anti-enumeration answer whether the e-mail exists or not.
 */
authRouter.post('/auth/register', registerLimiter, ah(async (req, res) => {
  const b = onlyKeys(req.body, ['fullName', 'email', 'mobile', 'password']);
  const c = new Checker();
  const fullName = c.text(b, 'fullName', { required: true, min: 2, max: 200 });
  const email = c.text(b, 'email', { required: true, max: 254 });
  const mobileRaw = c.text(b, 'mobile', { required: true, max: 20 });
  const mobile = mobileRaw === undefined ? undefined : normalizeDigits(mobileRaw);
  if (email && !isEmail(email)) c.add('email', 'invalid email');
  if (mobile && !isPhone(mobile)) c.add('mobile', 'invalid phone number');
  if (!isStrongPassword(b.password)) c.add('password', 'min 8 chars with letters and digits');
  c.throwIfAny();
  const done = () => okMessage(res, 201, 'تم استلام التسجيل — راجع بريدك الإلكتروني لتفعيل الحساب.', { email: email!.toLowerCase(), emailVerified: false });
  const existing = await getUserByEmail(email!);
  if (existing) {
    await hashPasswordAsync(b.password as string);
    await notifyExistingAccountOnRegister(existing, null, clientIp(req));
    return done();
  }
  const passwordHash = await hashPasswordAsync(b.password as string);
  await tx(async () => {
    const u = await createAccount({ email: email!, nameAr: fullName!, phone: mobile!, passwordHash, ip: clientIp(req), source: 'platform' });
    await savePersonProfile(u.id, { 'person.fullNameAr': fullName!, 'person.phone': mobile! });
    await sendVerification(u);
  });
  kickNotificationWorker();
  return done();
}));

authRouter.post('/auth/verify-email', emailFlowLimiter, ah(async (req, res) => {
  const b = onlyKeys(req.body, ['token']);
  const token = typeof b.token === 'string' ? b.token.trim() : '';
  const u = /^[a-f0-9]{64}$/.test(token) ? await getUserByTokenHash('emailVerifyTokenHash', sha256(token)) : null;
  if (!u || !u.tokenExpiresAt || Date.parse(u.tokenExpiresAt) < Date.now()) {
    return apiError(res, 400, 'TOKEN_INVALID', 'رابط التفعيل غير صالح أو منتهي — اطلب رابطًا جديدًا.', 'The activation link is invalid or expired. Request a new one.');
  }
  await markEmailVerified(u.id);
  await addAuditLog({ actorType: 'user', actorUserId: u.id, actorName: u.nameAr, ip: clientIp(req), action: 'auth.verify_email', entityType: 'user', entityId: u.id, summaryAr: 'تفعيل البريد الإلكتروني' });
  // Initiatives react to the verification (e.g. Shams submits the registration it received with the account).
  const fresh = (await getUserById(u.id))!;
  const messages: string[] = [];
  const data: Record<string, unknown> = {};
  for (const m of MODULES) {
    const r = await m.hooks?.onEmailVerified?.(fresh, clientIp(req));
    if (r?.messageAr) messages.push(r.messageAr);
    if (r?.data) data[m.id] = r.data;
  }
  kickNotificationWorker();
  return okMessage(res, 200, messages.length ? messages.join(' ') : 'تم تفعيل البريد الإلكتروني — يمكنك تسجيل الدخول الآن.', Object.keys(data).length ? data : undefined);
}));

authRouter.post('/auth/resend-verification', emailFlowLimiter, ah(async (req, res) => {
  const b = onlyKeys(req.body, ['email']);
  const u = isEmail(b.email) ? await getUserByEmail(b.email) : null;
  if (u && !u.emailVerifiedAt && u.isActive) { await sendVerification(u); kickNotificationWorker(); }
  return okMessage(res, 200, 'إذا كان الحساب موجودًا وغير مفعل فستصلك رسالة تفعيل جديدة.');
}));

/**
 * No account lockout: a progressive delay per (e-mail, IP) after failed attempts. An unknown e-mail goes through the same
 * path and bcrypt cost. The owner is warned after repeated failures.
 */
authRouter.post('/auth/login', loginLimiter, ah(async (req, res) => {
  const b = onlyKeys(req.body, ['email', 'password']);
  const ip = clientIp(req);
  const rawEmail = typeof b.email === 'string' ? b.email : '';
  const key = throttleKey(rawEmail, ip);
  const throttled = (wait: number) => {
    res.setHeader('Retry-After', String(Math.ceil(wait / 1000)));
    return apiError(res, 429, 'LOGIN_THROTTLED', `محاولات فاشلة متكررة — انتظر ${Math.ceil(wait / 1000)} ثانية ثم حاول مجددًا.`, `Too many failed attempts — wait ${Math.ceil(wait / 1000)} seconds and try again.`);
  };
  const wait = await retryAfterMs(key);
  if (wait > 0) return throttled(wait);
  const found = isEmail(rawEmail) ? await getUserByEmail(rawEmail) : null;
  const invalid = () => apiError(res, 401, 'INVALID_CREDENTIALS', 'البريد الإلكتروني أو كلمة المرور غير صحيحة.', 'Invalid email or password.');
  const passwordOk = Boolean(found) && typeof b.password === 'string' && await verifyPasswordAsync(b.password as string, found!.passwordHash);
  if (!found) await burnPasswordCheckAsync(b.password);
  const u = found ? await getUserByEmail(rawEmail) : null;
  const ok = Boolean(u) && passwordOk && u!.passwordHash === found!.passwordHash;
  const settled = await settleAttempt(key, ok);
  if ('throttledMs' in settled) return throttled(settled.throttledMs);
  if (!ok || !u) {
    if (Math.random() < 0.02) await pruneThrottle();
    if (u) {
      const failures = await recordFailedLogin(u.id);
      const every = platformPolicy.loginThrottle.notifyOwnerAfterFailures;
      if (failures > 0 && failures % every === 0 && u.isActive) {
        await dispatchCore('auth.suspicious_logins', { name: u.nameAr, count: failures }, [{ userId: u.id, email: u.email }],
          { dedupePrefix: `susp:${u.id}:${failures}:${new Date().toISOString().slice(0, 10)}`, channels: ['email'] });
        kickNotificationWorker();
      }
      await addAuditLog({ actorType: 'anonymous', ip, action: 'auth.login_failed', entityType: 'user', entityId: u.id, summaryAr: 'محاولة دخول فاشلة' });
    }
    return invalid();
  }
  if (!u.isActive) return apiError(res, 403, 'ACCOUNT_DISABLED', 'الحساب موقوف — تواصل مع إدارة المنصة.', 'The account is disabled.');
  if (!u.emailVerifiedAt) return apiError(res, 403, 'EMAIL_NOT_VERIFIED', 'يجب تفعيل البريد الإلكتروني أولًا.', 'Please verify your email first.');
  await recordSuccessfulLogin(u.id);
  const accessToken = await issueSession(res, u);
  await addAuditLog({ actorType: 'user', actorUserId: u.id, actorName: u.nameAr, actorRole: u.platformRole ?? '', ip, action: 'auth.login', entityType: 'user', entityId: u.id, summaryAr: 'تسجيل دخول' });
  return okMessage(res, 200, 'تم تسجيل الدخول.', { accessToken, user: toPublicCoreUser((await getUserById(u.id))!) });
}));

authRouter.post('/auth/refresh', refreshLimiter, ah(async (req, res) => {
  const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  const unauthorized = () => { clearRefreshCookie(res); return apiError(res, 401, 'UNAUTHORIZED', 'انتهت الجلسة — سجّل الدخول من جديد.', 'Session expired.'); };
  if (!token || !verifyRefresh(token)) return unauthorized();
  // Check → issue → rotate in ONE transaction: two concurrent refreshes of the same token cannot both mint a child token.
  const rotated = await tx(async () => {
    const check = await checkRefreshToken(token);
    if (!check.ok) return null;
    const u = await getUserById(check.userId);
    if (!u || !u.isActive || !u.emailVerifiedAt) return null;
    const { token: next } = signRefresh(u.id);
    const nextId = await storeRefreshToken(u.id, next, check.familyId);
    await markRotated(check.id, nextId);
    return { u, next };
  });
  if (!rotated) return unauthorized();
  setRefreshCookie(res, rotated.next);
  return okMessage(res, 200, 'تم تجديد الجلسة.', { accessToken: accessTokenFor(rotated.u), user: toPublicCoreUser(rotated.u) });
}));

authRouter.post('/auth/logout', ah(async (req, res) => {
  const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  if (token) await revokeRefreshToken(token);
  clearRefreshCookie(res);
  return okMessage(res, 200, 'تم تسجيل الخروج.');
}));

authRouter.post('/auth/forgot-password', emailFlowLimiter, ah(async (req, res) => {
  const b = onlyKeys(req.body, ['email']);
  const u = isEmail(b.email) ? await getUserByEmail(b.email) : null;
  if (u && u.isActive) {
    const { token, hash } = newToken();
    await setResetToken(u.id, hash, new Date(Date.now() + RESET_TTL_MS).toISOString());
    await dispatchCore('auth.reset_password', { name: u.nameAr, link: `${config.appUrl}/#reset-password/${token}` },
      [{ userId: u.id, email: u.email }], { dedupePrefix: `reset:${hash.slice(0, 16)}`, sensitive: true, channels: ['email'] });
    await addAuditLog({ actorType: 'anonymous', ip: clientIp(req), action: 'auth.password_reset_requested', entityType: 'user', entityId: u.id, summaryAr: 'طلب استعادة كلمة المرور' });
    kickNotificationWorker();
  }
  return okMessage(res, 200, 'إذا كان البريد مسجلًا فستصلك رسالة لاستعادة كلمة المرور.');
}));

authRouter.post('/auth/reset-password', emailFlowLimiter, ah(async (req, res) => {
  const b = onlyKeys(req.body, ['token', 'newPassword']);
  const token = typeof b.token === 'string' ? b.token.trim() : '';
  if (!isStrongPassword(b.newPassword)) throw new AppError(400, 'WEAK_PASSWORD', 'كلمة المرور 8 أحرف على الأقل وتحتوي حروفًا وأرقامًا.', 'Password must be at least 8 characters with letters and digits.');
  const newHash = /^[a-f0-9]{64}$/.test(token) ? await hashPasswordAsync(b.newPassword as string) : '';
  const done = await tx(async () => {
    const u = /^[a-f0-9]{64}$/.test(token) ? await getUserByTokenHash('passwordResetTokenHash', sha256(token)) : null;
    if (!u || !u.tokenExpiresAt || Date.parse(u.tokenExpiresAt) < Date.now()) return false;
    await setPassword(u.id, newHash, false);
    if (!u.emailVerifiedAt) await markEmailVerified(u.id); // opening the link proves ownership of the e-mail
    await revokeAllSessions(u.id);
    await addAuditLog({ actorType: 'user', actorUserId: u.id, actorName: u.nameAr, ip: clientIp(req), action: 'auth.password_reset', entityType: 'user', entityId: u.id, summaryAr: 'تعيين كلمة مرور جديدة عبر رابط الاستعادة' });
    return true;
  });
  if (!done) return apiError(res, 400, 'TOKEN_INVALID', 'رابط الاستعادة غير صالح أو منتهي.', 'The reset link is invalid or expired.');
  return okMessage(res, 200, 'تم تعيين كلمة المرور — سجّل الدخول بها الآن.');
}));

authRouter.get('/auth/me', auth, ah((req, res) => okMessage(res, 200, 'ok', { user: toPublicCoreUser(coreUserOf(req)) })));

authRouter.post('/auth/change-password', auth, ah(async (req, res) => {
  const u = coreUserOf(req);
  const b = onlyKeys(req.body, ['currentPassword', 'newPassword']);
  if (typeof b.currentPassword !== 'string' || !(await verifyPasswordAsync(b.currentPassword, u.passwordHash))
    || (await getUserById(u.id))?.passwordHash !== u.passwordHash) {
    return apiError(res, 400, 'INVALID_CURRENT_PASSWORD', 'كلمة المرور الحالية غير صحيحة.', 'Current password is incorrect.');
  }
  if (!isStrongPassword(b.newPassword)) return apiError(res, 400, 'WEAK_PASSWORD', 'كلمة المرور 8 أحرف على الأقل وتحتوي حروفًا وأرقامًا.', 'Password must be at least 8 characters with letters and digits.');
  if (b.newPassword === b.currentPassword) return apiError(res, 400, 'WEAK_PASSWORD', 'اختر كلمة مرور مختلفة عن الحالية.', 'Choose a different password.');
  const newHash = await hashPasswordAsync(b.newPassword as string);
  const accessToken = await tx(async () => {
    await setPassword(u.id, newHash, false);
    await revokeAllSessions(u.id);
    await addAuditLog({ actorType: 'user', actorUserId: u.id, actorName: u.nameAr, ip: clientIp(req), action: 'auth.change_password', entityType: 'user', entityId: u.id, summaryAr: 'تغيير كلمة المرور' });
    return await issueSession(res, (await getUserById(u.id))!);
  });
  return okMessage(res, 200, 'تم تغيير كلمة المرور.', { accessToken, user: toPublicCoreUser((await getUserById(u.id))!) });
}));
