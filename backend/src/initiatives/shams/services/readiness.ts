/**
 * جاهزية التشغيل (B2) — مصدر واحد للوحة الأدمن و`npm run check:readiness`.
 * كل شرط غير مستوفى = طريق مغلق محتمل: طلب يصل لجهة لا يعمل فيها أحد، أو مصنع لا يجد ما يختاره، أو رسالة لم تصل.
 */
import { getDb } from '../db/database.js';
import { filterSeq } from '../http/helpers.js';
import { config } from '../config.js';
import { ORG_IDS } from '../domain.js';
import { listOrganizations, activeStaffCount, getOrganization } from '../store/organizations.js';
import { listApplications, type AppRow } from '../store/applications.js';
import { NON_TERMINAL_STATES, STATE_LABELS, STATE_RESPONSIBLE, responsibleOrgId } from '../workflow/shamsWorkflow.js';

export interface ReadinessCheck {
  key: string; ok: boolean; labelAr: string; labelEn: string; detailAr: string; detailEn: string;
  items?: Array<{ id: string; labelAr: string; labelEn: string; extraAr?: string; extraEn?: string }>;
}

export interface StuckApplication { id: string; number: string | null; companyName: string; state: AppRow['state']; stateLabelAr: string; stateLabelEn: string; reasonAr: string; reasonEn: string }

/** طلب مفتوح ينتظر جهة لا يوجد فيها مستخدم نشط، أو مصنعًا بلا خيار متاح. */
export async function stuckApplications(): Promise<StuckApplication[]> {
  // PA-04: the open applications only, filtered in SQL (was: the whole table loaded, then filtered here). Same rows, same order.
  const apps = (await listApplications({ scopeSql: '1 = 1', scopeParams: [], states: [...NON_TERMINAL_STATES] }, 1, 1, true)).rows;
  const out: StuckApplication[] = [];
  // PR-P2: the responsible organisations are a handful (IMC, ENCPC, PMU, banks); look each one up once per call instead of
  // two queries per open application (a report: a change made during the call shows on the next one).
  const orgCache = new Map<string, { org: Awaited<ReturnType<typeof getOrganization>>; staff: number }>();
  const orgState = async (orgId: string) => {
    let s = orgCache.get(orgId);
    if (!s) { const org = await getOrganization(orgId); s = { org, staff: org && org.isActive ? await activeStaffCount(orgId) : 0 }; orgCache.set(orgId, s); }
    return s;
  };
  for (const a of apps) {
    let ar = '';
    let en = '';
    const resp = STATE_RESPONSIBLE[a.state];
    if (resp !== 'factory' && resp !== 'none') {
      const orgId = responsibleOrgId(a);
      const st = orgId ? await orgState(orgId) : null;
      const org = st?.org ?? null;
      if (!orgId || !org || !org.isActive || st!.staff === 0) {
        ar = `الجهة المسؤولة (${org?.nameAr ?? 'غير محددة'}) بلا مستخدم نشط`;
        en = `Responsible organization (${org?.nameEn ?? 'unknown'}) has no active user`;
      }
    }
    if (ar) out.push({ id: a.id, number: a.number, companyName: a.companyName, state: a.state, stateLabelAr: STATE_LABELS[a.state].ar, stateLabelEn: STATE_LABELS[a.state].en, reasonAr: ar, reasonEn: en });
  }
  return out;
}

