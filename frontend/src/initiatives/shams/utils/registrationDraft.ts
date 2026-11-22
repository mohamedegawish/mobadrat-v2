/**
 * مسودة صفحة التسجيل في المتصفح، حتى لا يضيع ما أدخله المصنع عند تحديث الصفحة أو إغلاقها قبل إنشاء الحساب.
 * - البيانات النصية والخطوة الحالية: localStorage. كلمة المرور لا تُحفظ أبدًا.
 * - المستندات: IndexedDB (ملفات حقيقية تتحمل أحجامًا كبيرة) حتى «إنشاء الحساب»، فتُرفع مع التسجيل وتُمسح من المتصفح.
 * كل وصول للتخزين داخل try/catch: وضع التصفح الخاص أو تعطيل التخزين يعني فقط «لا حفظ محلي»، لا تعطل الصفحة.
 */
import type { FormSection } from '../api';

const TEXT_KEY = 'shams.registerDraft.v1';
const DONE_KEY = 'shams.registerDone.v1';
const DB_NAME = 'shams-register';
const STORE = 'files';

export interface RegisterTextDraft {
  step: number;
  form: Partial<Record<FormSection, Record<string, unknown>>>;
  savedAt: string;
}

export function loadTextDraft(): RegisterTextDraft | null {
  try {
    const raw = localStorage.getItem(TEXT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as RegisterTextDraft;
    return d && typeof d === 'object' && d.form ? d : null;
  } catch { return null; }
}

export function saveTextDraft(d: Omit<RegisterTextDraft, 'savedAt'>): void {
  try { localStorage.setItem(TEXT_KEY, JSON.stringify({ ...d, savedAt: new Date().toISOString() })); } catch { /* storage unavailable */ }
}

export function clearTextDraft(): void {
  try { localStorage.removeItem(TEXT_KEY); } catch { /* storage unavailable */ }
}

/** بعد إنشاء الحساب: البريد الذي أُرسل إليه رابط التفعيل (تبقى شاشة «راجع بريدك» بعد التحديث). */
export function loadDone(): string | null { try { return localStorage.getItem(DONE_KEY); } catch { return null; } }
export function saveDone(email: string): void { try { localStorage.setItem(DONE_KEY, email); } catch { /* storage unavailable */ } }
export function clearDone(): void { try { localStorage.removeItem(DONE_KEY); } catch { /* storage unavailable */ } }

// ── المستندات (IndexedDB) ──

export interface LocalFile {
  id: string;
  kind: string;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  addedAt: string;
  /** بريد الحساب بعد إنشائه (يُعرض الملف بعد الدخول بهذا البريد فقط). null = ما زال في صفحة التسجيل. */
  owner: string | null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tr = db.transaction(STORE, mode);
      const r = fn(tr.objectStore(STORE));
      let value: T | undefined;
      if (r) r.onsuccess = () => { value = r.result; };
      tr.oncomplete = () => resolve(value);
      tr.onerror = () => reject(tr.error);
      tr.onabort = () => reject(tr.error);
    });
  } finally { db.close(); }
}

/** هل يدعم المتصفح حفظ الملفات محليًا؟ */
export async function localFilesAvailable(): Promise<boolean> {
  try { await withStore('readonly', (s) => s.count()); return true; } catch { return false; }
}

export async function listLocalFiles(owner: string | null): Promise<LocalFile[]> {
  try {
    const all = (await withStore<LocalFile[]>('readonly', (s) => s.getAll() as IDBRequest<LocalFile[]>)) ?? [];
    const want = owner?.toLowerCase() ?? null;
    return all.filter((f) => (f.owner?.toLowerCase() ?? null) === want).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  } catch { return []; }
}

export async function addLocalFile(kind: string, file: File, owner: string | null = null): Promise<LocalFile> {
  const rec: LocalFile = {
    id: `lf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind, name: file.name, type: file.type || 'application/pdf', size: file.size, blob: file, addedAt: new Date().toISOString(), owner,
  };
  await withStore('readwrite', (s) => { s.put(rec); });
  return rec;
}

export async function removeLocalFile(id: string): Promise<void> {
  try { await withStore('readwrite', (s) => { s.delete(id); }); } catch { /* already gone */ }
}

export async function clearLocalFiles(owner: string | null): Promise<void> {
  for (const f of await listLocalFiles(owner)) await removeLocalFile(f.id);
}

export function toFile(f: LocalFile): File {
  return new File([f.blob], f.name, { type: f.type || 'application/pdf' });
}
