/**
 * The page to open after signing in, taken from the `next` query parameter.
 *
 * Only a page of this app is accepted. Anything that would leave the app
 * (another host, a protocol, or a form a browser reads as another host) falls
 * back to the dashboard. The value is resolved the way the router resolves it,
 * against a placeholder origin, instead of trusting its first character.
 */
const PLACEHOLDER_ORIGIN = 'https://app.invalid';

function resolveInApp(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function safeNextPath(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next || !next.startsWith('/')) return fallback;

  const path = resolveInApp(next);
  if (path === null) return fallback;

  // The router resolves the returned value again. Resolving removes dot
  // segments ("/./", "/../", "%2e"), which can leave a value starting with two
  // slashes that names another host. Accept the value only if resolving it
  // again keeps it in the app and unchanged.
  if (path.startsWith('//') || resolveInApp(path) !== path) return fallback;

  return path;
}
