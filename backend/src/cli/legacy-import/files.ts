/**
 * Uploaded files: copied (never moved) from the legacy upload folders into <UPLOAD_DIR>/<namespace>/…, keeping the
 * relative paths and stored names (rows reference files by stored name). An existing destination file is kept only when
 * its bytes are identical. Every database row that names a file is then checked against its sha256.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export interface TreeCopy { files: number; copied: number; identical: number; conflicts: string[] }

const sha256 = (p: string) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function* walk(dir: string, rel = ''): Generator<string> {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) yield* walk(dir, r);
    else if (e.isFile()) yield r;
  }
}

/** Copies every file of `src` (except the temp folder) under `dest`. In a dry run nothing is written. */
export function copyTree(src: string, dest: string, dryRun: boolean): TreeCopy {
  const out: TreeCopy = { files: 0, copied: 0, identical: 0, conflicts: [] };
  if (!fs.existsSync(src)) throw new Error(`upload folder not found: ${src}`);
  for (const rel of walk(src)) {
    if (rel.split(path.sep)[0] === 'tmp') continue;
    out.files++;
    const from = path.join(src, rel);
    const to = path.join(dest, rel);
    if (fs.existsSync(to)) {
      if (sha256(to) === sha256(from)) out.identical++;
      else out.conflicts.push(rel);
      continue;
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    }
    out.copied++;
  }
  return out;
}

/** 'ok' when the file exists with the recorded sha256 (sha256 may be unknown → existence only). */
export function checkFile(dir: string, storedName: string, expectedSha256: string | null): 'ok' | 'missing' | 'mismatch' {
  const p = path.join(dir, path.basename(storedName));
  if (!fs.existsSync(p)) return 'missing';
  if (expectedSha256 && sha256(p) !== expectedSha256) return 'mismatch';
  return 'ok';
}

/** Copies a legacy document into the shared profile storage under a new random name. */
export function copyIntoProfileStore(srcFile: string, coreDocsDir: string, dryRun: boolean): { storedName: string; sha256: string; sizeBytes: number } {
  const buf = fs.readFileSync(srcFile);
  const storedName = `${randomUUID()}${path.extname(srcFile) || '.pdf'}`;
  if (!dryRun) {
    fs.mkdirSync(coreDocsDir, { recursive: true });
    fs.writeFileSync(path.join(coreDocsDir, storedName), buf, { flag: 'wx' });
  }
  return { storedName, sha256: createHash('sha256').update(buf).digest('hex'), sizeBytes: buf.length };
}
