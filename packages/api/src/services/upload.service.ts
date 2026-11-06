import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import os from 'os';
import { StorageDriver } from './storage/types';
import { LocalStorageDriver } from './storage/local';
import { isValidStorageKey } from './storage/signed-url';

// ── Storage root ──────────────────────────────────────────────────────────────

function getUploadDir(): string {
  // In test mode use a temp directory so files don't persist between runs
  if (process.env['NODE_ENV'] === 'test') {
    return path.join(os.tmpdir(), 'construction-platform-test-uploads');
  }
  return path.resolve(process.cwd(), 'uploads');
}

/** Directory that has always held delivery, drawing and instruction uploads. */
export function legacyUploadRoot(): string {
  return path.resolve(getUploadDir());
}

let legacyLocalDriver: LocalStorageDriver | undefined;

/**
 * Local driver rooted at the legacy upload directory: the same directory and
 * key layout as before (`photos/<uuid>.jpg` → `<root>/photos/<uuid>.jpg`).
 * Used for these uploads when STORAGE_DRIVER=local, and as the default when no
 * driver is passed.
 */
export function legacyLocalUploadDriver(): StorageDriver {
  return (legacyLocalDriver ??= new LocalStorageDriver(getUploadDir()));
}

/** Resolves `fileKey` strictly inside the legacy root, or null if it escapes. */
function legacyPath(fileKey: string): string | null {
  const root = legacyUploadRoot();
  const resolved = path.resolve(root, fileKey);
  return resolved.startsWith(root + path.sep) ? resolved : null;
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

/**
 * Stored-file extension for each accepted MIME type. The extension comes from
 * the magic-byte-validated type, never from the client's filename, so no
 * upload can land on disk (or later in a bucket / CDN that infers
 * Content-Type from the extension) as .html, .svg, .js, etc.
 */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg':  '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp',
  'image/gif':  '.gif',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

/** Extension for a stored file key; '' for a type outside the allow-list. */
export function storedFileExtension(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType] ?? '';
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
 * Persists a file buffer through the upload storage driver (default: local
 * disk under the legacy upload root, exactly as before).
 * Returns metadata needed to save to the database.
 *
 * @param buffer       Raw file bytes
 * @param originalName Original filename (returned as fileName for display only)
 * @param mimeType     MIME type of the file
 * @param subdir       Key prefix (e.g. "photos", "documents")
 * @param storage      Upload storage (routes pass `fastify.uploadStorage`)
 */
export async function storeFile(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  subdir: string,
  storage: StorageDriver = legacyLocalUploadDriver(),
): Promise<UploadResult> {
  const ext    = storedFileExtension(mimeType);
  const fileId = randomUUID();
  const fileKey = `${subdir}/${fileId}${ext}`;

  await storage.put(fileKey, buffer, { contentType: mimeType });

  return {
    fileKey,
    fileUrl:      `/uploads/${fileKey}`,
    fileName:     originalName,
    fileSizeBytes: buffer.length,
    fileType:     mimeType,
  };
}

/**
 * Removes a previously uploaded file from the upload storage and, best effort,
 * from the legacy local directory (files written before the storage driver
 * was used for uploads). Silently ignores missing files (idempotent).
 */
export async function removeFile(
  fileKey: string,
  storage: StorageDriver = legacyLocalUploadDriver(),
): Promise<void> {
  if (isValidStorageKey(fileKey)) {
    try {
      await storage.delete(fileKey);
    } catch {
      // Best effort, as before: the database row is already gone.
    }
  }
  const filePath = legacyPath(fileKey);
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch {
    // File may already be gone — that's fine
  }
}

/**
 * Reads an uploaded file. Tries the upload storage first, then the legacy
 * local directory, so files stored before a switch to STORAGE_DRIVER=s3 (or
 * with keys the driver's strict key rules reject) are still served.
 * Returns null if the file exists in neither. Storage errors other than
 * "not found" propagate.
 */
export async function readFile(
  fileKey: string,
  storage: StorageDriver = legacyLocalUploadDriver(),
): Promise<Buffer | null> {
  if (isValidStorageKey(fileKey)) {
    const stored = await storage.get(fileKey);
    if (stored) return stored;
  }
  const filePath = legacyPath(fileKey);
  if (!filePath) return null;
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}
