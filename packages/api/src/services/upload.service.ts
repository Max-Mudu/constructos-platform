import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import os from 'os';

// ── Storage root ──────────────────────────────────────────────────────────────

function getUploadDir(): string {
  // In test mode use a temp directory so files don't persist between runs
  if (process.env['NODE_ENV'] === 'test') {
    return path.join(os.tmpdir(), 'construction-platform-test-uploads');
  }
  return path.resolve(process.cwd(), 'uploads');
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

export const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export const ALLOWED_DOCUMENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

// ── Magic-bytes validation ────────────────────────────────────────────────────

/**
 * Maps MIME types to a function that checks the file's actual byte signature.
 * This prevents MIME-type spoofing: a client cannot upload malware by lying
 * about Content-Type.
 */
const MAGIC_BYTES: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  'image/jpg':  (b) => b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  'image/png':  (b) =>
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
    b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A,
  'image/webp': (b) =>
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  'image/gif': (b) =>
    b.length >= 4 &&
    b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  'application/pdf': (b) =>
    b.length >= 4 &&
    b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  'application/msword': (b) =>
    b.length >= 4 &&
    b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (b) =>
    b.length >= 4 &&
    b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (b) =>
    b.length >= 4 &&
    b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04,
  'application/vnd.ms-excel': (b) =>
    b.length >= 4 &&
    b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0,
};

/**
 * Returns false if the buffer's file signature does not match the declared MIME type.
 * Call this after reading the buffer and before persisting the file.
 */
export function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const validator = MAGIC_BYTES[mimeType];
  if (!validator) return false;
  return validator(buffer);
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface UploadResult {
  fileKey:      string;
  fileUrl:      string;
  fileName:     string;
  fileSizeBytes: number;
  fileType:     string;
}

/**
 * Persists a file buffer to local disk.
 * Returns metadata needed to save to the database.
 *
 * @param buffer       Raw file bytes
 * @param originalName Original filename (used for extension only)
 * @param mimeType     MIME type of the file
 * @param subdir       Sub-directory under the upload root (e.g. "photos", "documents")
 */
export async function storeFile(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  subdir: string,
): Promise<UploadResult> {
  const uploadDir = getUploadDir();
  const targetDir = path.join(uploadDir, subdir);
  await ensureDir(targetDir);

  const ext    = path.extname(originalName).toLowerCase() || '';
  const fileId = randomUUID();
  const fileKey = `${subdir}/${fileId}${ext}`;
  const filePath = path.join(uploadDir, fileKey);

  await fs.writeFile(filePath, buffer);

  return {
    fileKey,
    fileUrl:      `/uploads/${fileKey}`,
    fileName:     originalName,
    fileSizeBytes: buffer.length,
    fileType:     mimeType,
  };
}

/**
 * Removes a previously uploaded file from disk.
 * Silently ignores missing files (idempotent).
 */
export async function removeFile(fileKey: string): Promise<void> {
  const uploadDir = getUploadDir();
  const filePath  = path.join(uploadDir, fileKey);
  try {
    await fs.unlink(filePath);
  } catch {
    // File may already be gone — that's fine
  }
}

/**
 * Reads a file from disk and returns its content.
 * Returns null if the file does not exist.
 */
export async function readFile(fileKey: string): Promise<Buffer | null> {
  const uploadDir = getUploadDir();
  const filePath  = path.join(uploadDir, fileKey);
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}
