/**
 * Shams public endpoints (/api/v1/i/shams/public/*) and the module's /auth/me.
 *
 * Registration keeps the original one-request flow (account + the four form sections + PDFs, registry check before
 * anything is created), but creates ONE platform account for the person, plus the shared profiles every initiative can
 * reuse: person profile (contact name, mobile), factory profile (the form's company data) and the company documents.
 * Sign-in, refresh, password flows and e-mail verification are the platform's (core/routes/auth.ts); after verification
 * the platform calls onEmailVerified (module.ts), which submits the registration to IMC as before.
 */
import { Router } from 'express';
import fs from 'node:fs';
import { tx } from '../db/database.js';
import { ah, apiError, okMessage, AppError } from '../http/errors.js';
import { makeLimiter } from '../http/rateLimits.js';
import { clientIp } from '../http/helpers.js';
import { Checker, isEmail, isPhone, isStrongPassword, normalizeDigits, onlyKeys } from '../http/validate.js';
import { hashPasswordAsync } from '../auth/jwt.js';
import { currentUser } from '../middleware/auth.js';
import { toPublicUser, getUserById } from '../store/users.js';
import { shamsPolicy } from '../config/shamsPolicy.js';
import { cancelRecoveryByOwner } from '../services/accountRecovery.js';
import { createOrganization } from '../store/organizations.js';
import { createFactory, setFactoryProfile } from '../store/factories.js';
import { cleanRegistrationApplication, createRegistrationDraft, type RegistrationSections } from '../workflow/applicationService.js';
import { acceptPdf, discardUpload, registrationUpload, storedPath, type StoredFile } from '../http/upload.js';
import { completenessIssues } from '../workflow/validate.js';
import { fieldForDocKind, type DocumentKind } from '../workflow/applicationForm.js';
import { addDocumentVersion } from '../store/documents.js';
import { registryAccess } from '../store/registry.js';
import { findOpenSubmittedByRegistry } from '../store/applications.js';
import { recordRegistryConflict } from '../workflow/actionService.js';
import { getRegistryClient } from '../integrations/registry/index.js';
import { addAuditLog } from '../store/audit.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { createMembership } from '../../../core/store/memberships.js';
import { getUserByEmail as getCoreUserByEmail } from '../../../core/store/users.js';
import { createAccount, isAccountExistsRace, notifyExistingAccountOnRegister, sendVerification } from '../../../core/identity.js';
import { savePersonProfile, createFactoryProfile, addProfileDocument } from '../../../core/profile/store.js';
import { copyStoredFile, namespaceDir } from '../../../core/http/upload.js';
import { factoryProfileFromSections } from '../requirements.js';
import { MODULE_ID } from '../config.js';

export const publicAuthRouter = Router();
export const meRouter = Router();

const TOO_MANY_AR = 'محاولات كثيرة — انتظر قليلًا ثم حاول مجددًا.';
const TOO_MANY_EN = 'Too many attempts, please wait and try again.';
const registerLimiter = makeLimiter('register', {}, TOO_MANY_AR, TOO_MANY_EN);
const emailFlowLimiter = makeLimiter('emailFlow', {}, TOO_MANY_AR, TOO_MANY_EN);

/** The company documents uploaded with the registration become reusable profile documents of the factory. */
const PROFILE_DOC_KINDS: DocumentKind[] = ['commercialRegisterFile', 'industrialRegisterFile', 'taxCardFile', 'ownershipProofFile'];

