/**
 * The /api/v1 rewrite target (api-proxy-target.js, used by next.config.js).
 * API_INTERNAL_URL (server-only) wins when set; otherwise NEXT_PUBLIC_API_URL
 * is used exactly as before. A malformed API_INTERNAL_URL is refused.
 */
import { apiProxyTarget } from '../../api-proxy-target';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const nextConfig = require('../../next.config.js') as {
  rewrites: () => Promise<Array<{ source: string; destination: string }>>;
};

type Env = Record<string, string | undefined>;

describe('apiProxyTarget', () => {
  it('falls back to NEXT_PUBLIC_API_URL unchanged, then the local default', () => {
    expect(apiProxyTarget({ NEXT_PUBLIC_API_URL: 'https://api.example.test' })).toBe('https://api.example.test');
    // Unchanged from before: the public value is used verbatim.
    expect(apiProxyTarget({ NEXT_PUBLIC_API_URL: 'https://api.example.test/' })).toBe('https://api.example.test/');
    expect(apiProxyTarget({})).toBe('http://localhost:3001');
    expect(apiProxyTarget({ API_INTERNAL_URL: '   ', NEXT_PUBLIC_API_URL: 'https://api.example.test' }))
      .toBe('https://api.example.test');
  });

  it('prefers API_INTERNAL_URL when set', () => {
    const env: Env = { API_INTERNAL_URL: 'http://api.railway.internal:8080', NEXT_PUBLIC_API_URL: 'https://api.example.test' };
    expect(apiProxyTarget(env)).toBe('http://api.railway.internal:8080');
  });

  it('normalises API_INTERNAL_URL to origin plus path prefix, without a trailing slash', () => {
    expect(apiProxyTarget({ API_INTERNAL_URL: 'http://api.internal:8080/' })).toBe('http://api.internal:8080');
    expect(apiProxyTarget({ API_INTERNAL_URL: ' https://api.internal/base// ' })).toBe('https://api.internal/base');
    expect(apiProxyTarget({ API_INTERNAL_URL: 'http://[fd12::1]:3001' })).toBe('http://[fd12::1]:3001');
  });

  it.each([
    ['api.internal:8080'],
    ['not a url'],
    ['ftp://api.internal'],
    ['javascript:alert(1)'],
    ['http://user:pass@api.internal'],
    ['http://api.internal/?x=1'],
    ['http://api.internal/#frag'],
    ['http://api.internal?'],
  ])('refuses API_INTERNAL_URL=%j', (value) => {
    expect(() => apiProxyTarget({ API_INTERNAL_URL: value })).toThrow(/API_INTERNAL_URL/);
  });
});

describe('next.config.js rewrite', () => {
  const saved = { internal: process.env.API_INTERNAL_URL, pub: process.env.NEXT_PUBLIC_API_URL };
  afterEach(() => {
    if (saved.internal === undefined) delete process.env.API_INTERNAL_URL; else process.env.API_INTERNAL_URL = saved.internal;
    if (saved.pub === undefined) delete process.env.NEXT_PUBLIC_API_URL; else process.env.NEXT_PUBLIC_API_URL = saved.pub;
  });

  it('targets NEXT_PUBLIC_API_URL when API_INTERNAL_URL is unset', async () => {
    delete process.env.API_INTERNAL_URL;
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test';
    expect(await nextConfig.rewrites()).toEqual([
      { source: '/api/v1/:path*', destination: 'https://api.example.test/api/v1/:path*' },
    ]);
  });

  it('targets API_INTERNAL_URL when set', async () => {
    process.env.API_INTERNAL_URL = 'http://api.railway.internal:8080';
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test';
    expect(await nextConfig.rewrites()).toEqual([
      { source: '/api/v1/:path*', destination: 'http://api.railway.internal:8080/api/v1/:path*' },
    ]);
  });

  it('fails instead of building a rewrite from a malformed API_INTERNAL_URL', async () => {
    process.env.API_INTERNAL_URL = 'api.railway.internal:8080';
    await expect(nextConfig.rewrites()).rejects.toThrow(/API_INTERNAL_URL/);
  });
});
