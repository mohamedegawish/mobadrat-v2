/**
 * Shapes the platform's public screens are written against (header, home, catalog, initiative page, compare, login,
 * «مبادراتي», admin sidebar). They are filled from the platform API by store/state.ts.
 */

export type Language = 'ar' | 'en';

/** The signed-in person as the screens show them. `id === 'guest'` when nobody is signed in. */
export interface User {
  id: string;
  name: string;
  nameEn: string;
  email: string;
  /** The platform role (super_admin, ministry_viewer, auditor, catalog_manager) or 'member' / 'guest'. */
  role: string;
  roleTitleAr: string;
  roleTitleEn: string;
  organizationId: string;
  organizationNameAr: string;
  organizationNameEn: string;
  avatar?: string;
  mustChangePassword?: boolean;
}

// ----------------------------------------------------------
// تخصيص المبادرة — يتحكم فيه الادمن من لوحة التحكم
// ----------------------------------------------------------
export interface InitiativeCustomization {
  showBenefits: boolean;
  showFaqs: boolean;
  showImpactMetrics: boolean;
  showTimeline: boolean;
  showPartners: boolean;
  enablePreEligibility: boolean;
  allowFactoryFileUpload: boolean;
  requireDetailsFile: boolean;
  maxFileSizeMB: number;
  allowedFileTypes: string;
  customWelcomeMessageAr?: string;
  customWelcomeMessageEn?: string;
  accentColor?: string;
}

export const DEFAULT_CUSTOMIZATION: InitiativeCustomization = {
  showBenefits: true,
  showFaqs: true,
  showImpactMetrics: true,
  showTimeline: true,
  showPartners: true,
  enablePreEligibility: true,
  allowFactoryFileUpload: true,
  requireDetailsFile: false,
  maxFileSizeMB: 15,
  allowedFileTypes: '.pdf',
  customWelcomeMessageAr: '',
  customWelcomeMessageEn: '',
  accentColor: '',
};

export type InitiativeStatus = 'draft' | 'active' | 'closed' | 'coming_soon' | 'archived' | 'completed';

export interface InitiativeBenefit {
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  iconName: string;
}

export interface PreEligibilityQuestion {
  id: string;
  questionAr: string;
  questionEn: string;
  type: 'boolean' | 'select' | 'number';
  options?: { labelAr: string; labelEn: string; isEligible: boolean; value: string }[];
  expectedValue?: unknown;
  explanationAr: string;
  explanationEn: string;
}

/** An initiative's stage as shown on the public pages (the steps its module runs after applying). */
export interface WorkflowStage {
  id: string;
  order: number;
  nameAr: string;
  nameEn: string;
  descriptionAr?: string;
  descriptionEn?: string;
  assignedOrgNameAr: string;
  /** 0 = not published for this initiative. */
  slaDays: number;
}

export interface WorkflowDefinition {
  id: string;
  initiativeId: string;
  nameAr: string;
  nameEn: string;
  stages: WorkflowStage[];
}

/** بند نصي مزدوج اللغة (المستهدفات / الاشتراطات / المعايير) */
export interface BilingualItem {
  textAr: string;
  textEn: string;
}

export type FinancingType = 'bank_loans' | 'grants' | 'subsidy' | 'mixed';

/** المحددات المالية والتمويلية للمبادرة */
export interface FinancialTerms {
  financingType?: FinancingType;
  currency?: 'EGP' | 'USD';
  maxDurationYears?: number;
  maxFinancingPerClientEGP?: number;
  maxFinancingPerGroupEGP?: number;
  beneficiariesAr?: string;
  beneficiariesEn?: string;
  purposeAr?: string;
  purposeEn?: string;
  notesAr?: string;
  notesEn?: string;
}

export interface Initiative {
  id: string;
  slug: string;
  /** The module that runs registration and dashboards (null = information page only). */
  moduleId: string | null;
  titleAr: string;
  titleEn: string;
  taglineAr: string;
  taglineEn: string;
  descriptionAr: string;
  descriptionEn: string;
  status: InitiativeStatus;
  registrationOpen: boolean;
  category: string;
  categoryEn: string;
  targetSectors: string[];
  targetSectorsEn: string[];
  targetGovernorates: string[];
  budgetTotalEGP: number;
  budgetAllocatedEGP: number;
  startDate: string;
  endDate: string;
  coverImage: string;
  badgeTextAr: string;
  badgeTextEn: string;
  participatingOrgs: string[];
  customization?: InitiativeCustomization;
  benefits: InitiativeBenefit[];
  faqs: { questionAr: string; questionEn: string; answerAr: string; answerEn: string }[];
  preEligibilityQuestions: PreEligibilityQuestion[];
  requiredDocsList: { code: string; titleAr: string; titleEn: string; mandatory: boolean }[];
  workflow: WorkflowDefinition;
  impactMetrics: {
    targetFactories: number;
    benefitedFactories: number;
    targetCapacityMW?: number;
    savedEnergyGWh?: number;
    investmentStimulatedEGP: number;
    jobsCreated: number;
  };
  objectives?: BilingualItem[];
  eligibilityRequirements?: BilingualItem[];
  selectionCriteria?: BilingualItem[];
  financialTerms?: FinancialTerms;
  executionNotesAr?: string;
  executionNotesEn?: string;
}
