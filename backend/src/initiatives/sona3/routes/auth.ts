/**
 * Sona3 public endpoints (/api/v1/i/sona3/public/*) and the module's /auth/me.
 *
 * Registration keeps the original fields (full name, e-mail, mobile, password) and creates ONE platform account with the
 * person's shared profile (name, mobile) + the Sona3 applicant file. An e-mail that already has a platform account gets the
 * same answer as a new one (no enumeration) and a notice to sign in and apply from the initiative page.
 * Sign-in, refresh, password flows and verification are the platform's (core/routes/auth.ts).
 */
import { Router } from 'express';
import { tx } from '../db/database.js';
import { ah, okMessage } from '../http/errors.js';
import { makeLimiter } from '../http/rateLimits.js';
import { clientIp } from '../http/helpers.js';
import { Checker, isEmail, isPhone, isStrongPassword, normalizeDigits, onlyKeys } from '../http/validate.js';
import { hashPasswordAsync } from '../auth/jwt.js';
import { currentUser } from '../middleware/auth.js';
import { toPublicUser } from '../store/users.js';
import { createOrganization } from '../store/organizations.js';
import { createApplicant, setApplicantCreator } from '../store/applicants.js';
import { addAuditLog } from '../store/audit.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { createMembership } from '../../../core/store/memberships.js';
import { getUserByEmail as getCoreUserByEmail } from '../../../core/store/users.js';
import { createAccount, isAccountExistsRace, notifyExistingAccountOnRegister, sendVerification } from '../../../core/identity.js';
import { savePersonProfile } from '../../../core/profile/store.js';
import { MODULE_ID } from '../config.js';

export const publicAuthRouter = Router();
export const meRouter = Router();

const TOO_MANY_AR = 'محاولات كثيرة — انتظر قليلًا ثم حاول مجددًا.';
const TOO_MANY_EN = 'Too many attempts, please wait and try again.';
const registerLimiter = makeLimiter('register', {}, TOO_MANY_AR, TOO_MANY_EN);

publicAuthRouter.post('/register', registerLimiter, ah(async (req, res) => {
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
  const done = () => okMessage(res, 201, 'تم إنشاء الحساب — راجع بريدك الإلكتروني لتفعيله.', { email: email!.toLowerCase(), emailVerified: false });
  const existing = await getCoreUserByEmail(email!);
  if (existing) {
    await hashPasswordAsync(b.password as string);
    await notifyExistingAccountOnRegister(existing, { id: MODULE_ID, titleAr: 'صُنّاع المستقبل' }, clientIp(req));
    return done();
  }
  const passwordHash = await hashPasswordAsync(b.password as string);
  try {
   await tx(async () => {
    const account = await createAccount({ email: email!, nameAr: fullName!, phone: mobile!, passwordHash, ip: clientIp(req), source: MODULE_ID });
    await savePersonProfile(account.id, { 'person.fullNameAr': fullName!, 'person.phone': mobile! });
    const org = await createOrganization({ type: 'applicant', nameAr: fullName!, nameEn: fullName!, contactEmail: email! });
    const applicant = await createApplicant(org.id, fullName!, null, account.id);
    await createMembership({ userId: account.id, initiativeId: MODULE_ID, role: 'applicant', organizationId: org.id });
    await setApplicantCreator(applicant.id, account.id);
    await sendVerification(account);
    await addAuditLog({ actorType: 'user', actorUserId: account.id, actorName: account.nameAr, actorRole: 'applicant', actorOrgId: org.id, ip: clientIp(req),
      action: 'auth.register', entityType: 'applicant', entityId: applicant.id, summaryAr: `تسجيل متقدم جديد: ${fullName}` });
   });
  } catch (e) {
    if (isAccountExistsRace(e)) return done(); // the same registration committed first (double submit)
    throw e;
  }
  kickNotificationWorker();
  return done();
}));

/** The Sona3 view of the signed-in person (role, organization). */
meRouter.get('/auth/me', ah((req, res) => okMessage(res, 200, 'ok', { user: toPublicUser(currentUser(req)) })));
