/**
 * Manual verification (REGISTRY_ADAPTER=manual) — until the industrial registry API is connected. No number is accepted or
 * refused automatically: the answer is always 'manual', the registration and the submission to IMC go ahead, and IMC checks
 * the number against the uploaded industrial registry certificate (industrialRegisterFile, required) before its decision.
 * The duplicate and on-hold checks (one open application per number, PMU holds) do not need the API and still apply.
 * Allowed in production (unlike mock): nothing is presented as verified.
 */
import type { IndustrialRegistryClient, RegistryResult } from './types.js';

export class ManualRegistryClient implements IndustrialRegistryClient {
  readonly name = 'manual' as const;
  async verify(): Promise<RegistryResult> {
    return { result: 'manual' };
  }
}
