import { Router, type Response } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { tx } from '../db/sqlite.js';
import { ah, apiError, okMessage, AppError } from '../http/errors.js';
import { makeLimiter } from '../http/rateLimits.js';
import { clientIp } from '../http/helpers.js';
import { Checker, isEmail, isPhone, isStrongPassword, normalizeDigits, onlyKeys } from '../http/validate.js';
import { hashPassword, verifyPassword, signAccess, signRefresh, verifyRefresh, sha256 } from '../auth/jwt.js';
import { auth, currentUser } from '../middleware/auth.js';
import {
  createUser, getUserByEmail, getUserById, getUserByTokenHash, isLocked, markEmailVerified, recordFailedLogin,
  recordSuccessfulLogin, setPassword, setResetToken, setVerifyToken, toPublicUser, type UserInternal,
} from '../store/users.js';
import { checkRefreshToken, markRotated, revokeAllForUser, revokeRefreshToken, storeRefreshToken } from '../store/refreshTokens.js';
import { createOrganization } from '../store/organizations.js';
import { createApplicant, setApplicantCreator } from '../store/applicants.js';
import { addAuditLog } from '../store/audit.js';
import { dispatch } from '../notifications/notify.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';

export const authRouter = Router();

export const REFRESH_COOKIE = 'sona3_refresh';
const COOKIE_PATH = '/api/v1/auth';
const VERIFY_TTL_MS = 24 * 3600_000;
const RESET_TTL_MS = 3600_000;

const TOO_MANY_AR = 'محاولات كثيرة — انتظر قليلًا ثم حاول مجددًا.';
const TOO_MANY_EN = 'Too many attempts, please wait and try again.';
const loginLimiter = makeLimiter('login', {}, TOO_MANY_AR, TOO_MANY_EN);
const registerLimiter = makeLimiter('register', {}, TOO_MANY_AR, TOO_MANY_EN);
const emailFlowLimiter = makeLimiter('emailFlow', {}, TOO_MANY_AR, TOO_MANY_EN);
const refreshLimiter = makeLimiter('refresh', {}, TOO_MANY_AR, TOO_MANY_EN);

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true, secure: config.isProd, sameSite: 'strict', maxAge: config.jwtRefreshTtlSec * 1000, path: COOKIE_PATH,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: config.isProd, sameSite: 'strict', path: COOKIE_PATH });
}

/** يبدأ جلسة: access في الرد (يُحفظ في الذاكرة)، refresh في كوكي httpOnly فقط. */
function issueSession(res: Response, user: UserInternal, familyId = randomUUID()): string {
  const { token } = signRefresh(user.id);
  storeRefreshToken(user.id, token, familyId);
  setRefreshCookie(res, token);
  return signAccess(user.id, user.role, user.organizationId);
}

function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, hash: sha256(token) };
}

function sendVerification(user: UserInternal): void {
  const { token, hash } = newToken();
  setVerifyToken(user.id, hash, new Date(Date.now() + VERIFY_TTL_MS).toISOString());
  dispatch('auth.verify_email', { name: user.nameAr, link: `${config.appUrl}/#verify-email/${token}` },
    [{ userId: user.id, email: user.email }], { dedupePrefix: `verify:${hash.slice(0, 16)}`, sensitive: true, channels: ['email'] });
}

// ── تسجيل متقدم جديد (التسجيل العام للمتقدمين فقط؛ حسابات الجهات ينشئها الأدمن) ──
authRouter.post('/auth/register', registerLimiter, ah((req, res) => {
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
  if (getUserByEmail(email!)) {
    return apiError(res, 409, 'EMAIL_TAKEN', 'البريد الإلكتروني مسجل بالفعل — سجّل الدخول أو استعد كلمة المرور.', 'This email is already registered. Sign in or reset your password.');
  }
  const user = tx(() => {
    const org = createOrganization({ type: 'applicant', nameAr: fullName!, nameEn: fullName!, contactEmail: email! });
    const applicant = createApplicant(org.id, fullName!, null);
    const u = createUser({
      organizationId: org.id, role: 'applicant', email: email!.toLowerCase(), nameAr: fullName!, phone: mobile!,
      passwordHash: hashPassword(b.password as string), emailVerified: false,
    });
    setApplicantCreator(applicant.id, u.id);
    sendVerification(u);
    addAuditLog({ actorType: 'user', actorUserId: u.id, actorName: u.nameAr, actorRole: u.role, actorOrgId: org.id, ip: clientIp(req),
      action: 'auth.register', entityType: 'applicant', entityId: applicant.id, summaryAr: `تسجيل متقدم جديد: ${fullName}` });
    return u;
  });
  kickNotificationWorker();
  // لا يُرجع توكن التفعيل أبدًا — يصل بالبريد فقط.
  return okMessage(res, 201, 'تم إنشاء الحساب — راجع بريدك الإلكتروني لتفعيله.', { email: user.email, emailVerified: false });
}));

