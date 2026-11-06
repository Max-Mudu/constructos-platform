import { isIP } from 'net';

/**
 * Parses a strict boolean env flag. Unset/empty → defaultValue; otherwise only
 * 'true' / 'false' (case-insensitive) are accepted so a typo fails at boot
 * instead of silently flipping a security control.
 */
export function parseEnvFlag(key: string, raw: string | undefined, defaultValue: boolean): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Environment variable ${key} must be 'true' or 'false'`);
}

/** A flag that is on by default outside production and off in production. */
export function flagDefaultOffInProduction(
  key: string,
  raw: string | undefined,
  isProduction: boolean,
): boolean {
  return parseEnvFlag(key, raw, !isProduction);
}

export type TrustProxySetting = false | number | string[];

const TRUST_PROXY_PRESETS = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isValidProxyEntry(entry: string): boolean {
  if (TRUST_PROXY_PRESETS.has(entry)) return true;
  const [address, prefix, ...rest] = entry.split('/');
  if (rest.length > 0 || !address) return false;
  const family = isIP(address);
  if (family === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const bits = Number(prefix);
  return bits >= 0 && bits <= (family === 4 ? 32 : 128);
}

/**
 * TRUST_PROXY → Fastify `trustProxy`.
 *  - unset / '' / 'false' / '0' → false (X-Forwarded-* ignored; safe default)
 *  - positive integer          → trust that many proxy hops
 *  - comma-separated list      → trust only these IPs / CIDRs, or the
 *                                proxy-addr presets loopback, linklocal,
 *                                uniquelocal
 * 'true' (trust every hop, so any client can spoof its IP) is refused.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = (raw ?? '').trim();
  if (value === '' || value.toLowerCase() === 'false' || value === '0') return false;
  if (value.toLowerCase() === 'true') {
    throw new Error(
      'TRUST_PROXY=true would trust any X-Forwarded-For value. ' +
      'Set a hop count (e.g. 1) or a comma-separated list of proxy IPs/CIDRs.',
    );
  }
  if (/^-?\d+$/.test(value)) {
    const hops = Number(value);
    if (!Number.isSafeInteger(hops) || hops < 1) {
      throw new Error('TRUST_PROXY hop count must be a positive integer');
    }
    return hops;
  }
  const entries = value.split(',').map((e) => e.trim()).filter((e) => e !== '');
  const invalid = entries.filter((e) => !isValidProxyEntry(e));
  if (entries.length === 0 || invalid.length > 0) {
    throw new Error(
      'TRUST_PROXY must be false, a positive hop count, or a comma-separated list of IPs/CIDRs ' +
      `(invalid entries: ${invalid.length})`,
    );
  }
  return entries;
}

// Development-only behaviour (returning reset/setup links, logging them, open
// registration) is keyed off "not production". Refuse to boot on an unset or
// unrecognised NODE_ENV so a misconfigured deployment fails closed instead of
// silently running in development mode.
const NODE_ENVS = ['development', 'test', 'production'] as const;
const NODE_ENV = process.env['NODE_ENV'];
if (!NODE_ENV || !(NODE_ENVS as readonly string[]).includes(NODE_ENV)) {
  throw new Error(`NODE_ENV must be one of ${NODE_ENVS.join(', ')} (got ${NODE_ENV ? `'${NODE_ENV}'` : 'unset'})`);
}

const IS_PRODUCTION = NODE_ENV === 'production';

function parseEnumEnv<T extends string>(key: string, allowed: readonly T[], defaultValue: T): T {
  const value = (process.env[key] ?? '').trim();
  if (value === '') return defaultValue;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`Environment variable ${key} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function parsePositiveIntEnv(key: string, defaultValue: number): number {
  const value = (process.env[key] ?? '').trim();
  if (value === '') return defaultValue;
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new Error(`Environment variable ${key} must be a positive integer`);
  }
  return Number(value);
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

