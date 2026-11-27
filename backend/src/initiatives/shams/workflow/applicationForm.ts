/**
 * تعريف فورم التسجيل والتقديم (القسم 6) ومستندات المراحل. الإجبارية من shamsPolicy.requiredFields فقط.
 * يُعرض كما هو للواجهة عبر GET /meta حتى لا تتكرر القواعد.
 */
import { shamsPolicy, type FormFieldKey } from '../config/shamsPolicy.js';

export type FormSection = 'general' | 'contact' | 'company' | 'engineering';
export const FORM_SECTIONS: readonly FormSection[] = ['general', 'contact', 'company', 'engineering'];
export type DataSection = FormSection | 'provider' | 'offer' | 'electricity' | 'bank_result' | 'contract';

export type FieldType = 'text' | 'textarea' | 'select' | 'phone' | 'url' | 'email' | 'number' | 'date' | 'file' | 'files' | 'roofTable';

export const DOCUMENT_KINDS = [
  'commercialRegisterFile', 'industrialRegisterFile', 'taxCardFile', 'electricityBill', 'ownershipProofFile',
  'technicalOfferFile', 'electricityApprovalFile',
  // G-03: مستند إثبات التعاقد (عقد أو خطاب البنك) — يرفعه المصنع عند تسجيل «تم التعاقد».
  'contractFile',
  // مسار التعاقد عن طريق شركة توزيع الكهرباء: موافقتها على التعاقد — تراجعها PMU (قرار نهائي).
  'distributionApprovalFile',
  // D13 / D18: what the factory sends back after a technical or electricity rejection (several files).
  'correctionProofFile',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface FieldDef {
  key: FormFieldKey;
  section: FormSection;
  type: FieldType;
  labelAr: string;
  labelEn: string;
  maxLength?: number;
  /** للحقول من نوع ملف: نوع المستند المخزن. */
  docKind?: DocumentKind;
  options?: 'governorates' | 'zones' | 'capacityUnits' | 'loadUnits' | 'ownershipTypes';
}

export const FORM_FIELDS: readonly FieldDef[] = [
  // بيانات عامة
  { key: 'companyName', section: 'general', type: 'text', labelAr: 'اسم الشركة', labelEn: 'Company name', maxLength: 200 },
  { key: 'governorate', section: 'general', type: 'select', labelAr: 'المحافظة', labelEn: 'Governorate', options: 'governorates' },
  { key: 'industrialZone', section: 'general', type: 'select', labelAr: 'المنطقة الصناعية', labelEn: 'Industrial zone', options: 'zones' },
  { key: 'address', section: 'general', type: 'textarea', labelAr: 'العنوان', labelEn: 'Address', maxLength: 500 },
  { key: 'phone1', section: 'general', type: 'phone', labelAr: 'تليفون (1)', labelEn: 'Phone (1)' },
  { key: 'phone2', section: 'general', type: 'phone', labelAr: 'تليفون (2)', labelEn: 'Phone (2)' },
  { key: 'fax', section: 'general', type: 'phone', labelAr: 'فاكس (1)', labelEn: 'Fax (1)' },
  { key: 'website', section: 'general', type: 'url', labelAr: 'الموقع الإلكتروني', labelEn: 'Website' },
  // مسؤول الاتصال
  { key: 'contactName', section: 'contact', type: 'text', labelAr: 'اسم مسؤول الاتصال', labelEn: 'Contact name', maxLength: 200 },
  { key: 'contactTitle', section: 'contact', type: 'text', labelAr: 'الوظيفة', labelEn: 'Job title', maxLength: 200 },
  { key: 'contactMobile', section: 'contact', type: 'phone', labelAr: 'موبايل مسؤول الاتصال', labelEn: 'Contact mobile' },
  { key: 'contactPhone', section: 'contact', type: 'phone', labelAr: 'تليفون مسؤول الاتصال', labelEn: 'Contact phone' },
  { key: 'contactFax', section: 'contact', type: 'phone', labelAr: 'فاكس مسؤول الاتصال', labelEn: 'Contact fax' },
  { key: 'contactEmail', section: 'contact', type: 'email', labelAr: 'البريد الإلكتروني لمسؤول الاتصال', labelEn: 'Contact email' },
  // أوراق الشركة
  { key: 'commercialRegisterNumber', section: 'company', type: 'text', labelAr: 'رقم السجل التجاري', labelEn: 'Commercial register number', maxLength: 50 },
  { key: 'commercialRegisterFile', section: 'company', type: 'file', labelAr: 'السجل التجاري (ملف)', labelEn: 'Commercial register file', docKind: 'commercialRegisterFile' },
  { key: 'industrialRegistryNumber', section: 'company', type: 'text', labelAr: 'رقم السجل الصناعي', labelEn: 'Industrial registry number', maxLength: 50 },
  { key: 'industrialRegisterFile', section: 'company', type: 'file', labelAr: 'السجل الصناعي (ملف)', labelEn: 'Industrial register file', docKind: 'industrialRegisterFile' },
  { key: 'taxNumber', section: 'company', type: 'text', labelAr: 'الرقم الضريبي', labelEn: 'Tax number', maxLength: 50 },
  { key: 'taxCardFile', section: 'company', type: 'file', labelAr: 'البطاقة الضريبية (ملف)', labelEn: 'Tax card file', docKind: 'taxCardFile' },
  // بيانات هندسية
  { key: 'roofAreas', section: 'engineering', type: 'roofTable', labelAr: 'بيان المساحات المتاحة من أسطح المنشأة الصناعية', labelEn: 'Available roof areas of the industrial facility' },
  { key: 'electricityBills', section: 'engineering', type: 'files', labelAr: 'فواتير الكهرباء لآخر 12 شهرًا', labelEn: 'Electricity bills (last 12 months)', docKind: 'electricityBill' },
  { key: 'contractedCapacity', section: 'engineering', type: 'number', labelAr: 'القدرة التعاقدية', labelEn: 'Contracted capacity' },
  { key: 'capacityUnit', section: 'engineering', type: 'select', labelAr: 'وحدة القدرة', labelEn: 'Capacity unit', options: 'capacityUnits' },
  { key: 'peakLoad', section: 'engineering', type: 'number', labelAr: 'أقصى حمل', labelEn: 'Peak load' },
  { key: 'loadUnit', section: 'engineering', type: 'select', labelAr: 'وحدة الحمل', labelEn: 'Load unit', options: 'loadUnits' },
  { key: 'ownershipProofFile', section: 'engineering', type: 'file', labelAr: 'إثبات حق الملكية أو الاستخدام طوال مدة التمويل والتشغيل', labelEn: 'Proof of ownership or right of use for the whole financing and operation period', docKind: 'ownershipProofFile' },
  { key: 'ownershipType', section: 'engineering', type: 'select', labelAr: 'نوع الحيازة', labelEn: 'Tenure type', options: 'ownershipTypes' },
  { key: 'ownershipExpiresAt', section: 'engineering', type: 'date', labelAr: 'تاريخ انتهاء الحيازة', labelEn: 'Tenure expiry date' },
];

export const FIELD_BY_KEY = new Map(FORM_FIELDS.map((f) => [f.key, f]));
export const DATA_FIELDS = FORM_FIELDS.filter((f) => f.type !== 'file' && f.type !== 'files');
export const FILE_FIELDS = FORM_FIELDS.filter((f) => f.type === 'file' || f.type === 'files');

export function dataFieldsOf(section: FormSection): FieldDef[] {
  return DATA_FIELDS.filter((f) => f.section === section);
}

/** المستند ← قسمه (لتطبيق قواعد الرؤية). */
export const DOCUMENT_SECTION: Record<DocumentKind, DataSection> = {
  commercialRegisterFile: 'company', industrialRegisterFile: 'company', taxCardFile: 'company',
  electricityBill: 'engineering', ownershipProofFile: 'engineering',
  technicalOfferFile: 'offer', electricityApprovalFile: 'electricity', contractFile: 'contract', distributionApprovalFile: 'contract',
  correctionProofFile: 'general',
};

export const FORM_DOCUMENT_KINDS: readonly DocumentKind[] = ['commercialRegisterFile', 'industrialRegisterFile', 'taxCardFile', 'electricityBill', 'ownershipProofFile'];

/** حقل النواقص ← نوع المستند (الحقول التي هي ملفات). */
export function docKindForField(field: string): DocumentKind | null {
  if (field === 'technicalOfferFile' || field === 'electricityApprovalFile' || field === 'contractFile' || field === 'distributionApprovalFile') return field;
  return FIELD_BY_KEY.get(field as FormFieldKey)?.docKind ?? null;
}

export function fieldForDocKind(kind: DocumentKind): string {
  return kind === 'electricityBill' ? 'electricityBills' : kind;
}

export const DOCUMENT_LABELS: Record<DocumentKind, { ar: string; en: string }> = {
  commercialRegisterFile: { ar: 'السجل التجاري', en: 'Commercial register' },
  industrialRegisterFile: { ar: 'السجل الصناعي', en: 'Industrial register' },
  taxCardFile: { ar: 'البطاقة الضريبية', en: 'Tax card' },
  electricityBill: { ar: 'فاتورة كهرباء', en: 'Electricity bill' },
  ownershipProofFile: { ar: 'إثبات الملكية أو الاستخدام', en: 'Ownership / right of use proof' },
  technicalOfferFile: { ar: 'العرض الفني', en: 'Technical offer' },
  electricityApprovalFile: { ar: 'موافقة شركة الكهرباء', en: 'Electricity company approval' },
  contractFile: { ar: 'مستند إثبات التعاقد', en: 'Contract evidence' },
  distributionApprovalFile: { ar: 'موافقة شركة توزيع الكهرباء على التعاقد', en: 'Distribution company contracting approval' },
  correctionProofFile: { ar: 'إثبات حل المشكلة', en: 'Proof that the issue is fixed' },
};

export function isRequired(key: FormFieldKey): boolean {
  return shamsPolicy.requiredFields[key];
}
