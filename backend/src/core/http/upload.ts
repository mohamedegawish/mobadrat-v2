/**
 * Core file storage (profile documents). PDF only: extension + type + magic bytes (%PDF-) + size limit + sha256.
 * Files live outside the public folder under random names: <UPLOAD_DIR>/<namespace>/documents/<uuid>.pdf.
 * Each initiative module keeps its own upload helpers (its own limits) under <UPLOAD_DIR>/<moduleId>/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';
import { config, maxFileSizeBytes } from '../../config.js';
import { AppError, apiError } from './errors.js';

export function namespaceDir(namespace: string, sub: string): string {
  if (!/^[a-z0-9_-]+$/.test(namespace) || !/^[a-z0-9_-]+$/.test(sub)) throw new Error('invalid storage namespace');
  const dir = path.join(config.uploadDir, namespace, sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function tmpDir(): string {
  const dir = path.join(config.uploadDir, 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function decodeName(name: string): string {
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? name : decoded;
  } catch { return name; }
}

/** One PDF in the `file` field (multer per request: settings are lazy so tests can use temporary folders). */
export function singlePdfUpload(req: Request, res: Response, next: NextFunction) {
  const maxBytes = maxFileSizeBytes(config.maxFileSizeMB);
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
    if (code === 'LIMIT_FILE_SIZE') return apiError(res, 413, 'FILE_TOO_LARGE', `حجم الملف يتجاوز ${config.maxFileSizeMB} ميجابايت.`, `File exceeds ${config.maxFileSizeMB} MB.`);
    if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') return apiError(res, 400, 'VALIDATION_ERROR', 'ملف واحد فقط في الحقل file.', 'Exactly one file in the "file" field.');
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
  } finally { fs.closeSync(fd); }
}

export function discardUpload(file?: Express.Multer.File): void {
  if (file?.path) fs.rm(file.path, { force: true }, () => undefined);
}

/** Validates the temp file and moves it into <namespace>/documents. Throws AppError on refusal (after deleting it). */
export function acceptPdf(file: Express.Multer.File | undefined, namespace: string): StoredFile {
  if (!file) throw new AppError(400, 'FILE_REQUIRED', 'يجب إرفاق ملف PDF في الحقل file.', 'A PDF file is required in the "file" field.');
  const originalName = decodeName(file.originalname).slice(0, 200);
  const extOk = path.extname(originalName).toLowerCase() === '.pdf';
  const mimeOk = ['application/pdf', 'application/x-pdf', 'application/octet-stream'].includes(file.mimetype);
  if (!extOk || !mimeOk || file.size < 5 || !hasPdfMagic(file.path)) {
    discardUpload(file);
    throw new AppError(400, 'INVALID_FILE_TYPE', 'الملف يجب أن يكون PDF صالحًا.', 'The file must be a valid PDF.');
  }
  const hash = createHash('sha256').update(fs.readFileSync(file.path)).digest('hex');
  const storedName = `${randomUUID()}.pdf`;
  fs.renameSync(file.path, path.join(namespaceDir(namespace, 'documents'), storedName));
  return { storedName, originalName, sizeBytes: file.size, sha256: hash };
}

export function storedPathIn(namespace: string, storedName: string): string {
  return path.join(namespaceDir(namespace, 'documents'), path.basename(storedName));
}

/** Copies a stored file into another namespace under a new random name (profile document → initiative document). */
export function copyStoredFile(fromNamespace: string, storedName: string, toDir: string): { storedName: string; sizeBytes: number; sha256: string } {
  const src = storedPathIn(fromNamespace, storedName);
  const buf = fs.readFileSync(src);
  const next = `${randomUUID()}${path.extname(storedName) || '.pdf'}`;
  fs.mkdirSync(toDir, { recursive: true });
  fs.writeFileSync(path.join(toDir, next), buf);
  return { storedName: next, sizeBytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}

/** Sends a stored PDF after the permission check (RFC 5987, nosniff, no-store). */
export function sendPdfFile(res: Response, filePath: string, originalName: string, inline: boolean): void {
  let size: number;
  try { size = fs.statSync(filePath).size; } catch {
    apiError(res, 404, 'NOT_FOUND', 'الملف غير موجود.', 'File not found.');
    return;
  }
  const ascii = originalName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'document.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(size));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(originalName)}`);
  fs.createReadStream(filePath).pipe(res);
}

/** Temp parts older than `maxAgeMs` (a crash during an upload) are removed. Called at boot and hourly. */
export function sweepStaleTmp(maxAgeMs = 60 * 60_000, now = Date.now()): number {
  let removed = 0;
  let names: string[] = [];
  try { names = fs.readdirSync(tmpDir()); } catch { return 0; }
  for (const n of names) {
    if (!/^up-[0-9a-f-]{36}\.tmp$/.test(n)) continue;
    const p = path.join(tmpDir(), n);
    try { if (now - fs.statSync(p).mtimeMs > maxAgeMs) { fs.rmSync(p, { force: true }); removed++; } } catch { /* next sweep */ }
  }
  return removed;
}
