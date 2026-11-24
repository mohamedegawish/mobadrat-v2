/**
 * مصنع لم يُقبل حسابه بعد (factories.accountStatus ≠ approved): القيد على السيرفر نفسه لا في الواجهة فقط.
 * D3 (QA 2026-11-23): قبل قبول IMC يرى المصنع طلبه المرسل للقراءة فقط، وينسحب بسبب أثناء مراجعة IMC وأثناء استيفاء البيانات،
 * ويقدم اعتراضًا على رقم السجل. كل ما عدا ذلك مقفل:
 * - pending / correction: ما سبق + تعديل البنود المسموحة (يحصرها editableKeys/uploadableKinds) والإرسال.
 * - under_review: القراءة + الانسحاب + الاعتراض فقط (لا تعديل ولا إرسال).
 * - rejected: لا شيء (حالة نهائية).
 * الطلب نفسه مقيّد بطلبات المصنع (canSeeApplication)، والإجراء بجدول الانتقالات (الانسحاب وحده متاح له في هذه الحالات).
 * مسارات /auth (me، logout، change-password) خارج هذا الـ middleware.
 */
import type { NextFunction, Request, Response } from 'express';
import { apiError } from '../http/errors.js';
import type { AuthedRequest } from './auth.js';
import { accountLoginBlock, isRestrictedFactory } from '../services/factoryAccount.js';

type Route = [string, RegExp];

/** D3: القراءة — طلبه ومستنداته واعتراضاته (الرابط من بطاقة المبادرة في المنصة). */
const READ: Route[] = [
  ['GET', /^\/applications\/[^/]+$/],
  ['GET', /^\/applications\/[^/]+\/documents\/[^/]+\/download$/],
  ['GET', /^\/registry-objections$/],
  ['GET', /^\/registry-objections\/[^/]+\/document$/],
];
/** D3: الانسحاب بسبب، والاعتراض على رقم السجل. */
const D3_ACTIONS: Route[] = [
  ['POST', /^\/applications\/[^/]+\/actions\/withdraw$/],
  ['POST', /^\/registry-objections$/],
];
/** طلب التسجيل قبل إرساله أو أثناء الاستيفاء: ملف المصنع (طلبه المفتوح)، تعديل البنود المطلوبة وإرساله. */
const EDIT: Route[] = [
  ['GET', /^\/factory\/profile$/],
  ['PUT', /^\/applications\/[^/]+\/data\/[^/]+$/],
  ['POST', /^\/applications\/[^/]+\/documents$/],
  ['DELETE', /^\/applications\/[^/]+\/documents\/[^/]+$/],
  ['POST', /^\/applications\/[^/]+\/actions\/(submit|resubmit)$/],
];

const matches = (routes: Route[], req: Request) => routes.some(([m, re]) => m === req.method && re.test(req.path));

export function restrictUnapprovedFactory(req: Request, res: Response, next: NextFunction) {
  const u = (req as AuthedRequest).user;
  if (!u || !isRestrictedFactory(u)) return next();
  const status = u.factoryAccountStatus;
  const block = accountLoginBlock(status);
  if (status === 'rejected') return apiError(res, 403, block!.code, block!.ar, block!.en);
  if (matches(READ, req) || matches(D3_ACTIONS, req)) return next();
  if (status === 'under_review') return apiError(res, 403, block!.code, block!.ar, block!.en);
  if (matches(EDIT, req)) return next();
  return apiError(res, 403, 'ACCOUNT_RESTRICTED', 'حسابكم لم يُقبل بعد — المتاح الآن تعديل بيانات طلب التسجيل المطلوبة وإعادة إرساله، أو الانسحاب، أو الاعتراض على رقم السجل.',
    'Your account is not approved yet — you can edit and resubmit the requested registration data, withdraw, or object to a registry number decision.');
}
