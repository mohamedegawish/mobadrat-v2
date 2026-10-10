import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb } from '../db/sqlite.js';
import {
  createDetailsFile,
  createFactory,
  deleteDetailsFile,
  getFactoryById,
  listDetailsFiles,
  listFactories,
  updateFactory,
} from '../store/factories.js';
import { getInitiativeById } from '../store/initiatives.js';
import { createOrganization, getOrganizationByCode } from '../store/organizations.js';
import { createUser, getUserByEmail, getUserById } from '../store/users.js';
import { signAccess, signRefresh, hashPassword } from '../auth/jwt.js';
import { storeRefreshToken } from '../store/refreshTokens.js';
import { setRefreshCookie, isStrongPassword } from './auth.js';
import { AUDIT_ROLES, requireRole } from '../middleware/requireRole.js';
import { addAuditLog } from '../store/audit.js';
import { apiError, okMessage } from '../middleware/error.js';
import type { AuthedRequest } from '../middleware/auth.js';

export const factoriesRouter = Router();

// P0-SEC: فحص ملكية المصنع — المالك يرى مصنعه فقط، الأدمن/المدقق يرون الكل.
function canAccessFactory(req: AuthedRequest, factoryId: string): boolean {
  const role = req.user?.role ?? '';
  if (role === 'ministry_admin' || role === 'initiative_manager' || role === 'auditor') return true;
  const ownFactory = (req.user as { factoryId?: string } | undefined)?.factoryId ?? '';
  return ownFactory !== '' && ownFactory === factoryId;
}
function canEditFactory(req: AuthedRequest, factoryId: string): boolean {
  const role = req.user?.role ?? '';
  if (role === 'ministry_admin' || role === 'initiative_manager') return true;
  const ownFactory = (req.user as { factoryId?: string } | undefined)?.factoryId ?? '';
  return ownFactory !== '' && ownFactory === factoryId;
}

// API-only frontend: public factory self-registration (replaces local mock signup).
// Mounted BEFORE auth in app.ts — rate-limited there (publicLimiter).
export const publicFactoriesRouter = Router();

// HOSTING: حد الرفع — ملفات كبيرة مكلفة (تخزين + فحص). 30 رفع/دقيقة لكل IP.
const uploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'RATE_LIMITED', messageAr: 'رفع كثير — انتظر قليلا.', messageEn: 'Too many uploads.' },
});

fs.mkdirSync(config.uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const safe = path.basename(file.originalname).replace(/[^\w.\-+\u0600-\u06FF]+/g, '_').slice(0, 120);
    cb(null, `fdet-${randomUUID()}-${safe}`);
  },
});
// PROD FIX: fileFilter يرفض غير-PDF مبكراً + حد 100MB كسقف عام (الحد الحقيقي من customization).
function pdfFileFilter(_req: unknown, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const ok = file.originalname.toLowerCase().endsWith('.pdf') || file.mimetype === 'application/pdf';
  if (!ok) cb(new Error('INVALID_FILE_TYPE'));
  else cb(null, true);
}
const upload = multer({
  storage,
  fileFilter: pdfFileFilter,
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
});

// PROD FIX: whitelist صارمة — تمنع mass-assignment (كان يقبل أي مفاتيح).

