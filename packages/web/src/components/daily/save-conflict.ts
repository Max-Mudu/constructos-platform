/**
 * Decides what to do when a save comes back 409 STALE_REPORT.
 *
 * The server bumps updatedAt for any change (another device, a photo upload,
 * an AI draft). If the field we were saving is unchanged on the server since
 * we last synced it, nobody else touched it: retry with the fresh updatedAt.
 * If the server already holds exactly our value, there is nothing to do.
 * Otherwise it is a real conflict and the user decides — their text stays.
 */
import { deepEqual } from './content';

export type StaleResolution = 'retry' | 'noop' | 'conflict';

export function resolveStale<T>(args: { base: T; server: T; mine: T }): StaleResolution {
  if (deepEqual(args.server, args.mine)) return 'noop';
  if (deepEqual(args.server, args.base)) return 'retry';
  return 'conflict';
}
