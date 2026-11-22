import { getDb, nowIso } from '../db/sqlite.js';
import { newId } from '../http/helpers.js';
import type { ApplicationState } from '../workflow/shamsWorkflow.js';
import type { DocumentKind } from '../workflow/applicationForm.js';

export interface DocumentRow {
  id: string; applicationId: string; kind: DocumentKind; version: number; attempt: number; supersededAtAttempt: number | null;
  status: 'current' | 'superseded' | 'removed'; uploadedInState: ApplicationState; originalName: string; storedName: string;
  mimeType: string; sizeBytes: number; sha256: string; uploadedBy: string; createdAt: string;
}

export async function listDocuments(appId: string): Promise<DocumentRow[]> {
  return await getDb().prepare('SELECT * FROM shams_documents WHERE applicationId = ? ORDER BY kind, version').all(appId) as unknown as DocumentRow[];
}

export async function getDocument(appId: string, docId: string): Promise<DocumentRow | null> {
  return (await getDb().prepare('SELECT * FROM shams_documents WHERE id = ? AND applicationId = ?').get(docId, appId) as unknown as DocumentRow | undefined) ?? null;
}

/** المستند ساري المفعول كما في المحاولة N (المراجع يرى ≤ attempt المُرسل؛ المصنع يرى المحاولة القادمة). */
export function isActiveAt(d: DocumentRow, attempt: number): boolean {
  return d.attempt <= attempt && (d.supersededAtAttempt === null || d.supersededAtAttempt > attempt);
}

/**
 * M7: هل وصلت هذه النسخة إلى المراجعين فعلًا؟ نسخة رُفعت واستُبدلت/أُزيلت قبل الإرسال (في محاولتها نفسها)
 * لم يرها أحد ولا يجوز أن يراها مراجع؛ تبقى للمصنع وفي سجل التدقيق فقط.
 */
export function wasSubmitted(d: DocumentRow, currentAttempt: number): boolean {
  if (d.attempt > currentAttempt) return false;
  return !(d.supersededAtAttempt !== null && d.supersededAtAttempt <= d.attempt);
}

export async function activeDocsAt(appId: string, attempt: number): Promise<DocumentRow[]> {
  return (await listDocuments(appId)).filter((d) => isActiveAt(d, attempt));
}

export async function countActiveByKind(appId: string, attempt: number): Promise<Partial<Record<DocumentKind, number>>> {
  const out: Partial<Record<DocumentKind, number>> = {};
  for (const d of await activeDocsAt(appId, attempt)) out[d.kind] = (out[d.kind] ?? 0) + 1;
  return out;
}

export interface NewDocument {
  applicationId: string; kind: DocumentKind; attempt: number; uploadedInState: ApplicationState; originalName: string;
  storedName: string; sizeBytes: number; sha256: string; uploadedBy: string;
}

/**
 * يضيف نسخة جديدة. للمستند المفرد: النسخة الحالية تُعلَّم superseded (لا تُحذف).
 * فواتير الكهرباء متعددة: تُضاف دون استبدال (حتى الحد الأقصى في السياسة).
 */
export async function addDocumentVersion(d: NewDocument, multi: boolean): Promise<DocumentRow> {
  const db = getDb();
  if (!multi) {
    await db.prepare(`UPDATE shams_documents SET supersededAtAttempt = ?, status = 'superseded'
      WHERE applicationId = ? AND kind = ? AND supersededAtAttempt IS NULL`).run(d.attempt, d.applicationId, d.kind);
  }
  const { v } = await db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM shams_documents WHERE applicationId = ? AND kind = ?').get(d.applicationId, d.kind) as { v: number };
  const id = newId('doc');
  await db.prepare(`INSERT INTO shams_documents (id, applicationId, kind, version, attempt, status, uploadedInState, originalName, storedName, mimeType,
      sizeBytes, sha256, uploadedBy, createdAt) VALUES (?, ?, ?, ?, ?, 'current', ?, ?, ?, 'application/pdf', ?, ?, ?, ?)`).run(
    id, d.applicationId, d.kind, v, d.attempt, d.uploadedInState, d.originalName, d.storedName, d.sizeBytes, d.sha256, d.uploadedBy, nowIso(),
  );
  return (await getDocument(d.applicationId, id))!;
}

/** إزالة نسخة (فواتير متعددة) من المحاولة القادمة — تبقى محفوظة في السجل. */
export async function removeDocumentAt(doc: DocumentRow, attempt: number): Promise<void> {
  await getDb().prepare("UPDATE shams_documents SET supersededAtAttempt = ?, status = 'removed' WHERE id = ?").run(attempt, doc.id);
}

/**
 * F-07: نسخ من النوع رُفعت في المحاولة القادمة ولم تُرسل بعد، تُسقط من رؤية المراجعين (M7: «ما لم يُرسل لا يراه أحد»)
 * لأن محاولة المصنع التالية ستُحتسب «مُرسلة». لا حذف: الصف والملف يبقيان، وتبقى النسخة للمصنع وفي التدقيق. يرجع معرّفاتها.
 */
export async function discardUnsentVersions(appId: string, kind: DocumentKind, attempt: number): Promise<string[]> {
  const db = getDb();
  const ids = (await db.prepare('SELECT id FROM shams_documents WHERE applicationId = ? AND kind = ? AND attempt = ? AND supersededAtAttempt IS NULL').all(appId, kind, attempt) as Array<{ id: string }>).map((r) => r.id);
  if (ids.length) {
    await db.prepare("UPDATE shams_documents SET supersededAtAttempt = attempt, status = 'superseded' WHERE applicationId = ? AND kind = ? AND attempt = ? AND supersededAtAttempt IS NULL").run(appId, kind, attempt);
  }
  return ids;
}

/** هل رُفعت نسخة جديدة من النوع في المحاولة القادمة (شرط إرسال العرض/الموافقة)؟ */
export async function hasNewVersionAt(appId: string, kind: DocumentKind, attempt: number): Promise<boolean> {
  return Boolean(await getDb().prepare('SELECT 1 FROM shams_documents WHERE applicationId = ? AND kind = ? AND attempt = ? AND supersededAtAttempt IS NULL LIMIT 1').get(appId, kind, attempt));
}

/** F-05: كل النسخ التي رُفعت لهذا النوع في هذه المحاولة، بما فيها المستبدَلة والمُزالة (كلها تبقى على القرص). */
export async function countVersionsAtAttempt(appId: string, kind: DocumentKind, attempt: number): Promise<number> {
  return (await getDb().prepare('SELECT COUNT(*) AS n FROM shams_documents WHERE applicationId = ? AND kind = ? AND attempt = ?').get(appId, kind, attempt) as { n: number }).n;
}

/** F-05: مجموع أحجام كل الملفات المحفوظة للطلب (كل النسخ، لا النسخ الحالية فقط). */
export async function retainedBytes(appId: string): Promise<number> {
  return Number((await getDb().prepare('SELECT COALESCE(SUM(sizeBytes), 0) AS n FROM shams_documents WHERE applicationId = ?').get(appId) as { n: number }).n);
}

export async function countDocuments(): Promise<number> {
  return (await getDb().prepare('SELECT COUNT(*) AS n FROM shams_documents').get() as { n: number }).n;
}