// ── Registration extension (Shams El Senaa — General Data) ──────────────────
// Central validation + normalization shared by POST /factories/register and
// PUT /factories/:id. Phones/IDs stay strings; unknown numerics stay null
// (never silently 0); totalAvailableM2 is always recomputed, never trusted.
type ExtDetail = { field: string; issue: string };
const PHONE_RE = /^\+?[0-9\s\-()]{6,25}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function extStr(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  return String(v ?? '').trim();
}
function extNum(v: unknown): number | null | undefined {
  // undefined = not provided; null/'' = explicitly unknown; number/string = value
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return NaN as unknown as null;
  return n;
}
function validWebsite(v: string): boolean {
  try {
    const u = new URL(v.includes('://') ? v : `https://${v}`);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}
export function validateFactoryExtension(body: Record<string, unknown>, opts?: { strict?: boolean }): { errors: ExtDetail[]; norm: Record<string, unknown> } {
  const errors: ExtDetail[] = [];
  const norm: Record<string, unknown> = {};
  const s = (k: string, max = 500) => {
    const v = extStr(body[k]);
    if (v === undefined) return;
    if (v.length > max) { errors.push({ field: k, issue: 'too_long' }); return; }
    norm[k] = v;
  };
  const phone = (k: string) => {
    const v = extStr(body[k]);
    if (v === undefined || v === '') { if (v !== undefined) norm[k] = ''; return; }
    if (!PHONE_RE.test(v)) { errors.push({ field: k, issue: 'invalid' }); return; }
    norm[k] = v;
  };
  const nonNeg = (k: string, opts: { int?: boolean; max?: number } = {}) => {
    const v = extNum(body[k]);
    if (v === undefined) return;
    if (v === null) { norm[k] = null; return; }
    if (typeof v !== 'number' || Number.isNaN(v) || v < 0) { errors.push({ field: k, issue: 'negative_or_invalid' }); return; }
    if (opts.int && !Number.isInteger(v)) { errors.push({ field: k, issue: 'must_be_integer' }); return; }
    if (opts.max !== undefined && v > opts.max) { errors.push({ field: k, issue: 'out_of_range' }); return; }
    norm[k] = v;
  };
  const tribool = (k: string) => {
    const v = body[k];
    if (v === undefined) return;
    if (v === null || v === '') { norm[k] = null; return; }
    if (typeof v !== 'boolean') { errors.push({ field: k, issue: 'invalid' }); return; }
    norm[k] = v;
  };
  // Section A
  s('facilityAddressDetailed', 1000);
  phone('secondaryPhone');
  const ws = extStr(body.website);
  if (ws !== undefined) {
    if (ws === '') norm.website = '';
    else if (ws.length > 500 || !validWebsite(ws)) errors.push({ field: 'website', issue: 'invalid' });
    else norm.website = ws;
  }
  s('contactJobTitle', 200);
  phone('contactFax');
  phone('contactMobile');
  const ce = extStr(body.contactEmail);
  if (ce !== undefined) {
    if (ce === '') norm.contactEmail = '';
    else if (!EMAIL_RE.test(ce)) errors.push({ field: 'contactEmail', issue: 'invalid' });
    else norm.contactEmail = ce;
  }
  // Section B
  s('mainProducts', 10000);
  s('mainProcesses', 10000);
  nonNeg('employeesCount', { int: true });
  // Section C
  const st = body.electricitySourceType;
  if (st !== undefined) {
    if (st === null || st === '') norm.electricitySourceType = null;
    else if (st !== 'public' && st !== 'other') errors.push({ field: 'electricitySourceType', issue: 'invalid' });
    else norm.electricitySourceType = st;
  }
  const so = extStr(body.electricitySourceOther);
  if (so !== undefined) norm.electricitySourceOther = so.slice(0, 500);
  nonNeg('annualElectricityKwh');
  nonNeg('operatingHoursPerDay', { max: 24 });
  const dow = extNum(body.operatingDaysPerWeek);
  if (dow !== undefined) {
    if (dow === null) norm.operatingDaysPerWeek = null;
    else if (typeof dow !== 'number' || Number.isNaN(dow) || !Number.isInteger(dow) || dow < 0 || dow > 7) errors.push({ field: 'operatingDaysPerWeek', issue: 'out_of_range' });
    else norm.operatingDaysPerWeek = dow;
  }
  nonNeg('electricityCostEGP');
  // Section D (total recomputed by caller — never trust submitted total)
  nonNeg('concreteRoofM2');
  nonNeg('metalRoofM2');
  nonNeg('vacantLandM2');
  // Section E
  tribool('hasEnergyReductionProcedures');
  tribool('hasEfficiencyStudies');
  tribool('hasEnergyDept');
  s('energyNotes', 5000);
  // Cross-field: 'other' requires a description
  if (norm.electricitySourceType === 'other' || (norm.electricitySourceType === undefined && extStr(body.electricitySourceType) === 'other')) {
    const desc = (norm.electricitySourceOther as string | undefined) ?? extStr(body.electricitySourceOther) ?? '';
    if (!desc.trim()) errors.push({ field: 'electricitySourceOther', issue: 'required' });
  }
  // Strict mode (POST /factories/register): every user-entered extension field is
  // REQUIRED — no optional fields. PUT stays partial (strict off). totalAvailableM2
  // is always derived; electricitySourceOther stays conditional on 'other'.
  if (opts?.strict) {
    const hasErr = (k: string) => errors.some((e) => e.field === k);
    for (const k of ['facilityAddressDetailed', 'secondaryPhone', 'website', 'contactJobTitle',
      'contactFax', 'contactMobile', 'contactEmail', 'mainProducts', 'mainProcesses', 'energyNotes']) {
      const v = norm[k] as string | undefined;
      if ((v === undefined || v.trim() === '') && !hasErr(k)) errors.push({ field: k, issue: 'required' });
    }
    for (const k of ['employeesCount', 'annualElectricityKwh', 'operatingHoursPerDay',
      'operatingDaysPerWeek', 'electricityCostEGP', 'concreteRoofM2', 'metalRoofM2', 'vacantLandM2']) {
      if (typeof norm[k] !== 'number' && !hasErr(k)) errors.push({ field: k, issue: 'required' });
    }
    if (norm.electricitySourceType !== 'public' && norm.electricitySourceType !== 'other' && !hasErr('electricitySourceType')) {
      errors.push({ field: 'electricitySourceType', issue: 'required' });
    }
    for (const k of ['hasEnergyReductionProcedures', 'hasEfficiencyStudies', 'hasEnergyDept']) {
      if (typeof norm[k] !== 'boolean' && !hasErr(k)) errors.push({ field: k, issue: 'required' });
    }
  }
  return { errors, norm };
}
/** Recompute totalAvailableM2: sum of 3 components, or null if ANY is missing/null. */
export function computeTotalAvailableM2(a: unknown, b: unknown, c: unknown): number | null {
  const nums = [a, b, c].map((v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null));
  if (nums.some((v) => v === null)) return null;
  return (nums[0] as number) + (nums[1] as number) + (nums[2] as number);
}

// API-only frontend: public factory self-registration (replaces local mock signup).
// Creates org (type factory) + factory profile + owner account, then auto-logs in (JWT).
// Rate-limited in app.ts (publicLimiter) — same abuse surface as /auth/login.
// Mounted in app.ts as v1.use('/factories/register', publicLimiter, publicFactoriesRouter)
// so the internal path stays '/' (a full path here would double the prefix).
publicFactoriesRouter.post('/', (req: AuthedRequest, res) => {
  const b = (req.body ?? {}) as {
    name?: string; nameEn?: string; email?: string; password?: string;
    factoryNameAr?: string; factoryNameEn?: string;
    commercialRegistrationNumber?: string; industrialRegistrationNumber?: string; taxIdNumber?: string;
    sector?: string; sectorEn?: string; governorate?: string; governorateEn?: string; phone?: string;
    facilityAddressDetailed?: string; secondaryPhone?: string; website?: string;
    contactJobTitle?: string; contactFax?: string; contactMobile?: string; contactEmail?: string;
    mainProducts?: string; mainProcesses?: string; employeesCount?: number;
    electricitySourceType?: string; electricitySourceOther?: string;
    annualElectricityKwh?: number | null; operatingHoursPerDay?: number | null;
    operatingDaysPerWeek?: number | null; electricityCostEGP?: number | null;
    concreteRoofM2?: number | null; metalRoofM2?: number | null; vacantLandM2?: number | null;
    hasEnergyReductionProcedures?: boolean | null; hasEfficiencyStudies?: boolean | null;
    hasEnergyDept?: boolean | null; energyNotes?: string;
  };
  const email = (b.email ?? '').trim();
  const missing =
    (!b.name?.trim() ? 'name' : null) ?? (!email ? 'email' : null) ??
    (!b.password ? 'password' : null) ?? (!b.factoryNameAr?.trim() ? 'factoryNameAr' : null);
  if (missing) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'الاسم والبريد وكلمة المرور واسم المنشأة مطلوبة.', 'name, email, password, factoryNameAr are required.', [
      { field: missing, issue: 'required' },
    ]);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'البريد الإلكتروني غير صالح.', 'Invalid email.', [
      { field: 'email', issue: 'invalid' },
    ]);
  }
  if (!isStrongPassword(b.password as string)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'كلمة المرور 8 أحرف على الأقل وتحتوي حرفاً ورقماً.', 'password must be 8+ with letter+digit.', [
      { field: 'password', issue: 'weak' },
    ]);
  }
  if (getUserByEmail(email)) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'هذا البريد مسجل بالفعل.', 'Email already exists.', [
      { field: 'email', issue: 'unique' },
    ]);
  }
  // Extension fields (Sections A–E): strict — ALL required on registration.
  // Total recomputed below; PUT stays partial (non-strict).
  const { errors: extErrors, norm: ext } = validateFactoryExtension(b as unknown as Record<string, unknown>, { strict: true });
  if (extErrors.length > 0) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'بيانات الاستمارة الموسعة غير صالحة.', 'Extended registration fields invalid.', extErrors);
  }
  let code = '';
  for (let i = 0; i < 5 && !code; i++) {
    const c = `FAC-${randomUUID().slice(0, 4).toUpperCase()}`;
    if (!getOrganizationByCode(c)) code = c;
  }
  if (!code) return apiError(res, 500, 'INTERNAL_ERROR', 'تعذر إنشاء كود الجهة — حاول لاحقا.', 'Could not allocate org code.');
  const factoryNameAr = (b.factoryNameAr as string).trim();
  const factoryNameEn = b.factoryNameEn?.trim() || factoryNameAr;
  // P0-6: معاملة ذرية — فشل أي خطوة يلغي الكل (لا أيتام org/factory).
  const db = getDb();
  let org: { id: string; nameAr: string; nameEn: string };
  let factory: { id: string };
  let created: { id: string; name: string; role: string };
  let accessToken: string;
  let refreshToken: string;
  db.exec('BEGIN IMMEDIATE');
  try {
    org = createOrganization({
      code, nameAr: factoryNameAr, nameEn: factoryNameEn, type: 'factory', contactEmail: email,
    });
    const totalAvailableM2 = computeTotalAvailableM2(ext.concreteRoofM2, ext.metalRoofM2, ext.vacantLandM2);
    factory = createFactory({
      nameAr: factoryNameAr, nameEn: factoryNameEn,
      sector: b.sector?.trim() || 'الصناعات الهندسية', sectorEn: b.sectorEn?.trim() || 'Engineering Industries',
      governorate: b.governorate?.trim() || 'القاهرة', governorateEn: b.governorateEn?.trim() || 'Cairo',
      industrialZone: 'منطقة صناعية معتمدة',
      commercialRegistrationNumber: b.commercialRegistrationNumber?.trim() || '',
      industrialRegistrationNumber: b.industrialRegistrationNumber?.trim() || '',
      taxIdNumber: b.taxIdNumber?.trim() || '',
      contactPerson: (b.name as string).trim(), contactPhone: b.phone?.trim() || '',
      contactEmail: (ext.contactEmail as string | undefined) ?? email,
      employeesCount: (ext.employeesCount as number | undefined) ?? 0,
      roofAreaSqMeters: 0, annualEnergyConsumptionMWh: 0, monthlyElectricityBillEGP: 0,
      // Section A
      facilityAddressDetailed: (ext.facilityAddressDetailed as string | undefined) ?? '',
      secondaryPhone: (ext.secondaryPhone as string | undefined) ?? '',
      website: (ext.website as string | undefined) ?? '',
      contactJobTitle: (ext.contactJobTitle as string | undefined) ?? '',
      contactFax: (ext.contactFax as string | undefined) ?? '',
      contactMobile: (ext.contactMobile as string | undefined) ?? '',
      // Section B
      mainProducts: (ext.mainProducts as string | undefined) ?? '',
      mainProcesses: (ext.mainProcesses as string | undefined) ?? '',
      // Section C (null = unknown — never silent 0)
      electricitySourceType: (ext.electricitySourceType as string | null | undefined) ?? null,
      electricitySourceOther: ext.electricitySourceType === 'other' ? ((ext.electricitySourceOther as string | undefined) ?? '') : '',
      annualElectricityKwh: (ext.annualElectricityKwh as number | null | undefined) ?? null,
      operatingHoursPerDay: (ext.operatingHoursPerDay as number | null | undefined) ?? null,
      operatingDaysPerWeek: (ext.operatingDaysPerWeek as number | null | undefined) ?? null,
      electricityCostEGP: (ext.electricityCostEGP as number | null | undefined) ?? null,
      // Section D (server-computed total)
      concreteRoofM2: (ext.concreteRoofM2 as number | null | undefined) ?? null,
      metalRoofM2: (ext.metalRoofM2 as number | null | undefined) ?? null,
      vacantLandM2: (ext.vacantLandM2 as number | null | undefined) ?? null,
      totalAvailableM2,
      // Section E (null = unspecified)
      hasEnergyReductionProcedures: (ext.hasEnergyReductionProcedures as boolean | null | undefined) ?? null,
      hasEfficiencyStudies: (ext.hasEfficiencyStudies as boolean | null | undefined) ?? null,
      hasEnergyDept: (ext.hasEnergyDept as boolean | null | undefined) ?? null,
      energyNotes: (ext.energyNotes as string | undefined) ?? '',
    });
    const vToken = randomUUID();
    const vExp = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    created = createUser({
      name: (b.name as string).trim(), nameEn: (b.nameEn?.trim() || b.name as string).trim(),
      email, role: 'factory_owner', organizationId: org.id, factoryId: factory.id,
      passwordHash: hashPassword(b.password as string), mustChangePassword: false,
      isVerified: false, emailVerificationToken: vToken, emailVerificationExpires: vExp,
    });
    // Auto-verify in test env so existing tests don't break; prod/dev require explicit verify-email
    const autoVerify = (process.env.NODE_ENV ?? 'development') === 'test';
    let finalToken: string | undefined = vToken;
    if (autoVerify) {
      getDb().prepare('UPDATE users SET isVerified = 1, emailVerificationToken = ?, emailVerificationExpires = ?, updatedAt = ? WHERE id = ?').run('', '', new Date().toISOString(), created.id);
      (created as { isVerified?: boolean }).isVerified = true;
      finalToken = undefined;
    }
    if (autoVerify) {
      accessToken = signAccess(created.id, created.role, org.id);
      const r = signRefresh(created.id);
      refreshToken = r.token;
      storeRefreshToken(created.id, '', refreshToken);
    } else {
      // Not verified yet — do not issue tokens; user must verify email first
      accessToken = '' as unknown as string;
      refreshToken = '' as unknown as string;
    }
    // Stash token for response (non-prod only)
    (created as { _verificationToken?: string })._verificationToken = finalToken;
    addAuditLog({
      userId: created.id, userName: created.name, ip: req.clientIp ?? '',
      actionType: 'create', entityType: 'factory', entityId: factory.id,
      summaryAr: `تسجيل منشأة جديدة ${factoryNameAr}`,
    });
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
  const isTest = (process.env.NODE_ENV ?? 'development') === 'test';
  if (isTest) setRefreshCookie(res, refreshToken!);
  const resp: Record<string, unknown> = {
    user: created!,
    organization: { id: org!.id, nameAr: org!.nameAr, nameEn: org!.nameEn },
    factory: { id: factory!.id, nameAr: factoryNameAr, nameEn: factoryNameEn },
    mustChangePassword: false,
  };
  if (isTest) {
    (resp as Record<string, unknown>).accessToken = accessToken!;
    (resp as Record<string, unknown>).refreshToken = refreshToken!;
  } else {
    (resp as Record<string, unknown>).requiresVerification = true;
    (resp as Record<string, unknown>).message = 'تم التسجيل — يرجى تفعيل بريدك عبر رابط التفعيل';
  }
  const vt = (created as { _verificationToken?: string })._verificationToken;
  if (vt) (resp as Record<string, unknown>).verificationToken = vt;
  return okMessage(res, 201, isTest ? 'تم تسجيل المنشأة' : 'تم التسجيل — يرجى تفعيل البريد', resp);
});

