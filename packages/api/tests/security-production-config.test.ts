/**
 * Security regression: production boot warns about settings that silently
 * break password reset / account setup or defeat the rate limits.
 *  - APP_URL unset → reset/setup links point at http://localhost:3000;
 *    APP_URL on http → tokens travel in clear text.
 *  - SMTP_HOST unset → reset/setup emails are never sent.
 *  - TRUST_PROXY unset → behind Railway's proxy every client shares one IP
 *    for the 100/min global and 5/15min forgot-password limits.
 * These are warnings only, so an existing deployment never fails to boot.
 */
import { productionConfigWarnings } from '../src/utils/env';

const GOOD = { appUrl: 'https://app.example.com', smtpHost: 'smtp.example.com', trustProxy: 1 as const };

describe('productionConfigWarnings', () => {
  it('is silent for a complete configuration', () => {
    expect(productionConfigWarnings(GOOD)).toEqual([]);
    expect(productionConfigWarnings({ ...GOOD, trustProxy: ['10.0.0.0/8'] })).toEqual([]);
  });

  it('warns when APP_URL is unset or blank', () => {
    for (const appUrl of [undefined, '', '   ']) {
      const w = productionConfigWarnings({ ...GOOD, appUrl });
      expect(w).toHaveLength(1);
      expect(w[0]).toContain('APP_URL is not set');
    }
  });

  it('warns when APP_URL is not https', () => {
    const w = productionConfigWarnings({ ...GOOD, appUrl: 'http://app.example.com' });
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('does not use https');
  });

  it('warns when SMTP_HOST is unset', () => {
    const w = productionConfigWarnings({ ...GOOD, smtpHost: '' });
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('SMTP_HOST is not set');
  });

  it('warns when TRUST_PROXY is unset', () => {
    const w = productionConfigWarnings({ ...GOOD, trustProxy: false });
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('TRUST_PROXY is not set');
  });
});

describe('production boot', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    jest.restoreAllMocks();
  });

  function bootEnv(overrides: Record<string, string | undefined>) {
    process.env = { ...saved, NODE_ENV: 'production', DAILY_REPORT_AI_PROVIDER: 'disabled', ...overrides };
    for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete process.env[k];
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../src/utils/env');
    });
    return warn.mock.calls.map((c) => String(c[0]));
  }

  it('prints every applicable warning and still boots', () => {
    const lines = bootEnv({ APP_URL: undefined, SMTP_HOST: undefined, TRUST_PROXY: undefined, CORS_ORIGIN: 'https://app.example.com' });
    expect(lines.some((l) => l.includes('APP_URL is not set'))).toBe(true);
    expect(lines.some((l) => l.includes('SMTP_HOST is not set'))).toBe(true);
    expect(lines.some((l) => l.includes('TRUST_PROXY is not set'))).toBe(true);
  });

  it('prints none of them for a complete configuration', () => {
    const lines = bootEnv({
      APP_URL: 'https://app.example.com', SMTP_HOST: 'smtp.example.com', TRUST_PROXY: '1',
      CORS_ORIGIN: 'https://app.example.com',
    });
    expect(lines.filter((l) => /APP_URL|SMTP_HOST|TRUST_PROXY/.test(l))).toEqual([]);
  });

  it('never warns outside production', () => {
    process.env = { ...saved, NODE_ENV: 'development' };
    delete process.env['APP_URL'];
    delete process.env['SMTP_HOST'];
    delete process.env['TRUST_PROXY'];
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../src/utils/env');
    });
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => /APP_URL|SMTP_HOST|TRUST_PROXY/.test(l))).toEqual([]);
  });
});
