/**
 * F7 (QA 2026-11-23, BUG-11): the Arabic names of the fields Shams El Senaa's forms and actions send, so a refusal names the
 * field in Arabic instead of its code (the shared mechanism is core/http/validationText.ts). The form's fields and documents
 * take their names from the form definition; the rest are the actions', the account's and the staff screens' fields.
 */
import { registerFieldLabels, type FieldLabel } from '../../../core/http/validationText.js';
import { DOCUMENT_LABELS, FORM_FIELDS } from '../workflow/applicationForm.js';
import { MODULE_ID } from '../config.js';

const L = (ar: string, en: string): FieldLabel => ({ ar, en });

const OTHER: Record<string, FieldLabel> = {
  // Decisions and the factory's own actions (reason, data completion, provider, offer, electricity, contract).
  reason: L('السبب', 'Reason'),
  reasonCode: L('سبب الرفض', 'Rejection reason'),
  note: L('الملاحظة', 'Note'),
  deficiencies: L('البنود المطلوب استيفاؤها', 'Items to complete'),
  providersLink: L('لينك مقدمي الخدمة', 'Providers link'),
  providerName: L('اسم مقدم الخدمة', 'Service provider name'),
  providerEmail: L('بريد مقدم الخدمة', 'Service provider e-mail'),
  providerPhone: L('هاتف مقدم الخدمة', 'Service provider phone'),
  correctionProofFile: L('إثبات حل المشكلة', 'Proof that the issue is fixed'),
  bankOrgId: L('البنك', 'Bank'),
  distributionCompany: L('شركة توزيع الكهرباء', 'Electricity distribution company'),
  contractDate: L('تاريخ التعاقد', 'Contract date'),
  contractAmount: L('قيمة التعاقد', 'Contract amount'),
  contractNotes: L('تفاصيل التعاقد', 'Contract details'),
  expectedVersion: L('نسخة الطلب', 'Application version'),
  // The account and the registration request.
  application: L('بيانات الطلب', 'Application data'),
  email: L('البريد الإلكتروني', 'Email'),
  mobile: L('رقم الموبايل', 'Mobile number'),
  phone: L('رقم التليفون', 'Phone number'),
  password: L('كلمة المرور', 'Password'),
  newEmail: L('البريد الإلكتروني الجديد', 'New email'),
  token: L('رابط التفعيل', 'Activation link'),
  // Documents and uploads.
  file: L('الملف', 'File'),
  kind: L('نوع المستند', 'Document type'),
  // Registry disputes and account recovery.
  registryNumber: L('رقم السجل الصناعي', 'Industrial registry number'),
  reference: L('المرجع', 'Reference'),
  requestReference: L('مرجع الطلب', 'Request reference'),
  allowedFactoryId: L('المنشأة المخوّلة بالرقم', 'Factory authorised to use the number'),
  // Staff and administration screens.
  name: L('الاسم', 'Name'),
  nameAr: L('الاسم بالعربية', 'Arabic name'),
  nameEn: L('الاسم بالإنجليزية', 'English name'),
  organizationId: L('الجهة', 'Organization'),
  role: L('الدور', 'Role'),
  userId: L('المستخدم', 'User'),
  isActive: L('الحالة', 'Status'),
  status: L('الحالة', 'Status'),
  confirmOpenReferrals: L('تأكيد الطلبات المفتوحة المرتبطة', 'Confirmation of the bound open applications'),
  rows: L('الصفوف', 'Rows'),
  scopes: L('الصلاحيات', 'Scopes'),
  type: L('النوع', 'Type'),
  format: L('الصيغة', 'Format'),
  rateLimitPerMinute: L('حد الطلبات في الدقيقة', 'Requests per minute'),
};

export function registerShamsFieldLabels(): void {
  const labels: Record<string, FieldLabel> = {};
  for (const [kind, l] of Object.entries(DOCUMENT_LABELS)) labels[kind] = l;
  for (const f of FORM_FIELDS) labels[f.key] = L(f.labelAr, f.labelEn);
  registerFieldLabels(MODULE_ID, { ...labels, ...OTHER });
}
