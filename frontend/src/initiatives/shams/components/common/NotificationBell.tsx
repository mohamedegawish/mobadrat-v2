import React, { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { api } from '../../api';
import { store, useStore } from '../../store/state';

/** حدث داخلي: الصفحة بعد وسم إشعار تطلب من الجرس إعادة العدّ فورًا. */
export const INBOX_CHANGED = 'shams:inbox-changed';
export function announceInboxChange(): void { window.dispatchEvent(new Event(INBOX_CHANGED)); }

const POLL_MS = 60_000;

/** عدّاد غير المقروء: استعلام عند الفتح وعند كل تنقل، ودوريًا كل دقيقة (يتوقف والتبويب مخفي). الفشل صامت — الجرس زينة لا مسار حرج. */
export function useUnread(enabled: boolean): number | null {
  const { view } = useStore();
  const [n, setN] = useState<number | null>(null);
  const load = useCallback(async () => {
    if (!enabled || document.hidden) return;
    try { setN((await api.unreadNotifications()).unread); } catch { /* يبقى آخر رقم */ }
  }, [enabled]);
  useEffect(() => { if (!enabled) setN(null); else void load(); }, [enabled, view, load]);
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setInterval(() => { void load(); }, POLL_MS);
    const onChange = () => { void load(); };
    const onVisible = () => { if (!document.hidden) void load(); };
    window.addEventListener(INBOX_CHANGED, onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); window.removeEventListener(INBOX_CHANGED, onChange); document.removeEventListener('visibilitychange', onVisible); };
  }, [enabled, load]);
  return n;
}

export const NotificationBell: React.FC<{ className?: string; onNavigate?: () => void }> = ({ className = 'nav-item', onNavigate }) => {
  const { t, isAr, user, view } = useStore();
  const unread = useUnread(Boolean(user));
  if (!user) return null;
  const label = unread ? t(`الإشعارات — ${unread} غير مقروء`, `Notifications — ${unread} unread`) : t('الإشعارات', 'Notifications');
  return (
    <button type="button" className={`${className}${view === 'notifications' ? ' active' : ''}`} style={{ position: 'relative' }}
      onClick={() => { onNavigate?.(); store.navigate('notifications'); }} aria-label={label} title={label} data-testid="bell">
      <Bell size={15} />
      {unread ? (
        <span data-testid="bell-badge" style={{ position: 'absolute', top: -2, insetInlineEnd: -2, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: 'var(--egypt-red)', color: '#fff', fontSize: 10, fontWeight: 800, lineHeight: '16px', textAlign: 'center' }}>
          {unread > 99 ? '99+' : unread.toLocaleString(isAr ? 'ar-EG' : 'en-US')}
        </span>
      ) : null}
    </button>
  );
};