export async function readinessReport() {
  const db = getDb();
  const checks: ReadinessCheck[] = [];
  const structural = [ORG_IDS.imc, ORG_IDS.encpc, ORG_IDS.pmu, ORG_IDS.electricity];
  const orgs = await listOrganizations({});
  // G-02: البنوك جهات خارجية بلا مستخدمين — لا تُحتسب هنا.
  const staffless = await filterSeq(orgs, async (o) => structural.includes(o.id as never) && (await activeStaffCount(o.id)) === 0);
  checks.push({
    key: 'orgs_without_users', ok: staffless.length === 0,
    labelAr: 'كل جهة لها مستخدم نشط', labelEn: 'Every organization has an active user',
    detailAr: staffless.length ? `${staffless.length} جهة بلا مستخدم نشط — أي طلب يصلها لن يراه أحد.` : 'IMC وENCPC وPMU ووزارة الكهرباء لكل منها مستخدم نشط.',
    detailEn: staffless.length ? `${staffless.length} organization(s) without an active user.` : 'IMC, ENCPC, PMU and the Ministry of Electricity each have an active user.',
    items: staffless.map((o) => ({ id: o.id, labelAr: o.nameAr, labelEn: o.nameEn })),
  });
  const banks = orgs.filter((o) => o.type === 'bank' && o.isActive);
  checks.push({
    key: 'banks_available', ok: banks.length > 0,
    labelAr: 'بنك متاح واحد على الأقل', labelEn: 'At least one available bank',
    detailAr: banks.length ? `${banks.length} بنك نشط (يظهر للمصنع للاختيار بعد قبول موافقة الكهرباء).` : 'لا يوجد بنك نشط — لن يستطيع أي مصنع اختيار بنك بعد قبول موافقة الكهرباء.',
    detailEn: banks.length ? `${banks.length} active bank(s) offered to factories.` : 'No active bank — factories cannot choose a bank after the electricity approval.',
  });
  const stuck = await stuckApplications();
  checks.push({
    key: 'stuck_applications', ok: stuck.length === 0,
    labelAr: 'لا توجد طلبات عالقة', labelEn: 'No stuck applications',
    detailAr: stuck.length ? `${stuck.length} طلب ينتظر جهة أو خيارًا غير متاح.` : 'كل الطلبات المفتوحة لها من يعمل عليها.',
    detailEn: stuck.length ? `${stuck.length} application(s) waiting on an unavailable party.` : 'Every open application has someone to act on it.',
    items: stuck.map((s) => ({ id: s.id, labelAr: `${s.number ?? 'مسودة'} — ${s.companyName}`, labelEn: `${s.number ?? 'Draft'} — ${s.companyName}`, extraAr: s.reasonAr, extraEn: s.reasonEn })),
  });
  const failed = (await db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE status = 'failed' AND initiativeId = 'shams'").get() as { n: number }).n;
  checks.push({
    key: 'failed_notifications', ok: failed === 0,
    labelAr: 'لا توجد رسائل فاشلة', labelEn: 'No failed messages',
    detailAr: failed ? `${failed} رسالة فشل إرسالها بعد كل المحاولات — راجع «سجل الإشعارات».` : 'لا توجد رسائل فاشلة.',
    detailEn: failed ? `${failed} message(s) failed after all retries.` : 'No failed messages.',
  });
  const registryApi = config.registryAdapter === 'http' && Boolean(config.registryApiUrl);
  checks.push({
    key: 'registry_api', ok: registryApi,
    labelAr: 'خدمة السجل الصناعي مربوطة', labelEn: 'Industrial registry service connected',
    detailAr: registryApi ? 'رقم السجل يُتحقق منه آليًا عند الإرسال.'
      : config.registryAdapter === 'manual' ? 'تحقق يدوي (REGISTRY_ADAPTER=manual): IMC تراجع رقم السجل على «شهادة السجل الصناعي» المرفوعة مع كل طلب، حتى يُربط API السجل.'
        : 'REGISTRY_API_URL غير مضبوط — لا يمكن التحقق من السجل ولا تسجيل المصانع (اضبطه، أو REGISTRY_ADAPTER=manual للتحقق اليدوي).',
    detailEn: registryApi ? 'Registry numbers are verified automatically on submission.'
      : config.registryAdapter === 'manual' ? 'Manual verification: IMC checks each number against the uploaded certificate until the registry API is connected.'
        : 'REGISTRY_API_URL is not set — factories cannot register (set it, or REGISTRY_ADAPTER=manual).',
  });
  const support = Boolean(config.supportEmail && config.supportPhone);
  checks.push({
    key: 'support_contact', ok: support,
    labelAr: 'قناة استفسار رسمية مضبوطة', labelEn: 'Official support channel configured',
    detailAr: support ? 'SUPPORT_EMAIL وSUPPORT_PHONE مضبوطان ويظهران في الموقع والبريد.' : 'SUPPORT_EMAIL أو SUPPORT_PHONE غير مضبوط — المصنع لا يعرف كيف يستفسر أو يعترض.',
    detailEn: support ? 'SUPPORT_EMAIL and SUPPORT_PHONE are set.' : 'SUPPORT_EMAIL or SUPPORT_PHONE is missing.',
  });
  const skipped = (await db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE status = 'skipped' AND initiativeId = 'shams'").get() as { n: number }).n;
  const pending = (await db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE status IN ('pending','sending') AND initiativeId = 'shams'").get() as { n: number }).n;
  return {
    ok: checks.every((c) => c.ok),
    checks,
    stuck,
    notifications: { failed, skipped, pending },
    generatedAt: new Date().toISOString(),
  };
}
