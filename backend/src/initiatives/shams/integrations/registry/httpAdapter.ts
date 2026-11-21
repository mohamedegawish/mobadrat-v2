import { config } from '../../config.js';
import type { IndustrialRegistryClient, RegistryResult } from './types.js';
import { buildRequest, mapResponse } from './mapResponse.js';

export class HttpRegistryClient implements IndustrialRegistryClient {
  readonly name = 'http' as const;
  async verify(registryNumber: string): Promise<RegistryResult> {
    if (!config.registryApiUrl) return { result: 'unavailable', errorCode: 'NOT_CONFIGURED' };
    const { url, init } = buildRequest(config.registryApiUrl, config.registryApiKey, registryNumber);
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(config.registryTimeoutMs) });
      let body: unknown = null;
      try { body = await res.json(); } catch { body = null; }
      return mapResponse(registryNumber, res.status, body);
    } catch (e) {
      const name = (e as Error).name;
      return { result: 'unavailable', errorCode: name === 'TimeoutError' || name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR' };
    }
  }
}