// Requires the env var to exist AND be at least minLength chars in production.
// Generate a suitable value with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
function requireSecret(key: string, minLength = 32): string {
  const value = requireEnv(key);
  if (process.env['NODE_ENV'] === 'production' && value.length < minLength) {
    throw new Error(
      `Environment variable ${key} must be at least ${minLength} characters in production. ` +
      `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return value;
}

export const env = {
  DATABASE_URL:           requireEnv('DATABASE_URL'),
  JWT_SECRET:             requireSecret('JWT_SECRET'),
  JWT_REFRESH_SECRET:     requireSecret('JWT_REFRESH_SECRET'),
  JWT_EXPIRES_IN:         process.env['JWT_EXPIRES_IN']         ?? '15m',
  JWT_REFRESH_EXPIRES_IN: process.env['JWT_REFRESH_EXPIRES_IN'] ?? '7d',
  PORT:                   parseInt(process.env['PORT'] ?? '3001', 10),
  NODE_ENV,
  CORS_ORIGIN:            process.env['CORS_ORIGIN'] ?? 'http://localhost:3000',
  AWS_ACCESS_KEY_ID:      process.env['AWS_ACCESS_KEY_ID']     ?? '',
  AWS_SECRET_ACCESS_KEY:  process.env['AWS_SECRET_ACCESS_KEY'] ?? '',
  AWS_REGION:             process.env['AWS_REGION']             ?? 'us-east-1',
  AWS_S3_BUCKET:          process.env['AWS_S3_BUCKET']          ?? '',
  APP_URL:   process.env['APP_URL']   ?? 'http://localhost:3000',
  SMTP_HOST: process.env['SMTP_HOST'] ?? '',
  SMTP_PORT: parseInt(process.env['SMTP_PORT'] ?? '587', 10),
  SMTP_USER: process.env['SMTP_USER'] ?? '',
  SMTP_PASS: process.env['SMTP_PASS'] ?? '',
  SMTP_FROM: process.env['SMTP_FROM'] ?? 'noreply@constructos.app',
  isProduction: IS_PRODUCTION,
  isTest:       process.env['NODE_ENV'] === 'test',
  // Proxy trust for request.ip / rate limiting. Default: trust nothing.
  TRUST_PROXY: parseTrustProxy(process.env['TRUST_PROXY']) as TrustProxySetting,
  // POST /auth/register. Default: on outside production, off in production.
  ALLOW_PUBLIC_REGISTRATION: flagDefaultOffInProduction(
    'ALLOW_PUBLIC_REGISTRATION', process.env['ALLOW_PUBLIC_REGISTRATION'], IS_PRODUCTION,
  ),
  // GET /events (SSE). Default: on outside production, off in production.
  SSE_ENABLED: flagDefaultOffInProduction('SSE_ENABLED', process.env['SSE_ENABLED'], IS_PRODUCTION),

  // ─── Daily report: private object storage ─────────────────────────────────
  // 'local' for development and tests; 's3' for an S3-compatible private
  // bucket (Cloudflare R2 for the pilot). No credentials have defaults.
  STORAGE_DRIVER: parseEnumEnv('STORAGE_DRIVER', ['local', 's3'] as const, 'local'),
  S3_ENDPOINT:          process.env['S3_ENDPOINT'] ?? '',
  S3_BUCKET:            process.env['S3_BUCKET'] ?? '',
  S3_REGION:            process.env['S3_REGION'] ?? '',
  S3_ACCESS_KEY_ID:     process.env['S3_ACCESS_KEY_ID'] ?? '',
  S3_SECRET_ACCESS_KEY: process.env['S3_SECRET_ACCESS_KEY'] ?? '',
  S3_FORCE_PATH_STYLE:  parseEnvFlag('S3_FORCE_PATH_STYLE', process.env['S3_FORCE_PATH_STYLE'], false),
  // HMAC key for the local driver's short-lived signed URLs.
  FILE_URL_SECRET:      process.env['FILE_URL_SECRET'] ?? '',
  // Local disk is lost on most hosted redeploys; refuse it in production unless explicitly allowed.
  ALLOW_LOCAL_STORAGE_IN_PRODUCTION: parseEnvFlag(
    'ALLOW_LOCAL_STORAGE_IN_PRODUCTION', process.env['ALLOW_LOCAL_STORAGE_IN_PRODUCTION'], false,
  ),

  // ─── Daily report: AI extraction ──────────────────────────────────────────
  // 'fake' is deterministic and makes no network calls; 'disabled' leaves the
  // report fully manual. The Anthropic SDK reads ANTHROPIC_API_KEY itself.
  DAILY_REPORT_AI_PROVIDER: parseEnumEnv(
    'DAILY_REPORT_AI_PROVIDER', ['anthropic', 'fake', 'disabled'] as const,
    NODE_ENV === 'test' ? 'fake' : 'disabled',
  ),
  // Local demos only: a JSON DailyReportDraftV1 the fake provider returns.
  DAILY_REPORT_AI_FAKE_DRAFT_FILE: process.env['DAILY_REPORT_AI_FAKE_DRAFT_FILE'] ?? '',
  DAILY_REPORT_AI_MODEL:      process.env['DAILY_REPORT_AI_MODEL'] || 'claude-sonnet-5-5',
  DAILY_REPORT_AI_TIMEOUT_MS: parsePositiveIntEnv('DAILY_REPORT_AI_TIMEOUT_MS', 45_000),
  DAILY_REPORT_AI_DAILY_CAP_PER_COMPANY: parsePositiveIntEnv('DAILY_REPORT_AI_DAILY_CAP_PER_COMPANY', 200),
};

// The fake AI provider returns canned drafts; it must never serve real users.
if (env.isProduction && env.DAILY_REPORT_AI_PROVIDER === 'fake') {
  throw new Error('DAILY_REPORT_AI_PROVIDER=fake is not allowed in production');
}

// Warn loudly if CORS is still pointing at localhost in production so that the
// Railway deploy log makes the misconfiguration obvious.
if (env.isProduction && env.CORS_ORIGIN.includes('localhost')) {
  console.warn(
    '[WARN] CORS_ORIGIN contains "localhost" in production. ' +
    'Set CORS_ORIGIN to your production web app URL in Railway environment variables.',
  );
}