// ── Factory self-registration (staff accounts are created through the approval flow) ──
publicAuthRouter.post('/register', registerLimiter, registrationUpload, ah(async (req, res) => {
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
    let application: RegistrationSections | undefined;
    if (b.application === undefined || b.application === null) c.add('application', 'required');
    else {
      try { application = cleanRegistrationApplication(b.application); } catch (e) {
        if (e instanceof AppError && e.details) for (const d of e.details) c.add(d.field, d.issue); else throw e;
      }
    }
    c.throwIfAny();

    for (const u of uploaded) {
      try { stored.push({ kind: u.kind, file: acceptPdf(u.file) }); } catch (e) {
        if (e instanceof AppError) throw new AppError(e.http, e.code, e.messageAr, e.messageEn, [{ field: fieldForDocKind(u.kind), issue: 'invalid file' }]);
        throw e;
      }
    }
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

    const regNumber = String(data.company?.industrialRegistryNumber ?? '');
    // F2 / D3: a number another application holds (or one on hold) no longer refuses the sign-up. The account and a draft held
    // on that number are created, the conflict is recorded for IMC and PMU, and the factory is offered the objection right away;
    // the draft cannot be submitted until PMU decides (performAction refuses DUPLICATE_REGISTRY / REGISTRY_BLOCKED).
    const access = await registryAccess(regNumber, '');
    const holder = await findOpenSubmittedByRegistry(regNumber, '');
    const registryHeld = !access.allowed || Boolean(holder);
    let check: Awaited<ReturnType<ReturnType<typeof getRegistryClient>['verify']>>;
    try { check = await getRegistryClient().verify(regNumber); } catch { check = { result: 'unavailable', errorCode: 'CLIENT_ERROR' }; }
    if (check.result === 'invalid') {
      throw new AppError(422, 'REGISTRY_INVALID', 'رقم السجل الصناعي غير صحيح أو غير مسجل — صحّحه ثم أعد المحاولة.', 'The industrial registry number is invalid or not registered.', [{ field: 'industrialRegistryNumber', issue: 'invalid' }]);
    }
    if (check.result === 'unavailable') {
      throw new AppError(503, 'REGISTRY_UNAVAILABLE', 'تعذر التحقق من السجل الصناعي حاليًا. بياناتك محفوظة في هذه الصفحة — أعد المحاولة بعد قليل.', 'The industrial registry is unavailable right now. Your data is kept on this page — try again shortly.');
    }

    const done = () => okMessage(res, 201, 'تم استلام التسجيل — راجع بريدك الإلكتروني لإكمال الخطوة التالية.', { email: email!.toLowerCase(), emailVerified: false, ...(registryHeld ? { registryHeld: true } : {}) });
    const existing = await getCoreUserByEmail(email!);
    if (existing) {
      // Same answer and about the same cost: registration never reveals that an e-mail exists. The owner is told to sign in
      // with the existing platform account and apply from the initiative page (only the missing data will be asked).
      dropAll();
      await hashPasswordAsync(b.password as string);
      await notifyExistingAccountOnRegister(existing, { id: MODULE_ID, titleAr: 'شمس الصناعة' }, clientIp(req));
      return done();
    }
    const passwordHash = await hashPasswordAsync(b.password as string);
    const created: { user?: NonNullable<Awaited<ReturnType<typeof getUserById>>>; app?: Awaited<ReturnType<typeof createRegistrationDraft>> } = {};
    await tx(async () => {
      const account = await createAccount({ email: email!, nameAr: contactName!, phone: mobile!, passwordHash, ip: clientIp(req), source: MODULE_ID });
      await savePersonProfile(account.id, { 'person.fullNameAr': contactName!, 'person.phone': mobile! });
      const profile = await createFactoryProfile(account.id, factoryProfileFromSections(data as Record<string, Record<string, unknown> | undefined>));
      for (const s of stored) {
        if (!PROFILE_DOC_KINDS.includes(s.kind)) continue;
        const copy = copyStoredFile(MODULE_ID, s.file.storedName, namespaceDir('core', 'documents'));
        await addProfileDocument({ ownerType: 'factory', ownerId: profile.id, kind: s.kind, originalName: s.file.originalName, ...copy, uploadedBy: account.id });
      }
      const org = await createOrganization({ type: 'factory', nameAr: companyName!, nameEn: companyName!, contactEmail: email! });
      const factory = await createFactory(org.id, companyName!, null, 'pending');
      await setFactoryProfile(factory.id, profile.id);
      await createMembership({ userId: account.id, initiativeId: MODULE_ID, role: 'factory_owner', organizationId: org.id });
      const u = (await getUserById(account.id))!;
      await sendVerification(account);
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
      created.user = u; created.app = app;
    });
    if (holder && created.user && created.app) await recordRegistryConflict(created.user, created.app, holder, regNumber, clientIp(req), companyName!);
    kickNotificationWorker();
    return done();
  } catch (e) {
    dropAll();
    // The same registration committed first (double submit): the same answer as for an existing account.
    if (isAccountExistsRace(e)) return okMessage(res, 201, 'تم استلام التسجيل — راجع بريدك الإلكتروني لإكمال الخطوة التالية.', { email: String((req.body as Record<string, unknown>)?.email ?? '').trim().toLowerCase(), emailVerified: false });
    throw e;
  }
}));

/** Cancel an account-recovery request by its owner (one-time link/code sent to their e-mail and phone). Generic answer. */
publicAuthRouter.post('/recovery/cancel', emailFlowLimiter, ah(async (req, res) => {
  const b = onlyKeys(req.body, ['token']);
  const ok = await cancelRecoveryByOwner(b.token, clientIp(req));
  if (!ok) return apiError(res, 400, 'TOKEN_INVALID', 'رابط الإلغاء غير صالح أو مستخدم أو أن الطلب مغلق.', 'The cancel link is invalid, used, or the request is closed.');
  return okMessage(res, 200, 'أُلغي طلب نقل الحساب — لن يتغير بريدك.');
}));

/** The Shams view of the signed-in person (role, organization, factory account status). */
meRouter.get('/auth/me', ah((req, res) => okMessage(res, 200, 'ok', { user: toPublicUser(currentUser(req)) })));
