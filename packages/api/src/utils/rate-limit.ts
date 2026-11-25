import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { JwtPayload } from '../types';

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * This route's rate limit is always counted per client address, even when
     * the request carries an access token (sign-in, refresh, password reset,
     * setup links). See rateLimitKey().
     */
    rateLimitByAddress?: boolean;
  }
}

/** Route config for a route whose limit is always counted per client address. */
export const BY_ADDRESS = { rateLimitByAddress: true } as const;

/** The general limit every route has unless it sets its own. */
export const GENERAL_RATE_LIMIT = { max: 100, timeWindowMs: 60_000 } as const;

export interface RateLimitSettings {
  /** RATE_LIMIT_PER_USER: count requests with a valid access token per user. */
  perUser: boolean;
  /** RATE_LIMIT_ADDRESS_MAX: requests per minute per address while perUser is on. */
  addressMax: number;
}

/**
 * The user id of a valid access token in the Authorization header, else null.
 * The signature and expiry are verified with the same key and verifier as the
 * authenticate middleware; an unverified claim never becomes a key. Whether the
 * session is still current is left to authenticate (it needs the database): a
 * verified token was issued to that user, so counting it against that user is
 * correct either way.
 */
export function verifiedTokenUserId(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const parts = header.split(' ');
  if (parts.length !== 2 || !/^Bearer$/i.test(parts[0]!) || parts[1] === '') return null;
  try {
    const payload = request.server.jwt.verify<JwtPayload>(parts[1]!);
    return typeof payload.sub === 'string' && payload.sub !== '' && typeof payload.companyId === 'string'
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

/**
 * The key a request is counted under.
 *  - perUser off (default): the client address (request.ip), for every route.
 *  - perUser on: `user:<id>` for a request with a valid access token, else the
 *    client address. Routes marked BY_ADDRESS always use the client address.
 * Address keys are plain addresses (as before) and user keys are prefixed, so
 * the two can never collide.
 */
export function rateLimitKey(request: FastifyRequest, perUser: boolean): string {
  if (!perUser || request.routeOptions.config?.rateLimitByAddress === true) return request.ip;
  const userId = verifiedTokenUserId(request);
  return userId === null ? request.ip : `user:${userId}`;
}

/**
 * Fixed-window request counter per client address. With per-user keys, one
 * address holding tokens for several users would otherwise get a full general
 * allowance per user; this caps everything one address sends, all users
 * together. In memory and per instance, like the general limiter's store.
 */
export class AddressCeiling {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxAddresses = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one request from `address`; returns whether it is within the cap. */
  hit(address: string): { allowed: boolean; retryAfterSeconds: number } {
    const t = this.now();
    let entry = this.windows.get(address);
    if (entry === undefined || entry.resetAt <= t) {
      if (entry !== undefined) this.windows.delete(address);
      this.evict(t);
      entry = { count: 0, resetAt: t + this.windowMs };
      this.windows.set(address, entry);
    }
    entry.count += 1;
    return { allowed: entry.count <= this.max, retryAfterSeconds: Math.ceil((entry.resetAt - t) / 1000) };
  }

  /** Number of addresses currently tracked (for tests). */
  get size(): number {
    return this.windows.size;
  }

  private evict(t: number): void {
    if (this.windows.size < this.maxAddresses) return;
    for (const [key, value] of this.windows) {
      if (value.resetAt <= t) this.windows.delete(key);
    }
    // Still full: drop the oldest windows (Map keeps insertion order).
    for (const key of this.windows.keys()) {
      if (this.windows.size < this.maxAddresses) break;
      this.windows.delete(key);
    }
  }
}

/** Same response as the general limiter's (statusCode 429, same message form). */
function tooManyRequests(reply: FastifyReply, retryAfterSeconds: number): Error {
  reply.header('retry-after', retryAfterSeconds);
  const err = new Error('Rate limit exceeded, retry in 1 minute') as Error & { statusCode: number };
  err.statusCode = 429;
  return err;
}

/**
 * Registers the general rate limit (GENERAL_RATE_LIMIT, keyed by rateLimitKey)
 * and, while perUser is on, the per-address ceiling. Routes with their own
 * `config.rateLimit` keep their numbers and use the same key function, so a
 * BY_ADDRESS route stays per address.
 */
export async function registerRateLimits(app: FastifyInstance, settings: RateLimitSettings): Promise<void> {
  if (settings.perUser) {
    const ceiling = new AddressCeiling(settings.addressMax, GENERAL_RATE_LIMIT.timeWindowMs);
    // A root onRequest hook runs before the per-route limiter hooks.
    app.addHook('onRequest', async (request, reply) => {
      const result = ceiling.hit(request.ip);
      if (!result.allowed) throw tooManyRequests(reply, result.retryAfterSeconds);
    });
  }
  await app.register(fastifyRateLimit, {
    max: GENERAL_RATE_LIMIT.max,
    timeWindow: GENERAL_RATE_LIMIT.timeWindowMs,
    keyGenerator: (request) => rateLimitKey(request, settings.perUser),
  });
}
