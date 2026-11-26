/**
 * Production start-up checks (src/utils/production-checks.ts, run by env.ts):
 *  - the API refuses to start in production with the token secrets from
 *    .env.example, placeholder wording, a non-random value, or the same value
 *    for JWT_SECRET and JWT_REFRESH_SECRET;
 *  - it warns when live updates or public registration are on, or when
 *    CORS_ORIGIN is not exactly an https origin;
 *  - no message contains a configured value; nothing changes outside production.
 */
import crypto from 'crypto';
import { productionStartupErrors, productionStartupWarnings } from '../src/utils/production-checks';

const random = () => crypto.randomBytes(32).toString('hex');
const EXAMPLE_ACCESS  = 'change-this-to-a-long-random-secret-minimum-32-chars';
const EXAMPLE_REFRESH = 'change-this-to-another-long-random-secret-minimum-32-chars';

describe('productionStartupErrors', () => {
  it('accepts two different generated secrets', () => {
    for (let i = 0; i < 50; i++) {
      expect(productionStartupErrors({ jwtSecret: random(), jwtRefreshSecret: random() })).toEqual([]);
    }
    // base64 secrets too
    expect(productionStartupErrors({
      jwtSecret: crypto.randomBytes(32).toString('base64'), jwtRefreshSecret: crypto.randomBytes(32).toString('base64'),
    })).toEqual([]);
  });

  it('refuses the values published in .env.example', () => {
    const errors = productionStartupErrors({ jwtSecret: EXAMPLE_ACCESS, jwtRefreshSecret: EXAMPLE_REFRESH });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^JWT_SECRET is an example or placeholder value/);
    expect(errors[1]).toMatch(/^JWT_REFRESH_SECRET is an example or placeholder value/);
  });

  it.each([
    'please-change-this-secret-before-deploying-0001',
    'CHANGEME-CHANGEME-CHANGEME-CHANGEME-1234',
    'replace-me-with-a-real-secret-value-0001',
    'your-jwt-secret-goes-here-at-least-32-characters',
    'placeholder-placeholder-placeholder-123',
    'example-secret-value-for-documentation-01',
  ])('refuses placeholder wording: %s', (value) => {
    const errors = productionStartupErrors({ jwtSecret: value, jwtRefreshSecret: random() });
    expect(errors).toEqual([expect.stringMatching(/^JWT_SECRET is an example or placeholder value/)]);
  });

  it('refuses a value that is not random', () => {
    const errors = productionStartupErrors({ jwtSecret: random(), jwtRefreshSecret: 'ab'.repeat(20) });
    expect(errors).toEqual([expect.stringMatching(/^JWT_REFRESH_SECRET is not a random value/)]);
    expect(productionStartupErrors({ jwtSecret: 'x'.repeat(64), jwtRefreshSecret: random() })).toHaveLength(1);
  });

  it('refuses the same value for both secrets', () => {
    const same = random();
    expect(productionStartupErrors({ jwtSecret: same, jwtRefreshSecret: same }))
      .toEqual(['JWT_SECRET and JWT_REFRESH_SECRET must be two different values.']);
  });

  it('never includes a configured value in a message', () => {
    const same = `${random()}`;
    for (const input of [
      { jwtSecret: same, jwtRefreshSecret: same },
      { jwtSecret: EXAMPLE_ACCESS, jwtRefreshSecret: 'ab'.repeat(20) },
    ]) {
      const text = productionStartupErrors(input).join('\n');
      expect(text).not.toContain(input.jwtSecret);
      expect(text).not.toContain(input.jwtRefreshSecret);
    }
  });
});

