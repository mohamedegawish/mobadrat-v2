import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { usePlatformStore } from '../../store/state';
import { api } from '../../platform/api';
import { store as platform } from '../../platform/store';

// إشعارات الحساب داخل زر الحساب في الهيدر — بلا أي عنصر إضافي يغيّر عرض الشريط العلوي.
// UnreadBadge: عداد صغير فوق الصورة الرمزية · AccountNotifications: قسم «الإشعارات» داخل قائمة الحساب.

type Item = { id: string; initiativeId: string | null; title: string; body: string; link: string; readAt: string | null; createdAt: string };

function relativeTime(iso: string, isAr: boolean): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (!Number.isFinite(mins)) return '';
  if (mins < 1) return isAr ? 'الآن' : 'now';
  if (mins < 60) return isAr ? `منذ ${mins} د` : `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return isAr ? `منذ ${h} س` : `${h}h`;
  const d = Math.round(h / 24);
  return isAr ? `منذ ${d} يوم` : `${d}d`;
}

/** Red count bubble on the account avatar (renders nothing when there is nothing unread). */
export const UnreadBadge: React.FC = () => {
  const { me } = usePlatformStore();
  const total = me?.unreadTotal ?? 0;
  if (total === 0) return null;
  return (
    <span
      className="pf-count"
      data-testid="header-unread"
      aria-label={`${total}`}
      style={{
        position: 'absolute', top: '-6px', insetInlineEnd: '-8px',
        minWidth: '17px', height: '17px', padding: '0 4px', borderRadius: '999px',
        background: 'var(--egypt-red)', color: '#FFFFFF', border: '2px solid #FFFFFF',
        fontSize: '0.6rem', fontWeight: 800, lineHeight: '13px', textAlign: 'center',
        boxSizing: 'border-box',
      }}
    >
      {total > 99 ? '99+' : total}
    </span>
  );
};

const rowStyle = (isAr: boolean): React.CSSProperties => ({
  width: '100%', padding: '0.55rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.65rem',
  borderRadius: 'var(--radius-md)', border: 'none', background: 'transparent', cursor: 'pointer',
  textAlign: isAr ? 'right' : 'left',
});

/** «الإشعارات» section inside the account dropdown — the latest unread notifications of every initiative. */
export const AccountNotifications: React.FC<{ onNavigate: () => void }> = ({ onNavigate }) => {
  const { language, me } = usePlatformStore();
  const isAr = language === 'ar';
  const total = me?.unreadTotal ?? 0;
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    if (!total) { setItems([]); return; }
    let live = true;
    api.notifications(1, true).then(d => { if (live) setItems(d.items.slice(0, 4)); }).catch(() => undefined);
    return () => { live = false; };
  }, [total]);

  const open = async (n?: Item) => {
    onNavigate();
    if (!n) { platform.go('notifications'); return; }
    if (!n.readAt) await api.markRead(n.id).catch(() => undefined);
    void platform.reloadMe();
    platform.go(n.link || 'notifications');
  };

  return (
    <div style={{ padding: '0.4rem', borderBottom: '1px solid #EAECF0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.35rem 0.85rem 0.25rem' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem', fontWeight: 800, color: '#64748B' }}>
          <Bell size={13} />
          {isAr ? 'الإشعارات' : 'Notifications'}
        </span>
        {total > 0 && (
          <span style={{ fontSize: '0.66rem', fontWeight: 800, padding: '0.1rem 0.45rem', borderRadius: '999px', background: 'var(--egypt-red-soft)', color: 'var(--egypt-red)', border: '1px solid var(--gov-gold-border)' }}>
            {isAr ? `${total} جديدة` : `${total} new`}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <div style={{ padding: '0.35rem 0.85rem 0.55rem', fontSize: '0.75rem', color: '#94A3B8' }}>
          {isAr ? 'لا توجد إشعارات جديدة.' : 'No new notifications.'}
        </div>
      ) : items.map(n => (
        <button key={n.id} type="button" onClick={() => void open(n)} style={rowStyle(isAr)} className="header-notif-row">
          <span style={{ width: '30px', height: '30px', borderRadius: '8px', flexShrink: 0, background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <Bell size={14} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#101828', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.title}</span>
              <span style={{ fontSize: '0.66rem', color: '#94A3B8', flexShrink: 0 }}>{relativeTime(n.createdAt, isAr)}</span>
            </span>
            <span style={{ display: 'block', fontSize: '0.72rem', color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {n.body}
            </span>
          </span>
        </button>
      ))}

      <button type="button" onClick={() => void open()} style={{ ...rowStyle(isAr), padding: '0.6rem 0.85rem', color: '#101828', fontSize: '0.825rem', fontWeight: 600 }} className="header-notif-row" data-testid="header-notifications">
        <Bell size={15} style={{ color: '#475569' }} />
        <span style={{ flex: 1 }}>{isAr ? 'كل الإشعارات' : 'All notifications'}</span>
      </button>
    </div>
  );
};
