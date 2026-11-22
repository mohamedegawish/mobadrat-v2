/**
 * إنشاء حساب مدير النظام (أول حساب في الإنتاج — البذرة ممنوعة هناك).
 *   npm run admin:create -- --email admin@example.gov.eg --name "اسم المدير"
 * تُطبع كلمة مرور مؤقتة مرة واحدة في الطرفية فقط، ويجب تغييرها عند أول دخول.
 */
import { closeDb, getDb } from '../db/sqlite.js';
import { hashPassword } from '../auth/jwt.js';
import { createUser, getUserByEmail } from '../store/users.js';
import { addAuditLog } from '../store/audit.js';
import { isEmail } from '../http/validate.js';
import { tempPassword } from '../services/accounts.js';
import { ORG_IDS } from '../domain.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const email = arg('email')?.trim().toLowerCase();
const name = arg('name')?.trim();
if (!email || !isEmail(email) || !name) {
  console.error('usage: admin:create -- --email <email> --name "<الاسم>"');
  process.exit(1);
}
getDb();
if (getUserByEmail(email)) {
  console.error(`[admin:create] ${email} already exists`);
  closeDb();
  process.exit(1);
}
const password = tempPassword();
const u = createUser({ organizationId: ORG_IDS.admin, role: 'system_admin', email, nameAr: name, passwordHash: hashPassword(password), mustChangePassword: true, emailVerified: true });
addAuditLog({ actorType: 'system', actorName: 'cli', action: 'user.create', entityType: 'user', entityId: u.id, summaryAr: `إنشاء مدير نظام من سطر الأوامر: ${email}` });
closeDb();
console.log(`[admin:create] created ${email}`);
console.log(`Temporary password (shown once, must be changed at first sign-in): ${password}`);
