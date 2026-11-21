import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { LOGO_CID, logoAttachment } from './layout.js';

export interface MailAttachment {
  filename: string;
  path: string;
  cid?: string;
}

export interface MailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
}

/** 'sent' = delivered to SMTP; 'skipped' = intentionally not delivered (non-prod without redirect). */
export type MailResult = 'sent' | 'skipped';
export type MailSender = (m: MailMessage) => Promise<MailResult>;

let testSender: MailSender | null = null;
let transport: Transporter | null = null;
let transportKey = '';

/** Tests inject a fake sender (null restores SMTP). */
export function setMailSenderForTests(fn: MailSender | null): void {
  testSender = fn;
}

export function isMailConfigured(): boolean {
  return Boolean(testSender) || Boolean(config.smtpHost && config.mailFromAddress) || Boolean(config.gmailUser && config.gmailAppPassword);
}

function getTransport(): Transporter {
  const key = `${config.smtpHost}:${config.smtpPort}:${config.smtpUser}:${config.gmailUser}`;
  if (!transport || key !== transportKey) {
    transport = config.smtpHost
      ? nodemailer.createTransport({
          host: config.smtpHost, port: config.smtpPort, secure: config.smtpSecure,
          auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
        })
      : nodemailer.createTransport({ service: 'gmail', auth: { user: config.gmailUser, pass: config.gmailAppPassword } });
    transportKey = key;
  }
  return transport;
}

export async function sendMail(input: MailMessage): Promise<MailResult> {
  // Official layout embeds the ministry logo as CID — attach it automatically when referenced.
  const logo = input.html.includes(`cid:${LOGO_CID}`) ? logoAttachment() : null;
  const m: MailMessage = logo && !(input.attachments ?? []).some((a) => a.cid === LOGO_CID)
    ? { ...input, attachments: [...(input.attachments ?? []), logo] }
    : input;
  if (testSender) return testSender(m);
  if (!isMailConfigured()) return 'skipped';
  let to = m.to;
  let subject = m.subject;
  if (!config.mailSendReal) {
    // Outside production never mail real recipients unless redirected to a developer inbox.
    if (!config.mailRedirectTo) return 'skipped';
    to = [config.mailRedirectTo];
    subject = `[dev] ${m.subject}`;
  }
  await getTransport().sendMail({
    from: { name: config.mailFromName, address: config.mailFromAddress },
    to,
    subject,
    html: m.html,
    text: m.text,
    attachments: m.attachments,
  });
  return 'sent';
}
