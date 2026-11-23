/**
 * The platform dashboard of a user type: one page for every initiative in which the person holds that kind of role
 * (IMC in Shams and in Sona3 → one «IMC» dashboard). Each initiative computes its own part (module.workspace) for the
 * actor its router would have resolved; the platform sums the headline figures and merges the queues.
 *
 *   GET /me/workspace/:type?i=<initiative|all>&tab=mine|all|overdue|monitoring|readiness&page&pageSize&q&state&sort&from&to&<module filters>
 *
 * Only the caller's own active memberships count (a platform super_admin is the system admin of every module without
 * one, as in moduleAuth). One initiative failing never blanks the page: its part carries the error instead.
 */
import { Router } from 'express';
import { ah, AppError, Errors, okMessage } from '../http/errors.js';
import { normPage, normPageSize, str } from '../http/helpers.js';
import { coreUserOf } from '../middleware/auth.js';
import { listMembershipsOfUser, type Membership } from '../store/memberships.js';
import type { CoreUser } from '../store/users.js';
import { getCatalogByModule } from '../catalog/initiatives.js';
import { MODULES } from '../../initiatives/registry.js';
import {
  WORKSPACE_TABS, WORKSPACE_TYPES, type InitiativeModule, type ModuleWorkspace, type UserType, type WorkspaceQuery, type WorkspaceRow, type WorkspaceTab,
} from '../../initiatives/contract.js';

export const workspaceRouter = Router();

/** With «all initiatives», each initiative's queue is loaded up to this many rows, then merged (the page says when capped). */
export const MERGED_QUEUE_CAP = 50;

/** Query keys of the page itself; any other key is a module filter (the module keeps only the ones it declared). */
const RESERVED = new Set(['i', 'tab', 'page', 'pageSize', 'q', 'state', 'sort', 'from', 'to']);

export interface WorkspaceEntry { module: InitiativeModule; membership: Membership | null; role: string; type: UserType }

/** The person's dashboards: one entry per initiative where a role of theirs has a platform dashboard. */
export async function workspaceEntries(user: CoreUser): Promise<WorkspaceEntry[]> {
  const memberships = await listMembershipsOfUser(user.id);
  const out: WorkspaceEntry[] = [];
  for (const mod of MODULES) {
    if (!mod.workspace) continue;
    const m = memberships.find((x) => x.initiativeId === mod.id);
    if (m) {
      if (m.status !== 'active') continue;
      const type = mod.roles.find((r) => r.key === m.role)?.userType;
      if (type && WORKSPACE_TYPES.includes(type)) out.push({ module: mod, membership: m, role: m.role, type });
    } else if (user.platformRole === 'super_admin') {
      out.push({ module: mod, membership: null, role: mod.adminRole, type: 'system_admin' });
    }
  }
  return out;
}

function errorOf(e: unknown): { code: string; messageAr: string; messageEn: string } {
  if (e instanceof AppError) return { code: e.code, messageAr: e.messageAr, messageEn: e.messageEn };
  console.warn('[workspace] an initiative part failed:', e);
  return { code: 'UNAVAILABLE', messageAr: 'تعذر تحميل بيانات هذه المبادرة الآن.', messageEn: 'This initiative\'s data could not be loaded right now.' };
}

