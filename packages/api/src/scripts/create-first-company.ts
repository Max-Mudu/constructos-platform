/**
 * Operator command: creates a company and its first company administrator.
 *
 * Production has no public sign-up (ALLOW_PUBLIC_REGISTRATION is off), so the
 * first company of a new environment is created with this command, run once
 * in the API service's own environment:
 *
 *   node dist/scripts/create-first-company.js \
 *     --company-name "Example Builders Ltd" --currency KES \
 *     --country Kenya --timezone Africa/Nairobi \
 *     --admin-email admin@example.com --admin-first-name Ada --admin-last-name Admin \
 *     --confirm-production
 *
 * (Development: `npx tsx src/scripts/create-first-company.ts ...`.)
 *
 * Behaviour:
 *  - The administrator gets a random password nobody sees and chooses their
 *    own through the same one-time setup link (60 minutes, single use) that
 *    admin-created users receive. The link is emailed; this command never
 *    prints it, the password or any token.
 *  - Running it again with the same details changes nothing and exits 0.
 *    --resend-setup-email then sends a fresh link if the administrator has
 *    not set a password yet (the previous link stops working).
 *  - It refuses to create a company when any company already exists, unless
 *    --allow-existing-companies is given.
 *  - With NODE_ENV=production it refuses to run without --confirm-production,
 *    and refuses to create the account while SMTP_HOST is unset or APP_URL is
 *    not https (the administrator could not receive a working link).
 *  - --dry-run checks everything and writes nothing.
 *
 * Exit codes: 0 done or nothing to do; 1 refused (conflict with existing
 * data); 2 invalid arguments or unconfirmed production run; 3 the account
 * exists but the setup email could not be sent.
 */
import 'dotenv/config';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { env } from '../utils/env';
import { generateToken, hashPassword, hashToken } from '../utils/hash';
import { emailService } from '../services/email.service';

/** Same window as admin-created users' setup links (user.service). */
export const SETUP_LINK_EXPIRES_MINUTES = 60;

const AUDIT_SOURCE = 'create-first-company';

export const EXIT = { OK: 0, REFUSED: 1, USAGE: 2, EMAIL_FAILED: 3 } as const;

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

export interface CliDeps {
  isProduction:      boolean;
  smtpConfigured:    boolean;
  appUrl:            string;
  /** Resolves true when SMTP accepted the message; rejects on delivery failure. */
  sendSetupEmail:    (to: string, link: string) => Promise<boolean>;
}

function defaultDeps(): CliDeps {
  return {
    isProduction:   env.isProduction,
    smtpConfigured: env.SMTP_HOST.trim() !== '',
    appUrl:         env.APP_URL,
    sendSetupEmail: (to, link) => emailService.sendAccountSetupEmail(to, link),
  };
}

export const USAGE = [
  'Usage: create-first-company --company-name <name> --currency <ISO 4217 code>',
  '         --admin-email <email> --admin-first-name <name> --admin-last-name <name>',
  '         [--country <name>] [--timezone <IANA zone>]',
  '         [--dry-run] [--resend-setup-email] [--allow-existing-companies] [--confirm-production]',
].join('\n');

const VALUE_FLAGS = {
  '--company-name':     'companyName',
  '--currency':         'currency',
  '--country':          'country',
  '--timezone':         'timezone',
  '--admin-email':      'adminEmail',
  '--admin-first-name': 'adminFirstName',
  '--admin-last-name':  'adminLastName',
} as const;

const SWITCHES = {
  '--dry-run':                  'dryRun',
  '--resend-setup-email':       'resendSetupEmail',
  '--allow-existing-companies': 'allowExistingCompanies',
  '--confirm-production':       'confirmProduction',
} as const;

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const optionsSchema = z.object({
  companyName:    z.string().trim().min(2, 'must be 2 to 255 characters').max(255, 'must be 2 to 255 characters'),
  currency:       z.string().regex(/^[A-Z]{3}$/, 'must be a three-letter ISO 4217 code in capitals, e.g. KES'),
  country:        z.string().trim().min(1).max(100).optional(),
  timezone:       z.string().refine(isValidTimeZone, 'must be an IANA time zone, e.g. Africa/Nairobi').optional(),
  adminEmail:     z.string().trim().email('must be an email address')
    .refine((v) => v === v.toLowerCase(), 'must be written in lower case'),
  adminFirstName: z.string().trim().min(1, 'must be 1 to 100 characters').max(100, 'must be 1 to 100 characters'),
  adminLastName:  z.string().trim().min(1, 'must be 1 to 100 characters').max(100, 'must be 1 to 100 characters'),
  dryRun:                 z.boolean(),
  resendSetupEmail:       z.boolean(),
  allowExistingCompanies: z.boolean(),
  confirmProduction:      z.boolean(),
});

