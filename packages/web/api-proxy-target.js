/**
 * Where the Next server forwards /api/v1/* (the rewrite in next.config.js).
 *
 *  - API_INTERNAL_URL (server-only, optional): the API address the web server
 *    itself uses, for example a private-network address on the hosting
 *    platform. It is never sent to the browser.
 *  - otherwise NEXT_PUBLIC_API_URL, exactly as before, then the local default.
 *
 * NEXT_PUBLIC_API_URL stays the API's public URL either way: the browser loads
 * uploaded files (/uploads/...) from it directly, and the phone app uses it.
 *
 * Rewrites are fixed when the web app is built, so API_INTERNAL_URL must be set
 * at build time. A malformed value fails the build instead of sending API
 * traffic somewhere unexpected.
 */
function apiProxyTarget(env = process.env) {
  const internal = (env.API_INTERNAL_URL || '').trim();
  if (internal === '') {
    return env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  }
  let url;
  try {
    url = new URL(internal);
  } catch {
    url = null;
  }
  if (
    !url ||
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username || url.password || url.search || url.hash ||
    internal.includes('?') || internal.includes('#')
  ) {
    throw new Error(
      'API_INTERNAL_URL must be an http(s) URL with no credentials, query or fragment, ' +
      'for example http://api.internal:8080',
    );
  }
  // Same form as NEXT_PUBLIC_API_URL: origin plus an optional path prefix, no
  // trailing slash (the rewrite appends /api/v1/...).
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

module.exports = { apiProxyTarget };
