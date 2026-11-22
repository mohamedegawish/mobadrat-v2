/**
 * أول مستخدم في جهة (H2 / القرار 1) — على السيرفر فقط، ويُرفض إن كان في الجهة مستخدم نشط بنفس الدور.
 *   npm run users:create-first -- --org org-pmu --role pmu_reviewer --email a@b.gov.eg --name "الاسم" [--phone 010...] [--print-link]
 * لا كلمة مرور: رابط تعيين لمرة واحدة يُرسل لبريد المستخدم من طابور الإشعارات (يرسله السيرفر العامل).
 * --print-link يطبع الرابط في الطرفية بدل الاعتماد على البريد (عند عدم ضبط البريد بعد) — يُدقق.
 */
import { closeDb, initDb } from '../db/sqlite.js';
import { createFirstOrgUser } from '../services/accounts.js';
import { isMailConfigured } from '../mail/mailer.js';
import { addAuditLog } from '../store/audit.js';
import { AppError } from '../http/errors.js';
import { ROLES, type Role } from '../domain.js';

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export async function runCreateFirst(input: { org?: string; role?: string; email?: string; name?: string; phone?: string; printLink: boolean }): Promise<number> {
  if (!input.org || !input.role || !(ROLES as readonly string[]).includes(input.role) || !input.email || !input.name) {
    console.error('usage: users:create-first -- --org <organizationId> --role <role> --email <email> --name "<الاسم>" [--phone <mobile>] [--print-link]');
    return 1;
  }
  if (!input.printLink && !isMailConfigured()) {
    console.error('[users:create-first] mail is not configured — the setup link cannot be delivered. Configure SMTP or re-run with --print-link.');
    return 1;
  }
  await initDb();
  try {
    const r = await createFirstOrgUser({ organizationId: input.org, role: input.role as Role, email: input.email, nameAr: input.name, phone: input.phone });
    console.log(`[users:create-first] created ${r.user.email} (${r.user.role} in ${r.user.organizationId})`);
    if (input.printLink) {
      await addAuditLog({ actorType: 'system', actorName: 'cli', action: 'user.setup_link_printed', entityType: 'user', entityId: r.user.id, summaryAr: 'طُبع رابط تعيين كلمة المرور في طرفية السيرفر' });
      console.log(`One-time password setup link (deliver to ${r.user.email} only): ${r.link}`);
    } else {
      console.log('A one-time password setup link was queued to the user\'s email (sent by the running server).');
    }
    return 0;
  } catch (e) {
    console.error(`[users:create-first] ${e instanceof AppError ? `${e.code}: ${e.messageEn}` : (e as Error).message}`);
    return 1;
  } finally {
    await closeDb();
  }
}

if (process.argv[1] && /createFirstUser\.(ts|js)$/.test(process.argv[1])) {
  process.exit(await runCreateFirst({ org: arg('org'), role: arg('role'), email: arg('email')?.trim().toLowerCase(), name: arg('name')?.trim(), phone: arg('phone')?.trim(), printLink: process.argv.includes('--print-link') }));
}
