// ألوان الحالات (درجات الشارات من globals.css) — لا hex داخل المكونات.
import type { ApplicationState } from '../api/schemas';

export type StatusTone = 'approved' | 'pending' | 'rework' | 'rejected' | 'draft' | 'gold' | 'teal' | 'info';

const STATE_TONES: Record<ApplicationState, StatusTone> = {
  DRAFT: 'draft',
  IMC_REVIEW: 'pending', ENCPC_REVIEW: 'pending', OFFER_REVIEW: 'pending', ELECTRICITY_REVIEW: 'pending', DISTRIBUTION_REVIEW: 'pending', BANK_STUDY: 'pending',
  IMC_CORRECTION: 'rework', ENCPC_CORRECTION: 'rework', OFFER_CORRECTION: 'rework',
  PROVIDER_SELECTION: 'info', OFFER_UPLOAD: 'info', ELECTRICITY_UPLOAD: 'info', CONTRACT_OUTCOME: 'info', DISTRIBUTION_UPLOAD: 'info',
  REJECTED: 'rejected', CONTRACTED: 'approved', CLOSED_NOT_CONTRACTED: 'rejected', WITHDRAWN: 'draft',
};

export function statusTone(status: string | undefined | null): StatusTone {
  if (!status) return 'draft';
  if (status in STATE_TONES) return STATE_TONES[status as ApplicationState];
  if (['approved', 'sent', 'delivered', 'valid', 'active'].includes(status)) return 'approved';
  if (['pending', 'sending'].includes(status)) return 'pending';
  if (['failed', 'rejected', 'invalid', 'suspended', 'declined'].includes(status)) return 'rejected';
  if (['skipped', 'unavailable'].includes(status)) return 'rework';
  return 'draft';
}
