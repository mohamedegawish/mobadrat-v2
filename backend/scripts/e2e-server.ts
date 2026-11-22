/**
 * Browser e2e server only (e2e/start-backend.mjs): the normal server, with every outgoing e-mail written to a file in
 * E2E_MAIL_DIR instead of SMTP, so Playwright journeys can read verification / reset links like a real inbox. Each file is
 * the message HTML preceded by `<!-- to: … | subject: … -->`. Never used outside tests (refuses NODE_ENV=production).
 */
import fs from 'node:fs';
import path from 'node:path';

if (process.env.NODE_ENV === 'production') throw new Error('[e2e] the e2e server never runs in production');
const mailDir = process.env.E2E_MAIL_DIR;
if (!mailDir) throw new Error('[e2e] E2E_MAIL_DIR is required');
fs.mkdirSync(mailDir, { recursive: true });

const { setMailSenderForTests } = await import('../src/core/mail/mailer.js');
let n = 0;
setMailSenderForTests(async (m) => {
  const to = m.to.join('_').replace(/[^\w.@-]/g, '_');
  const file = path.join(mailDir, `${Date.now()}-${String(++n).padStart(5, '0')}-${to}.html`);
  fs.writeFileSync(file, `<!-- to: ${m.to.join(', ')} | subject: ${m.subject} -->\n${m.html}`, 'utf8');
  return 'sent';
});
console.log(`[e2e] e-mails are written to ${mailDir}`);
await import('../src/index.js');
