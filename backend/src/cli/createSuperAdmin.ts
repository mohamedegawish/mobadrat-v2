/**
 * npm run admin:create -- --email admin@example.gov.eg --name "الاسم" [--phone 010…] [--print-link]
 *
 * Makes an account a platform administrator (super_admin) — on the server only. A new account gets no password: a one-time
 * setup link is queued to its e-mail (sent by the running server), or printed with --print-link when mail is not set up yet
 * (the printing is audited). An existing account keeps its password and just gains the role.
 */
import { config } from '../config.js';
import { bootPlatform } from '../core/boot.js';
import { closeDb } from '../core/db/index.js';
import { createAccount, newToken, sendSetupLink } from '../core/identity.js';
import { isMailConfigured } from '../core/mail/mailer.js';
import { platformPolicy } from '../core/policy.js';
import { addAuditLog } from '../core/store/audit.js';
import { getUserByEmail, setPlatformRole, setResetToken } from '../core/store/users.js';
import { isEmail } from '../core/http/validate.js';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1]?.trim() : undefined; };
const email = arg('email')?.toLowerCase();
const name = arg('name');
const printLink = process.argv.includes('--print-link');

if (!email || !isEmail(email)) {
  console.error('usage: npm run admin:create -- --email <email> --name "<الاسم>" [--phone <mobile>] [--print-link]');
  process.exit(1);
}
try {
  await bootPlatform();
  const existing = await getUserByEmail(email);
  if (!existing && !name) throw new Error('--name is required for a new account');
  if (!existing && !printLink && !isMailConfigured()) throw new Error('mail is not configured — the setup link cannot be delivered. Configure SMTP or re-run with --print-link.');
  const created = !existing;
  const user = existing ?? await createAccount({ email, nameAr: name!, phone: arg('phone'), passwordHash: '', emailVerified: true, createdBy: null, source: 'cli' });
  await setPlatformRole(user.id, 'super_admin');
  await addAuditLog({ actorType: 'system', actorName: 'cli', action: 'user.platform_role_set', entityType: 'user', entityId: user.id,
    summaryAr: `منح دور مدير المنصة لـ ${user.email} من طرفية السيرفر`, details: { platformRole: 'super_admin', created } });
  console.log(`[admin:create] ${user.email} is now a platform administrator${created ? ' (new account)' : ''}`);
  if (created) {
    if (printLink) {
      const { token, hash } = newToken();
      await setResetToken(user.id, hash, new Date(Date.now() + platformPolicy.setupTokenHours * 3600_000).toISOString());
      await addAuditLog({ actorType: 'system', actorName: 'cli', action: 'user.setup_link_printed', entityType: 'user', entityId: user.id, summaryAr: 'طُبع رابط تعيين كلمة المرور في طرفية السيرفر' });
      console.log(`One-time password setup link (deliver to ${user.email} only, valid ${platformPolicy.setupTokenHours}h): ${config.appUrl}/#reset-password/${token}`);
    } else {
      await sendSetupLink(user, 'setup');
      console.log('A one-time password setup link was queued to the account\'s e-mail (sent by the running server).');
    }
  }
  await closeDb();
} catch (e) {
  console.error(`[admin:create] FAILED: ${(e as Error).message}`);
  process.exit(1);
}
