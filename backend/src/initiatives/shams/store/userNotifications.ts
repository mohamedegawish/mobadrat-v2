/**
 * In-app inbox — the platform's single inbox, scoped to this initiative. Every read/update is limited to the row owner.
 * Links stored here are relative to this module's screens; the platform bell prefixes them with i/<module>/.
 */
import * as core from '../../../core/store/userNotifications.js';
import { MODULE_ID } from '../config.js';

export type UserNotification = core.UserNotification;

export function insertUserNotification(n: { userId: string; applicationId?: string | null; templateKey: string; title: string; body: string; link: string; dedupeKey: string }): Promise<boolean> {
  return core.insertUserNotification({ ...n, initiativeId: MODULE_ID });
}

export function listUserNotifications(userId: string, f: { unreadOnly?: boolean }, page: number, pageSize: number): Promise<{ rows: UserNotification[]; total: number }> {
  return core.listUserNotifications(userId, { ...f, initiativeId: MODULE_ID }, page, pageSize);
}

export function unreadCount(userId: string): Promise<number> {
  return core.unreadCount(userId, MODULE_ID);
}

export function markRead(userId: string, id: string): Promise<'marked' | 'already' | 'not_found'> {
  return core.markRead(userId, id);
}

export function markAllRead(userId: string): Promise<number> {
  return core.markAllRead(userId, MODULE_ID);
}
