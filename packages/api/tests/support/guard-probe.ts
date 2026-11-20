/**
 * Child-process probe for tests/test-database-guard.test.ts (not a test file).
 *
 *   tsx tests/support/guard-probe.ts setup   - loads the real jest setup file
 *     (tests/setup.ts), then the app's Prisma client, and runs a query, which is
 *     what every database test file does.
 *   tsx tests/support/guard-probe.ts global  - runs the real jest globalSetup.
 *
 * The test points it at an unreachable port, so even a broken guard cannot
 * reach a real database. "PROBE:" lines show how far it got.
 */
async function main(mode: string | undefined): Promise<void> {
  if (mode === 'setup') {
    require('../setup');
    console.log('PROBE: setup accepted the target; querying the database');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prisma } = require('../../src/utils/prisma');
    try {
      await prisma.$queryRawUnsafe('select 1');
      console.log('PROBE: query succeeded');
    } finally {
      await prisma.$disconnect();
    }
    return;
  }
  if (mode === 'global') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const globalSetup = require('../global-setup').default as () => Promise<void>;
    await globalSetup();
    console.log('PROBE: globalSetup accepted the target');
    return;
  }
  throw new Error('usage: guard-probe.ts setup|global');
}

main(process.argv[2]).then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
