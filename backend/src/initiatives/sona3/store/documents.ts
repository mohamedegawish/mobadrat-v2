import { getDb, nowIso } from '../db/sqlite.js';
import { newId } from '../http/helpers.js';
import type { ApplicationState } from '../workflow/workflow.js';
import type { DocumentKind } from '../workflow/applicationForm.js';

export interface DocumentRow {
  id: string; applicationId: string; kind: DocumentKind; version: number; attempt: number; supersededAtAttempt: number | null;
  status: 'current' | 'superseded' | 'removed'; uploadedInState: ApplicationState; originalName: string; storedName: string;
  mimeType: string; sizeBytes: number; sha256: string; uploadedBy: string; createdAt: string;
}

export async function listDocuments(appId: string): Promise<DocumentRow[]> {
  return await getDb().prepare('SELECT * FROM sona3_documents WHERE applicationId = ? ORDER BY kind, version').all(appId) as unknown as DocumentRow[];
}

export async function getDocument(appId: string, docId: string): Promise<DocumentRow | null> {
  return (await getDb().prepare('SELECT * FROM sona3_documents WHERE id = ? AND applicationId = ?').get(docId, appId) as unknown as DocumentRow | undefined) ?? null;
}

/** المستند ساري المفعول كما في المحاولة N (المراجع يرى ≤ attempt المُرسل؛ المتقدم يرى المحاولة القادمة). */
export function isActiveAt(d: DocumentRow, attempt: number): boolean {
  return d.attempt <= attempt && (d.supersededAtAttempt === null || d.supersededAtAttempt > attempt);
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
 * المرفقات المتعددة (داعمة/عروض أسعار/أدلة): تُضاف دون استبدال (حتى الحد الأقصى في السياسة).
 */
export async function addDocumentVersion(d: NewDocument, multi: boolean): Promise<DocumentRow> {
  const db = getDb();
  if (!multi) {
    await db.prepare(`UPDATE sona3_documents SET supersededAtAttempt = ?, status = 'superseded'
      WHERE applicationId = ? AND kind = ? AND supersededAtAttempt IS NULL`).run(d.attempt, d.applicationId, d.kind);
  }
  const { v } = await db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM sona3_documents WHERE applicationId = ? AND kind = ?').get(d.applicationId, d.kind) as { v: number };
  const id = newId('doc');
  await db.prepare(`INSERT INTO sona3_documents (id, applicationId, kind, version, attempt, status, uploadedInState, originalName, storedName, mimeType,
      sizeBytes, sha256, uploadedBy, createdAt) VALUES (?, ?, ?, ?, ?, 'current', ?, ?, ?, 'application/pdf', ?, ?, ?, ?)`).run(
    id, d.applicationId, d.kind, v, d.attempt, d.uploadedInState, d.originalName, d.storedName, d.sizeBytes, d.sha256, d.uploadedBy, nowIso(),
  );
  return (await getDocument(d.applicationId, id))!;
}

/** إزالة نسخة (فواتير متعددة) من المحاولة القادمة — تبقى محفوظة في السجل. */
export async function removeDocumentAt(doc: DocumentRow, attempt: number): Promise<void> {
  await getDb().prepare("UPDATE sona3_documents SET supersededAtAttempt = ?, status = 'removed' WHERE id = ?").run(attempt, doc.id);
}

/** هل رُفعت نسخة جديدة من النوع في المحاولة القادمة (شرط إرسال العرض/الموافقة)؟ */
export async function hasNewVersionAt(appId: string, kind: DocumentKind, attempt: number): Promise<boolean> {
  return Boolean(await getDb().prepare('SELECT 1 FROM sona3_documents WHERE applicationId = ? AND kind = ? AND attempt = ? AND supersededAtAttempt IS NULL LIMIT 1').get(appId, kind, attempt));
}

export async function countDocuments(): Promise<number> {
  return (await getDb().prepare('SELECT COUNT(*) AS n FROM sona3_documents').get() as { n: number }).n;
}
