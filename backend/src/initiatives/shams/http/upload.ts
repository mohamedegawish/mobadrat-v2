/**
 * رفع ملفات PDF فقط: امتداد + نوع + magic bytes (%PDF-) + حد الحجم من السياسة + sha256.
 * الملفات تُخزن خارج المجلد العام بأسماء UUID، وتُحذف فورًا عند الرفض.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';
import { config, maxFileSizeBytes } from '../config.js';
import { shamsPolicy } from '../config/shamsPolicy.js';
import { AppError, apiError } from './errors.js';

/** This module's files live under <UPLOAD_DIR>/shams/; the temp folder is the platform's. */
const MODULE_DIR = 'shams';

export function uploadRoot(): string {
  const dir = path.join(config.uploadDir, MODULE_DIR, 'documents');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function tmpDir(): string {
  const dir = path.join(config.uploadDir, 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** يستعيد أسماء الملفات العربية (multer يقرأها latin1). */
export function decodeName(name: string): string {
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? name : decoded;
  } catch { return name; }
}

/** multer لكل طلب (الإعدادات lazy حتى تعمل الاختبارات بمجلدات مؤقتة). */
export function singlePdfUpload(req: Request, res: Response, next: NextFunction) {
  // PR-F1: busboy stops a file only when its size becomes exactly equal to `fileSize`, and flags a file that reaches the limit.
  // A fractional byte limit was therefore never hit (the file was silently truncated and stored), and a file of exactly the
  // limit was refused. Whole bytes, inclusive: a file of up to maxBytes is accepted, maxBytes + 1 is refused.
  const maxBytes = maxFileSizeBytes(shamsPolicy.maxFileSizeMB);
  // PR-F2: a client that drops the connection mid-upload left its partial temp file behind (multer does not remove it).
  // When the connection closes, every temp file of this request is removed; an accepted file was already renamed into
  // storage, so this is a no-op for it. Retries cover Windows, where the write stream may still hold the file briefly.
  const temps: string[] = [];
  res.once('close', () => { for (const p of temps) fs.rm(p, { force: true, recursive: true, maxRetries: 5, retryDelay: 200 }, () => undefined); });
  const mw = multer({
    storage: multer.diskStorage({
      destination: (_r, _f, cb) => cb(null, tmpDir()),
      filename: (_r, _f, cb) => { const name = `up-${randomUUID()}.tmp`; temps.push(path.join(tmpDir(), name)); cb(null, name); },
    }),
    limits: { fileSize: maxBytes + 1, files: 1, fields: 5, fieldSize: 1024 },
  }).single('file');
  mw(req, res, (err: unknown) => {
    if (!err && req.file && req.file.size > maxBytes) { discardUpload(req.file); err = { code: 'LIMIT_FILE_SIZE' }; }
    if (!err) return next();
    const code = (err as { code?: string }).code;
    if (code === 'LIMIT_FILE_SIZE') {
      return apiError(res, 413, 'FILE_TOO_LARGE', `حجم الملف يتجاوز ${shamsPolicy.maxFileSizeMB} ميجابايت.`, `File exceeds ${shamsPolicy.maxFileSizeMB} MB.`);
    }
    if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') {
      return apiError(res, 400, 'VALIDATION_ERROR', 'ارفع ملفًا واحدًا فقط في كل مرة.', 'Exactly one file in the "file" field.');
    }
    return next(err);
  });
}

/** مستندات فورم التسجيل التي تُرفع مع إنشاء الحساب: اسم الحقل في multipart = نوع المستند. */
export const REGISTRATION_FILE_FIELDS = [
  { name: 'commercialRegisterFile', maxCount: 1 }, { name: 'industrialRegisterFile', maxCount: 1 }, { name: 'taxCardFile', maxCount: 1 },
  { name: 'ownershipProofFile', maxCount: 1 }, { name: 'electricityBill', maxCount: 12 },
] as const;

/**
 * POST /auth/register (multipart): الحقل `payload` (JSON الحساب + أقسام الفورم) + ملفات PDF بأسماء أنواعها.
 * نفس حدود الحجم وحذف الملفات المؤقتة في singlePdfUpload؛ سقف 16 ملفًا وحقلان وحجم payload ≤ 256KB.
 */
export function registrationUpload(req: Request, res: Response, next: NextFunction) {
  if (!req.is('multipart/form-data')) {
    return apiError(res, 400, 'VALIDATION_ERROR', 'التسجيل يتطلب إرسال البيانات والمستندات معًا (multipart/form-data).', 'Registration requires the data and documents together (multipart/form-data).',
      [{ field: '_body', issue: 'multipart/form-data required' }]);
  }
  const maxBytes = maxFileSizeBytes(shamsPolicy.maxFileSizeMB);
  const temps: string[] = [];
  res.once('close', () => { for (const p of temps) fs.rm(p, { force: true, recursive: true, maxRetries: 5, retryDelay: 200 }, () => undefined); });
  const mw = multer({
    storage: multer.diskStorage({
      destination: (_r, _f, cb) => cb(null, tmpDir()),
      filename: (_r, _f, cb) => { const name = `up-${randomUUID()}.tmp`; temps.push(path.join(tmpDir(), name)); cb(null, name); },
    }),
    limits: { fileSize: maxBytes + 1, files: 16, fields: 2, fieldSize: 256 * 1024 },
  }).fields(REGISTRATION_FILE_FIELDS.map((f) => ({ ...f })));
  mw(req, res, (err: unknown) => {
    const files = Object.values((req.files ?? {}) as Record<string, Express.Multer.File[]>).flat();
    if (!err && files.some((f) => f.size > maxBytes)) err = { code: 'LIMIT_FILE_SIZE' };
    if (!err) return next();
    for (const f of files) discardUpload(f);
    const code = (err as { code?: string }).code;
    if (code === 'LIMIT_FILE_SIZE') return apiError(res, 413, 'FILE_TOO_LARGE', `حجم أحد الملفات يتجاوز ${shamsPolicy.maxFileSizeMB} ميجابايت.`, `A file exceeds ${shamsPolicy.maxFileSizeMB} MB.`);
    if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE' || code === 'LIMIT_FIELD_COUNT' || code === 'LIMIT_FIELD_VALUE') {
      return apiError(res, 400, 'VALIDATION_ERROR', 'عدد الملفات أو الحقول غير مسموح.', 'Unexpected files or fields.', [{ field: (err as { field?: string }).field ?? '_body', issue: 'unexpected' }]);
    }
    return next(err);
  });
}

