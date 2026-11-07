// Server-side logout with one refresh-and-retry.
//
// POST /auth/logout needs a valid access token (it runs `authenticate`). When
// the access token has already expired the first attempt gets 401, so the
// refresh token is never revoked. In that case refresh ONCE, then retry with
// the new access token and the new refresh token.
//
// Pure (no React Native imports) so it can be exercised with plain Node.
// It never throws and never loops; the caller clears local tokens whatever
// the outcome.

export interface LogoutFlowDeps {
  /** The refresh token currently stored on the device (read fresh each time). */
  getRefreshToken: () => Promise<string | null>;
  /** POST /auth/logout with the current access token and this refresh token. */
  postLogout: (refreshToken: string) => Promise<void>;
  /**
   * Rotate the token pair once and store it. Must not end the session or
   * navigate on failure: the logout caller does that exactly once.
   */
  refreshOnce: () => Promise<void>;
  /** HTTP status of a failed request, if it reached the server. */
  statusOf: (err: unknown) => number | undefined;
}

export type LogoutOutcome = 'revoked' | 'no-token' | 'failed';

export async function logoutWithRefreshRetry(deps: LogoutFlowDeps): Promise<LogoutOutcome> {
  try {
    const first = await deps.getRefreshToken();
    if (!first) return 'no-token';

    try {
      await deps.postLogout(first);
      return 'revoked';
    } catch (err) {
      // Offline, timeout, 5xx, ...: nothing a refresh would fix.
      if (deps.statusOf(err) !== 401) return 'failed';
    }

    await deps.refreshOnce();

    // The refresh rotated the pair: revoke the NEW refresh token.
    const next = await deps.getRefreshToken();
    if (!next) return 'failed';
    await deps.postLogout(next);
    return 'revoked';
  } catch {
    return 'failed';
  }
}
