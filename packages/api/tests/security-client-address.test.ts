/**
 * Client address (request.ip) behind reverse proxies.
 *
 * request.ip feeds rate limiting and audit_logs.ipAddress. It comes from
 * Fastify's trustProxy (proxy-addr), configured by TRUST_PROXY:
 *  - unset / false: the socket address; X-Forwarded-For is ignored.
 *  - hop count N:   the address N hops back along X-Forwarded-For.
 *  - address list:  X-Forwarded-For is followed only through the listed
 *                   proxy addresses / CIDRs.
 *
 * The matrix below models the hosted topology. Every proxy appends the address
 * it received the request from to X-Forwarded-For; the Next.js web server's
 * /api/v1 rewrite forwards the header unchanged.
 *  - direct:      phone or browser → platform edge → API
 *  - web public:  browser → edge → web server → edge (public API URL) → API
 *  - web private: browser → edge → web server → private network → API
 *                 (API_INTERNAL_URL on the web server)
 *  - no proxy:    client → API
 * Each request also carries a header value the client set itself, which must
 * never become request.ip.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { env, parseTrustProxy, parseListenHost, TrustProxySetting } from '../src/utils/env';

const EDGE        = '100.64.0.2';    // platform edge, as the API sees it
const WEB_PRIVATE = 'fd12::10';      // web server on the private network
const WEB_EGRESS  = '192.0.2.50';    // web server's public egress address
const CLIENT      = '198.51.100.7';  // the real client
const SPOOF       = '203.0.113.9';   // a value the client put in the header itself

type Path = 'direct' | 'webPublic' | 'webPrivate' | 'noProxy';

const PATHS: Record<Path, { remoteAddress: string; xff: string }> = {
  direct:     { remoteAddress: EDGE,        xff: `${SPOOF}, ${CLIENT}` },
  webPublic:  { remoteAddress: EDGE,        xff: `${SPOOF}, ${CLIENT}, ${WEB_EGRESS}` },
  webPrivate: { remoteAddress: WEB_PRIVATE, xff: `${SPOOF}, ${CLIENT}` },
  noProxy:    { remoteAddress: CLIENT,      xff: SPOOF },
};

type MutableEnv = Record<string, unknown>;

async function withTrustProxy<T>(value: TrustProxySetting, fn: () => Promise<T>): Promise<T> {
  const mutable = env as unknown as MutableEnv;
  const saved = mutable['TRUST_PROXY'];
  mutable['TRUST_PROXY'] = value;
  try {
    return await fn();
  } finally {
    mutable['TRUST_PROXY'] = saved;
  }
}

/** request.ip for each path, from an app built with TRUST_PROXY = `value`. */
async function addressesSeen(value: TrustProxySetting): Promise<Record<Path, string>> {
  return withTrustProxy(value, async () => {
    const probe: FastifyInstance = await buildApp();
    probe.get('/__probe/ip', async (req) => ({ ip: req.ip }));
    await probe.ready();
    try {
      const out = {} as Record<Path, string>;
      for (const [name, p] of Object.entries(PATHS) as [Path, { remoteAddress: string; xff: string }][]) {
        const res = await probe.inject({
          method: 'GET', url: '/__probe/ip', remoteAddress: p.remoteAddress,
          headers: { 'x-forwarded-for': p.xff },
        });
        out[name] = res.json().ip as string;
      }
      return out;
    } finally {
      await probe.close();
    }
  });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('TRUST_PROXY parsing', () => {
  it('unset, empty, false and 0 trust no proxy', () => {
    for (const raw of [undefined, '', '  ', 'false', 'FALSE', '0']) {
      expect(parseTrustProxy(raw)).toBe(false);
    }
  });

  it('accepts a positive hop count', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
  });

  it('accepts a comma-separated list of addresses, CIDRs and proxy-addr presets', () => {
    expect(parseTrustProxy('100.64.0.0/10, fd12::/16')).toEqual(['100.64.0.0/10', 'fd12::/16']);
    expect(parseTrustProxy('10.1.2.3,::1,loopback,linklocal,uniquelocal'))
      .toEqual(['10.1.2.3', '::1', 'loopback', 'linklocal', 'uniquelocal']);
    expect(parseTrustProxy('10.0.0.0/8,')).toEqual(['10.0.0.0/8']);
  });

  it.each([
    ['true'], ['TRUE'], ['-1'], ['1.5'], ['+1'], ['99999999999999999999'],
    ['not-an-ip'], ['10.0.0.0/33'], ['fd12::/129'], ['10.0.0.0/8/1'], ['10.0.0.0/'],
    ['1,10.0.0.1'], ['10.0.0.1 10.0.0.2'], [','], ['*'], ['all'], ['example.com'],
  ])('refuses %j', (raw) => {
    expect(() => parseTrustProxy(raw)).toThrow(/TRUST_PROXY/);
  });

  it('names the entries it refuses, so the boot failure says what to fix', () => {
    expect(() => parseTrustProxy('10.0.0.1, 10.0.0.0/99, proxy.internal'))
      .toThrow(/invalid entries: "10\.0\.0\.0\/99", "proxy\.internal"/);
    expect(() => parseTrustProxy(',')).toThrow(/the list is empty/);
  });
});

