import { isRetiredRole } from '../domain.js';
import { Router, type Response } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { tx } from '../db/sqlite.js';
import { ah, apiError, okMessage, AppError } from '../http/errors.js';
import { makeLimiter } from '../http/rateLimits.js';
import { clientIp } from '../http/helpers.js';
import { Checker, isEmail, isPhone, isStrongPassword, normalizeDigits, onlyKeys } from '../http/validate.js';
import { burnPasswordCheckAsync, hashPasswordAsync, verifyPasswordAsync, signAccess, signRefresh, verifyRefresh, sha256 } from '../auth/jwt.js';
import { auth, currentUser } from '../middleware/auth.js';
import {
  createUser, getUserByEmail, getUserById, getUserByTokenHash, markEmailVerified, recordFailedLogin,
  recordSuccessfulLogin, setPassword, setResetToken, setVerifyToken, toPublicUser, type UserInternal,
} from '../store/users.js';
import { checkRefreshToken, markRotated, revokeAllSessions, revokeRefreshToken, storeRefreshToken } from '../store/refreshTokens.js';
import { pruneThrottle, retryAfterMs, settleAttempt, throttleKey } from '../store/loginThrottle.js';
import { shamsPolicy } from '../config/shamsPolicy.js';
import { cancelRecoveryByOwner } from '../services/accountRecovery.js';
import { createOrganization } from '../store/organizations.js';
import { createFactory, getFactoryByOrg } from '../store/factories.js';
import { findOpenApplicationForFactory } from '../store/applications.js';
import { performAction } from '../workflow/actionService.js';
import { cleanRegistrationApplication, createRegistrationDraft, type RegistrationSections } from '../workflow/applicationService.js';
import { accountLoginBlock } from '../services/factoryAccount.js';
import fs from 'node:fs';
import { acceptPdf, discardUpload, registrationUpload, storedPath, type StoredFile } from '../http/upload.js';
import { completenessIssues } from '../workflow/validate.js';
import { fieldForDocKind, type DocumentKind } from '../workflow/applicationForm.js';
import { addDocumentVersion } from '../store/documents.js';
import { registryAccess } from '../store/registry.js';
import { findOpenSubmittedByRegistry } from '../store/applications.js';
import { getRegistryClient } from '../integrations/registry/index.js';
import { addAuditLog } from '../store/audit.js';
import { dispatch } from '../notifications/notify.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';

export const authRouter = Router();

export const REFRESH_COOKIE = 'shams_refresh';
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
async function issueSession(res: Response, user: UserInternal, familyId = randomUUID()): Promise<string> {
  const { token } = signRefresh(user.id);
  await storeRefreshToken(user.id, token, familyId);
  setRefreshCookie(res, token);
  return signAccess(user.id, user.role, user.organizationId, user.tokenVersion);
}

function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, hash: sha256(token) };
}

async function sendVerification(user: UserInternal): Promise<void> {
  const { token, hash } = newToken();
  await setVerifyToken(user.id, hash, new Date(Date.now() + VERIFY_TTL_MS).toISOString());
  await dispatch('auth.verify_email', { name: user.nameAr, link: `${config.appUrl}/#verify-email/${token}` },
    [{ userId: user.id, email: user.email }], { dedupePrefix: `verify:${hash.slice(0, 16)}`, sensitive: true, channels: ['email'] });
}

