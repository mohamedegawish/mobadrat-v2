import { config, mockRegistryAllowedInProd } from '../../config.js';
import type { IndustrialRegistryClient } from './types.js';
import { HttpRegistryClient } from './httpAdapter.js';
import { MockRegistryClient } from './mockAdapter.js';
import { ManualRegistryClient } from './manualAdapter.js';

let override: IndustrialRegistryClient | null = null;

export function setRegistryClientForTests(c: IndustrialRegistryClient | null): void {
  override = c;
}

export function getRegistryClient(): IndustrialRegistryClient {
  if (override) return override;
  if (config.registryAdapter === 'http') return new HttpRegistryClient();
  if (config.registryAdapter === 'manual') return new ManualRegistryClient();
  if (config.isProd && !mockRegistryAllowedInProd()) throw new Error('[registry] mock adapter is forbidden in production');
  return new MockRegistryClient();
}

export type { IndustrialRegistryClient, RegistryResult, FacilityData } from './types.js';
export type { OwnershipApplicant, OwnershipResult } from './types.js';

/** H3 (القرار 5): نقطة التوصيل الوحيدة لمطابقة الملكية — أي خطأ = inconclusive، ولا تمنع الإرسال أبدًا. */
export async function checkOwnership(client: IndustrialRegistryClient, applicant: import('./types.js').OwnershipApplicant, facility: import('./types.js').FacilityData): Promise<import('./types.js').OwnershipResult> {
  if (!client.verifyOwnership) return { status: 'not_available' };
  try { return await client.verifyOwnership(applicant, facility); } catch { return { status: 'inconclusive', note: 'ownership check failed' }; }
}