describe('productionStartupWarnings', () => {
  const GOOD = { sseEnabled: false, publicRegistration: false, corsOrigin: 'https://app.example.com' };

  it('is silent for the recommended production settings', () => {
    expect(productionStartupWarnings(GOOD)).toEqual([]);
  });

  it('warns when live updates are on', () => {
    expect(productionStartupWarnings({ ...GOOD, sseEnabled: true }))
      .toEqual([expect.stringContaining('SSE_ENABLED is on in production')]);
  });

  it('warns when public registration is on', () => {
    expect(productionStartupWarnings({ ...GOOD, publicRegistration: true }))
      .toEqual([expect.stringContaining('ALLOW_PUBLIC_REGISTRATION is on in production')]);
  });

  it.each(['https://app.example.com/', 'https://app.example.com/app', 'app.example.com', ''])(
    'warns when CORS_ORIGIN is not exactly an origin: %p',
    (corsOrigin) => {
      expect(productionStartupWarnings({ ...GOOD, corsOrigin }))
        .toEqual([expect.stringContaining('CORS_ORIGIN must be exactly the web app origin')]);
    },
  );

  it('warns when CORS_ORIGIN is not https', () => {
    expect(productionStartupWarnings({ ...GOOD, corsOrigin: 'http://app.example.com' }))
      .toEqual([expect.stringContaining('CORS_ORIGIN does not use https')]);
  });

  it('leaves a localhost CORS_ORIGIN to the existing localhost warning', () => {
    expect(productionStartupWarnings({ ...GOOD, corsOrigin: 'http://localhost:3000' })).toEqual([]);
  });
});

describe('start-up', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    jest.restoreAllMocks();
  });

  /** Loads env.ts with the given environment; returns the thrown message (or null) and the warnings. */
  function boot(overrides: Record<string, string | undefined>): { error: string | null; warnings: string[] } {
    process.env = {
      ...saved,
      DAILY_REPORT_AI_PROVIDER: 'disabled',
      APP_URL: 'https://app.example.com', SMTP_HOST: 'smtp.example.com', TRUST_PROXY: '1',
      CORS_ORIGIN: 'https://app.example.com',
      JWT_SECRET: random(), JWT_REFRESH_SECRET: random(),
      ...overrides,
    };
    for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete process.env[k];
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let error: string | null = null;
    jest.isolateModules(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('../src/utils/env');
      } catch (err) {
        error = (err as Error).message;
      }
    });
    return { error, warnings: warn.mock.calls.map((c) => String(c[0])) };
  }

  it('starts in production with generated secrets and prints no warning', () => {
    const r = boot({ NODE_ENV: 'production' });
    expect(r.error).toBeNull();
    expect(r.warnings).toEqual([]);
  });

  it('refuses to start in production with the .env.example secrets', () => {
    const r = boot({ NODE_ENV: 'production', JWT_SECRET: EXAMPLE_ACCESS, JWT_REFRESH_SECRET: EXAMPLE_REFRESH });
    expect(r.error).toMatch(/^Refusing to start in production: JWT_SECRET is an example or placeholder value/);
    expect(r.error).not.toContain(EXAMPLE_ACCESS);
  });

  it('refuses to start in production with the same value for both secrets', () => {
    const same = random();
    const r = boot({ NODE_ENV: 'production', JWT_SECRET: same, JWT_REFRESH_SECRET: same });
    expect(r.error).toContain('must be two different values');
    expect(r.error).not.toContain(same);
  });

  it('warns in production when live updates and public registration are switched on', () => {
    const r = boot({ NODE_ENV: 'production', SSE_ENABLED: 'true', ALLOW_PUBLIC_REGISTRATION: 'true' });
    expect(r.error).toBeNull();
    expect(r.warnings.some((w) => w.startsWith('[WARN] SSE_ENABLED is on in production'))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith('[WARN] ALLOW_PUBLIC_REGISTRATION is on in production'))).toBe(true);
  });

  it('changes nothing outside production', () => {
    for (const NODE_ENV of ['development', 'test']) {
      const r = boot({ NODE_ENV, JWT_SECRET: EXAMPLE_ACCESS, JWT_REFRESH_SECRET: EXAMPLE_ACCESS, SSE_ENABLED: 'true' });
      expect(r.error).toBeNull();
      expect(r.warnings).toEqual([]);
    }
  });
});