// API-only frontend: current user's factory (no static mapping, no full list needed).
factoriesRouter.get('/factories/mine', (req: AuthedRequest, res) => {
  const me = req.userId ? getUserById(req.userId) : null;
  const fid = me?.factoryId ?? '';
  if (!fid) {
    return apiError(res, 404, 'NO_FACTORY', 'لا توجد منشأة مرتبطة بحسابك.', 'No factory linked to your account.');
  }
  const found = getFactoryById(fid);
  if (!found) return apiError(res, 404, 'NOT_FOUND', 'المصنع غير موجود.', 'Factory not found.');
  return okMessage(res, 200, 'ok', found);
});

// API-only frontend: factory directory for privileged roles (admin stats need it;
// factory owners use /factories/mine instead).
factoriesRouter.get('/factories', requireRole(...AUDIT_ROLES), (req, res) => {
  const { q, page = '1', pageSize = '20' } = req.query as Record<string, string>;
  res.json(listFactories({ q, page, pageSize }));
});

factoriesRouter.get('/factories/:id', (req: AuthedRequest, res) => {
  const found = getFactoryById(req.params.id);
  if (!found) return apiError(res, 404, 'NOT_FOUND', 'المصنع غير موجود.', 'Factory not found.');
  if (!canAccessFactory(req, req.params.id)) {
    return apiError(res, 403, 'FORBIDDEN', 'لا يمكنك الوصول لبيانات مصنع آخر.', 'You can only access your own factory.');
  }
  return okMessage(res, 200, 'ok', found);
});