export type CliOptions = z.infer<typeof optionsSchema>;

/** Parses argv strictly: unknown flags, repeats and missing values are errors. */
export function parseArgs(argv: string[]): { options: CliOptions } | { errors: string[] } {
  const raw: Record<string, unknown> = {
    dryRun: false, resendSetupEmail: false, allowExistingCompanies: false, confirmProduction: false,
  };
  const errors: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (seen.has(arg)) { errors.push(`${arg} is given more than once`); continue; }
    seen.add(arg);
    if (arg in SWITCHES) {
      raw[SWITCHES[arg as keyof typeof SWITCHES]] = true;
    } else if (arg in VALUE_FLAGS) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) { errors.push(`${arg} needs a value`); continue; }
      raw[VALUE_FLAGS[arg as keyof typeof VALUE_FLAGS]] = value;
      i += 1;
    } else {
      errors.push(`unknown argument: ${arg.startsWith('--') ? arg : '(a value without a flag)'}`);
    }
  }
  const required: (keyof typeof VALUE_FLAGS)[] = [
    '--company-name', '--currency', '--admin-email', '--admin-first-name', '--admin-last-name',
  ];
  for (const flag of required) if (!seen.has(flag)) errors.push(`${flag} is required`);
  if (errors.length > 0) return { errors };

  const parsed = optionsSchema.safeParse(raw);
  if (!parsed.success) {
    const flagFor = (key: string) =>
      Object.entries(VALUE_FLAGS).find(([, k]) => k === key)?.[0] ?? key;
    return {
      errors: parsed.error.issues.map((issue) => `${flagFor(String(issue.path[0]))} ${issue.message}`),
    };
  }
  return { options: parsed.data };
}

/** Same slug rule as self-registration (auth.service). */
export function companySlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').substring(0, 60);
}

