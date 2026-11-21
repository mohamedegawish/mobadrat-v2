/**
 * محوّل SMS قابل للاستبدال. مزود الرسائل لم يُحدد بعد:
 * - SMS_PROVIDER فارغ → لا مزود، والرسائل تُسجل `skipped` ظاهرة للأدمن.
 * - SMS_PROVIDER=http → محوّل عام (POST JSON) placeholder حتى تتوفر مواصفات المزود.
 */
import { config } from '../../config.js';

export interface SmsAdapter {
  readonly name: string;
  send(to: string, text: string): Promise<void>;
}

let testAdapter: SmsAdapter | null | undefined;

/** الاختبارات تحقن محوّلًا (null = لا مزود، undefined = السلوك الافتراضي). */
export function setSmsAdapterForTests(a: SmsAdapter | null | undefined): void {
  testAdapter = a;
}

/** TODO(تكامل): استبدل جسم الطلب وحقوله عند اعتماد مزود الرسائل. */
class HttpSmsAdapter implements SmsAdapter {
  readonly name = 'http';
  async send(to: string, text: string): Promise<void> {
    const res = await fetch(config.smsApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.smsApiKey}` },
      body: JSON.stringify({ to, text, sender: config.smsSender }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`SMS provider HTTP ${res.status}`);
  }
}

export function getSmsAdapter(): SmsAdapter | null {
  if (testAdapter !== undefined) return testAdapter;
  if (config.smsProvider === 'http' && config.smsApiUrl) return new HttpSmsAdapter();
  return null;
}
