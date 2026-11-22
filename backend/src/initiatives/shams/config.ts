/**
 * Module configuration: the platform configuration, with this module's own outbound webhook (SHAMS_WEBHOOK_URL /
 * SHAMS_WEBHOOK_SECRET, off by default — the platform admin is built in).
 */
import { config as core } from '../../config.js';

export * from '../../config.js';

export const MODULE_ID = 'shams';

export const config: typeof core = new Proxy(core, {
  get(target, prop, receiver) {
    if (prop === 'platformWebhookUrl') return (process.env.SHAMS_WEBHOOK_URL ?? '').trim();
    if (prop === 'platformWebhookSecret') return process.env.SHAMS_WEBHOOK_SECRET ?? '';
    return Reflect.get(target, prop, receiver);
  },
});
