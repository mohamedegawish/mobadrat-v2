/**
 * قائمة الطلبات لدور المستخدم — مصدر واحد لـ GET /applications (قائمة العمل) وللوحة المنصة الموحدة (workspace.ts):
 * نفس النطاق (listScope) ونفس «بانتظاري» و«متأخر» (listFlags)، فيتطابق كل رقم مع عدد صفوف قائمته.
 */
import { mapSeq, paginate } from '../http/helpers.js';
import { listApplications } from '../store/applications.js';
import { listScope } from '../access/visibility.js';
import { buildListItem, listFlags, preloadListOrgs } from '../workflow/applicationView.js';
import { APPLICATION_STATES, NON_TERMINAL_STATES, type ApplicationState } from '../workflow/shamsWorkflow.js';
import type { UserInternal } from '../store/users.js';

export interface ListQuery {
  page: number;
  pageSize: number;
  q?: string;
  states?: ApplicationState[];
  /** «بانتظار قراري» — الأقدم انتظارًا أولًا. */
  mine?: boolean;
  overdue?: boolean;
  sort?: string;
  governorate?: string;
  bankOrgId?: string;
  from?: string;
  to?: string;
}

/** «A,B» → حالات معروفة فقط (قيمة غير معروفة تُتجاهل، لا فلتر مختلق). */
export function parseStates(raw: unknown): ApplicationState[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const list = raw.split(',').map((s) => s.trim()).filter((s): s is ApplicationState => (APPLICATION_STATES as readonly string[]).includes(s));
  return list.length ? list : undefined;
}

/** عدد المسودات غير المُرسلة (يُعرض منفصلًا عن قائمة العمل لـ PMU والأدمن). */
export async function draftsCount(user: UserInternal, scope = listScope(user)): Promise<number | undefined> {
  if (user.role !== 'pmu_reviewer' && user.role !== 'system_admin') return undefined;
  return (await listApplications({ scopeSql: scope.sql, scopeParams: scope.params, includeDrafts: true, states: ['DRAFT'] }, 1, 1)).total;
}

export async function listForUser(user: UserInternal, f: ListQuery) {
  const scope = listScope(user);
  const { page, pageSize, states } = f;
  const flagged = Boolean(f.overdue || f.mine);
  // PA-04: "awaiting me" and "overdue" can only be true for a non-terminal application, so those lists load just those rows
  // (the requested states, if any, narrowed to them) instead of every application in scope. Same rows, order and totals.
  const loadStates = flagged ? (states ?? APPLICATION_STATES).filter((s) => NON_TERMINAL_STATES.includes(s)) : states;
  if (flagged && loadStates!.length === 0) return { ...paginate([] as Awaited<ReturnType<typeof buildListItem>>[], 0, page, pageSize), draftsCount: await draftsCount(user, scope) };
  // M5: المسودات غير المُرسلة لا تظهر في قوائم عمل PMU والأدمن إلا بطلب صريح (state=DRAFT)، وتبقى في عدّ منفصل.
  const includeDrafts = scope.includeDrafts && (user.role === 'factory_owner' || Boolean(states?.includes('DRAFT')));
  const { rows, total } = await listApplications({
    scopeSql: scope.sql, scopeParams: scope.params, includeDrafts,
    q: f.q, states: loadStates, oldestFirst: Boolean(f.mine) || f.sort === 'oldest',
    governorate: f.governorate, bankOrgId: f.bankOrgId, from: f.from, to: f.to,
  }, page, pageSize, flagged);
  // التأخر و«بانتظاري» محسوبان (لا أعمدة) — يُفلتر بعد الحساب ثم يُقسَّم لصفحات.
  // PERF-3: the filter needs only listFlags (the same values buildListItem puts in isMine/overdue), so the full list item —
  // with its organization lookups — is built for the requested page only, not for every row in scope (was 750 org queries
  // and ~350 ms of CPU per IMC request with ?mine=1). The page's organizations are loaded in one query.
  if (flagged) {
    const flags = await mapSeq(rows, (a) => listFlags(user, a));
    const selected = rows.filter((_, i) => (!f.overdue || flags[i].overdue) && (!f.mine || flags[i].isMine));
    const pageRows = selected.slice((page - 1) * pageSize, page * pageSize);
    const orgs = await preloadListOrgs(pageRows);
    const items = await mapSeq(pageRows, (a) => buildListItem(user, a, orgs));
    return { ...paginate(items, selected.length, page, pageSize), draftsCount: await draftsCount(user, scope) };
  }
  const orgs = await preloadListOrgs(rows);
  const items = await mapSeq(rows, (a) => buildListItem(user, a, orgs));
  return { ...paginate(items, total, page, pageSize), draftsCount: await draftsCount(user, scope) };
}
