/**
 * D10 (Shams QA 2026-11-23, applies to every initiative): a negative decision carries its reason in every channel.
 *  - In-app: the decision, then the FULL reason (the notification's own link opens the application).
 *  - SMS: the decision, the reason cut to fit two SMS segments, then a link to the platform.
 *  - The outbox stores the rendered SMS text whether or not an SMS provider is configured.
 * E-mail templates already carry the reason and are not touched here.
 */

/** One multipart SMS segment: 153 characters in GSM-7, 67 in UCS-2 (any Arabic letter forces UCS-2). */
const SEGMENT_GSM = 153;
const SEGMENT_UCS2 = 67;
/** A message up to this many segments; longer reasons are cut with an ellipsis. */
export const SMS_MAX_SEGMENTS = 2;

/** Characters allowed in a GSM-7 message (basic table; extension characters count double and are treated as UCS-2 here). */
const GSM7 = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà]*$/;

/** The longest text that still fits in `segments` SMS segments for this alphabet. */
export function smsCapacity(text: string, segments = SMS_MAX_SEGMENTS): number {
  return (GSM7.test(text) ? SEGMENT_GSM : SEGMENT_UCS2) * segments;
}

export interface DecisionReason {
  /** The reviewer's reason, as written (deficiency notes already joined by the caller). */
  text: string;
  /** Arabic label shown before the reason (default «السبب»). */
  labelAr?: string;
}

const ELLIPSIS = '…';

/**
 * Builds the in-app body and the SMS body of a decision notification.
 * `decision` is the template's short decision line (its `sms` text), `link` the platform address for the SMS.
 */
export function composeDecisionTexts(decision: string, reason: DecisionReason, link?: string): { inbox: string; sms: string } {
  const label = reason.labelAr ?? 'السبب';
  const full = reason.text.trim();
  const base = decision.trim();
  if (!full) return { inbox: base, sms: link ? `${base} ${link}` : base };
  const inbox = `${base}\n${label}: ${full}`;

  const flat = full.replace(/\s+/g, ' ');
  const head = `${base} ${label}: `;
  const tail = link ? ` ${link}` : '';
  const whole = `${head}${flat}${tail}`;
  const cap = smsCapacity(whole);
  if (whole.length <= cap) return { inbox, sms: whole };
  const room = cap - head.length - tail.length;
  if (room <= ELLIPSIS.length + 1) {
    // No room for any of the reason: keep the decision and the link (the full reason is in-app and in the e-mail).
    return { inbox, sms: `${base}${tail}`.slice(0, cap) };
  }
  const cut = `${flat.slice(0, room - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`;
  return { inbox, sms: `${head}${cut}${tail}` };
}
