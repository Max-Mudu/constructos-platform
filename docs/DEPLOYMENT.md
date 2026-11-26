# ConstructOS — Pilot Deployment Guide

This guide covers a hosted deployment on Railway: one company, one project and one site, used from the web app and the Android app. Every API variable and its production rule is in [`packages/api/docs/PRODUCTION-CONFIG.md`](../packages/api/docs/PRODUCTION-CONFIG.md); private file storage is in [`packages/api/docs/STORAGE-R2.md`](../packages/api/docs/STORAGE-R2.md).

## Architecture

| Layer    | Stack                | Platform                             |
|----------|----------------------|--------------------------------------|
| API      | Fastify + Prisma     | Railway (Node.js), **exactly one instance** |
| Web      | Next.js 14           | Railway (Node.js)                    |
| Database | PostgreSQL           | Railway (Postgres)                   |
| Files    | S3-compatible bucket | A private bucket (for example Cloudflare R2) |
| Mobile   | Expo / React Native  | EAS (Android for the pilot)          |

How requests travel:

- The web app calls the API through its own `/api/v1/*` rewrite (`packages/web/next.config.js`), so the browser only talks to the web origin for API calls. The rewrite target is `NEXT_PUBLIC_API_URL`.
- The web app downloads uploaded delivery, drawing and instruction files directly from the API origin (`<NEXT_PUBLIC_API_URL>/uploads/...`) with the signed-in user's token. This is why `CORS_ORIGIN` on the API must be the exact web origin.
- The Android app calls the API directly at `EXPO_PUBLIC_API_URL`, which is fixed when the EAS build is made.

---

## Railway variables

Set these in **Railway → Service → Variables** before the first deploy.

### API service

