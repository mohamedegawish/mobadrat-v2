/** واجهة التحقق من السجل الصناعي — adapter حقيقي (http) وadapter للتطوير (mock). */
export interface FacilityData {
  registryNumber: string;
  facilityName?: string;
  activity?: string;
  governorate?: string;
  status?: string;
  /** أي حقول إضافية من الخدمة كما وردت (بعد التحويل). */
  extra?: Record<string, unknown>;
}

export type RegistryResult =
  | { result: 'valid'; facility: FacilityData }
  | { result: 'invalid'; errorCode?: string }
  | { result: 'unavailable'; errorCode: string };

/**
 * H3 (القرار 5): بيانات مقدم الطلب التي قد تُطابق ببيانات المالك/المفوض في السجل عند توفرها.
 * شكل رد API السجل لم يُحدد بعد — لا نفترضه؛ الـadapter الذي يدعم المطابقة يحوّل رده إلى OwnershipResult.
 */
export interface OwnershipApplicant {
  registryNumber: string;
  companyName: string;
  commercialRegisterNumber?: string;
  taxNumber?: string;
  contactName?: string;
  /** عند إضافة حقل الرقم القومي للمفوض لاحقًا. */
  representativeNationalId?: string;
}

export type OwnershipResult =
  | { status: 'match'; checkedFields: string[] }
  | { status: 'mismatch'; checkedFields: string[]; note?: string }
  | { status: 'inconclusive'; note?: string }
  | { status: 'not_available' };

export interface IndustrialRegistryClient {
  readonly name: 'mock' | 'http';
  verify(registryNumber: string): Promise<RegistryResult>;
  /**
   * اختيارية: مطابقة المالك/المفوض. غيابها = not_available. النتيجة تُسجَّل وتُعرض لـ IMC وPMU فقط — لا منع آلي
   * (shamsPolicy.registryOwnershipCheck = 'record_only') حتى يُعتمد غير ذلك.
   */
  verifyOwnership?(applicant: OwnershipApplicant, facility: FacilityData): Promise<OwnershipResult>;
}
