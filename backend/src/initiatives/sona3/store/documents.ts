import { getDb, nowIso } from '../db/sqlite.js';
import { newId } from '../http/helpers.js';
import type { ApplicationState } from '../workflow/workflow.js';
import type { DocumentKind } from '../workflow/applicationForm.js';

export interface DocumentRow {
  id: string; applicationId: string; kind: DocumentKind; version: number; attempt: number; supersededAtAttempt: number | null;
  status: 'current' | 'superseded' | 'removed'; uploadedInState: ApplicationState; originalName: string; storedName: string;
  mimeType: string; sizeBytes: number; sha256: string; uploadedBy: string; createdAt: string;
}

export function listDocuments(appId: string): DocumentRow[] {
  return getDb().prepare('SELECT * FROM documents WHERE applicationId = ? ORDER BY kind, version').all(appId) as unknown as DocumentRow[];
}

export function getDocument(appId: string, docId: string): DocumentRow | null {
  return (getDb().prepare('SELECT * FROM documents WHERE id = ? AND applicationId = ?').get(docId, appId) as unknown as DocumentRow | undefined) ?? null;
}

/** المستند ساري المفعول كما في المحاولة N (المراجع يرى ≤ attempt المُرسل؛ المتقدم يرى المحاولة القادمة). */
export function isActiveAt(d: DocumentRow, attempt: number): boolean {
  return d.attempt <= attempt && (d.supersededAtAttempt === null || d.supersededAtAttempt > attempt);
}

export function activeDocsAt(appId: string, attempt: number): DocumentRow[] {
  return listDocuments(appId).filter((d) => isActiveAt(d, attempt));
}

export function countActiveByKind(appId: string, attempt: number): Partial<Record<DocumentKind, number>> {
  const out: Partial<Record<DocumentKind, number>> = {};
  for (const d of activeDocsAt(appId, attempt)) out[d.kind] = (out[d.kind] ?? 0) + 1;
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
export function addDocumentVersion(d: NewDocument, multi: boolean): DocumentRow {
  const db = getDb();
  if (!multi) {
    db.prepare(`UPDATE documents SET supersededAtAttempt = ?, status = 'superseded'
      WHERE applicationId = ? AND kind = ? AND supersededAtAttempt IS NULL`).run(d.attempt, d.applicationId, d.kind);
  }
  const { v } = db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM documents WHERE applicationId = ? AND kind = ?').get(d.applicationId, d.kind) as { v: number };
  const id = newId('doc');
  db.prepare(`INSERT INTO documents (id, applicationId, kind, version, attempt, status, uploadedInState, originalName, storedName, mimeType,
      sizeBytes, sha256, uploadedBy, createdAt) VALUES (?, ?, ?, ?, ?, 'current', ?, ?, ?, 'application/pdf', ?, ?, ?, ?)`).run(
    id, d.applicationId, d.kind, v, d.attempt, d.uploadedInState, d.originalName, d.storedName, d.sizeBytes, d.sha256, d.uploadedBy, nowIso(),
  );
  return getDocument(d.applicationId, id)!;
}

/** إزالة نسخة (فواتير متعددة) من المحاولة القادمة — تبقى محفوظة في السجل. */
export function removeDocumentAt(doc: DocumentRow, attempt: number): void {
  getDb().prepare("UPDATE documents SET supersededAtAttempt = ?, status = 'removed' WHERE id = ?").run(attempt, doc.id);
}

/** هل رُفعت نسخة جديدة من النوع في المحاولة القادمة (شرط إرسال العرض/الموافقة)؟ */
export function hasNewVersionAt(appId: string, kind: DocumentKind, attempt: number): boolean {
  return Boolean(getDb().prepare('SELECT 1 FROM documents WHERE applicationId = ? AND kind = ? AND attempt = ? AND supersededAtAttempt IS NULL LIMIT 1').get(appId, kind, attempt));
}

export function countDocuments(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }).n;
}
