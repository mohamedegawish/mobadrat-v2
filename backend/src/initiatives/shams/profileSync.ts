/**
 * After a successful submit/resubmit (outside the workflow transaction): copy the submitted factory data back to the
 * shared factory profile, so the next initiative that needs it is prefilled. Best-effort — a failure here never fails the
 * submission; the submitted snapshot itself never changes. A Shams file without a linked profile (older data) gets one.
 */
import { writeBackToProfile } from '../../core/profile/writeback.js';
import { createFactoryProfile } from '../../core/profile/store.js';
import { MODULE_ID } from './config.js';
import { requirements } from './requirements.js';
import { getFactory, setFactoryProfile } from './store/factories.js';
import type { FormData } from './workflow/validate.js';

export async function syncProfileAfterSubmit(input: { userId: string; actorName: string; factoryId: string; form: FormData }): Promise<void> {
  try {
    const factory = await getFactory(input.factoryId);
    if (!factory) return;
    let profileId = factory.factoryProfileId;
    if (!profileId) {
      profileId = (await createFactoryProfile(input.userId, { 'factory.companyName': factory.companyName })).id;
      await setFactoryProfile(factory.id, profileId);
    }
    await writeBackToProfile({
      initiativeId: MODULE_ID, manifest: requirements, userId: input.userId, factoryProfileId: profileId,
      sections: input.form as Record<string, Record<string, unknown> | undefined>, actorName: input.actorName,
    });
  } catch (e) {
    console.error('[shams] profile write-back failed:', (e as Error).message);
  }
}
