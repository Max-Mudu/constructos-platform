/**
 * Resolves to the promise's value, or to null when it has not settled within
 * `ms`. A rejection inside the time limit is passed on unchanged.
 *
 * For best-effort steps that must not hold up the step after them. Example:
 * looking up the Expo push token at logout waits for APNs registration and
 * an HTTPS call to Expo, neither of which has a time limit of its own, so on
 * a poor site connection it could keep the user from logging out.
 *
 * Pure (no React Native imports) so it can be exercised with plain Node.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err: unknown) => { clearTimeout(timer); reject(err); },
    );
  });
}
