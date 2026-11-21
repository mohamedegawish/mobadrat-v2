/**
 * إنشاء أول حساب مدير نظام (البذرة ممنوعة في الإنتاج) — اختصار لـ users:create-first على جهة إدارة النظام.
 *   npm run admin:create -- --email admin@example.gov.eg --name "اسم المدير" [--print-link]
 * لا كلمة مؤقتة (H2): رابط تعيين لمرة واحدة لبريد المدير، أو يُطبع في الطرفية مع --print-link.
 */
import { arg, runCreateFirst } from './createFirstUser.js';
import { ORG_IDS } from '../domain.js';

process.exit(await runCreateFirst({
  org: ORG_IDS.admin, role: 'system_admin', email: arg('email')?.trim().toLowerCase(), name: arg('name')?.trim(), phone: arg('phone')?.trim(),
  printLink: process.argv.includes('--print-link'),
}));
