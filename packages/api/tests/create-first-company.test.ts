/**
 * Operator command that creates a company and its first company_admin
 * (src/scripts/create-first-company.ts).
 *
 *  - creates exactly one company and one administrator, who chooses their own
 *    password through the existing one-time setup link;
 *  - running it again with the same details changes nothing;
 *  - refuses when another company exists unless explicitly allowed;
 *  - refuses NODE_ENV=production without --confirm-production, and without
 *    working email settings;
 *  - never prints the setup link, a token or a password.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { clearDatabase, createTestCompany } from './helpers/fixtures';
import {
  CliDeps,
  EXIT,
  parseArgs,
  runCreateFirstCompany,
  SETUP_LINK_EXPIRES_MINUTES,
} from '../src/scripts/create-first-company';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await clearDatabase();
});

afterEach(() => jest.restoreAllMocks());

const ARGS = [
  '--company-name', 'Pilot Builders Ltd',
  '--currency', 'KES',
  '--country', 'Kenya',
  '--timezone', 'Africa/Nairobi',
  '--admin-email', 'admin@pilot.test',
  '--admin-first-name', 'Ada',
  '--admin-last-name', 'Admin',
];

/** Replaces one flag's value in ARGS. */
function argsWith(flag: string, value: string): string[] {
  const out = [...ARGS];
  out[out.indexOf(flag) + 1] = value;
  return out;
}

interface Run {
  code:  number;
  lines: string[];
  /** Everything printed: the command's own output plus anything sent to console. */
  text:  string;
  sent:  { to: string; link: string }[];
}

async function run(argv: string[], overrides: Partial<CliDeps> = {}): Promise<Run> {
  const lines: string[] = [];
  const consoleLines: string[] = [];
  const record = (...a: unknown[]) => { consoleLines.push(a.map(String).join(' ')); };
  jest.spyOn(console, 'log').mockImplementation(record);
  jest.spyOn(console, 'warn').mockImplementation(record);
  jest.spyOn(console, 'error').mockImplementation(record);
  const sent: { to: string; link: string }[] = [];
  const deps: Partial<CliDeps> = {
    isProduction:   false,
    smtpConfigured: true,
    appUrl:         'https://app.pilot.test',
    sendSetupEmail: async (to, link) => { sent.push({ to, link }); return true; },
    ...overrides,
  };
  const code = await runCreateFirstCompany(argv, { out: (l) => lines.push(l), err: (l) => lines.push(l) }, deps);
  jest.restoreAllMocks();
  return { code, lines, text: [...lines, ...consoleLines].join('\n'), sent };
}

const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;

async function counts() {
  return {
    companies: await prisma.company.count(),
    users:     await prisma.user.count(),
    tokens:    await prisma.passwordResetToken.count(),
    audits:    await prisma.auditLog.count(),
  };
}

/** No run of hex long enough to be a token or the generated password. */
function expectNoSecrets(r: Run) {
  expect(r.text).not.toMatch(/[0-9a-f]{32,}/i);
  expect(r.text).not.toContain('token=');
  for (const { link } of r.sent) expect(r.text).not.toContain(tokenOf(link));
}

describe('first run', () => {
  it('creates one company and one company_admin with a setup link, and prints no secret', async () => {
    const r = await run(ARGS);
    expect(r.code).toBe(EXIT.OK);
    expectNoSecrets(r);

    const companies = await prisma.company.findMany();
    expect(companies).toHaveLength(1);
    expect(companies[0]).toMatchObject({
      name: 'Pilot Builders Ltd', slug: 'pilot-builders-ltd', currency: 'KES', country: 'Kenya', timezone: 'Africa/Nairobi',
    });
    const users = await prisma.user.findMany();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      email: 'admin@pilot.test', firstName: 'Ada', lastName: 'Admin', role: 'company_admin',
      canViewFinance: true, isActive: true, lastLoginAt: null, companyId: companies[0]!.id,
    });
    expect(await prisma.project.count()).toBe(0);

    const tokens = await prisma.passwordResetToken.findMany();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.usedAt).toBeNull();
    const minutes = (tokens[0]!.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(SETUP_LINK_EXPIRES_MINUTES - 2);
    expect(minutes).toBeLessThanOrEqual(SETUP_LINK_EXPIRES_MINUTES);

    const audit = await prisma.auditLog.findMany();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'create', entityType: 'company', entityId: companies[0]!.id, companyId: companies[0]!.id });
    expect(audit[0]!.changesAfter).toMatchObject({ adminEmail: 'admin@pilot.test', source: 'create-first-company' });

    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]!.to).toBe('admin@pilot.test');
    expect(r.sent[0]!.link.startsWith('https://app.pilot.test/reset-password?token=')).toBe(true);
    expect(r.text).toContain(companies[0]!.id);
    expect(r.text).toContain('Setup email sent to admin@pilot.test');
  });

  it('the administrator completes setup through the emailed link and signs in', async () => {
    const r = await run(ARGS);
    expect(r.code).toBe(EXIT.OK);
    const reset = await app.inject({
      method: 'POST', url: '/api/v1/auth/reset-password',
      payload: { token: tokenOf(r.sent[0]!.link), password: 'ChosenPass1!' },
    });
    expect(reset.statusCode).toBe(200);
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email: 'admin@pilot.test', password: 'ChosenPass1!' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().user).toMatchObject({ role: 'company_admin', currency: 'KES', canViewFinance: true });
  });
});