/** Serialises concurrent runs so the "no company yet" check cannot race. */
async function lockOnboarding(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'create-first-company'}::text, 0))`;
}

class Refusal extends Error {
  constructor(message: string, readonly exitCode: number = EXIT.REFUSED) {
    super(message);
  }
}

interface SetupLink { userId: string; email: string; link: string }

async function issueSetupLink(
  tx: Prisma.TransactionClient,
  userId: string,
  email: string,
  appUrl: string,
): Promise<SetupLink> {
  const rawToken = generateToken(48);
  await tx.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + SETUP_LINK_EXPIRES_MINUTES * 60 * 1000),
    },
  });
  return { userId, email, link: `${appUrl}/reset-password?token=${rawToken}` };
}

/** Finds the existing company and administrator these options describe, if any. */
async function findExisting(options: CliOptions, slug: string) {
  const user = await prisma.user.findUnique({
    where:  { email: options.adminEmail },
    select: {
      id: true, role: true, isActive: true, lastLoginAt: true, companyId: true,
      company: { select: { id: true, slug: true, name: true, currency: true, country: true, timezone: true } },
    },
  });
  const company = await prisma.company.findUnique({ where: { slug }, select: { id: true } });
  return { user, company };
}

async function resendSetupLink(userId: string, companyId: string, email: string, appUrl: string): Promise<SetupLink> {
  return prisma.$transaction(async (tx) => {
    await lockOnboarding(tx);
    const user = await tx.user.findUniqueOrThrow({
      where:  { id: userId },
      select: { isActive: true, lastLoginAt: true },
    });
    const setupCompleted = await tx.auditLog.findFirst({
      where: {
        userId,
        entityType:   'auth',
        changesAfter: { path: ['event'], equals: 'password_reset_completed' },
      },
      select: { id: true },
    });
    if (!user.isActive || user.lastLoginAt !== null || setupCompleted) {
      throw new Refusal(
        'The administrator has already set a password or signed in (or is deactivated): no link was sent. ' +
        'They can use "Forgot password" on the sign-in page.',
      );
    }
    const invalidated = await tx.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data:  { usedAt: new Date() },
    });
    const link = await issueSetupLink(tx, userId, email, appUrl);
    await tx.auditLog.create({
      data: {
        companyId,
        action:       'update',
        entityType:   'user',
        entityId:     userId,
        changesAfter: { event: 'setup_link_reissued', setupTokensInvalidated: invalidated.count, source: AUDIT_SOURCE },
      },
    });
    return link;
  });
}

async function createCompanyAndAdmin(options: CliOptions, slug: string, appUrl: string) {
  // bcrypt is slow: hash outside the transaction. The plaintext is never
  // returned, printed or stored.
  const passwordHash = await hashPassword(generateToken(32));
  return prisma.$transaction(async (tx) => {
    await lockOnboarding(tx);
    // Checked again under the lock: another run may have finished meanwhile.
    const companies = await tx.company.count();
    if (companies > 0 && !options.allowExistingCompanies) {
      throw new Refusal(existingCompaniesMessage(companies));
    }
    if (await tx.company.findUnique({ where: { slug }, select: { id: true } })) {
      throw new Refusal('A company with this name already exists. Nothing was changed.');
    }
    if (await tx.user.findUnique({ where: { email: options.adminEmail }, select: { id: true } })) {
      throw new Refusal('An account with this email already exists. Nothing was changed.');
    }

    const company = await tx.company.create({
      data: {
        name:     options.companyName,
        slug,
        currency: options.currency,
        ...(options.country  !== undefined && { country:  options.country }),
        ...(options.timezone !== undefined && { timezone: options.timezone }),
      },
      select: { id: true, slug: true },
    });
    const admin = await tx.user.create({
      data: {
        companyId:      company.id,
        email:          options.adminEmail,
        passwordHash,
        firstName:      options.adminFirstName,
        lastName:       options.adminLastName,
        role:           'company_admin',
        canViewFinance: true,
      },
      select: { id: true, email: true },
    });
    const link = await issueSetupLink(tx, admin.id, admin.email, appUrl);
    await tx.auditLog.create({
      data: {
        companyId:    company.id,
        action:       'create',
        entityType:   'company',
        entityId:     company.id,
        changesAfter: {
          companyName: options.companyName,
          adminUserId: admin.id,
          adminEmail:  admin.email,
          adminRole:   'company_admin',
          source:      AUDIT_SOURCE,
        },
      },
    });
    return { company, admin, link };
  });
}

function existingCompaniesMessage(count: number): string {
  return `${count} ${count === 1 ? 'company already exists' : 'companies already exist'} in this database. ` +
    'This command creates the first company. Nothing was changed. ' +
    'Re-run with --allow-existing-companies only if you mean to add another company.';
}

/** Sends the setup email and reports the outcome. Never prints the link. */
async function deliverSetupLink(setup: SetupLink, io: CliIo, deps: CliDeps): Promise<number> {
  if (!deps.smtpConfigured) {
    io.out(
      'SMTP is not configured, so no setup email was sent. Once SMTP works, run this command again with ' +
      '--resend-setup-email, or ask the administrator to use "Forgot password" on the sign-in page.',
    );
    return EXIT.OK;
  }
  try {
    const sent = await deps.sendSetupEmail(setup.email, setup.link);
    if (sent) {
      io.out(`Setup email sent to ${setup.email}. The link works once and expires in ${SETUP_LINK_EXPIRES_MINUTES} minutes.`);
      return EXIT.OK;
    }
    io.out('No setup email was sent (SMTP is not configured).');
    return EXIT.OK;
  } catch (err) {
    const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : 'unknown';
    io.err(
      `The account exists, but the setup email could not be sent (error code: ${code}). ` +
      'Fix SMTP, then run this command again with --resend-setup-email.',
    );
    return EXIT.EMAIL_FAILED;
  }
}

export async function runCreateFirstCompany(
  argv: string[],
  io: CliIo,
  overrides: Partial<CliDeps> = {},
): Promise<number> {
  const deps: CliDeps = { ...defaultDeps(), ...overrides };

  if (argv.includes('--help') || argv.includes('-h')) {
    io.out(USAGE);
    return EXIT.OK;
  }

  const parsed = parseArgs(argv);
  if ('errors' in parsed) {
    for (const e of parsed.errors) io.err(`error: ${e}`);
    io.err(USAGE);
    return EXIT.USAGE;
  }
  const options = parsed.options;

  // Before any database access.
  if (deps.isProduction && !options.confirmProduction) {
    io.err(
      'Refused: NODE_ENV is production. Check that DATABASE_URL is the database you mean to change, ' +
      'then run again with --confirm-production.',
    );
    return EXIT.USAGE;
  }

  const slug = companySlug(options.companyName);
  if (!slug) {
    io.err('error: --company-name must contain at least one letter or digit');
    return EXIT.USAGE;
  }

  try {
    const existing = await findExisting(options, slug);

    // ── Already onboarded: nothing to create ─────────────────────────────
    if (existing.user) {
      const { user } = existing;
      if (user.company.slug !== slug || user.role !== 'company_admin') {
        throw new Refusal('An account with this email already exists in another company or with another role. Nothing was changed.');
      }
      const differences = ([
        ['--company-name', user.company.name, options.companyName],
        ['--currency', user.company.currency, options.currency],
        ...(options.country  !== undefined ? [['--country', user.company.country, options.country]] : []),
        ...(options.timezone !== undefined ? [['--timezone', user.company.timezone, options.timezone]] : []),
      ] as [string, string | null, string][]).filter(([, have, want]) => have !== want).map(([flag]) => flag);
      if (differences.length > 0) {
        throw new Refusal(
          `This company and administrator already exist, but with a different ${differences.join(', ')}. Nothing was changed.`,
        );
      }
      io.out(`Already set up: company ${user.company.id} (${slug}) with administrator ${user.id}. Nothing was changed.`);
      if (!options.resendSetupEmail) return EXIT.OK;
      if (!deps.smtpConfigured) {
        throw new Refusal('--resend-setup-email: SMTP is not configured, so no link could be delivered. Nothing was changed.');
      }
      if (options.dryRun) {
        io.out('Dry run: a new setup link would be issued and emailed. Nothing was written.');
        return EXIT.OK;
      }
      const setup = await resendSetupLink(user.id, user.company.id, options.adminEmail, deps.appUrl);
      io.out('A new setup link was issued; earlier links no longer work.');
      return deliverSetupLink(setup, io, deps);
    }

    if (options.resendSetupEmail) {
      throw new Refusal('--resend-setup-email: no administrator with this email exists yet. Nothing was changed.');
    }
    if (existing.company) {
      throw new Refusal('A company with this name already exists. Nothing was changed.');
    }
    const companies = await prisma.company.count();
    if (companies > 0 && !options.allowExistingCompanies) {
      throw new Refusal(existingCompaniesMessage(companies));
    }

    // A production administrator must be able to receive a working link.
    if (deps.isProduction) {
      const problems: string[] = [];
      if (!deps.smtpConfigured) problems.push('SMTP_HOST is not set');
      if (!deps.appUrl.startsWith('https://')) problems.push('APP_URL is not an https URL');
      if (problems.length > 0) {
        io.err(`Refused: ${problems.join(' and ')}, so the administrator could not receive a working setup link. Nothing was changed.`);
        return EXIT.REFUSED;
      }
    }

    if (options.dryRun) {
      io.out(
        `Dry run: would create company "${options.companyName}" (${slug}, ${options.currency}) and ` +
        `administrator ${options.adminEmail}, then email a setup link. Nothing was written.`,
      );
      return EXIT.OK;
    }

    const created = await createCompanyAndAdmin(options, slug, deps.appUrl);
    io.out(`Created company ${created.company.id} (${created.company.slug}) and administrator ${created.admin.id}.`);
    io.out('The administrator chooses their own password through the setup link. Next: they sign in and create the project and site.');
    return deliverSetupLink(created.link, io, deps);
  } catch (err) {
    if (err instanceof Refusal) {
      io.err(`Refused: ${err.message}`);
      return err.exitCode;
    }
    // A concurrent run created the same company or account first.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      io.err('Refused: the company or the account was created by another run at the same time. Run again to check.');
      return EXIT.REFUSED;
    }
    throw err;
  }
}

/* istanbul ignore next -- process entry point */
if (require.main === module) {
  const io: CliIo = { out: (l) => console.log(l), err: (l) => console.error(l) };
  runCreateFirstCompany(process.argv.slice(2), io)
    .catch((err: unknown) => {
      // The message only: an error object can carry connection details.
      console.error(`Failed: ${err instanceof Error ? err.message.split('\n')[0] : 'unknown error'}`);
      return 1;
    })
    .then(async (code) => {
      await prisma.$disconnect();
      process.exit(code);
    });
}
