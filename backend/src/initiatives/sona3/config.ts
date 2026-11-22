/**
 * Module configuration: the platform configuration, with this module's own outbound webhook (SONA3_WEBHOOK_URL /
 * SONA3_WEBHOOK_SECRET, off by default — the platform admin is built in).
 */
import { config as core } from '../../config.js';

export * from '../../config.js';

export const MODULE_ID = 'sona3';

export const config: typeof core = new Proxy(core, {
  get(target, prop, receiver) {
    if (prop === 'platformWebhookUrl') return (process.env.SONA3_WEBHOOK_URL ?? '').trim();
    if (prop === 'platformWebhookSecret') return process.env.SONA3_WEBHOOK_SECRET ?? '';
    if (prop === 'mailFromName') return process.env.SONA3_MAIL_FROM_NAME ?? Reflect.get(target, prop, receiver);
    return Reflect.get(target, prop, receiver);
  },
});