describe('LISTEN_HOST parsing', () => {
  it('defaults to 0.0.0.0 as before', () => {
    expect(parseListenHost(undefined)).toBe('0.0.0.0');
    expect(parseListenHost('')).toBe('0.0.0.0');
  });

  it('accepts IP literals', () => {
    expect(parseListenHost('::')).toBe('::');
    expect(parseListenHost(' 127.0.0.1 ')).toBe('127.0.0.1');
  });

  it.each([['localhost'], ['example.com'], ['0.0.0.0:3001'], ['[::]']])('refuses %j', (raw) => {
    expect(() => parseListenHost(raw)).toThrow(/LISTEN_HOST/);
  });
});

describe('request.ip by TRUST_PROXY and path (spoofed X-Forwarded-For on every request)', () => {
  it('the test environment trusts no proxy by default', () => {
    expect(env.TRUST_PROXY).toBe(false);
  });

  it('none: the socket address, header ignored', async () => {
    expect(await addressesSeen(false)).toEqual({
      direct: EDGE, webPublic: EDGE, webPrivate: WEB_PRIVATE, noProxy: CLIENT,
    });
  });

  it('1 hop: the client on the direct and private web paths; the web server on the public web path', async () => {
    const seen = await addressesSeen(1);
    expect(seen.direct).toBe(CLIENT);
    expect(seen.webPrivate).toBe(CLIENT);
    expect(seen.webPublic).toBe(WEB_EGRESS);
    // A hop count above the real number of proxies takes the address from the header.
    expect(seen.noProxy).toBe(SPOOF);
  });

  it('2 hops: the client on the public web path only; one-proxy paths take the header value', async () => {
    const seen = await addressesSeen(2);
    expect(seen.webPublic).toBe(CLIENT);
    expect(seen.direct).toBe(SPOOF);
    expect(seen.webPrivate).toBe(SPOOF);
  });

  it('address list (edge + private network): the client on direct and private web paths, header ignored from anyone else', async () => {
    const seen = await addressesSeen(parseTrustProxy('100.64.0.0/10,fd12::/16'));
    expect(seen).toEqual({
      direct: CLIENT, webPublic: WEB_EGRESS, webPrivate: CLIENT, noProxy: CLIENT,
    });
  });

  it('address list that also names the web egress: the client on every proxied path', async () => {
    const seen = await addressesSeen(parseTrustProxy(`100.64.0.0/10,${WEB_EGRESS}`));
    expect(seen.direct).toBe(CLIENT);
    expect(seen.webPublic).toBe(CLIENT);
    expect(seen.noProxy).toBe(CLIENT);
  });

  it('a client address arriving without any header of its own is used as is', async () => {
    const res = await withTrustProxy(1, async () => {
      const probe = await buildApp();
      probe.get('/__probe/ip', async (req) => ({ ip: req.ip }));
      await probe.ready();
      try {
        return await probe.inject({
          method: 'GET', url: '/__probe/ip', remoteAddress: WEB_PRIVATE,
          headers: { 'x-forwarded-for': CLIENT },
        });
      } finally {
        await probe.close();
      }
    });
    expect(res.json().ip).toBe(CLIENT);
  });
});