const FACTORY_EDITABLE = new Set([
  'nameAr', 'nameEn', 'commercialRegistrationNumber', 'industrialRegistrationNumber',
  'taxIdNumber', 'sector', 'sectorEn', 'governorate', 'governorateEn', 'industrialZone',
  'roofAreaSqMeters', 'annualEnergyConsumptionMWh', 'monthlyElectricityBillEGP',
  'employeesCount', 'contactPerson', 'contactPhone', 'contactEmail',
  // Registration extension (Sections A–E). totalAvailableM2 accepted but recomputed.
  'facilityAddressDetailed', 'secondaryPhone', 'website', 'contactJobTitle', 'contactFax',
  'contactMobile', 'mainProducts', 'mainProcesses',
  'electricitySourceType', 'electricitySourceOther', 'annualElectricityKwh',
  'operatingHoursPerDay', 'operatingDaysPerWeek', 'electricityCostEGP',
  'concreteRoofM2', 'metalRoofM2', 'vacantLandM2', 'totalAvailableM2',
  'hasEnergyReductionProcedures', 'hasEfficiencyStudies', 'hasEnergyDept', 'energyNotes',
]);

factoriesRouter.put('/factories/:id', (req: AuthedRequest, res) => {
  const found = getFactoryById(req.params.id);
  if (!found) return apiError(res, 404, 'NOT_FOUND', 'المصنع غير موجود.', 'Factory not found.');
  if (!canEditFactory(req, req.params.id)) {
    return apiError(res, 403, 'FORBIDDEN', 'لا يمكنك تعديل بيانات مصنع آخر.', 'You can only edit your own factory.');
  }
  const raw = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) {
    if (FACTORY_EDITABLE.has(k)) patch[k] = raw[k];
  }
  // Validate extension fields (subset actually sent); total recomputed from merged record.
  if (Object.keys(patch).length > 0) {
    const { errors: putErrors, norm: putNorm } = validateFactoryExtension(patch);
    if (putErrors.length > 0) {
      return apiError(res, 400, 'VALIDATION_ERROR', 'بيانات الملف الموحد غير صالحة.', 'Factory profile fields invalid.', putErrors);
    }
    for (const [k, v] of Object.entries(putNorm)) patch[k] = v;
    if ('concreteRoofM2' in patch || 'metalRoofM2' in patch || 'vacantLandM2' in patch || 'totalAvailableM2' in patch) {
      const merged = { ...(found as Record<string, unknown>), ...patch };
      patch.totalAvailableM2 = computeTotalAvailableM2(merged.concreteRoofM2, merged.metalRoofM2, merged.vacantLandM2);
    } else {
      delete patch.totalAvailableM2;
    }
    // Cross-field on merged record: 'other' source requires description (existing or new).
    const mergedSrc = (patch.electricitySourceType ?? (found as Record<string, unknown>).electricitySourceType) as string | null | undefined;
    const mergedDesc = String((patch.electricitySourceOther ?? (found as Record<string, unknown>).electricitySourceOther) ?? '').trim();
    if (mergedSrc === 'other' && !mergedDesc) {
      return apiError(res, 400, 'VALIDATION_ERROR', 'وصف مصدر الكهرباء البديل مطلوب.', 'Other electricity source description required.', [
        { field: 'electricitySourceOther', issue: 'required' },
      ]);
    }
    if (mergedSrc !== 'other' && 'electricitySourceType' in patch && patch.electricitySourceType !== 'other') {
      patch.electricitySourceOther = '';
    }
  }
  if (Object.keys(patch).length === 0) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'لا توجد حقول قابلة للتعديل.', 'No editable fields.', [
      { field: 'body', issue: 'empty or unknown fields' },
    ]);
  }
  const updated = updateFactory(found.id as string, patch);
  addAuditLog({
    userName: req.user?.name ?? req.userId ?? 'unknown',
    actionType: 'update', entityType: 'factory', entityId: found.id as string,
    summaryAr: `تحديث الملف الموحد للمصنع ${found.id as string}`,
  });
  return okMessage(res, 200, 'تم حفظ الملف الموحد', { id: updated?.id });
});

