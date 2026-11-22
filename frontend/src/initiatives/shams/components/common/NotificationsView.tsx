import React, { useState } from 'react';
import { BellRing, CheckCheck } from 'lucide-react';
import { api, type InboxNotification } from '../../api';
import { canView, errorText, store, useStore, VIEW_ACCESS, type View } from '../../store/state';
import { useAsync, formatDate, formatNumber } from '../../hooks/useAsync';
import { Loading, Empty, ErrorState } from './StateViews';
import { useToast } from './ToastSystem';
import { announceInboxChange } from './NotificationBell';

const LINK_RE = /^([a-z][a-z-]*)(?:\/([A-Za-z0-9_%-]{1,80}))?$/;

/** مسار الإشعار → وجهة داخلية، فقط إن كانت شاشة معروفة ومسموحة لدور المستخدم. غير ذلك لا تنقّل (الإشعار يُقرأ فقط). */
function resolveLink(link: string, user: Parameters<typeof canView>[1]): { view: View; param: string | null } | null {
  const m = LINK_RE.exec(link);
  if (!m || !Object.prototype.hasOwnProperty.call(VIEW_ACCESS, m[1])) return null;
  const view = m[1] as View;
  if (VIEW_ACCESS[view] === 'public' || VIEW_ACCESS[view] === 'guest' || !canView(view, user)) return null;
  let param: string | null = null;
  if (m[2]) { try { param = decodeURIComponent(m[2]); } catch { return null; } }
  return { view, param };
}

/** صندوق الإشعارات: كل ما وصل المستخدم (يطابق البريد/SMS)، مع غير المقروء، والنقر يفتح الطلب المعني. */
export const NotificationsView: React.FC = () => {
  const { isAr, t, user } = useStore();
  const { toast } = useToast();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const res = useAsync(() => api.notifications({ page, pageSize: 20, unread: unreadOnly ? '1' : undefined }), [page, unreadOnly]);
  const d = res.data;

  const open = async (n: InboxNotification) => {
    if (!n.read) {
      try { await api.markNotificationRead(n.id); announceInboxChange(); } catch (e) { toast('error', errorText(e, isAr)); return; }
    }
    const target = resolveLink(n.link, user);
    if (target) store.navigate(target.view, target.param); else await res.reload();
  };

  const readAll = async () => {
    setBusy(true);
    try { await api.markAllNotificationsRead(); announceInboxChange(); await res.reload(); } catch (e) { toast('error', errorText(e, isAr)); } finally { setBusy(false); }
  };

  return (
    <div className="container-custom page">
      <div className="page-head">
        <div>
          <h1 className="page-title"><BellRing size={20} style={{ verticalAlign: '-3px' }} /> {t('الإشعارات', 'Notifications')}</h1>
          <p className="page-sub">{t('ما يصلك من البريد والرسائل القصيرة يظهر هنا أيضًا، فلا يفوتك قرار إن لم يصل البريد.', 'Everything sent by email or SMS also appears here, so you never miss a decision if the email does not arrive.')}</p>
        </div>
        <div className="row" style={{ gap: '0.5rem' }}>
          <label className="row" style={{ gap: '0.4rem', fontSize: '0.86rem' }}>
            <input type="checkbox" checked={unreadOnly} onChange={(e) => { setUnreadOnly(e.target.checked); setPage(1); }} data-testid="unread-only" /> {t('غير المقروء فقط', 'Unread only')}
          </label>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void readAll()} disabled={busy || !d?.unread} data-testid="read-all"><CheckCheck size={14} /> {t('وسم الكل مقروءًا', 'Mark all read')}</button>
        </div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {res.loading && !d ? <div style={{ padding: '1rem' }}><Loading variant="table" /></div> : res.error || !d ? <ErrorState message={res.error} onRetry={res.reload} />
          : !d.items.length ? <Empty title={unreadOnly ? t('لا توجد إشعارات غير مقروءة', 'No unread notifications') : t('لا توجد إشعارات بعد', 'No notifications yet')} /> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="inbox-list">
              {d.items.map((n) => {
                const target = resolveLink(n.link, user);
                return (
                  <li key={n.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <button type="button" onClick={() => void open(n)} data-testid={`inbox-${n.id}`} data-read={n.read ? '1' : '0'}
                      style={{ display: 'block', width: '100%', textAlign: 'start', padding: '0.85rem 1.1rem', background: n.read ? 'transparent' : 'var(--egypt-red-soft, #FEF2F2)', border: 0, cursor: 'pointer' }}>
                      <div className="row" style={{ justifyContent: 'space-between', gap: '0.6rem', alignItems: 'flex-start' }}>
                        <span style={{ fontWeight: n.read ? 600 : 800 }}>{!n.read ? <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: 'var(--egypt-red)', marginInlineEnd: 6 }} /> : null}{n.title}</span>
                        <span className="doc-meta" style={{ whiteSpace: 'nowrap' }}>{formatDate(n.createdAt, isAr, true)}</span>
                      </div>
                      {n.body ? <div className="doc-meta" style={{ marginTop: 2 }}>{n.body}</div> : null}
                      {target ? <div className="doc-meta" style={{ marginTop: 2, color: 'var(--egypt-red)' }}>{t('اضغط لفتح الطلب', 'Click to open')}</div> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
      </div>
      {d && d.totalPages > 1 ? (
        <div className="row" style={{ justifyContent: 'center', marginTop: '0.8rem' }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('السابق', 'Previous')}</button>
          <span style={{ fontSize: '0.85rem' }}>{formatNumber(page, isAr)} / {formatNumber(d.totalPages, isAr)}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={page >= d.totalPages} onClick={() => setPage(page + 1)}>{t('التالي', 'Next')}</button>
        </div>
      ) : null}
    </div>
  );
};
