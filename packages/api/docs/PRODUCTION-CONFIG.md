# API production configuration

This is the reference for every environment variable the API (`packages/api`) reads, and how to set it for a hosted deployment such as Railway. Values come from `src/utils/env.ts` unless noted. No real values appear here: generate secrets yourself and keep them only in the hosting provider's variable store.

**Hosted means every internet-reachable environment**: production, staging, QA and demo. Treat all of them as production for configuration purposes.

## 1. Non-negotiables for any hosted environment

| Rule | Why |
|---|---|
| `NODE_ENV=production` | Development and test modes turn on conveniences intended only for a developer's own machine: open self-registration, developer-facing auth helpers, a derived file-signing key, and local storage without a guard. Boot fails on an unset or unknown `NODE_ENV`, but `development` is accepted, so set it explicitly. |
| `JWT_SECRET` and `JWT_REFRESH_SECRET`: different random values of 32+ characters | Boot fails in production if either is shorter. |
| `APP_URL` starts with `https://` | Password-reset and account-setup emails link to it. A production boot prints a warning if it is unset or not https. |
| `CORS_ORIGIN`: the exact web app origin | This is a single origin with credentials. A production boot warns if it still contains `localhost`. |
| `TRUST_PROXY=1` on Railway | Without it, rate limits and audit-log addresses see the proxy instead of the client. A production boot warns when it is unset. Verify it after deploy (§3). |
| Exactly one API instance | Rate-limit counters and live-update connections live in the API process (§5). |
| `SSE_ENABLED`, `ALLOW_PUBLIC_REGISTRATION` and `CI` unset | Live updates stay off until they are scoped per audience; companies are created by an operator; `CI` is for CI runners only (§6). |
| SMTP configured and tested | Without it, no reset or setup email is sent. A production boot warns when `SMTP_HOST` is empty. |

Generate a secret with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run it once per secret. Never reuse a value across variables or environments.

## 2. Variable reference

**Required** means boot fails without it. **Recommended** means boot succeeds, but something important is broken or weakened in production.

### Core

| Variable | Required? | Default | Production guidance |
|---|---|---|---|
| `NODE_ENV` | **Required** | none (boot fails) | `production`. Allowed values: `development`, `test`, `production`. |
| `DATABASE_URL` | **Required** | none | PostgreSQL connection string. Railway injects it when the Postgres service is linked. Prefer the private (internal) URL. |
| `PORT` | Optional | `3001` | Railway sets it. Do not override it. The server binds `0.0.0.0:$PORT`. |
| `CORS_ORIGIN` | Recommended | `http://localhost:3000` | The exact origin of the web app, for example `https://app.example.com`: scheme and host, no path, no trailing slash. Only one origin is supported. |
| `APP_URL` | Recommended | `http://localhost:3000` | The public https URL of the web app, without a trailing slash. Reset and setup links are built from it. |

### Authentication