/**
 * PR-F2 backstop: temp parts older than `maxAgeMs` (a crash or kill during an upload) are removed. Called at boot and hourly.
 * Only `uploads/tmp/up-*.tmp` is touched; stored documents are never deleted here.
 */
export function sweepStaleTmp(maxAgeMs = 60 * 60_000, now = Date.now()): number {
  let removed = 0;
  let names: string[] = [];
  try { names = fs.readdirSync(tmpDir()); } catch { return 0; }
  for (const n of names) {
    if (!/^up-[0-9a-f-]{36}\.tmp$/.test(n)) continue;
    const p = path.join(tmpDir(), n);
    try { if (now - fs.statSync(p).mtimeMs > maxAgeMs) { fs.rmSync(p, { force: true }); removed++; } } catch { /* vanished or busy: next sweep */ }
  }
  return removed;
}

export interface StoredFile { storedName: string; originalName: string; sizeBytes: number; sha256: string }

function hasPdfMagic(filePath: string): boolean {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(5);
    const n = fs.readSync(fd, buf, 0, 5, 0);
    return n === 5 && buf.toString('ascii') === '%PDF-';
  } finally {
    fs.closeSync(fd);
  }
}

export function discardUpload(file?: Express.Multer.File): void {
  if (file?.path) fs.rm(file.path, { force: true }, () => undefined);
}

/** يتحقق من الملف المؤقت وينقله للتخزين الدائم. يرمي AppError عند الرفض (بعد حذف الملف). */
export function acceptPdf(file: Express.Multer.File | undefined): StoredFile {
  if (!file) throw new AppError(400, 'FILE_REQUIRED', 'يجب إرفاق ملف PDF.', 'A PDF file is required in the "file" field.');
  const originalName = decodeName(file.originalname).slice(0, 200);
  const extOk = path.extname(originalName).toLowerCase() === '.pdf';
  const mimeOk = file.mimetype === 'application/pdf' || file.mimetype === 'application/x-pdf' || file.mimetype === 'application/octet-stream';
  if (!extOk || !mimeOk || file.size < 5 || !hasPdfMagic(file.path)) {
    discardUpload(file);
    throw new AppError(400, 'INVALID_FILE_TYPE', 'الملف يجب أن يكون PDF صالحًا.', 'The file must be a valid PDF.');
  }
  const hash = createHash('sha256').update(fs.readFileSync(file.path)).digest('hex');
  const storedName = `${randomUUID()}.pdf`;
  fs.renameSync(file.path, path.join(uploadRoot(), storedName));
  return { storedName, originalName, sizeBytes: file.size, sha256: hash };
}

export function storedPath(storedName: string): string {
  // storedName من القاعدة (UUID) — نمنع أي مسار نسبي احتياطًا.
  return path.join(uploadRoot(), path.basename(storedName));
}

/** إرسال ملف مخزن بعد فحص الصلاحية (RFC 5987، nosniff، no-store). */
export function sendStoredPdf(res: Response, storedName: string, originalName: string, inline: boolean): void {
  const p = storedPath(storedName);
  let size: number;
  try { size = fs.statSync(p).size; } catch {
    apiError(res, 404, 'NOT_FOUND', 'الملف غير موجود.', 'File not found.');
    return;
  }
  const ascii = originalName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'document.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(size));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(originalName)}`);
  fs.createReadStream(p).pipe(res);
}
