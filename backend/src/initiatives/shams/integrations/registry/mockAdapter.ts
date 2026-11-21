/**
 * Adapter تطوير واختبار فقط — ممنوع في الإنتاج (assertProductionSafe + check:prod).
 * قواعد حتمية:
 *   يبدأ بـ "INVALID" أو ينتهي بـ "000"  → invalid
 *   يبدأ بـ "DOWN"                        → unavailable
 *   غير ذلك                              → valid ببيانات منشأة تجريبية
 */
import type { IndustrialRegistryClient, RegistryResult } from './types.js';

export class MockRegistryClient implements IndustrialRegistryClient {
  readonly name = 'mock' as const;
  async verify(registryNumber: string): Promise<RegistryResult> {
    const n = registryNumber.toUpperCase();
    if (n.startsWith('DOWN')) return { result: 'unavailable', errorCode: 'MOCK_DOWN' };
    if (n.startsWith('INVALID') || n.endsWith('000')) return { result: 'invalid', errorCode: 'NOT_FOUND' };
    return { result: 'valid', facility: { registryNumber: n, facilityName: `منشأة تجريبية ${n}`, activity: 'نشاط صناعي (بيانات تجريبية)', status: 'active' } };
  }
}