The full list, defaults and checks are in [PRODUCTION-CONFIG.md](../packages/api/docs/PRODUCTION-CONFIG.md) §2 and §8. The ones a deployment cannot do without:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | The linked Railway Postgres reference (private URL) |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Two different random values of 32+ characters, generated for this environment |
| `APP_URL`, `CORS_ORIGIN` | The web app's https origin, for example `https://app.example.com` (no trailing slash) |
| `TRUST_PROXY` | `1` (see [PRODUCTION-CONFIG.md §3](../packages/api/docs/PRODUCTION-CONFIG.md#3-client-address-and-trust_proxy)) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | A working SMTP provider |
| `STORAGE_DRIVER` and the `S3_*` variables | `s3` with a private bucket |

Leave `ALLOW_PUBLIC_REGISTRATION`, `SSE_ENABLED`, `CI` and `PORT` unset. The `AWS_*` variables are not read; use `S3_*`.

### Web service

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | The API's public https URL, for example `https://api.example.com`: no trailing slash, no `/api/v1`. It is built into the web app, so set it **before** the build; changing it needs a redeploy. |

### Android build (EAS)

`EXPO_PUBLIC_API_URL` = `https://<api host>/api/v1`, set in the EAS build profile. A build keeps the URL it was made with.

---

## Run exactly one API instance

The pilot runs **one** API instance. Keep the replica count of the API service at 1 and do not enable horizontal scaling.

The API keeps some state in the memory of its process: the rate-limit counters and the live-update connections. With two instances, each instance counts requests on its own, so every limit is effectively multiplied by the number of instances, and a live update would reach only the clients connected to the instance that made the change. Running several instances needs a shared store first (see PRODUCTION-CONFIG.md §5).

Check after every change to the service settings:

- [ ] The service shows one replica, and the deployment list shows one active deployment.
- [ ] `GET /health` answers, and the boot log shows a single `API server running on port ...` line per deployment.

During a deploy Railway may run the new deployment next to the old one for a short time before stopping the old one. That overlap is expected. It also means `prisma migrate deploy` (run by the new deployment at start-up) changes the schema while the old code is still serving requests, so every migration must keep working with the previous release (add columns and tables first; remove them in a later release).

---

## Deploy commands

Railway runs these from `packages/api/package.json`:

```
# API build
prisma generate && tsc

# API start (runs migrations first)
prisma migrate deploy && node dist/server.js
```

`prisma migrate deploy` applies pending migrations before the server starts. If a migration fails, the process exits non-zero and Railway does not promote the deploy. Never run `prisma migrate dev`, `prisma migrate reset`, `prisma db push` or the demo seed against a hosted database.

Set the API health check path to `/health` (not under `/api/v1`). It answers 200 when the database is reachable and 503 when it is not.

---

## First deploy checklist

Work through this in order.

1. [ ] Create the Railway project, a Postgres service, the API service and the web service. Keep the API at one replica.
2. [ ] Turn on database backups for the Postgres service (see [Backups and restore](#backups-and-restore)) before the first deploy.
3. [ ] Create the private bucket and its bucket-scoped key ([STORAGE-R2.md](../packages/api/docs/STORAGE-R2.md) §8).
4. [ ] Set the API variables (PRODUCTION-CONFIG.md §8.2) and the web variable `NEXT_PUBLIC_API_URL`.
5. [ ] Deploy the API. The deploy log shows the migrations and `API server running on port ...`, and no `[WARN]` lines.
6. [ ] Deploy the web app.
7. [ ] Run the smoke tests below.
8. [ ] Create the company and its first administrator ([First company](#first-company-and-administrator)).
9. [ ] Verify the client address ([PRODUCTION-CONFIG.md §3](../packages/api/docs/PRODUCTION-CONFIG.md#3-client-address-and-trust_proxy)), the SMTP test (§4) and file storage ([File storage](#file-storage)).
10. [ ] Take a manual backup and run a restore test ([Backups and restore](#backups-and-restore)) before inviting users.

---

## First company and administrator

Production has no public sign-up: `ALLOW_PUBLIC_REGISTRATION` is off, so `POST /api/v1/auth/register` answers 403 and the web `/register` page cannot create an account. Do not turn it on. The company and its first administrator are created by an operator with a one-off command that ships with the API build (`packages/api/src/scripts/create-first-company.ts`, compiled to `dist/scripts/create-first-company.js`).

Before running it:

- SMTP works (PRODUCTION-CONFIG.md §4) and `APP_URL` is the web app's https URL. In production the command refuses to create the account otherwise, because the administrator could not receive a working link.
- The database is the one you mean to change. The command refuses to create a company when any company already exists, so it will not add a second company to a database that already has one (for example demo data).

Run it **in the API service's own environment** (a shell in the running API service, for example with `railway ssh`), so it uses the same `DATABASE_URL`, SMTP and `APP_URL` as the API. First check with `--dry-run`, then run it for real:

```sh
node dist/scripts/create-first-company.js \
  --company-name "Example Builders Ltd" --currency KES \
  --country Kenya --timezone Africa/Nairobi \
  --admin-email admin@example.com --admin-first-name Ada --admin-last-name Admin \
  --confirm-production --dry-run

node dist/scripts/create-first-company.js \
  --company-name "Example Builders Ltd" --currency KES \
  --country Kenya --timezone Africa/Nairobi \
  --admin-email admin@example.com --admin-first-name Ada --admin-last-name Admin \
  --confirm-production
```

What it does:

- Creates the company and one `company_admin` with finance access, and writes an audit-log row.
- Emails the administrator a one-time setup link (the same link admin-created users receive: single use, valid for 60 minutes). The administrator chooses their own password. The command never prints the link, a token or a password.
- Running it again with the same details changes nothing. If the link expired or the email did not arrive, run it again with `--resend-setup-email` (the earlier link stops working), or ask the administrator to use **Forgot password** on the sign-in page.
- With `NODE_ENV=production` it refuses to run without `--confirm-production`. Adding a further company needs `--allow-existing-companies`.
- The administrator's email must be written in lower case, and the currency as a three-letter code in capitals.
- Exit codes: `0` done or nothing to do, `1` refused, `2` invalid arguments or unconfirmed production run, `3` the account exists but the email failed (fix SMTP, then `--resend-setup-email`).

Then the administrator:

1. Opens the setup link, chooses a password and signs in on the web app.
2. Creates the project and the site.
3. Adds the other pilot users in **Settings → Team**. Each new user receives their own setup email; project-scoped roles are given their project and site when they are created.

---

## Smoke tests

Run after every deploy.

### API

```
curl https://<api host>/health
# {"status":"ok","timestamp":"..."}; 503 means the database is unreachable
```

- [ ] `POST /api/v1/auth/register` answers 403 `REGISTRATION_DISABLED`.
- [ ] `POST /api/v1/auth/login` with a pilot account returns an access token and sets the refresh cookie.
- [ ] `GET /api/v1/auth/me` with that token returns the user.
- [ ] `GET /api/v1/events` answers 404 `SSE_DISABLED` while live updates are off.

### Web

- [ ] The web root redirects to `/login`; signing in reaches the dashboard without console errors.
- [ ] A delivery photo opens (file download from the API origin works, so `CORS_ORIGIN` is right).

### Android (EAS preview build)

- [ ] The app opens on the sign-in screen, signs in and reaches the home tab.
- [ ] A supervisor can record attendance and a delivery with a photo.

---

## File storage

Uploaded files must live in the private bucket (`STORAGE_DRIVER=s3`). A container's own disk is replaced on every deploy, so files written there are lost. How files are served:

- Delivery photos and documents, drawing revisions and instruction attachments are streamed through the API (`GET /uploads/<key>`) after an access check on the record that owns the file.
- Daily Report photos are served by short-lived presigned bucket URLs (300 seconds), minted after the Daily Report access check. Daily Report PDFs are streamed through the API.
- The bucket must stay private: no public access, no public bucket URL. Clients never receive bucket credentials.

### Redeploy test (run once after switching to the bucket, and after any storage change)

1. Sign in as a supervisor and upload a delivery photo and a Daily Report photo. Download a Daily Report PDF.
2. Confirm the objects are in the bucket (the provider's object browser): `photos/<id>.jpg` and `daily-reports/<company id>/<report id>/photos/<id>.jpg`.
3. Redeploy the API (Railway → Deployments → Redeploy).
4. Open both photos and the PDF again. All three must load. A file that loaded before the redeploy and fails afterwards was stored on the container disk: check `STORAGE_DRIVER` and the `S3_*` variables.
5. Copy a Daily Report photo's URL and open it in a private browser window after five minutes: it must no longer load.

---

## Backups and restore

The database and the bucket are backed up separately and restored to matching points in time. Bucket backups are covered in [STORAGE-R2.md](../packages/api/docs/STORAGE-R2.md) §7.

### Schedule and retention (pilot)

| What | When | Kept | Where |
|---|---|---|---|
| Railway Postgres backups | Daily (and weekly, if the plan offers it) | As long as the plan allows; at least 7 daily copies | Railway |
| Off-platform `pg_dump` copy | Weekly, and before every deploy that adds a migration | 4 weekly + 3 monthly copies | Storage the owner controls outside Railway, encrypted |
| Restore test | Before launch, then monthly, and after any change to the backup set-up | Record the date and the result | — |

### Taking an off-platform copy

From a trusted machine with PostgreSQL client tools at least as new as the server (`pg_dump --version`):

```sh
# Use the database's public connection string (Railway Postgres → Connect → public network).
# Keep it in an environment variable; never paste it into a file or a chat.
pg_dump -Fc --no-owner --no-privileges -d "$PILOT_DATABASE_PUBLIC_URL" -f constructos-$(date +%Y%m%d-%H%M).dump
pg_restore --list constructos-<date>.dump | head        # the archive is readable
```

Encrypt the file before it leaves the machine (for example with `age`, `gpg --symmetric` or a 7-Zip AES-256 archive), keep the key in the owner's password manager, store the encrypted copy outside Railway, and delete the unencrypted file.

### Restore procedure

Restore into a **new** database first; never restore over the live database.

1. Create a new Postgres database (a new Railway Postgres service, or a local server for a test).
2. Restore: `pg_restore --no-owner --no-privileges --exit-on-error --single-transaction -d "$NEW_DATABASE_URL" constructos-<date>.dump`
3. Check the schema: run `npx prisma migrate status` with `DATABASE_URL` set to the new database. It must report that the schema is up to date.
4. Check the data: compare the row count of every table with the source (or with the counts recorded when the backup was taken), and compare the `_prisma_migrations` rows.
5. Point a test API at the new database (`DATABASE_URL`), check `/health`, and sign in.
6. Only for a real recovery: stop the API service, point the production API's `DATABASE_URL` at the restored database, redeploy, run the smoke tests, and restore the bucket to the matching point if files were lost.
7. Record what was restored, from which backup time, and the checks that passed.

Steps 1–5 have been rehearsed end to end on a local server against the current schema (custom-format dump, restore into a new database, identical row counts for every table and identical `_prisma_migrations` rows, API sign-in against the restored database).

---

## Rollback

Railway can redeploy an earlier deployment: Service → Deployments → the last good deployment → **Redeploy**.

Prisma has no automatic down-migrations. If a migration causes a problem, write a corrective migration locally (`npx prisma migrate dev --name fix_<issue>` against a local database), review it, and deploy it as a normal release. If data was damaged, restore into a new database (above) and copy the affected rows back.

---

## Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| API boot fails: "Missing required environment variable" | A variable is not set | Add it in Railway → Variables |
| API boot fails: "must be at least 32 characters" | JWT secret too short | Generate a new one (PRODUCTION-CONFIG.md §1) |
| API boot fails during migrations | Migration SQL error | Fix the migration and redeploy |
| Web shows a blank page or 500 | `NEXT_PUBLIC_API_URL` wrong or set after the build | Correct it and redeploy the web service |
| Web pages load but files do not | `CORS_ORIGIN` is not exactly the web origin | Set it to the web origin (scheme and host, no trailing slash) |
| Android "Network Error" | `EXPO_PUBLIC_API_URL` wrong | Make a new EAS build with the right URL |
| `/health` returns 503 | Database unreachable | Check the Postgres service and `DATABASE_URL` |
| Many web users get "Too many requests" at once | Shared client address (PRODUCTION-CONFIG.md §3) or more than one API instance | Check `TRUST_PROXY` and the replica count |
| Uploaded files disappear after a deploy | Files stored on the container disk | `STORAGE_DRIVER=s3` with the `S3_*` variables |

---

## Monitoring during the pilot

Railway streams the service logs (`railway logs`). Watch for:

- `API server running on port ...`: the server started.
- Any `[WARN]` line at boot: a production setting needs attention (PRODUCTION-CONFIG.md §1).
- `Unhandled server error`: an unexpected runtime error.
- `[auth] refresh token reuse detected`: every session of that user was ended; the user signs in again.

## Support procedure

When a pilot user reports an issue:

1. Check the API log at the time of the report.
2. As a company admin, use `/api/v1/activity` to see recent actions.
3. For detail (including the client address of a sign-in), query `audit_logs` read-only, for example in a `BEGIN TRANSACTION READ ONLY` session. Do not edit production rows by hand; fix data through the app or a reviewed migration.
4. Reproduce with the same role and project/site.
