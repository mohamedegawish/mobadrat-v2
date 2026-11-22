/**
 * After a successful submit/resubmit (outside the workflow transaction): copy the submitted personal data back to the
 * applicant's shared person profile. Best-effort — a failure here never fails the submission; the submitted snapshot
 * itself never changes. Identity fields (national ID, birth date) are only filled when the profile has none.
 */
import { writeBackToProfile } from '../../core/profile/writeback.js';
import { MODULE_ID } from './config.js';
import { requirements } from './requirements.js';
import { getApplicant } from './store/applicants.js';
import type { FormData } from './workflow/validate.js';

export async function syncProfileAfterSubmit(input: { actorUserId: string; actorName: string; applicantId: string; form: FormData }): Promise<void> {
  try {
    const applicant = await getApplicant(input.applicantId);
    const userId = applicant?.userId ?? input.actorUserId;
    await writeBackToProfile({
      initiativeId: MODULE_ID, manifest: requirements, userId, factoryProfileId: null,
      sections: input.form as Record<string, Record<string, unknown> | undefined>, actorName: input.actorName,
    });
  } catch (e) {
    console.error('[sona3] profile write-back failed:', (e as Error).message);
  }
}