authRouter.post('/auth/verify-email', emailFlowLimiter, ah((req, res) => {
  const b = onlyKeys(req.body, ['token']);
  const token = typeof b.token === 'string' ? b.token.trim() : '';
  const u = /^[a-f0-9]{64}$/.test(token) ? getUserByTokenHash('emailVerifyTokenHash', sha256(token)) : null;
  if (!u || !u.tokenExpiresAt || Date.parse(u.tokenExpiresAt) < Date.now()) {
    return apiError(res, 400, 'TOKEN_INVALID', 'رابط التفعيل غير صالح أو منتهي — اطلب رابطًا جديدًا.', 'The activation link is invalid or expired. Request a new one.');
  }
  markEmailVerified(u.id);
  addAuditLog({ actorType: 'user', actorUserId: u.id, actorName: u.nameAr, actorRole: u.role, actorOrgId: u.organizationId, ip: clientIp(req),
    action: 'auth.verify_email', entityType: 'user', entityId: u.id, summaryAr: 'تفعيل البريد الإلكتروني' });
  return okMessage(res, 200, 'تم تفعيل البريد الإلكتروني — يمكنك تسجيل الدخول الآن.');
}));

authRouter.post('/auth/resend-verification', emailFlowLimiter, ah((req, res) => {
  const b = onlyKeys(req.body, ['email']);
  const u = isEmail(b.email) ? getUserByEmail(b.email) : null;
  if (u && !u.emailVerifiedAt && u.isActive) { sendVerification(u); kickNotificationWorker(); }
  // رد عام لا يكشف وجود الحساب.
  return okMessage(res, 200, 'إذا كان الحساب موجودًا وغير مفعل فستصلك رسالة تفعيل جديدة.');
}));

authRouter.post('/auth/login', loginLimiter, ah((req, res) => {
  const b = onlyKeys(req.body, ['email', 'password']);
  const ip = clientIp(req);
  const u = isEmail(b.email) ? getUserByEmail(b.email) : null;
  const invalid = () => apiError(res, 401, 'INVALID_CREDENTIALS', 'البريد الإلكتروني أو كلمة المرور غير صحيحة.', 'Invalid email or password.');
  if (!u) return invalid();
  if (isLocked(u)) {
    return apiError(res, 423, 'ACCOUNT_LOCKED', 'تم قفل الحساب مؤقتًا بسبب محاولات فاشلة متكررة — حاول بعد 15 دقيقة.', 'Account temporarily locked after repeated failed attempts. Try again in 15 minutes.');
  }
  if (typeof b.password !== 'string' || !verifyPassword(b.password, u.passwordHash)) {
    const { locked } = recordFailedLogin(u);
    addAuditLog({ actorType: 'anonymous', ip, action: 'auth.login_failed', entityType: 'user', entityId: u.id, summaryAr: locked ? 'قفل الحساب بعد محاولات فاشلة' : 'محاولة دخول فاشلة' });
    if (locked) return apiError(res, 423, 'ACCOUNT_LOCKED', 'تم قفل الحساب مؤقتًا بسبب محاولات فاشلة متكررة — حاول بعد 15 دقيقة.', 'Account temporarily locked after repeated failed attempts. Try again in 15 minutes.');
    return invalid();
  }
  if (!u.isActive || !u.organizationActive) return apiError(res, 403, 'ACCOUNT_DISABLED', 'الحساب موقوف — تواصل مع إدارة النظام.', 'The account is disabled.');
  if (!u.emailVerifiedAt) return apiError(res, 403, 'EMAIL_NOT_VERIFIED', 'يجب تفعيل البريد الإلكتروني أولًا.', 'Please verify your email first.');
  recordSuccessfulLogin(u.id);
  const accessToken = issueSession(res, u);
  addAuditLog({ actorType: 'user', actorUserId: u.id, actorName: u.nameAr, actorRole: u.role, actorOrgId: u.organizationId, ip, action: 'auth.login', entityType: 'user', entityId: u.id, summaryAr: 'تسجيل دخول' });
  return okMessage(res, 200, 'تم تسجيل الدخول.', { accessToken, user: toPublicUser(getUserById(u.id)!) });
}));

authRouter.post('/auth/refresh', refreshLimiter, ah((req, res) => {
  const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  const unauthorized = () => { clearRefreshCookie(res); return apiError(res, 401, 'UNAUTHORIZED', 'انتهت الجلسة — سجّل الدخول من جديد.', 'Session expired.'); };
  if (!token || !verifyRefresh(token)) return unauthorized();
  const check = checkRefreshToken(token);
  if (!check.ok) return unauthorized();
  const u = getUserById(check.userId);
  if (!u || !u.isActive || !u.organizationActive) return unauthorized();
  const { token: next } = signRefresh(u.id);
  const nextId = storeRefreshToken(u.id, next, check.familyId);
  markRotated(check.id, nextId);
  setRefreshCookie(res, next);
  return okMessage(res, 200, 'تم تجديد الجلسة.', { accessToken: signAccess(u.id, u.role, u.organizationId), user: toPublicUser(u) });
}));

