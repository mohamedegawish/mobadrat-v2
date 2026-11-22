// ألوان الحالات (درجات الشارات من globals.css) — لا hex داخل المكونات.
import type { ApplicationState } from '../api/schemas';

export type StatusTone = 'approved' | 'pending' | 'rework' | 'rejected' | 'draft' | 'gold' | 'teal' | 'info';

const STATE_TONES: Record<ApplicationState, StatusTone> = {
  DRAFT: 'draft',
  ELIGIBILITY_REVIEW: 'pending', STUDY_REVIEW: 'pending', COMMITTEE_EVALUATION: 'pending', EVALUATED: 'pending', FUNDER_REVIEW: 'pending',
  ELIGIBILITY_CORRECTION: 'rework', STUDY_CORRECTION: 'rework',
  STUDY_PREPARATION: 'info', SELECTED: 'gold', FUNDING_SEARCH: 'info', IMPLEMENTATION: 'teal', OPERATING: 'approved',
  REJECTED: 'rejected', NOT_SELECTED: 'rejected', NOT_APPROVED: 'rejected', CLOSED_NOT_FUNDED: 'draft', COMPLETED: 'approved', WITHDRAWN: 'draft',
};

export function statusTone(status: string | undefined | null): StatusTone {
  if (!status) return 'draft';
  if (status in STATE_TONES) return STATE_TONES[status as ApplicationState];
  if (['approved', 'sent', 'delivered', 'valid', 'active', 'verified', 'disbursed', 'accepted'].includes(status)) return 'approved';
  if (['pending', 'sending', 'reported', 'planned'].includes(status)) return 'pending';
  if (['failed', 'rejected', 'invalid', 'suspended', 'declined'].includes(status)) return 'rejected';
  if (['skipped', 'unavailable', 'returned'].includes(status)) return 'rework';
  return 'draft';
}
