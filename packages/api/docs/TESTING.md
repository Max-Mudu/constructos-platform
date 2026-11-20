# API tests

The API tests (`packages/api/tests`, jest) delete every row in the database they
use (`clearDatabase()` in `tests/helpers/fixtures.ts`). They therefore run only
against a disposable **local** test database, and only after you confirm its
name. They never fall back to `DATABASE_URL`.

## Variables

Set both in your shell or in `packages/api/.env`. A value in the environment
wins over the `.env` file.

| Variable | Example | Meaning |
|---|---|---|
| `TEST_DATABASE_URL` | `postgresql://postgres:<password>@localhost:5432/construction_platform_test` | The test database. Required. |
| `TEST_DATABASE_CONFIRM` | `construction_platform_test` | Must equal the database name in `TEST_DATABASE_URL`. This is the explicit confirmation of the target. |

## What is checked

Before any migration or test touches a database, `tests/support/test-database.ts`
refuses the target unless all of these hold:

- `TEST_DATABASE_URL` is set. A missing value fails; nothing falls back to `DATABASE_URL`.
- The URL is `postgres://` or `postgresql://`.
- The host is `localhost`, `127.0.0.1` or `::1`, and the URL has no `host` or
  `hostaddr` parameter that could connect somewhere else.
- The database name contains only lowercase letters, digits and underscores, and ends in `_test`.
- Neither the host nor the name contains `prod`, `production`, `qa`, `staging`,
  `railway` or `rlwy` (any case).
- It is not the development database: `DATABASE_URL` from the `packages/api/.env`
  file is compared by parsed host, port and name (not as a string). Without a
  `.env` file (CI) only this comparison is skipped.
- `TEST_DATABASE_CONFIRM` equals the database name.

Where it runs:

- `tests/global-setup.ts` (jest `globalSetup`) applies the rules, connects once,
  and stops the whole run unless `select current_database()` returns the
  confirmed name. It prints `Test database guard: server confirmed <host>:<port>/<name>`.
- `tests/setup.ts` (jest `setupFiles`) applies the rules again in every test file
  before anything imports Prisma, then sets `DATABASE_URL` to the validated URL.
- `npm run test:db:migrate` applies the rules and the server check before it migrates.

A refusal starts with `Test database guard refused to run:` and names the host,
port and database only, never the password.

## First-time setup

From `packages/api`, with a local PostgreSQL server running:

```bash
createdb construction_platform_test        # or: psql -c "create database construction_platform_test"
export TEST_DATABASE_URL="postgresql://postgres:<password>@localhost:5432/construction_platform_test"
export TEST_DATABASE_CONFIRM=construction_platform_test
npm run test:db:migrate
```

`npm run test:db:migrate` prints the resolved host and database, then runs
`prisma migrate deploy` (no shell) with `DATABASE_URL` set to the validated test
database only. Do not run `npx prisma migrate deploy` yourself for the test
database: the Prisma CLI reads `DATABASE_URL` from `packages/api/.env`, which is
the development database. Run `npm run test:db:migrate` again whenever new
migrations arrive.

## Running the tests

```bash
npm test                                         # whole suite (runs in band)
npx jest --runInBand tests/auth.test.ts          # one file
```

Every jest run checks the database first, so even a file that does not use the
database needs the test database to be reachable.

## CI

The API job in `.github/workflows/ci.yml` sets `DATABASE_URL` and
`TEST_DATABASE_URL` to its throwaway PostgreSQL service database and
`TEST_DATABASE_CONFIRM: construction_platform_test`. There is no `.env` file in
CI.