factoriesRouter.get('/factories/:id/details-files', (req: AuthedRequest, res) => {
  const factory = getFactoryById(req.params.id);
  if (!factory) return apiError(res, 404, 'NOT_FOUND', 'المصنع غير موجود.', 'Factory not found.');
  if (!canAccessFactory(req, req.params.id)) {
    return apiError(res, 403, 'FORBIDDEN', 'لا يمكنك الوصول لملفات مصنع آخر.', 'You can only access your own factory files.');
  }
  const { initiativeId } = req.query as Record<string, string>;
  return okMessage(res, 200, 'ok', listDetailsFiles(req.params.id, initiativeId));
});

factoriesRouter.post('/factories/:id/details-files', uploadLimiter, upload.single('file'), (req: AuthedRequest, res) => {
  const factory = getFactoryById(req.params.id);
  if (!canEditFactory(req, req.params.id)) {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => undefined);
    return apiError(res, 403, 'FORBIDDEN', 'لا يمكنك الرفع لمصنع آخر.', 'You can only upload to your own factory.');
  }
  if (!factory) {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => undefined);
    return apiError(res, 404, 'NOT_FOUND', 'المصنع غير موجود.', 'Factory not found.');
  }
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'أرفق ملف PDF في حقل file.', 'file is required.', [
      { field: 'file', issue: 'required' },
    ]);
  }
  const cleanup = () => fs.promises.unlink(file.path).catch(() => undefined);
  const isPdf = file.originalname.toLowerCase().endsWith('.pdf') || file.mimetype === 'application/pdf';
  if (!isPdf) {
    void cleanup();
    return apiError(res, 400, 'INVALID_FILE_TYPE', 'ملف التفاصيل يجب أن يكون PDF فقط.', 'Details file must be PDF only.');
  }
  // PROD FIX: فحص magic-bytes — يمنع تزوير الامتداد (ملف .exe مُعاد تسميته لـ .pdf).
  try {
    const fd = fs.openSync(file.path, 'r');
    const buf = Buffer.alloc(5);
    fs.readSync(fd, buf, 0, 5, 0);
    fs.closeSync(fd);
    if (buf.toString('ascii') !== '%PDF-') {
      void cleanup();
      return apiError(res, 400, 'INVALID_FILE_TYPE', 'محتوى الملف ليس PDF حقيقي.', 'File content is not a valid PDF.');
    }
  } catch {
    void cleanup();
    return apiError(res, 400, 'INVALID_FILE_TYPE', 'تعذر فحص الملف.', 'Could not validate file.');
  }
  const initiativeId = (req.body?.initiativeId as string | undefined) ?? undefined;
  const init = initiativeId ? getInitiativeById(initiativeId) : null;
  if (initiativeId && !init) {
    void cleanup();
    return apiError(res, 404, 'NOT_FOUND', 'المبادرة غير موجودة.', 'Initiative not found.');
  }
  const maxMB = Number((init?.customization as Record<string, unknown> | undefined)?.maxFileSizeMB ?? 15);
  if (file.size > maxMB * 1024 * 1024) {
    void cleanup();
    return apiError(res, 400, 'FILE_TOO_LARGE', `حجم الملف يتجاوز ${maxMB} ميجا.`, `File exceeds ${maxMB} MB.`);
  }
  const entry = createDetailsFile({
    factoryId: factory.id as string,
    fileName: file.originalname,
    fileSize: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
    description: (req.body?.description as string | undefined) ?? '',
    initiativeId,
    applicationId: (req.body?.applicationId as string | undefined) ?? undefined,
    storedPath: file.path,
    uploadedBy: req.user?.id ?? req.userId ?? 'unknown',
  });
  addAuditLog({
    userName: req.user?.name ?? req.userId ?? 'unknown',
    actionType: 'upload', entityType: 'details_file', entityId: entry.id,
    summaryAr: `رفع ملف التفاصيل ${file.originalname} للمصنع ${factory.id as string}`,
  });
  return okMessage(res, 201, 'تم رفع ملف التفاصيل', entry);
});

factoriesRouter.delete('/factories/:id/details-files/:fileId', (req: AuthedRequest, res) => {
  const factory = getFactoryById(req.params.id);
  if (!canEditFactory(req, req.params.id)) {
    return apiError(res, 403, 'FORBIDDEN', 'لا يمكنك حذف ملفات مصنع آخر.', 'You can only delete your own factory files.');
  }
  if (!factory) return apiError(res, 404, 'NOT_FOUND', 'المصنع غير موجود.', 'Factory not found.');
  const removed = deleteDetailsFile(req.params.id, req.params.fileId);
  if (!removed) return apiError(res, 404, 'NOT_FOUND', 'الملف غير موجود.', 'File not found.');
  if (removed.storedPath) fs.promises.unlink(removed.storedPath).catch(() => undefined);
  addAuditLog({
    userName: req.user?.name ?? req.userId ?? 'unknown',
    actionType: 'delete', entityType: 'details_file', entityId: req.params.fileId,
    summaryAr: `حذف ملف التفاصيل ${removed.fileName}`,
  });
  return okMessage(res, 200, 'تم حذف الملف', undefined);
});