// ── تسجيل مصنع جديد (التسجيل العام للمصانع فقط؛ حسابات الجهات ينشئها الأدمن) ──
// كل نموذج التسجيل في طلب واحد (multipart): الحساب + الأقسام الأربعة (payload JSON) + المستندات. قبول الحساب مبني على
// المستندات (قرار IMC)، فتُرفع مع التسجيل. الحساب لا يدخل قبل تفعيل البريد وقبول IMC (services/factoryAccount.ts).
authRouter.post('/auth/register', registerLimiter, registrationUpload, ah(async (req, res) => {
  const uploaded = Object.entries((req.files ?? {}) as Record<string, Express.Multer.File[]>)
    .flatMap(([kind, list]) => list.map((file) => ({ kind: kind as DocumentKind, file })));
  const stored: Array<{ kind: DocumentKind; file: StoredFile }> = [];
  const dropAll = () => {
    for (const u of uploaded) discardUpload(u.file);
    for (const s of stored) fs.rmSync(storedPath(s.file.storedName), { force: true });
  };
  try {
    let parsed: unknown;
    try { parsed = JSON.parse(String((req.body as Record<string, unknown>)?.payload ?? '')); } catch { parsed = undefined; }
    const b = onlyKeys(parsed, ['companyName', 'contactName', 'email', 'mobile', 'password', 'application']);
    const c = new Checker();
    const companyName = c.text(b, 'companyName', { required: true, min: 2, max: 200 });
    const contactName = c.text(b, 'contactName', { required: true, min: 2, max: 200 });
    const email = c.text(b, 'email', { required: true, max: 254 });
    const mobileRaw = c.text(b, 'mobile', { required: true, max: 20 });
    const mobile = mobileRaw === undefined ? undefined : normalizeDigits(mobileRaw);
    if (email && !isEmail(email)) c.add('email', 'invalid email');
    if (mobile && !isPhone(mobile)) c.add('mobile', 'invalid phone number');
    if (!isStrongPassword(b.password)) c.add('password', 'min 8 chars with letters and digits');
    // أقسام الفورم: نفس تحقق المعالج، وأخطاؤها تُجمع مع أخطاء الحساب في رد واحد.
    let application: RegistrationSections | undefined;
    if (b.application === undefined || b.application === null) c.add('application', 'required');
    else {
      try { application = cleanRegistrationApplication(b.application); } catch (e) {
        if (e instanceof AppError && e.details) for (const d of e.details) c.add(d.field, d.issue); else throw e;
      }
    }
    c.throwIfAny();

    // المستندات: PDF حقيقي (امتداد + نوع + توقيع %PDF-)؛ أول ملف غير صالح يرفض التسجيل كله.
    for (const u of uploaded) {
      try { stored.push({ kind: u.kind, file: acceptPdf(u.file) }); } catch (e) {
        if (e instanceof AppError) throw new AppError(e.http, e.code, e.messageAr, e.messageEn, [{ field: fieldForDocKind(u.kind), issue: 'invalid file' }]);
        throw e;
      }
    }
    // الاكتمال: قبول الحساب مبني على النموذج كاملًا، فلا يُنشأ حساب بنموذج ناقص.
    const general = { ...(application!.general ?? {}), companyName: companyName! };
    const contact = { contactName: contactName!, contactEmail: email!.toLowerCase(), contactMobile: mobile!, ...(application!.contact ?? {}) };
    const data = { ...application!, general, contact };
    const counts: Partial<Record<DocumentKind, number>> = {};
    for (const s of stored) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
    const issues = completenessIssues(data, counts);
    if (issues.length) throw new AppError(422, 'INCOMPLETE_APPLICATION', 'نموذج التسجيل غير مكتمل — استكمل الحقول والمستندات المطلوبة.', 'The registration form is incomplete.', issues);
    const totalBytes = stored.reduce((n, s) => n + s.file.sizeBytes, 0);
    if (totalBytes > Math.floor(shamsPolicy.documentLimits.maxApplicationStorageMB * 1024 * 1024)) {
      throw new AppError(413, 'STORAGE_LIMIT', `مجموع المستندات يتجاوز ${shamsPolicy.documentLimits.maxApplicationStorageMB} ميجابايت.`, `The documents exceed ${shamsPolicy.documentLimits.maxApplicationStorageMB} MB in total.`);
    }

    // رقم السجل الصناعي قبل إنشاء أي شيء: الرقم غير الصحيح أو المحجوز يُصحَّح في الصفحة نفسها.
    const regNumber = String(data.company?.industrialRegistryNumber ?? '');
    const access = await registryAccess(regNumber, '');
    if (!access.allowed || await findOpenSubmittedByRegistry(regNumber, '')) {
      throw new AppError(409, 'REGISTRY_IN_USE', 'رقم السجل الصناعي مستخدم في طلب آخر أو موقوف لمراجعة وحدة إدارة المبادرة. إن كان الرقم لمنشأتكم فتواصلوا مع الدعم الفني.',
        'This industrial registry number is used by another application or on hold for PMU review. If it belongs to your facility, contact support.', [{ field: 'industrialRegistryNumber', issue: 'duplicate' }]);
    }
    let check: Awaited<ReturnType<ReturnType<typeof getRegistryClient>['verify']>>;
    try { check = await getRegistryClient().verify(regNumber); } catch { check = { result: 'unavailable', errorCode: 'CLIENT_ERROR' }; }
    if (check.result === 'invalid') {
      throw new AppError(422, 'REGISTRY_INVALID', 'رقم السجل الصناعي غير صحيح أو غير مسجل — صحّحه ثم أعد المحاولة.', 'The industrial registry number is invalid or not registered.', [{ field: 'industrialRegistryNumber', issue: 'invalid' }]);
    }
    if (check.result === 'unavailable') {
      throw new AppError(503, 'REGISTRY_UNAVAILABLE', 'تعذر التحقق من السجل الصناعي حاليًا. بياناتك محفوظة في هذه الصفحة — أعد المحاولة بعد قليل.', 'The industrial registry is unavailable right now. Your data is kept on this page — try again shortly.');
    }

    const done = () => okMessage(res, 201, 'تم استلام التسجيل — راجع بريدك الإلكتروني لإكمال الخطوة التالية.', { email: email!.toLowerCase(), emailVerified: false });
    const existing = await getUserByEmail(email!);
    if (existing) {
      // L6: نفس الرد ونفس الكلفة تقريبًا — لا يكشف التسجيل وجود البريد. صاحب البريد يُبلَّغ بالمحاولة، ولا يُحفظ أي ملف.
      dropAll();
      await hashPasswordAsync(b.password as string);
      if (existing.isActive) {
        await dispatch('auth.registration_attempt', { name: existing.nameAr }, [{ userId: existing.id, email: existing.email }],
          { dedupePrefix: `reg-attempt:${existing.id}:${new Date().toISOString().slice(0, 13)}`, channels: ['email'] });
        kickNotificationWorker();
      }
      await addAuditLog({ actorType: 'anonymous', ip: clientIp(req), action: 'auth.register_existing_email', entityType: 'user', entityId: existing.id, summaryAr: 'محاولة تسجيل ببريد مسجل' });
      return done();
    }
    // PA-03: hashed BEFORE the write transaction, in the worker pool (the hash does not depend on the database).
    const passwordHash = await hashPasswordAsync(b.password as string);
    await tx(async () => {
      const org = await createOrganization({ type: 'factory', nameAr: companyName!, nameEn: companyName!, contactEmail: email! });
      const factory = await createFactory(org.id, companyName!, null, 'pending');
      const u = await createUser({
        organizationId: org.id, role: 'factory_owner', email: email!.toLowerCase(), nameAr: contactName!, phone: mobile!,
        passwordHash, emailVerified: false,
      });
      await sendVerification(u);
      const app = await createRegistrationDraft(factory, u, data, clientIp(req));
      for (const s of stored) {
        await addDocumentVersion({
          applicationId: app.id, kind: s.kind, attempt: 1, uploadedInState: 'DRAFT', originalName: s.file.originalName,
          storedName: s.file.storedName, sizeBytes: s.file.sizeBytes, sha256: s.file.sha256, uploadedBy: u.id,
        }, s.kind === 'electricityBill');
      }
      await addAuditLog({ actorType: 'user', actorUserId: u.id, actorName: u.nameAr, actorRole: u.role, actorOrgId: org.id, ip: clientIp(req),
        action: 'auth.register', entityType: 'factory', entityId: factory.id, applicationId: app.id, summaryAr: `تسجيل مصنع جديد: ${companyName}`,
        details: { documents: stored.length, sha256: stored.map((s) => s.file.sha256) } });
    });
    kickNotificationWorker();
    // لا يُرجع توكن التفعيل أبدًا — يصل بالبريد فقط.
    return done();
  } catch (e) {
    dropAll();
    throw e;
  }
}));

