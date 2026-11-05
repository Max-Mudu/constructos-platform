import path from 'path';
import { FastifyInstance, FastifyReply } from 'fastify';
import { getStorageDriver } from '../services/storage';
import { LocalStorageDriver } from '../services/storage/local';
import { StorageDriver } from '../services/storage/types';
import { buildContentDisposition, verifyFileUrl } from '../services/storage/signed-url';

export interface FileRoutesOptions {
  /** Test hook: serve from this driver instead of getStorageDriver(). */
  driver?: StorageDriver;
}

/**
 * Content types this route will ever send. Anything else is served as
 * application/octet-stream so a stored object can never render as HTML/SVG
 * script on the API origin.
 */
const SERVABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

const TYPE_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
};

function normaliseType(value: string | null | undefined): string | null {
  if (!value) return null;
  const base = value.split(';')[0]!.trim().toLowerCase();
  if (base === 'image/jpg') return 'image/jpeg';
  return SERVABLE_TYPES.has(base) ? base : null;
}

function notFound(reply: FastifyReply) {
  return reply
    .status(404)
    .header('Cache-Control', 'no-store')
    .send({ error: 'File not found', code: 'NOT_FOUND' });
}

/**
 * Short-lived signed file URLs for the LOCAL storage driver.
 *
 * GET /signed?k=<key>&e=<unix expiry>&s=<hmac>[&d=<download name>][&t=<type>]
 *  - no JWT: the HMAC is the capability; it is minted only after the caller
 *    was authorised by the owning record's route/service.
 *  - every failure (bad / expired signature, invalid key, missing object,
 *    driver is s3, unexpected error) is the same 404 body.
 *  - never log request.query / request.url here: the signature is a bearer
 *    credential. (The app logger already strips query strings.)
 *
 * Register in server.ts with:
 *   app.register(fileRoutes, { prefix: '/api/v1/files' })
 */
export async function fileRoutes(app: FastifyInstance, opts: FileRoutesOptions = {}) {
  // Resolved on first request, not at registration: a missing storage
  // configuration must fail the file routes only, never the whole API boot.
  // Prefers the app's injected driver so tests and the app share one instance.
  const driverFor = (): StorageDriver =>
    opts.driver ?? (app.hasDecorator('storage') ? app.storage : getStorageDriver());

  app.get('/signed', async (request, reply) => {
    try {
      const driver = driverFor();
      // S3 objects are fetched straight from the bucket via presigned URLs.
      if (!(driver instanceof LocalStorageDriver)) return notFound(reply);

      const verified = verifyFileUrl(request.query as Record<string, unknown>);
      if (!verified) return notFound(reply);

      const body = await driver.get(verified.key);
      if (!body) return notFound(reply);

      const contentType =
        normaliseType(verified.contentType)
        ?? normaliseType(await driver.getContentType(verified.key))
        ?? TYPE_BY_EXTENSION[path.extname(verified.key).toLowerCase()]
        ?? 'application/octet-stream';

      return reply
        .status(200)
        .header('Content-Type', contentType)
        .header('Content-Length', body.length)
        .header('Cache-Control', 'private, max-age=300')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Disposition', verified.downloadName ? buildContentDisposition(verified.downloadName) : 'inline')
        .send(body);
    } catch {
      return notFound(reply);
    }
  });
}
