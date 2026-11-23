/**
 * The page to open after signing in, taken from the `next` query parameter.
 *
 * Only a page of this app is accepted. Anything that would leave the app
 * (another host, a protocol, or a form a browser reads as another host) falls
 * back to the dashboard. The check resolves the value the same way the router
 * does, against a placeholder origin, instead of trusting its first character.
 */
const PLACEHOLDER_ORIGIN = 'https://app.invalid';

export function safeNextPath(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next || !next.startsWith('/')) return fallback;

  let url: URL;
  try {
    url = new URL(next, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;

  return `${url.pathname}${url.search}${url.hash}`;
}