| Variable | Required? | Default | Production guidance |
|---|---|---|---|
| `JWT_SECRET` | **Required** | none | 32+ random characters (64 hex characters from the command above). It signs access tokens. Rotating it signs every user out. |
| `JWT_REFRESH_SECRET` | **Required** | none | 32+ random characters, different from `JWT_SECRET`. It must be set, but it does not currently sign anything: refresh tokens are opaque random values stored hashed. |
| `JWT_EXPIRES_IN` | Optional | `15m` | Access-token lifetime ([vercel/ms](https://github.com/vercel/ms) format). Keep it short (15 minutes to 1 hour). |
| `JWT_REFRESH_EXPIRES_IN` | Optional | `7d` | Accepted but currently unused: the refresh lifetime is fixed at 7 days in code. |
| `ALLOW_PUBLIC_REGISTRATION` | Optional | `false` in production, `true` elsewhere | Leave it unset (off) in production. Companies are onboarded by an operator. Only `true` or `false` is accepted. |

### Network and proxy

| Variable | Required? | Default | Production guidance |
|---|---|---|---|
| `TRUST_PROXY` | Recommended | trust none | The number of reverse-proxy hops between the client and the API, or a comma-separated list of proxy IPs/CIDRs (or `loopback`, `linklocal`, `uniquelocal`). `true` (trust everything) is rejected at boot. See §3. |
| `SSE_ENABLED` | Optional | `false` in production, `true` elsewhere | Server-sent events at `GET /api/v1/events`. Keep it off in production until event delivery is scoped per audience. With it off, the web and Android apps stop trying to connect after the first `404 SSE_DISABLED` answer and load fresh data when a page is opened or pulled to refresh; nothing updates in place, and the web sidebar shows the live-update status as disconnected. |
| `SITE_SCOPE_STRICT` | Optional | `false` | Opt-in site scoping: it applies the membership site rule to more roles and modules. Turn it on only after reviewing project memberships. Only `true` or `false` is accepted. |

### Email (SMTP)

| Variable | Required? | Default | Production guidance |
|---|---|---|---|
| `SMTP_HOST` | Recommended | empty (no email sent) | The provider's SMTP host (see §4). |
| `SMTP_PORT` | Optional | `587` | `465` uses implicit TLS. Any other port uses STARTTLS when the server offers it. Prefer `465` when the provider supports it, so the connection is always encrypted. |
| `SMTP_USER` | With SMTP | empty | The provider's SMTP username. Often a fixed word such as `apikey` or `resend` (see §4). |
| `SMTP_PASS` | With SMTP | empty | The provider's SMTP password or API key. Store it as a secret variable. |
| `SMTP_FROM` | Recommended | `noreply@constructos.app` | An address on a domain you have verified with the provider (SPF and DKIM). Otherwise mail is rejected or lands in spam. |

### File storage

The storage driver backs the Daily Report photos and PDFs. With `STORAGE_DRIVER=s3`, delivery photos and documents, drawing revisions and instruction attachments go to the same bucket, and files still on local disk are read from there as a fallback. With `local`, those uploads stay on local disk under `<cwd>/uploads`. See [STORAGE-R2.md](STORAGE-R2.md) for the bucket plan and the move from local disk.

| Variable | Required? | Default | Production guidance |
|---|---|---|---|
| `STORAGE_DRIVER` | Recommended | `local` | Use `s3` (an S3-compatible private bucket). With `local` in production, Daily Report storage refuses to start unless `ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true`. |
| `S3_BUCKET` | With `s3` | empty | A private bucket: no public access, no public bucket URL. |
| `S3_REGION` | With `s3` | empty | For example `auto` for Cloudflare R2, or the bucket region for AWS (e.g. `eu-west-1`). |
| `S3_ENDPOINT` | With non-AWS `s3` | empty | Must be https in production. R2: `https://<account-id>.r2.cloudflarestorage.com`. Backblaze B2: `https://s3.<region>.backblazeb2.com`. Leave it empty for AWS S3. |
| `S3_ACCESS_KEY_ID` | With `s3` | empty | An access key scoped to this one bucket, with object read, write and delete only. |
| `S3_SECRET_ACCESS_KEY` | With `s3` | empty | Secret for the key above. |
| `S3_FORCE_PATH_STYLE` | Optional | `false` | `true` only if the provider requires path-style URLs (for example MinIO). Not needed for R2, B2 or AWS. |
| `FILE_URL_SECRET` | With `local` in production | derived (dev/test only) | 32+ random characters. It signs the short-lived file URLs that `GET /api/v1/files/signed` serves for the local driver. |
| `ALLOW_LOCAL_STORAGE_IN_PRODUCTION` | Optional | `false` | `true` only when the upload directory (`<cwd>/uploads`) is on a persistent volume. A container's own disk is wiped on every redeploy. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET` | Unused | none | Legacy names that nothing reads. Use the `S3_*` variables. |

### Daily Report AI

| Variable | Required? | Default | Production guidance |
|---|---|---|---|
| `DAILY_REPORT_AI_PROVIDER` | Optional | `disabled` (`fake` under test) | `disabled` or `anthropic`. `fake` is refused in production. Enable `anthropic` only after the data-processing approval for sending site notes to the provider. |
| `ANTHROPIC_API_KEY` | With `anthropic` | none | Read by the Anthropic SDK itself. Use a workspace key with a spend limit. |
| `DAILY_REPORT_AI_MODEL` | Optional | `claude-sonnet-5-5` | Leave the default unless told otherwise. |
| `DAILY_REPORT_AI_TIMEOUT_MS` | Optional | `45000` | A positive integer. |
| `DAILY_REPORT_AI_DAILY_CAP_PER_COMPANY` | Optional | `200` | A positive integer: extraction runs per company per day. |
| `DAILY_REPORT_AI_FAKE_DRAFT_FILE` | Never in production | empty | Local demos only (fake provider). |

## 3. Client address and `TRUST_PROXY`

The API uses the client address for the rate limits (§5) and records it in `audit_logs.ipAddress` (sign-ins, failed sign-ins) and `refresh_tokens.ipAddress`. Fastify takes it from `X-Forwarded-For`, trusting only as many proxy hops as `TRUST_PROXY` allows.

### What to set today

Railway terminates TLS at its edge proxy and forwards to the service, so the API is **one hop** behind a proxy:

```text
TRUST_PROXY=1
```

Set it to the real number of proxy layers and never higher; a value above the real number makes the recorded address unreliable. If you put another proxy or CDN in front of the Railway domain (for example a proxied custom domain), add one hop for that layer, or list its published IP ranges as CIDRs.

### How each client reaches the API

| Client | Path | Address the API records with `TRUST_PROXY=1` |
|---|---|---|
| Android app | Phone → Railway edge → API | The phone's public address |
| Web app, file downloads (`/uploads/...`) | Browser → Railway edge → API | The browser's public address |
| Web app, every other API call (`/api/v1/*`) | Browser → web service (Next.js rewrite) → API's public URL → API | The **web service's** outbound address, the same for every web user |

Until the API identifies web users individually (the client-address change on branch `fix/api-client-address-and-rate-limit`), this means for the pilot:

- All web users share one rate-limit allowance (100 requests a minute in total), so several busy web users can receive "Too many requests" at the same time. Phones behind the same mobile-network address also share an allowance.
- Web sign-ins record the web service's address in `audit_logs.ipAddress`, not the user's.
- Do **not** raise `TRUST_PROXY` to 2 for the web path: requests that reach the API's public URL directly would then be recorded with an address the client supplied.

Once that change is merged, follow the configuration it documents and repeat the verification below.

### Verify after deploy

The activity feed does not show addresses, so read the audit log directly (read-only):

1. Sign in once on the **Android app** and once on the **web app** from a network whose public address you know.
2. Query the newest sign-ins:

   ```sql
   BEGIN TRANSACTION READ ONLY;
   SELECT "createdAt", "userEmail", "ipAddress", left("userAgent", 40) AS agent
   FROM audit_logs
   WHERE action = 'login' AND "entityType" = 'auth'
   ORDER BY "createdAt" DESC
   LIMIT 10;
   ROLLBACK;
   ```

3. Read the result:
   - The **Android** sign-in shows your public address: `TRUST_PROXY` is right.
   - It shows a private or proxy address (`10.x`, `100.64.x`, `fd..`): there is one more proxy layer than configured. Add one hop and redeploy.
   - The **web** sign-in shows the same non-personal address for every user: expected until the client-address change is merged (see above).
4. Record the result in the launch notes.

## 4. SMTP providers

Any provider with SMTP submission works. Verify your sending domain (SPF and DKIM, ideally DMARC) with the provider before going live. Common settings (check the provider's current documentation):

| Provider | `SMTP_HOST` | `SMTP_PORT` | `SMTP_USER` | `SMTP_PASS` |
|---|---|---|---|---|
| Resend | `smtp.resend.com` | `465` (or `587`) | `resend` | API key |
| SendGrid | `smtp.sendgrid.net` | `465` (or `587`) | `apikey` | API key |
| Mailgun | `smtp.mailgun.org` (EU: `smtp.eu.mailgun.org`) | `465` (or `587`) | domain SMTP login | that login's password |
| Postmark | `smtp.postmarkapp.com` | `587` | Server API token | same Server API token |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | `465` (or `587`) | SES SMTP username | SES SMTP password (not the IAM secret) |

**Railway note:** some Railway plans restrict outbound SMTP ports. If the test below times out on connect, check your plan's networking limits. The options are to upgrade, or to use the provider's HTTPS API, which needs a code change in `src/services/email.service.ts`.

### Test procedure (after every SMTP change)

1. Deploy. The boot log must **not** show the `SMTP_HOST is not set in production` warning.
2. Create or pick a test user whose mailbox you control, and request a reset: `POST /api/v1/auth/forgot-password` with that email, or use the web "Forgot password" page. The API always answers with the same generic success message, so the response alone proves nothing.
3. Confirm all of the following:
   - The email arrives, ideally not in spam.
   - The link starts with your https `APP_URL`.
   - The provider's dashboard shows the message as delivered.
4. Complete the reset once to prove the link works. Request another link and check that the first one no longer works.
5. If nothing arrives, look for `email` errors in the API log (they carry no link or token), and check the provider's activity log for rejects such as an unverified sender or bad credentials.

## 5. Rate limits and the single API instance

### Limits

| What | Limit | Counted per |
|---|---|---|
| Every API route (global) | 100 requests per minute | Client address (§3) |
| `POST /api/v1/auth/forgot-password` | 5 per 15 minutes | Client address |
| `POST /api/v1/companies/me/users/:id/setup-link` | 10 per 15 minutes | Client address |
| `POST .../daily-reports/:id/extract` | 6 per minute | Client address |
| Daily Report AI extraction | `DAILY_REPORT_AI_DAILY_CAP_PER_COMPANY` (default 200) per day | Company (counted in the database) |
| Failed sign-ins | 10 in a row lock the account for 15 minutes | Account (stored in the database) |

A request over a limit gets `429 Too Many Requests`. The request limits are switched off only under `NODE_ENV=test`.

### Why exactly one instance

These pieces of state live in the memory of the API process:

| State | Where | Effect with more than one instance |
|---|---|---|
| Rate-limit counters | `@fastify/rate-limit` in-memory store (`src/server.ts`) | Each instance counts separately: limits multiply by the instance count. |
| Live-update connections | `src/services/event-emitter.service.ts` | An event reaches only clients connected to the instance that made the change. |
| Live-update heartbeats | `src/routes/events.routes.ts` (one 25-second timer per open stream) | Per instance; harmless. |
| Upload files on disk (`STORAGE_DRIVER=local` only) | `<cwd>/uploads` | Each instance sees only its own files. Use `s3`. |
| Storage driver, PDF fonts, AI client | Module-level caches | None (read-only). |

Everything else that must be consistent is in PostgreSQL: sessions and refresh-token rotation, account lockout, the AI daily cap (a transaction-scoped advisory lock) and the onboarding command (also an advisory lock).

Set the API service to **one replica** and check it after every settings change (`docs/DEPLOYMENT.md`, "Run exactly one API instance"). Running several instances later needs a shared rate-limit store (for example Redis through the plugin's `redis` option), a shared live-update channel (for example PostgreSQL `LISTEN/NOTIFY` or Redis pub/sub), and the bucket for all files.

## 6. Token and session settings

| Setting | Production value | Where it is checked |
|---|---|---|
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Two different random values of 32+ characters, unique to the environment. Never the `.env.example` values. | Boot fails if either is shorter than 32 characters. |
| Access-token lifetime | `JWT_EXPIRES_IN`, default `15m`. Keep it at 1 hour or less. | Not validated beyond its format. |
| Refresh-token lifetime | 7 days, fixed in code (`JWT_REFRESH_EXPIRES_IN` is not read). Each refresh rotates the token; presenting a rotated token again ends every session of that user. | `src/services/auth.service.ts` |
| Refresh cookie | `refreshToken`: `HttpOnly`, `Secure` (when `NODE_ENV=production`), `SameSite=Strict`, `Path=/`, no `Domain` (host-only on the web app's host, because the web app proxies `/api/v1`), 7 days. The Android app keeps its tokens in the device's secure storage instead. | `src/routes/auth.routes.ts` |
| `CORS_ORIGIN` | Exactly the web app's https origin. Only one origin is supported, with credentials. | A production boot warns if it contains `localhost`. |
| HTTPS | Railway serves https; `APP_URL`, `CORS_ORIGIN`, `NEXT_PUBLIC_API_URL`, `EXPO_PUBLIC_API_URL` and `S3_ENDPOINT` all use https. | `S3_ENDPOINT` is refused on http in production; `APP_URL` warns. |
| Security headers | `@fastify/helmet` defaults (including `Strict-Transport-Security`), with the Content Security Policy on in production. | `src/server.ts` |
| `SSE_ENABLED` | Unset (off). The live-update stream carries the access token in its URL and delivers events company-wide; keep it off until per-audience delivery is merged (branch `fix/live-updates-scoped`). | Default off in production. |
| `ALLOW_PUBLIC_REGISTRATION` | Unset (off). | Default off in production. |
| `NODE_ENV` | `production`. Development mode returns reset and setup links in API responses and prints them to the log. | Boot fails on an unset or unknown value. |
| `CI` | Unset. It only matters outside production: when set, development builds stop printing account links. In production links are never printed or returned, whatever `CI` says, so never rely on `CI` to protect a hosted environment; rely on `NODE_ENV=production`. | `src/services/email.service.ts` |
| Logging | Request logs omit query strings, and `authorization`, `cookie`, password and token fields are redacted. Do not add request bodies or headers to log calls. | `src/server.ts` (`loggerOptions`) |

## 7. Pre-launch checklist

- [ ] `NODE_ENV=production` on **every** hosted environment.
- [ ] `JWT_SECRET` and `JWT_REFRESH_SECRET`: distinct, 32+ characters, unique to this environment.
- [ ] `DATABASE_URL` uses the private network URL, and backups are enabled on the database service.
- [ ] `CORS_ORIGIN` is the exact https origin of the web app. `APP_URL` is its https URL.
- [ ] `TRUST_PROXY=1` is set and verified with the audit-log query (§3).
- [ ] The API service runs exactly one instance (§5).
- [ ] The token and session settings match §6.
- [ ] Database backups are on, and a restore test has passed (`docs/DEPLOYMENT.md`, "Backups and restore").
- [ ] The company and its first administrator were created with the operator command (`docs/DEPLOYMENT.md`, "First company and administrator"); the demo seed was never run against this database.
- [ ] SMTP is configured and the §4 test passed.
- [ ] Storage:
  - either `STORAGE_DRIVER=s3` with a private bucket and a bucket-scoped key,
  - or a persistent volume with `ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true` and `FILE_URL_SECRET`.
- [ ] `ALLOW_PUBLIC_REGISTRATION`, `SSE_ENABLED` and `CI` are unset.
- [ ] `DAILY_REPORT_AI_PROVIDER` is `disabled`, or `anthropic` with approval and a spend-limited key.
- [ ] The boot log shows no `[WARN]` lines.

## 8. Railway launch checklist

Work through this in order for each Railway environment (QA first, then production). Every variable below is read by the API code: `src/utils/env.ts`, plus `DATABASE_URL` in `prisma/schema.prisma` and `ANTHROPIC_API_KEY` in the Anthropic SDK.

### 8.1 Service and build

- [ ] The service builds `packages/api`: build command `npm run build` (`prisma generate && tsc`), start command `npm start`.
- [ ] `npm start` runs `prisma migrate deploy && node dist/server.js`, so **migrations are applied before the server starts**, on every deploy. Do not also run `prisma migrate dev` or `prisma db push` against a hosted database.
- [ ] `DATABASE_URL` comes from the linked Railway Postgres service, using the private (internal) URL. Enable database backups **before** the first deploy, because the first `migrate deploy` creates the whole schema.
- [ ] Before each deploy that adds migrations, read the new files in `prisma/migrations/` and take a manual database backup if any of them drops or rewrites data.
- [ ] Health check path: **`/health`** (at the root, not under `/api/v1`). It runs `SELECT 1` and returns `200 {"status":"ok"}`, or `503` when the database is unreachable. Set it as the Railway health check so a deploy that cannot reach the database is not promoted.
- [ ] Do not set `PORT`. Railway injects it, and the server binds `0.0.0.0:$PORT`.

### 8.2 Variables to set

| Variable | Value | Check after deploy |
|---|---|---|
| `NODE_ENV` | `production` | Boot succeeds; no development behaviour. |
| `DATABASE_URL` | Railway Postgres reference (private URL) | `/health` returns 200. |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Two different random values, 32+ characters, unique to this environment | Boot succeeds (production refuses shorter values). |
| `APP_URL` | `https://<web app host>` (https, no trailing slash) | No `APP_URL` warning in the boot log; reset links start with it. |
| `CORS_ORIGIN` | `https://<web app host>`: exactly one origin | No `CORS_ORIGIN contains "localhost"` warning. The web app can load `/uploads/...` files. Native mobile apps send no `Origin` and are not affected. |
| `TRUST_PROXY` | `1` (Railway's edge proxy only); add one per extra proxy layer | No `TRUST_PROXY` warning. Verify the audit-log address as in §3. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Provider values (§4); `SMTP_FROM` on a verified domain | No `SMTP_HOST` warning; the §4 test passes. |
| `STORAGE_DRIVER` | `s3` | Daily Report photo upload and delivery photo upload both work. |
| `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` | https is enforced in production. |
| `S3_BUCKET` | The private bucket for this environment | |
| `S3_REGION` | `auto` | |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | A token scoped to that one bucket (Object Read & Write) | Any missing `S3_*` variable is named in the error when the storage routes are first used. |
| `DAILY_REPORT_AI_PROVIDER` | `disabled`, or `anthropic` after approval | |
| `ANTHROPIC_API_KEY` | Only with `anthropic`: a spend-limited workspace key | |

Optional, with sensible defaults: `SITE_SCOPE_STRICT` (`false`; turn it on only after reviewing project memberships), `JWT_EXPIRES_IN` (`15m`), `DAILY_REPORT_AI_MODEL`, `DAILY_REPORT_AI_TIMEOUT_MS`, `DAILY_REPORT_AI_DAILY_CAP_PER_COMPANY`.

Storage details, costs and the move from local disk are in [STORAGE-R2.md](STORAGE-R2.md).

### 8.3 Must NOT be set

| Do not set | Why |
|---|---|
| `NODE_ENV` to anything other than `production` | `development` is accepted at boot and enables development-only behaviour. |
| `TRUST_PROXY=true`, or a hop count above the real number of proxies | `true` is refused at boot. A hop count above the real number of proxies makes the recorded client address unreliable (§3). |
| `ALLOW_PUBLIC_REGISTRATION=true` | Companies are onboarded by an operator. |
| `SSE_ENABLED=true` | Keep it off in production until event delivery is scoped per audience. |
| `CI` | For CI runners only; it has no protective effect in production (§6). |
| `DAILY_REPORT_AI_PROVIDER=fake`, `DAILY_REPORT_AI_FAKE_DRAFT_FILE` | `fake` is refused in production; the draft file is for local demos. |
| `ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true` (with `STORAGE_DRIVER=s3`) | Not needed with a bucket. Set it only for a deliberate persistent-volume setup. |
| `FILE_URL_SECRET` (with `STORAGE_DRIVER=s3`) | Used only by the local driver. Harmless, but one less secret to manage. |
| `S3_FORCE_PATH_STYLE=true` for R2 | Not needed for R2. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET` | Parsed but unused. Setting them suggests a configuration that does nothing. |
| `PORT` | Railway sets it. |
| `JWT_REFRESH_EXPIRES_IN` | Parsed but unused (the refresh lifetime is fixed at 7 days). Setting it has no effect. |

### 8.4 After the first deploy

- [ ] `curl -sS https://<api host>/health` returns `{"status":"ok",...}`.
- [ ] The boot log has no `[WARN]` lines.
- [ ] Sign in on the Android app and the web app; check the audit-log addresses (§3).
- [ ] Exactly one API instance is running (§5).
- [ ] Create the company and its first administrator (`docs/DEPLOYMENT.md`).
- [ ] Run the SMTP test (§4).
- [ ] Upload and open a delivery photo and a Daily Report photo; download a Daily Report PDF; redeploy and open them again (`docs/DEPLOYMENT.md`, "Redeploy test").
- [ ] Sign in on a mobile build whose `EXPO_PUBLIC_API_URL` is `https://<api host>/api/v1`.

### 8.5 Documentation and code mismatches (as of `main` @ `4d13033`)

- `JWT_REFRESH_EXPIRES_IN` and the four `AWS_*` variables are read by `env.ts` but have no effect.
- No variable that `env.ts` reads is missing from §2.
- `SSE_ENABLED` off does not switch the clients to polling: pages load fresh data when opened or refreshed (§2).
