# ConstructOS — Pilot Deployment Guide

## Architecture

| Layer    | Stack              | Platform          |
|----------|--------------------|-------------------|
| API      | Fastify + Prisma   | Railway (Node.js) |
| Web      | Next.js 14         | Railway (Node.js) |
| Database | PostgreSQL 16      | Railway (Postgres)|
| Mobile   | Expo / React Native| EAS (iOS/Android) |

---

## Railway Environment Variables

Set these in **Railway → Service → Variables** before the first deploy.

### API service

| Variable               | Required | Notes |
|------------------------|----------|-------|
| `DATABASE_URL`         | Yes      | Provided automatically by Railway when PostgreSQL is linked |
| `JWT_SECRET`           | Yes      | Min 32 chars. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_REFRESH_SECRET`   | Yes      | Must be different from JWT_SECRET. Same generation command. |
| `JWT_EXPIRES_IN`       | No       | Default: `15m` |
| `JWT_REFRESH_EXPIRES_IN` | No     | Default: `7d` |
| `PORT`                 | No       | Railway sets `PORT` automatically |
| `NODE_ENV`             | Yes      | Set to `production` |
| `CORS_ORIGIN`          | Yes      | URL of your web app (e.g. `https://your-web.up.railway.app`) |
| `AWS_ACCESS_KEY_ID`    | No       | Required only for S3 file storage |
| `AWS_SECRET_ACCESS_KEY`| No       | Required only for S3 file storage |
| `AWS_REGION`           | No       | Default: `us-east-1` |
| `AWS_S3_BUCKET`        | No       | Required only for S3 file storage |

### Web service

| Variable             | Required | Notes |
|----------------------|----------|-------|
| `NEXT_PUBLIC_API_URL`| Yes      | Railway URL of the API service (e.g. `https://your-api.up.railway.app`) |

---

## Deploy Commands

Railway runs these automatically from `package.json`. Verify before first deploy:

```
# API — build step (Railway build phase)
prisma generate && tsc

# API — start step (Railway start phase — also runs migrations)
prisma migrate deploy && node dist/server.js
```

`prisma migrate deploy` runs all pending migrations before the server starts.
If migrations fail the process exits non-zero and Railway halts the deploy — this is intentional.

---

## First Deploy Checklist

- [ ] Create Railway project with PostgreSQL service linked to API service
- [ ] Set all required Railway environment variables (see table above)
- [ ] Verify `NODE_ENV=production` is set
- [ ] Verify `JWT_SECRET` and `JWT_REFRESH_SECRET` are at least 32 characters
- [ ] Verify `CORS_ORIGIN` matches the actual web app Railway URL (not localhost)
- [ ] Deploy API — watch deploy logs for migration output and "API server running"
- [ ] Deploy Web — set `NEXT_PUBLIC_API_URL` to the API Railway URL
- [ ] Run smoke tests (see below)
- [ ] Create first admin account (see Admin Account Setup)

---

## Admin Account Setup

There is no seeded admin account in production. Create the first `company_admin` account by:

1. Register via the web app `/register` flow — this creates a company + company_admin user.
2. The registering user is automatically assigned `company_admin` role.
3. Additional users register and are invited into the company by the admin.

For pilot testing with a specific test account, register with the pilot email before handing off to users.

---

## Smoke Test Checklist

Run after every deploy to production.

### API health

```
curl https://<api-url>/health
# Expected: {"status":"ok","timestamp":"..."}
# 503 means the database is unreachable — check Railway PostgreSQL service
```

### Auth flow

- [ ] POST `/api/v1/auth/register` with new company — returns tokens
- [ ] POST `/api/v1/auth/login` — returns accessToken + refreshToken cookie
- [ ] GET `/api/v1/auth/me` with Bearer token — returns user object
- [ ] POST `/api/v1/auth/refresh` with refreshToken — returns new tokens

### Core data

- [ ] GET `/api/v1/projects` — returns empty array (not 500)
- [ ] GET `/api/v1/dashboard` — returns dashboard stats (not 500)
- [ ] GET `/api/v1/workers` — returns empty array (not 500)

### Web

- [ ] Load web app root — redirects to `/login`
- [ ] Login with registered account — reaches `/dashboard`
- [ ] Dashboard loads without JS errors in browser console

### Mobile (EAS preview build)

- [ ] App launches and shows login screen
- [ ] Login with registered account — reaches home tab
- [ ] Dashboard loads and shows stats

---

## Rollback Procedure

Railway supports instant rollback to the previous deploy:

1. Railway dashboard → Service → Deployments
2. Click the last successful deployment
3. Click "Redeploy"

**Database rollback:** Prisma does not generate automatic down-migrations.
If a migration causes a schema issue:
- Identify the migration in `packages/api/prisma/migrations/`
- Write a manual corrective migration: `npx prisma migrate dev --name fix_<issue>`
- Deploy the fix migration as a normal deploy

---

## File Uploads (Pilot)

File uploads in the pilot use **local disk storage** on the Railway container.
Files stored in `/uploads` are ephemeral — they are lost on redeploy or restart.

**Pilot impact:** Delivery photos, drawings, and instruction attachments uploaded
during the pilot will not persist across deploys. Communicate this to pilot users.

**Production path:** Replace local disk storage with AWS S3 pre-signed URLs.
The upload service (`packages/api/src/utils/upload.service.ts`) is the only place
that writes files — swap it to use the AWS SDK without touching any route code.

---

## Common Issues

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| API startup crash: "Missing required environment variable" | Railway variable not set | Add the variable in Railway → Variables |
| API startup crash: "must be at least 32 characters" | JWT secret too short | Regenerate with `randomBytes(32).toString('hex')` |
| API startup crash during migrations | Migration SQL error | Check migration file; fix and redeploy |
| Web shows blank screen / 500 | `NEXT_PUBLIC_API_URL` wrong | Verify it matches the API Railway URL (no trailing slash) |
| Mobile "Network Error" | `EXPO_PUBLIC_API_URL` wrong or EAS build not rebuilt | Rebuild EAS with correct env var |
| `/health` returns 503 | Database unreachable | Check Railway PostgreSQL service is running and `DATABASE_URL` is correct |
| CORS errors in browser | `CORS_ORIGIN` mismatch | Set `CORS_ORIGIN` on API to the exact web app URL (protocol + domain, no trailing slash) |

---

## Monitoring During Pilot

Railway provides basic log streaming. View live logs:

```
railway logs --tail   # follow live output
```

Key log lines to watch:
- `API server running on port XXXX` — server started successfully
- `Migrations applied` / migration output — deploy ran migrations
- `[WARN] CORS_ORIGIN contains "localhost"` — CORS misconfiguration
- Any `Unhandled server error` lines — unexpected runtime errors

---

## Support Procedure

When a pilot user reports an issue:

1. Check Railway logs for errors at the time of the report
2. Use `/api/v1/activity` (company_admin) to see recent actions
3. Check `audit_logs` table via `prisma studio` for the affected user's actions:
   ```
   cd packages/api && npx prisma studio
   ```
4. Reproduce with the same role and project/site context
5. If data is corrupted, use `prisma studio` to inspect and correct records