describe('running it again', () => {
  it('with the same details changes nothing and sends nothing', async () => {
    expect((await run(ARGS)).code).toBe(EXIT.OK);
    const before = await counts();
    const again = await run(ARGS);
    expect(again.code).toBe(EXIT.OK);
    expect(again.text).toContain('Nothing was changed');
    expect(again.sent).toHaveLength(0);
    expect(await counts()).toEqual(before);
  });

  it('with different company settings refuses and names the difference', async () => {
    expect((await run(ARGS)).code).toBe(EXIT.OK);
    const before = await counts();
    const r = await run(argsWith('--currency', 'USD'));
    expect(r.code).toBe(EXIT.REFUSED);
    expect(r.text).toContain('--currency');
    expect(await counts()).toEqual(before);
    expect((await prisma.company.findFirstOrThrow()).currency).toBe('KES');
  });

  it('--resend-setup-email issues a new link and the previous one stops working', async () => {
    const first = await run(ARGS);
    const resent = await run([...ARGS, '--resend-setup-email']);
    expect(resent.code).toBe(EXIT.OK);
    expectNoSecrets(resent);
    expect(resent.sent).toHaveLength(1);
    expect(tokenOf(resent.sent[0]!.link)).not.toBe(tokenOf(first.sent[0]!.link));
    expect(await prisma.company.count()).toBe(1);
    expect(await prisma.passwordResetToken.count({ where: { usedAt: null } })).toBe(1);

    const old = await app.inject({
      method: 'POST', url: '/api/v1/auth/reset-password',
      payload: { token: tokenOf(first.sent[0]!.link), password: 'ChosenPass1!' },
    });
    expect(old.statusCode).toBe(401);
    const fresh = await app.inject({
      method: 'POST', url: '/api/v1/auth/reset-password',
      payload: { token: tokenOf(resent.sent[0]!.link), password: 'ChosenPass1!' },
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('--resend-setup-email is refused once the administrator has set a password', async () => {
    const first = await run(ARGS);
    await app.inject({
      method: 'POST', url: '/api/v1/auth/reset-password',
      payload: { token: tokenOf(first.sent[0]!.link), password: 'ChosenPass1!' },
    });
    const before = await prisma.passwordResetToken.count();
    const r = await run([...ARGS, '--resend-setup-email']);
    expect(r.code).toBe(EXIT.REFUSED);
    expect(r.sent).toHaveLength(0);
    expect(await prisma.passwordResetToken.count()).toBe(before);
  });

  it('--resend-setup-email is refused while SMTP is not configured, and keeps the current link', async () => {
    await run(ARGS);
    const r = await run([...ARGS, '--resend-setup-email'], { smtpConfigured: false });
    expect(r.code).toBe(EXIT.REFUSED);
    expect(await prisma.passwordResetToken.count({ where: { usedAt: null } })).toBe(1);
  });
});

describe('refusals', () => {
  it('refuses when another company already exists, unless explicitly allowed', async () => {
    await createTestCompany(app, 'existing');
    const before = await counts();
    const r = await run(ARGS);
    expect(r.code).toBe(EXIT.REFUSED);
    expect(r.text).toContain('already exists');
    expect(r.text).toContain('--allow-existing-companies');
    expect(r.sent).toHaveLength(0);
    expect(await counts()).toEqual(before);

    const allowed = await run([...ARGS, '--allow-existing-companies']);
    expect(allowed.code).toBe(EXIT.OK);
    expect(await prisma.company.count()).toBe(before.companies + 1);
  });

  it('refuses an email that already belongs to another account', async () => {
    const { admin } = await createTestCompany(app, 'other');
    const before = await counts();
    const r = await run([...argsWith('--admin-email', admin.email), '--allow-existing-companies']);
    expect(r.code).toBe(EXIT.REFUSED);
    expect(await counts()).toEqual(before);
  });

  it('refuses a company name that is already taken', async () => {
    await run(ARGS);
    const before = await counts();
    const r = await run([...argsWith('--admin-email', 'second@pilot.test'), '--allow-existing-companies']);
    expect(r.code).toBe(EXIT.REFUSED);
    expect(r.text).toContain('A company with this name already exists');
    expect(await counts()).toEqual(before);
  });

  it('two runs at the same time create only one company', async () => {
    const results = await Promise.all([
      run(ARGS),
      run([...argsWith('--company-name', 'Other Builders Ltd').map((a) => (a === 'admin@pilot.test' ? 'other@pilot.test' : a))]),
    ]);
    expect(results.map((r) => r.code).sort()).toEqual([EXIT.OK, EXIT.REFUSED]);
    expect(await prisma.company.count()).toBe(1);
    expect(await prisma.user.count()).toBe(1);
  });
});

describe('production', () => {
  const prod = { isProduction: true, smtpConfigured: true, appUrl: 'https://app.pilot.test' };

  it('refuses without --confirm-production and writes nothing', async () => {
    const r = await run(ARGS, prod);
    expect(r.code).toBe(EXIT.USAGE);
    expect(r.text).toContain('--confirm-production');
    expect(r.sent).toHaveLength(0);
    expect(await counts()).toEqual({ companies: 0, users: 0, tokens: 0, audits: 0 });
  });

  it('refuses when SMTP is not configured or APP_URL is not https', async () => {
    for (const overrides of [{ smtpConfigured: false }, { appUrl: 'http://app.pilot.test' }]) {
      const r = await run([...ARGS, '--confirm-production'], { ...prod, ...overrides });
      expect(r.code).toBe(EXIT.REFUSED);
      expect(await prisma.company.count()).toBe(0);
    }
  });

  it('runs with --confirm-production and working email settings', async () => {
    const r = await run([...ARGS, '--confirm-production'], prod);
    expect(r.code).toBe(EXIT.OK);
    expectNoSecrets(r);
    expect(await prisma.company.count()).toBe(1);
    expect(r.sent).toHaveLength(1);
  });
});

describe('dry run', () => {
  it('checks everything and writes nothing', async () => {
    const r = await run([...ARGS, '--dry-run']);
    expect(r.code).toBe(EXIT.OK);
    expect(r.text).toContain('Dry run');
    expect(r.sent).toHaveLength(0);
    expect(await counts()).toEqual({ companies: 0, users: 0, tokens: 0, audits: 0 });
  });
});

describe('email delivery', () => {
  it('without SMTP outside production: creates the account, sends nothing and says what to do', async () => {
    let calls = 0;
    const r = await run(ARGS, { smtpConfigured: false, sendSetupEmail: async () => { calls += 1; return true; } });
    expect(r.code).toBe(EXIT.OK);
    expect(calls).toBe(0);
    expect(r.text).toContain('no setup email was sent');
    expect(r.text).toContain('--resend-setup-email');
    expectNoSecrets(r);
    expect(await prisma.user.count()).toBe(1);
  });

  it('a delivery failure keeps the account, exits 3 and prints the error code only', async () => {
    let link = '';
    const r = await run(ARGS, {
      sendSetupEmail: async (_to, l) => {
        link = l;
        throw Object.assign(new Error(`smtp said: ${l}`), { code: 'ECONNREFUSED' });
      },
    });
    expect(r.code).toBe(EXIT.EMAIL_FAILED);
    expect(r.text).toContain('ECONNREFUSED');
    expect(r.text).not.toContain(tokenOf(link));
    expect(await prisma.user.count()).toBe(1);
  });
});

describe('arguments', () => {
  it('parses a complete command line', () => {
    const parsed = parseArgs([...ARGS, '--dry-run']);
    expect(parsed).toEqual({
      options: {
        companyName: 'Pilot Builders Ltd', currency: 'KES', country: 'Kenya', timezone: 'Africa/Nairobi',
        adminEmail: 'admin@pilot.test', adminFirstName: 'Ada', adminLastName: 'Admin',
        dryRun: true, resendSetupEmail: false, allowExistingCompanies: false, confirmProduction: false,
      },
    });
  });

  it.each([
    ['a missing required flag', ARGS.slice(2), '--company-name is required'],
    ['a lower-case currency', argsWith('--currency', 'kes'), '--currency'],
    ['an email with capitals', argsWith('--admin-email', 'Admin@pilot.test'), 'lower case'],
    ['an unknown time zone', argsWith('--timezone', 'Mars/Olympus'), '--timezone'],
    ['an unknown flag', [...ARGS, '--force'], 'unknown argument: --force'],
    ['a repeated flag', [...ARGS, '--currency', 'USD'], 'more than once'],
    ['a flag without its value', [...ARGS.slice(0, -1)], '--admin-last-name needs a value'],
  ])('rejects %s with exit 2 and writes nothing', async (_label, argv, message) => {
    const r = await run(argv);
    expect(r.code).toBe(EXIT.USAGE);
    expect(r.text).toContain(message);
    expect(await prisma.company.count()).toBe(0);
  });
});
