/** Provider logos embedded in Shams e-mails: read from storage at send time (the stored message carries only cid:…). */
import fs from 'node:fs';
import path from 'node:path';
import { getProvider } from '../store/providers.js';
import { logoPath } from '../http/upload.js';
import { LOGO_CID_PREFIX } from './templates.js';
import type { MailAttachment } from '../mail/mailer.js';

export async function providerLogoAttachments(html: string): Promise<MailAttachment[]> {
  const ids = new Set([...html.matchAll(new RegExp(`cid:${LOGO_CID_PREFIX}([A-Za-z0-9_-]+)`, 'g'))].map((m) => m[1]));
  const out: MailAttachment[] = [];
  for (const id of ids) {
    const p = await getProvider(id);
    if (!p?.logoStoredName) continue;
    const file = logoPath(p.logoStoredName);
    if (!fs.existsSync(file)) continue;
    out.push({ filename: `logo-${id}${path.extname(p.logoStoredName)}`, path: file, cid: `${LOGO_CID_PREFIX}${id}` });
  }
  return out;
}