authRouter.post('/auth/verify-email', emailFlowLimiter, ah(async (req, res) => {
  const b = onlyKeys(req.body, ['token']);
  const token = typeof b.token === 'string' ? b.token.trim() : '';
  const u = /^[a-f0-9]{64}$/.test(token) ? await getUserByTokenHash('emailVerifyTokenHash', sha256(token)) : null;
  if (!u || !u.tokenExpiresAt || Date.parse(u.tokenExpiresAt) < Date.now()) {
    return apiError(res, 400, 'TOKEN_INVALID', 'رابط التفعيل غير صالح أو منتهي — اطلب رابطًا جديدًا.', 'The activation link is invalid or expired. Request a new one.');
  }
  await markEmailVerified(u.id);
  await addAuditLog({ actorType: 'user', actorUserId: u.id, actorName: u.nameAr, actorRole: u.role, actorOrgId: u.organizationId, ip: clientIp(req),
    action: 'auth.verify_email', entityType: 'user', entityId: u.id, summaryAr: 'تفعيل البريد الإلكتروني' });
  // مصنع مسجَّل ذاتيًا: بعد إثبات البريد يُرسل طلب التسجيل (البيانات + المستندات) لمراجعة IMC تلقائيًا، والحساب لا يدخل حتى القرار.
  const factory = u.role === 'factory_owner' ? await getFactoryByOrg(u.organizationId) : null;
  if (factory?.accountStatus === 'pending') {
    const draft = await findOpenApplicationForFactory(factory.id);
    let submitted = false;
    if (draft?.state === 'DRAFT') {
      try {
        await performAction((await getUserById(u.id))!, draft.id, 'submit', { expectedVersion: draft.version }, { ip: clientIp(req) });
        submitted = true;
      } catch { /* يبقى pending: يدخل دخولًا مقيّدًا ويعيد الإرسال (مثلًا خدمة السجل غير متاحة) */ }
      finally { kickNotificationWorker(); }
    }
    return submitted
      ? okMessage(res, 200, 'تم تفعيل البريد الإلكتروني، وأُرسل طلب تسجيل المصنع لمراجعة مركز تحديث الصناعة (IMC). ستصلك رسالة بالقرار، ويمكنك الدخول بعد قبول الحساب.', { submitted: true })
      : okMessage(res, 200, 'تم تفعيل البريد الإلكتروني، لكن تعذر إرسال طلب التسجيل للمراجعة الآن. سجّل الدخول لإعادة إرساله.', { submitted: false });
  }
  return okMessage(res, 200, 'تم تفعيل البريد الإلكتروني — يمكنك تسجيل الدخول الآن.');
}));

