/**
 * Production start-up checks that env.ts runs after it has parsed the
 * environment (production only). Kept free of imports so they can be unit
 * tested without loading env.ts.
 *
 * Errors stop the API from starting; warnings are printed to the deploy log.
 * No message ever includes a configured value.
 */

/** Example values published in .env.example. */
const EXAMPLE_SECRETS = new Set([
  'change-this-to-a-long-random-secret-minimum-32-chars',
  'change-this-to-another-long-random-secret-minimum-32-chars',
]);

/** Wording that marks a value as a placeholder rather than a generated secret. */
const PLACEHOLDER_WORDING = /change[-_ ]?(this|me)|replace[-_ ]?(this|me)|your[-_ ]?(jwt[-_ ]?|refresh[-_ ]?)?secret|placeholder|example/i;

/** A generated secret uses many different characters; "aaaa…" or "abab…" does not. */
const MIN_DISTINCT_CHARACTERS = 6;

const GENERATE = `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;

export interface StartupSecretsInput {
  jwtSecret:        string;
  jwtRefreshSecret: string;
}

function secretProblem(value: string): string | null {
  if (EXAMPLE_SECRETS.has(value.trim()) || PLACEHOLDER_WORDING.test(value)) return 'is an example or placeholder value';
  if (new Set(value).size < MIN_DISTINCT_CHARACTERS) return 'is not a random value';
  return null;
}

/** Problems that must stop a production start. */
export function productionStartupErrors(input: StartupSecretsInput): string[] {
  const errors: string[] = [];
  for (const [name, value] of [
    ['JWT_SECRET', input.jwtSecret],
    ['JWT_REFRESH_SECRET', input.jwtRefreshSecret],
  ] as const) {
    const problem = secretProblem(value);
    if (problem) errors.push(`${name} ${problem}. Generate one with: ${GENERATE}`);
  }
  if (input.jwtSecret === input.jwtRefreshSecret) {
    errors.push('JWT_SECRET and JWT_REFRESH_SECRET must be two different values.');
  }
  return errors;
}

export interface StartupWarningsInput {
  sseEnabled:         boolean;
  publicRegistration: boolean;
  corsOrigin:         string;
}

/** Settings that start, but that a production deployment should not run with. */
export function productionStartupWarnings(input: StartupWarningsInput): string[] {
  const warnings: string[] = [];
  if (input.sseEnabled) {
    warnings.push(
      'SSE_ENABLED is on in production; confirm that live updates are intended for this deployment. ' +
      'The web and mobile apps also work with them off.',
    );
  }
  if (input.publicRegistration) {
    warnings.push(
      'ALLOW_PUBLIC_REGISTRATION is on in production: anyone can create a company. Unset it; companies ' +
      'are created by an operator with the create-first-company command.',
    );
  }
  const cors = input.corsOrigin.trim();
  if (!cors.includes('localhost')) {
    let origin: string | null = null;
    try { origin = new URL(cors).origin; } catch { origin = null; }
    if (origin !== cors) {
      warnings.push(
        'CORS_ORIGIN must be exactly the web app origin: scheme and host only, with no path and no ' +
        'trailing slash (for example https://app.example.com). Otherwise the web app cannot load uploaded files.',
      );
    } else if (!cors.startsWith('https://')) {
      warnings.push('CORS_ORIGIN does not use https in production. Set it to the https origin of the web app.');
    }
  }
  return warnings;
}
