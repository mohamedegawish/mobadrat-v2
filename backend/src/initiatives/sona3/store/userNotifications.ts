/**
 * In-app inbox — the platform's single inbox, scoped to this initiative. Every read/update is limited to the row owner.
 * Links stored here are relative to this module's screens; the platform bell prefixes them with i/<module>/.
 */
import * as core from '../../../core/store/userNotifications.js';
import { MODULE_ID } from '../config.js';

export type UserNotification = core.UserNotification;

export async function insertUserNotification(n: { userId: string; applicationId?: string | null; templateKey: string; title: string; body: string; link: string; dedupeKey: string }): Promise<boolean> {
  return await core.insertUserNotification({ ...n, initiativeId: MODULE_ID });
}

export async function listUserNotifications(userId: string, f: { unreadOnly?: boolean }, page: number, pageSize: number): Promise<{ rows: UserNotification[]; total: number }> {
  return await core.listUserNotifications(userId, { ...f, initiativeId: MODULE_ID }, page, pageSize);
}

export async function unreadCount(userId: string): Promise<number> {
  return await core.unreadCount(userId, MODULE_ID);
}

export async function markRead(userId: string, id: string): Promise<'marked' | 'already' | 'not_found'> {
  return await core.markRead(userId, id);
}

export async function markAllRead(userId: string): Promise<number> {
  return await core.markAllRead(userId, MODULE_ID);
}
