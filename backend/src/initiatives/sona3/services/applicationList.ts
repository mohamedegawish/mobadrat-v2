/**
 * قائمة الطلبات لدور المستخدم — مصدر واحد لـ GET /applications (قائمة العمل) وللوحة المنصة الموحدة (workspace.ts):
 * نفس النطاق (listScope) ونفس «بانتظاري» و«متأخر» (isMineFor / slaInfo)، فيتطابق كل رقم مع عدد صفوف قائمته.
 */
import { mapSeq, paginate } from '../http/helpers.js';
import { listApplications } from '../store/applications.js';
import { listScope } from '../access/visibility.js';
import { buildListItem, isMineFor, slaInfo } from '../workflow/applicationView.js';
import { APPLICATION_STATES, type ApplicationState } from '../workflow/workflow.js';
import type { UserInternal } from '../store/users.js';

export interface ListQuery {
  page: number;
  pageSize: number;
  q?: string;
  states?: ApplicationState[];
  /** «بانتظار قراري» — الأقدم انتظارًا أولًا. */
  mine?: boolean;
  overdue?: boolean;
  /** score = الأعلى درجة أولًا؛ oldest = الأقدم في المرحلة أولًا. */
  sort?: string;
  cohortId?: string;
  sector?: string;
  governorate?: string;
  funderOrgId?: string;
  from?: string;
  to?: string;
}

/** «A,B» → حالات معروفة فقط (قيمة غير معروفة تُتجاهل، لا فلتر مختلق). */
export function parseStates(raw: unknown): ApplicationState[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const list = raw.split(',').map((s) => s.trim()).filter((s): s is ApplicationState => (APPLICATION_STATES as readonly string[]).includes(s));
  return list.length ? list : undefined;
}

/** عدد المسودات غير المُرسلة (يُعرض منفصلًا عن قائمة العمل لـ IMC والأدمن). */
export async function draftsCount(user: UserInternal, scope = listScope(user)): Promise<number | undefined> {
  if (user.role !== 'imc_officer' && user.role !== 'system_admin') return undefined;
  return (await listApplications({ scopeSql: scope.sql, scopeParams: scope.params, includeDrafts: true, states: ['DRAFT'] }, 1, 1)).total;
}

export async function listForUser(user: UserInternal, f: ListQuery) {
  const scope = listScope(user);
  const { page, pageSize, states } = f;
  const mine = Boolean(f.mine);
  // المسودات غير المُرسلة لا تظهر في قوائم IMC والأدمن إلا بطلب صريح (state=DRAFT).
  const includeDrafts = scope.includeDrafts && (user.role === 'applicant' || Boolean(states?.includes('DRAFT')));
  const computed = Boolean(f.overdue) || mine;
  const { rows, total } = await listApplications({
    scopeSql: scope.sql, scopeParams: scope.params, includeDrafts,
    q: f.q, states, oldestFirst: mine || f.sort === 'oldest', byScore: f.sort === 'score',
    cohortId: f.cohortId, sector: f.sector, governorate: f.governorate, funderOrgId: f.funderOrgId, from: f.from, to: f.to,
  }, page, pageSize, computed);
  if (computed) {
    // «بانتظاري» / «متأخر» are computed, not columns: every row in scope is filtered by the two flags (no query each — the same
    // functions the list item uses), then the full item (cohort, funder and responsible lookups) is built for the requested
    // page only. Building it for every row first cost ~3 queries × every application in scope: 5.7 s per IMC request under
    // load with 900 applications (perf/ load test). Same rows, order and totals as before.
    const selected = rows.filter((a) => (!f.overdue || slaInfo(a).overdue) && (!mine || isMineFor(user, a)));
    const items = await mapSeq(selected.slice((page - 1) * pageSize, page * pageSize), async (a) => await buildListItem(user, a));
    return { ...paginate(items, selected.length, page, pageSize), draftsCount: await draftsCount(user, scope) };
  }
  const items = await mapSeq(rows, async (a) => await buildListItem(user, a));
  return { ...paginate(items, total, page, pageSize), draftsCount: await draftsCount(user, scope) };
}