authRouter.post('/auth/resend-verification', emailFlowLimiter, ah(async (req, res) => {
  const b = onlyKeys(req.body, ['email']);
  const u = isEmail(b.email) ? await getUserByEmail(b.email) : null;
  if (u && !u.emailVerifiedAt && u.isActive) { await sendVerification(u); kickNotificationWorker(); }
  // رد عام لا يكشف وجود الحساب.
  return okMessage(res, 200, 'إذا كان الحساب موجودًا وغير مفعل فستصلك رسالة تفعيل جديدة.');
}));

/**
 * M3: لا قفل للحساب. لكل (بريد، IP) تأخير متصاعد بعد المحاولات الفاشلة — مهاجم من عنوان لا يمنع المالك من عنوان آخر.
 * البريد غير الموجود يمر بنفس المسار ونفس كلفة bcrypt (L6). صاحب الحساب يُبلَّغ عند النشاط المتكرر.
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
  // PR-P1: the check above yields; read the account again so a deactivation or password change in the meantime is honoured.
  const u = found ? await getUserByEmail(rawEmail) : null;
  const ok = Boolean(u) && passwordOk && u!.passwordHash === found!.passwordHash;
  // PA-02: the outcome and a fresh throttle check in one transaction — see settleAttempt.
  const settled = await settleAttempt(key, ok);
  if ('throttledMs' in settled) return throttled(settled.throttledMs);
  if (!ok || !u) {
    if (Math.random() < 0.02) await pruneThrottle();
    if (u) {
      const failures = await recordFailedLogin(u.id);
      const every = shamsPolicy.loginThrottle.notifyOwnerAfterFailures;
      if (failures > 0 && failures % every === 0 && u.isActive) {
        await dispatch('auth.suspicious_logins', { name: u.nameAr, count: failures }, [{ userId: u.id, email: u.email }],
          { dedupePrefix: `susp:${u.id}:${failures}:${new Date().toISOString().slice(0, 10)}`, channels: ['email'] });
        kickNotificationWorker();
      }
      await addAuditLog({ actorType: 'anonymous', ip, action: 'auth.login_failed', entityType: 'user', entityId: u.id, summaryAr: 'محاولة دخول فاشلة' });
    }
    return invalid();
  }
  if (!u.isActive || !u.organizationActive || isRetiredRole(u.role)) return apiError(res, 403, 'ACCOUNT_DISABLED', 'الحساب موقوف — تواصل مع إدارة النظام.', 'The account is disabled.');
  if (!u.emailVerifiedAt) return apiError(res, 403, 'EMAIL_NOT_VERIFIED', 'يجب تفعيل البريد الإلكتروني أولًا.', 'Please verify your email first.');
  // حساب مصنع قيد مراجعة IMC أو مرفوض: لا دخول (صحة كلمة المرور لا تكفي). طلب التعديل يسمح بدخول مقيّد.
  const blockedAccount = u.role === 'factory_owner' ? accountLoginBlock(u.factoryAccountStatus) : null;
  if (blockedAccount) return apiError(res, 403, blockedAccount.code, blockedAccount.ar, blockedAccount.en);
  await recordSuccessfulLogin(u.id);
  const accessToken = await issueSession(res, u);
  await addAuditLog({ actorType: 'user', actorUserId: u.id, actorName: u.nameAr, actorRole: u.role, actorOrgId: u.organizationId, ip, action: 'auth.login', entityType: 'user', entityId: u.id, summaryAr: 'تسجيل دخول' });
  return okMessage(res, 200, 'تم تسجيل الدخول.', { accessToken, user: toPublicUser((await getUserById(u.id))!) });
}));

authRouter.post('/auth/refresh', refreshLimiter, ah(async (req, res) => {
  const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  const unauthorized = () => { clearRefreshCookie(res); return apiError(res, 401, 'UNAUTHORIZED', 'انتهت الجلسة — سجّل الدخول من جديد.', 'Session expired.'); };
  if (!token || !verifyRefresh(token)) return unauthorized();
  // Check → issue → rotate in ONE transaction. This was atomic while the code was synchronous; with the async driver two
  // concurrent refreshes of the same token could both pass the check and each mint a valid child token, defeating the
  // reuse detection. Inside tx the second one sees the token already rotated (revokedAt set) → "reused" → family revoked.
  const rotated = await tx(async () => {
    const check = await checkRefreshToken(token);
    if (!check.ok) return null;
    const u = await getUserById(check.userId);
    if (!u || !u.isActive || !u.organizationActive || isRetiredRole(u.role)) return null;
    if (u.role === 'factory_owner' && accountLoginBlock(u.factoryAccountStatus)) return null;
    const { token: next } = signRefresh(u.id);
    const nextId = await storeRefreshToken(u.id, next, check.familyId);
    await markRotated(check.id, nextId);
    return { u, next };
  });
  if (!rotated) return unauthorized();
  const { u, next } = rotated;
  setRefreshCookie(res, next);
  return okMessage(res, 200, 'تم تجديد الجلسة.', { accessToken: signAccess(u.id, u.role, u.organizationId, u.tokenVersion), user: toPublicUser(u) });
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
    await dispatch('auth.reset_password', { name: u.nameAr, link: `${config.appUrl}/#reset-password/${token}` },
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
  // One-time link: look it up and consume it (setPassword clears the hash) in the same transaction, so two concurrent
  // requests with the same link cannot both succeed (atomic by construction in the former synchronous code).
  // PA-03: hash outside the write transaction, in the worker pool; a malformed link costs no hash.
  const newHash = /^[a-f0-9]{64}$/.test(token) ? await hashPasswordAsync(b.newPassword as string) : '';
  const done = await tx(async () => {
    const u = /^[a-f0-9]{64}$/.test(token) ? await getUserByTokenHash('passwordResetTokenHash', sha256(token)) : null;
    if (!u || !u.tokenExpiresAt || Date.parse(u.tokenExpiresAt) < Date.now()) return false;
    await setPassword(u.id, newHash, false);
    if (!u.emailVerifiedAt) await markEmailVerified(u.id); // فتح الرابط يثبت ملكية البريد
    await revokeAllSessions(u.id); // M1: refresh + كل access token صادر
    await addAuditLog({ actorType: 'user', actorUserId: u.id, actorName: u.nameAr, actorRole: u.role, actorOrgId: u.organizationId, ip: clientIp(req),
      action: 'auth.password_reset', entityType: 'user', entityId: u.id, summaryAr: 'تعيين كلمة مرور جديدة عبر رابط الاستعادة' });
    return true;
  });
  if (!done) return apiError(res, 400, 'TOKEN_INVALID', 'رابط الاستعادة غير صالح أو منتهي.', 'The reset link is invalid or expired.');
  return okMessage(res, 200, 'تم تعيين كلمة المرور — سجّل الدخول بها الآن.');
}));

authRouter.get('/auth/me', auth, ah((req, res) => okMessage(res, 200, 'ok', { user: toPublicUser(currentUser(req)) })));

authRouter.post('/auth/change-password', auth, ah(async (req, res) => {
  const u = currentUser(req);
  const b = onlyKeys(req.body, ['currentPassword', 'newPassword']);
  if (typeof b.currentPassword !== 'string' || !(await verifyPasswordAsync(b.currentPassword, u.passwordHash))
    || (await getUserById(u.id))?.passwordHash !== u.passwordHash) {
    return apiError(res, 400, 'INVALID_CURRENT_PASSWORD', 'كلمة المرور الحالية غير صحيحة.', 'Current password is incorrect.');
  }
  if (!isStrongPassword(b.newPassword)) return apiError(res, 400, 'WEAK_PASSWORD', 'كلمة المرور 8 أحرف على الأقل وتحتوي حروفًا وأرقامًا.', 'Password must be at least 8 characters with letters and digits.');
  if (b.newPassword === b.currentPassword) return apiError(res, 400, 'WEAK_PASSWORD', 'اختر كلمة مرور مختلفة عن الحالية.', 'Choose a different password.');
  const newHash = await hashPasswordAsync(b.newPassword as string); // PA-03: outside the write transaction
  const accessToken = await tx(async () => {
    await setPassword(u.id, newHash, false);
    await revokeAllSessions(u.id); // M1: يُنهي الجلسات الأخرى فورًا (refresh + access)
    await addAuditLog({ actorType: 'user', actorUserId: u.id, actorName: u.nameAr, actorRole: u.role, actorOrgId: u.organizationId, ip: clientIp(req),
      action: 'auth.change_password', entityType: 'user', entityId: u.id, summaryAr: 'تغيير كلمة المرور' });
    return await issueSession(res, (await getUserById(u.id))!);
  });
  return okMessage(res, 200, 'تم تغيير كلمة المرور.', { accessToken, user: toPublicUser((await getUserById(u.id))!) });
}));

/** H4: إلغاء طلب استرداد الحساب من صاحبه برابط/رمز لمرة واحدة وصله على بريده وهاتفه. رد عام. */
authRouter.post('/auth/recovery/cancel', emailFlowLimiter, ah(async (req, res) => {
  const b = onlyKeys(req.body, ['token']);
  const ok = await cancelRecoveryByOwner(b.token, clientIp(req));
  if (!ok) return apiError(res, 400, 'TOKEN_INVALID', 'رابط الإلغاء غير صالح أو مستخدم أو أن الطلب مغلق.', 'The cancel link is invalid, used, or the request is closed.');
  return okMessage(res, 200, 'أُلغي طلب نقل الحساب — لن يتغير بريدك.');
}));