authRouter.post('/auth/logout', ah((req, res) => {
  const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  if (token) revokeRefreshToken(token);
  clearRefreshCookie(res);
  return okMessage(res, 200, 'تم تسجيل الخروج.');
}));

authRouter.post('/auth/forgot-password', emailFlowLimiter, ah((req, res) => {
  const b = onlyKeys(req.body, ['email']);
  const u = isEmail(b.email) ? getUserByEmail(b.email) : null;
  if (u && u.isActive) {
    const { token, hash } = newToken();
    setResetToken(u.id, hash, new Date(Date.now() + RESET_TTL_MS).toISOString());
    dispatch('auth.reset_password', { name: u.nameAr, link: `${config.appUrl}/#reset-password/${token}` },
      [{ userId: u.id, email: u.email }], { dedupePrefix: `reset:${hash.slice(0, 16)}`, sensitive: true, channels: ['email'] });
    addAuditLog({ actorType: 'anonymous', ip: clientIp(req), action: 'auth.password_reset_requested', entityType: 'user', entityId: u.id, summaryAr: 'طلب استعادة كلمة المرور' });
    kickNotificationWorker();
  }
  return okMessage(res, 200, 'إذا كان البريد مسجلًا فستصلك رسالة لاستعادة كلمة المرور.');
}));

authRouter.post('/auth/reset-password', emailFlowLimiter, ah((req, res) => {
  const b = onlyKeys(req.body, ['token', 'newPassword']);
  const token = typeof b.token === 'string' ? b.token.trim() : '';
  if (!isStrongPassword(b.newPassword)) throw new AppError(400, 'WEAK_PASSWORD', 'كلمة المرور 8 أحرف على الأقل وتحتوي حروفًا وأرقامًا.', 'Password must be at least 8 characters with letters and digits.');
  const u = /^[a-f0-9]{64}$/.test(token) ? getUserByTokenHash('passwordResetTokenHash', sha256(token)) : null;
  if (!u || !u.tokenExpiresAt || Date.parse(u.tokenExpiresAt) < Date.now()) {
    return apiError(res, 400, 'TOKEN_INVALID', 'رابط الاستعادة غير صالح أو منتهي.', 'The reset link is invalid or expired.');
  }
  tx(() => {
    setPassword(u.id, hashPassword(b.newPassword as string), false);
    if (!u.emailVerifiedAt) markEmailVerified(u.id); // فتح الرابط يثبت ملكية البريد
    revokeAllForUser(u.id);
    addAuditLog({ actorType: 'user', actorUserId: u.id, actorName: u.nameAr, actorRole: u.role, actorOrgId: u.organizationId, ip: clientIp(req),
      action: 'auth.password_reset', entityType: 'user', entityId: u.id, summaryAr: 'تعيين كلمة مرور جديدة عبر رابط الاستعادة' });
  });
  return okMessage(res, 200, 'تم تعيين كلمة المرور — سجّل الدخول بها الآن.');
}));

authRouter.get('/auth/me', auth, ah((req, res) => okMessage(res, 200, 'ok', { user: toPublicUser(currentUser(req)) })));

authRouter.post('/auth/change-password', auth, ah((req, res) => {
  const u = currentUser(req);
  const b = onlyKeys(req.body, ['currentPassword', 'newPassword']);
  if (typeof b.currentPassword !== 'string' || !verifyPassword(b.currentPassword, u.passwordHash)) {
    return apiError(res, 400, 'INVALID_CURRENT_PASSWORD', 'كلمة المرور الحالية غير صحيحة.', 'Current password is incorrect.');
  }
  if (!isStrongPassword(b.newPassword)) return apiError(res, 400, 'WEAK_PASSWORD', 'كلمة المرور 8 أحرف على الأقل وتحتوي حروفًا وأرقامًا.', 'Password must be at least 8 characters with letters and digits.');
  if (b.newPassword === b.currentPassword) return apiError(res, 400, 'WEAK_PASSWORD', 'اختر كلمة مرور مختلفة عن الحالية.', 'Choose a different password.');
  const accessToken = tx(() => {
    setPassword(u.id, hashPassword(b.newPassword as string), false);
    revokeAllForUser(u.id); // يُنهي الجلسات الأخرى
    addAuditLog({ actorType: 'user', actorUserId: u.id, actorName: u.nameAr, actorRole: u.role, actorOrgId: u.organizationId, ip: clientIp(req),
      action: 'auth.change_password', entityType: 'user', entityId: u.id, summaryAr: 'تغيير كلمة المرور' });
    return issueSession(res, getUserById(u.id)!);
  });
  return okMessage(res, 200, 'تم تغيير كلمة المرور.', { accessToken, user: toPublicUser(getUserById(u.id)!) });
}));
