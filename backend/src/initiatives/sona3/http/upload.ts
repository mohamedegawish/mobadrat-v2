/**
 * رفع ملفات PDF فقط: امتداد + نوع + magic bytes (%PDF-) + حد الحجم من السياسة + sha256.
 * الملفات تُخزن خارج المجلد العام بأسماء UUID، وتُحذف فورًا عند الرفض.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { policy } from '../config/initiativePolicy.js';
import { AppError, apiError } from './errors.js';

export function uploadRoot(): string {
  const dir = path.join(config.uploadDir, 'documents');
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
  const mw = multer({
    storage: multer.diskStorage({
      destination: (_r, _f, cb) => cb(null, tmpDir()),
      filename: (_r, _f, cb) => cb(null, `up-${randomUUID()}.tmp`),
    }),
    limits: { fileSize: policy.maxFileSizeMB * 1024 * 1024, files: 1, fields: 5, fieldSize: 1024 },
  }).single('file');
  mw(req, res, (err: unknown) => {
    if (!err) return next();
    const code = (err as { code?: string }).code;
    if (code === 'LIMIT_FILE_SIZE') {
      return apiError(res, 413, 'FILE_TOO_LARGE', `حجم الملف يتجاوز ${policy.maxFileSizeMB} ميجابايت.`, `File exceeds ${policy.maxFileSizeMB} MB.`);
    }
    if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') {
      return apiError(res, 400, 'VALIDATION_ERROR', 'ملف واحد فقط في الحقل file.', 'Exactly one file in the "file" field.');
    }
    return next(err);
  });
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
  if (!file) throw new AppError(400, 'FILE_REQUIRED', 'يجب إرفاق ملف PDF في الحقل file.', 'A PDF file is required in the "file" field.');
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
