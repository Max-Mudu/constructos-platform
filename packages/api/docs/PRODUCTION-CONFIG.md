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
| `TRUST_PROXY` set to the proxy hop count | Without it, rate limits and audit-log IPs see the proxy instead of the client. A production boot warns when it is unset. |
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
| `SSE_ENABLED` | Optional | `false` in production, `true` elsewhere | Server-sent events at `GET /api/v1/events`. Keep it off in production until event delivery is scoped per audience. Clients fall back to polling. |
| `SITE_SCOPE_STRICT` | Optional | `false` | Only if the opt-in site-scoping change is merged: it applies the membership site rule to more roles and modules. Turn it on only after reviewing project memberships. Only `true` or `false` is accepted. |

### Email (SMTP)

| Variable | Required? | Default | Production guidance |
|---|---|---|---|
| `SMTP_HOST` | Recommended | empty (no email sent) | The provider's SMTP host (see §4). |
| `SMTP_PORT` | Optional | `587` | `465` uses implicit TLS. Any other port uses STARTTLS when the server offers it. Prefer `465` when the provider supports it, so the connection is always encrypted. |
| `SMTP_USER` | With SMTP | empty | The provider's SMTP username. Often a fixed word such as `apikey` or `resend` (see §4). |
| `SMTP_PASS` | With SMTP | empty | The provider's SMTP password or API key. Store it as a secret variable. |
| `SMTP_FROM` | Recommended | `noreply@constructos.app` | An address on a domain you have verified with the provider (SPF and DKIM). Otherwise mail is rejected or lands in spam. |

### File storage

The storage driver backs the Daily Report photos and PDFs. Other uploads (delivery photos and documents, drawing revisions, instruction attachments) are stored on local disk unless your build routes them through the same driver.

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

## 3. `TRUST_PROXY` on Railway

Railway terminates TLS at its edge proxy and forwards to the service, adding the client address to `X-Forwarded-For`. When nothing else sits in front of Railway, the API is **one hop** behind a proxy:

```text
TRUST_PROXY=1
```

If you put another proxy or CDN in front of the Railway domain (for example a Cloudflare-proxied custom domain), add one hop for each layer (`TRUST_PROXY=2`). Alternatively, list that layer's published IP ranges as CIDRs.

**Verify after deploy.** Never guess higher: trusting more hops than exist lets a client choose its own IP.

1. Sign in to the web app from a network whose public IP you know (search "what is my IP").
2. As a company admin, open the activity feed (`GET /api/v1/activity`), or ask whoever can query `audit_logs.ipAddress`. Check the address recorded for the `login` action.
   - **Your public IP:** correct.
   - **A private or proxy address** (e.g. `10.x`, `100.64.x`): increase by one hop and redeploy.
   - **An address you supplied** yourself in an `X-Forwarded-For` header (`curl -H 'X-Forwarded-For: 203.0.113.9' …`): too many hops are trusted. Decrease.
3. The rate limit (100 requests per minute per IP) and the forgot-password limit are both per client only once this is correct. With more than one API replica, the in-memory rate-limit store is per instance.

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

## 5. Pre-launch checklist

- [ ] `NODE_ENV=production` on **every** hosted environment.
- [ ] `JWT_SECRET` and `JWT_REFRESH_SECRET`: distinct, 32+ characters, unique to this environment.
- [ ] `DATABASE_URL` uses the private network URL, and backups are enabled on the database service.
- [ ] `CORS_ORIGIN` is the exact https origin of the web app. `APP_URL` is its https URL.
- [ ] `TRUST_PROXY` is set and verified (§3).
- [ ] SMTP is configured and the §4 test passed.
- [ ] Storage:
  - either `STORAGE_DRIVER=s3` with a private bucket and a bucket-scoped key,
  - or a persistent volume with `ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true` and `FILE_URL_SECRET`.
- [ ] `ALLOW_PUBLIC_REGISTRATION` and `SSE_ENABLED` are unset (off) unless deliberately enabled.
- [ ] `DAILY_REPORT_AI_PROVIDER` is `disabled`, or `anthropic` with approval and a spend-limited key.
- [ ] The boot log shows no `[WARN]` lines.