workspaceRouter.get('/me/workspace/:type', ah(async (req, res) => {
  const user = coreUserOf(req);
  const type = req.params.type as UserType;
  if (!WORKSPACE_TYPES.includes(type)) throw Errors.notFound('لوحة غير معروفة.', 'Unknown dashboard.');
  const entries = (await workspaceEntries(user)).filter((e) => e.type === type);
  if (!entries.length) throw Errors.forbidden('هذه اللوحة غير متاحة لحسابك.', 'This dashboard is not available for your account.');

  const only = str(req.query.i);
  const selected = only && only !== 'all' ? entries.filter((e) => e.module.id === only) : entries;
  if (!selected.length) throw Errors.notFound('المبادرة غير موجودة في لوحتك.', 'This initiative is not on your dashboard.');
  const merged = selected.length > 1;

  const rawTab = str(req.query.tab) as WorkspaceTab;
  const tab: WorkspaceTab = WORKSPACE_TABS.includes(rawTab) && (rawTab !== 'readiness' || type === 'system_admin')
    ? rawTab : type === 'system_admin' ? 'readiness' : 'mine';
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 20, 100);
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (RESERVED.has(k) || typeof v !== 'string' || !v || !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k)) continue;
    if (Object.keys(filters).length < 10) filters[k] = v.slice(0, 100);
  }
  // A state or module filter belongs to one initiative: with «all», only what every initiative understands is passed on.
  const query: WorkspaceQuery = {
    tab, page: merged ? 1 : page, pageSize: merged ? MERGED_QUEUE_CAP : pageSize,
    q: str(req.query.q).trim().slice(0, 100) || undefined, sort: str(req.query.sort) || undefined,
    from: str(req.query.from) || undefined, to: str(req.query.to) || undefined,
    state: merged ? undefined : str(req.query.state) || undefined, filters: merged ? {} : filters,
  };

  const settled = await Promise.allSettled(selected.map(async (e) => {
    const actor = await e.module.resolveActor(user, e.membership);
    if (!actor) throw Errors.forbidden('لا يمكنك الدخول على هذه المبادرة.', 'You cannot access this initiative.');
    return await e.module.workspace!(actor, query);
  }));

  const catalog = new Map(await Promise.all(entries.map(async (e) => [e.module.id, await getCatalogByModule(e.module.id)] as const)));
  const info = (e: WorkspaceEntry) => {
    const cat = catalog.get(e.module.id);
    const role = e.module.roles.find((r) => r.key === e.role);
    return {
      initiativeId: e.module.id, slug: cat?.slug ?? e.module.id, titleAr: cat?.titleAr ?? e.module.titleAr, titleEn: cat?.titleEn ?? e.module.titleEn,
      themeColor: cat?.themeColor ?? '#0B2545', role: e.role, roleLabelAr: role?.labelAr ?? e.role, roleLabelEn: role?.labelEn ?? e.role,
      viaPlatformAdmin: !e.membership,
    };
  };

  const totals = { awaitingMe: 0, overdue: 0, open: 0, total: 0 };
  const rows: Array<WorkspaceRow & { initiativeId: string }> = [];
  let queueTotal = 0;
  const capped: string[] = [];
  let single: ModuleWorkspace['queue'] | undefined;
  const parts = selected.map((e, i) => {
    const r = settled[i];
    if (r.status === 'rejected') return { ...info(e), ok: false as const, error: errorOf(r.reason) };
    const { queue, ...data } = r.value;
    totals.awaitingMe += data.awaitingMe; totals.overdue += data.overdue; totals.open += data.open; totals.total += data.total;
    if (queue) {
      rows.push(...queue.items.map((it) => ({ ...it, initiativeId: e.module.id })));
      queueTotal += queue.total;
      if (queue.total > queue.items.length && merged) capped.push(e.module.id);
      if (!merged) single = queue;
    }
    return { ...info(e), ok: true as const, data };
  });

  let queue = null;
  if (['mine', 'all', 'overdue'].includes(tab)) {
    if (!merged && single) {
      queue = { ...single, items: rows, capped: [] as string[] };
    } else {
      // Longest-waiting first for «awaiting my decision» / «overdue» (and on request); otherwise the latest stage entries first.
      const oldest = tab !== 'all' || query.sort === 'oldest';
      rows.sort((a, b) => (oldest ? 1 : -1) * (Date.parse(a.enteredAt) - Date.parse(b.enteredAt)));
      const shown = rows.length;
      queue = {
        items: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize,
        total: queueTotal, loaded: shown, totalPages: Math.max(1, Math.ceil(shown / pageSize)), capped,
      };
    }
  }

  return okMessage(res, 200, 'ok', {
    type, tab, initiative: merged ? 'all' : selected[0].module.id, merged,
    initiatives: entries.map(info),
    totals, parts, queue,
    generatedAt: new Date().toISOString(),
  });
}));
