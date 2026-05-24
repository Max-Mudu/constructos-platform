# ConstructOS — Pilot Support & Incident Runbook

> This document is for the operator (you) during the pilot. It covers triage steps,
> failure scenarios, recovery procedures, and support scripts for every area
> identified in the pilot readiness audit.

---

## Quick Reference

| What | Where |
|------|-------|
| API logs | Railway → API service → Deployments → current → Logs |
| Web logs | Railway → Web service → Deployments → current → Logs |
| Live log tail | `railway logs --tail` (Railway CLI) |
| Database access | `cd packages/api && npx prisma studio` |
| API health | `curl https://<api-url>/health` |
| Activity log | GET `/api/v1/activity` (company_admin token) |
| Audit log table | `audit_logs` in Prisma Studio |

---

## 1. Pilot User Issue Triage

When a user reports a problem, run through this checklist in order:

1. **Get specifics** — exact page/screen, exact action, exact error message shown, time of incident, which account (email), which project/site they were working in.
2. **Check Railway logs** — filter by the reported time. Look for lines with `error`, `Error`, `500`, `Unhandled`.
3. **Check activity log** — `GET /api/v1/activity` shows recent mutations per company. Cross-reference with the reported time.
4. **Check audit log** — open Prisma Studio → `audit_logs` table, filter by `userId` or timestamp.
5. **Reproduce** — use the same role and the same project/site context.
6. **Fix or workaround** — use Prisma Studio to correct bad data, or redeploy after a code fix.

---

## 2. Common Failure Scenarios

### 2a. "I can't log in" (web or mobile)

**Likely causes and steps:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Invalid credentials" | Wrong email/password | Confirm the email in Prisma Studio → `users` table. Reset password (see §8). |
| "Invalid credentials" but creds are right | User account `isActive = false` | Prisma Studio → `users` → set `isActive = true` |
| Login form submits but nothing happens | API unreachable from browser | Check `NEXT_PUBLIC_API_URL`, check `/health`, check CORS |
| Mobile "Network Error" on login | Wrong `EXPO_PUBLIC_API_URL` in build | Rebuild EAS with correct env var |
| Token refresh loop on web (redirected to login repeatedly) | Expired refresh token or token revoked | User should log out fully and log back in |

### 2b. "Dashboard shows no data / zeros"

1. Confirm the user's `defaultProjectId` and `defaultSiteId` are set — `GET /api/v1/auth/me` returns them.
2. If both are null: the auto-create hook may not have run. Check Prisma Studio → `projects` and `jobsites` for the company. Create one manually if missing, then update `users.defaultProjectId` and `users.defaultSiteId`.
3. If project/site exist but stats are zero: the data truly is empty — this is expected for a new account.
4. If the dashboard returns a 500: check Railway logs immediately and look for a Prisma query error.

### 2c. "I submitted something and it disappeared"

1. The record may exist but be in a draft or inactive state. Check the relevant table in Prisma Studio.
2. If on mobile and offline at the time: check whether the offline queue flushed (see §9).
3. If a delivery/drawing/instruction upload was involved: files are ephemeral during pilot — a redeploy since submission will have deleted the file (the record still exists, only the file is gone). See §16.

### 2d. "App is completely down"

1. `curl https://<api-url>/health`
   - Returns 200 → API is up, problem is elsewhere (web app, CORS, mobile config).
   - Returns 503 → Database unreachable. Check Railway → PostgreSQL service status.
   - Connection refused / DNS error → API service is down. Check Railway deploy status and logs.
2. Web shows blank / 500: check `NEXT_PUBLIC_API_URL` in Railway Web service variables.
3. Mobile shows error on launch: if a new EAS build was pushed, check `EXPO_PUBLIC_API_URL` in that build's env.

---

## 3. Railway Log Investigation

### Viewing logs

```
# CLI (requires Railway CLI + login)
railway logs --tail

# Browser
Railway dashboard → Service → Deployments → click active deploy → Logs tab
```

### Key log patterns

| Log line | Meaning | Action |
|----------|---------|--------|
| `API server running on port XXXX` | Clean startup | None |
| `Migrations applied` | Prisma ran migrations on deploy | None |
| `Missing required environment variable: X` | Env var not set | Add in Railway Variables |
| `must be at least 32 characters` | JWT secret too short | Regenerate (see DEPLOYMENT.md) |
| `[WARN] CORS_ORIGIN contains "localhost"` | CORS misconfigured | Set `CORS_ORIGIN` to production web URL |
| `Unhandled server error` | Unexpected runtime exception | Read the full stack trace below it |
| `P2002` (Prisma) | Unique constraint violation | Duplicate record attempted |
| `P2025` (Prisma) | Record not found | Client sent an ID that doesn't exist |
| `P2003` (Prisma) | Foreign key constraint | Tried to delete a parent record with children |

### Correlating a web error to logs

When a user reports a web error, the `error.tsx` boundary shows a **digest** code (e.g. `123456789`). Search Railway Web logs for that digest to find the server-side error.

---

## 4. Mobile Support Steps

### "Network Error" on every request

1. Confirm `EXPO_PUBLIC_API_URL` in the EAS build points to the Railway API service URL, not localhost.
2. On a physical device: `http://10.0.2.2:3001` is Android emulator only — it will not work on real hardware.
3. The correct production value is `https://<your-api>.up.railway.app/api/v1`.
4. If the env var was wrong: rebuild the EAS binary with the corrected value. Distributing a new build is required — env vars are baked at build time.

### "Push notifications not appearing"

1. Confirm the user granted notification permission. On iOS, permission can only be requested once — if denied, they must re-enable in iOS Settings → Notifications → [App name].
2. On Android, notifications are enabled by default (Android 12 and below). Android 13+ requires explicit permission.
3. Confirm the app is using an EAS build (not Expo Go) — push tokens do not work in Expo Go.
4. Expo push token is registered on login. If the user logged in before the EAS build with the correct `projectId`, re-login to re-register the token.

### "Offline actions didn't sync"

The offline queue covers three operation types only: **attendance check-in (self)**, **attendance create (supervisor)**, **labour entry create**. All other actions require connectivity at the time of submission.

Offline sync happens automatically when connectivity resumes. If it did not:
1. Ask the user to fully close and reopen the app — the queue flushes on app foreground.
2. If still stuck: the offline queue file is stored in the app's document directory. The user can clear it by logging out and back in (the queue is wiped on logout).
3. If the same record was submitted twice (once offline, once online), a `P2002` unique constraint error appears in Railway logs. The duplicate will be rejected by the API — only one record is stored. Verify in Prisma Studio.

---

## 5. Web Support Steps

### Browser console errors

1. Open DevTools → Console tab.
2. A red `Failed to fetch` or `net::ERR_*` error means the web app cannot reach the API. Check `NEXT_PUBLIC_API_URL` and `/health`.
3. A `CORS` error means `CORS_ORIGIN` on the API does not match the web app URL exactly (protocol + domain, no trailing slash).
4. A `401 Unauthorized` means the user's session expired. They should log out and log in again.
5. A `403 Forbidden` means the user's role does not have access to that resource — not a bug.

### SSE (real-time updates) not working

The web app connects to `GET /api/v1/events` for real-time updates. If a user says dashboard/notifications aren't updating live:
1. Check Railway API logs for SSE connection errors.
2. The SSE client retries up to 10 times after failure, then stops. A page refresh re-initiates the connection.
3. If the API is behind a Railway proxy that buffers responses, SSE may not work. Railway supports streaming — this should not be an issue, but a Railway redeploy resets all SSE connections.

---

## 6. Auth / Session Issue Recovery

### User forgot password

There is no self-service password reset in the pilot. Steps:

1. Open Prisma Studio: `cd packages/api && npx prisma studio`
2. Go to the `users` table. Find the user by email.
3. Generate a bcrypt hash for a temporary password:
   ```
   node -e "require('bcryptjs').hash('TempPassword1', 10).then(console.log)"
   ```
4. Update the user's `password` field with the hash.
5. Tell the user their temporary password and ask them to change it after login.

> Note: `bcryptjs` is already a dependency of the API package.

### User locked out (account inactive)

1. Prisma Studio → `users` → find user by email.
2. Set `isActive` to `true`.
3. User can now log in.

### "Token expired" error in mobile app

Access tokens expire after 15 minutes. The mobile app should refresh automatically using the stored refresh token (7-day lifetime). If the user is seeing this error:
1. Ask them to log out fully and log back in — this issues a fresh token pair.
2. If the refresh token is also expired (user has not opened the app in 7+ days): same fix — full re-login.

### Revoke all sessions for a user (security incident)

```sql
-- Run via Prisma Studio → raw SQL (or psql connection)
DELETE FROM "refresh_tokens" WHERE "userId" = '<user-id>';
```

This immediately invalidates all refresh tokens. The user's current access token remains valid for up to 15 minutes, then they are forced to re-login.

---

## 7. Default Workspace Issues

On first registration, the system auto-creates a default project and site for the company. If a user reports their workspace context is missing:

1. Check Prisma Studio → `projects` table, filter by `companyId`.
2. Check Prisma Studio → `jobsites` table, filter by `companyId`.
3. Check the user's `defaultProjectId` and `defaultSiteId` fields in the `users` table.
4. If project/site exist but `defaultProjectId`/`defaultSiteId` are null, update those fields directly in Prisma Studio.
5. If no project/site exist for the company: create them via the web app (company_admin role → Projects → New Project → New Site) then set as defaults.

---

## 8. Admin Account Recovery

### Recovering company_admin access

If the only `company_admin` for a company loses access:

1. Prisma Studio → `users` → find an active user in the same company.
2. Change their `role` to `company_admin`.
3. Inform the user — they now have admin access.

### Creating an additional admin

The company_admin can invite team members via the Members section of the web app. To promote an existing member to admin:
1. Prisma Studio → `users` → find user by email and `companyId`.
2. Set `role` to `company_admin`.

---

## 9. Delivery / Inventory Support Issues

### Delivery record exists but photo is missing

During the pilot, uploaded files are stored on Railway's local disk and are **lost on every redeploy or restart**. This is expected and documented. Tell the user:

> "During the pilot, uploaded photos and documents are stored temporarily and may be lost when the app is updated. The delivery record itself (quantities, status, notes) is permanent. Photos would need to be re-uploaded after an update."

The database record (delivery, photos array) still exists with the original filename — only the actual file on disk is gone. The API will return a URL that results in a 404 when the file is missing.

### Inventory quantity looks wrong

Inventory quantities are computed from `inventory_transactions`. To investigate:
1. Prisma Studio → `inventory_transactions` table, filter by `itemId`.
2. Check `txType` (delivery_in, usage_out, adjustment_in, adjustment_out, transfer_in, transfer_out) and `quantity` for each transaction.
3. Sum them manually: `delivery_in + adjustment_in + transfer_in - usage_out - adjustment_out - transfer_out` = current stock.
4. If the computed total does not match the displayed total, there is a bug — record the itemId and the computed vs displayed values and report.

---

## 10. Attendance / Labour Support Issues

### Attendance record submitted twice

If a supervisor or worker accidentally submits attendance twice for the same person/day, the API will return a `P2002` conflict error. Only one record is stored. Verify in Prisma Studio → `attendance_records`, filter by `workerId` and `date`.

To correct a wrong attendance record (e.g. wrong status):
1. Prisma Studio → `attendance_records` → find the record.
2. Update the `status` field to the correct value (present, absent, late, half_day, excused).

### Labour entry shows wrong rate

Labour entries store the `dailyRate` at the time of submission. If a worker's base rate changed after submission, existing entries are not retroactively updated — this is by design.

To correct: update the `dailyRate` on the specific `labour_entries` record in Prisma Studio.

---

## 11. Report Generation Issues

Reports are generated synchronously on the API. Large date ranges or many records may cause slow responses (up to 15 seconds before timeout).

If a report fails:
1. Check Railway API logs for an error during the report request.
2. Try a shorter date range.
3. If the API returns a 500: look for a Prisma aggregation error in logs — it likely means a query hit a data edge case. Record the exact report parameters (type, date range, project/site) and report.

---

## 12. Migration / Deploy Failure Procedure

Railway runs `prisma migrate deploy` before starting the server. If a migration fails, the deploy is halted and the previous version keeps running.

### Steps when a deploy fails due to migration

1. Railway dashboard → Service → Deployments — the failed deploy shows a red status.
2. Click the failed deploy → Logs tab. The migration error will appear near the top (before "server running").
3. Common causes:
   - **SQL syntax error in migration file** — fix the migration file and redeploy.
   - **Constraint violation** — existing data violates the new constraint. Inspect the data in Prisma Studio and clean it before redeploying.
   - **Column already exists / does not exist** — migration was already partially applied. Check `_prisma_migrations` table in Prisma Studio for the migration's `applied` and `logs` fields.
4. If the migration must be skipped: mark it as applied in Prisma Studio → `_prisma_migrations` → set `applied_steps_count` to match `steps_applied` and clear `logs`. **Do this only if you understand the exact state of the schema.**
5. Railway will automatically keep the last successful deploy running during a failed deploy — users are not affected.

---

## 13. Database Backup / Restore

### Taking a manual backup

Railway PostgreSQL does not have a one-click backup UI in all plans. To take a manual backup:

```
# Railway CLI — dumps the connected database
railway run pg_dump $DATABASE_URL > backup-$(date +%Y%m%d-%H%M%S).sql
```

Store the `.sql` file in a safe location (not the Railway container — it is ephemeral).

### Restoring from backup

```
# Restore into the Railway database (will overwrite existing data)
railway run psql $DATABASE_URL < backup-YYYYMMDD-HHMMSS.sql
```

**Warning:** Restoring overwrites all data since the backup was taken. Only do this for a true data loss incident, not for individual record corrections — use Prisma Studio for those.

### Recommended pilot cadence

Take a manual backup before every deploy during the pilot. Railway higher-tier plans include automated daily backups — check your Railway plan.

---

## 14. Rollback Procedure

See also: DEPLOYMENT.md § Rollback Procedure

### Code rollback (Railway)

1. Railway dashboard → Service → Deployments.
2. Find the last successful deployment (green).
3. Click it → "Redeploy".
4. Railway runs the same `prisma migrate deploy && node dist/server.js` — if the old code's migrations are already applied, this is safe.

### Data rollback

Prisma does not generate automatic down-migrations. If a migration introduced a schema change that is causing problems:

1. Write a corrective migration that reverses the schema change.
2. Apply it as a normal deploy.
3. If the migration added a column with bad data: update the data in Prisma Studio first, then redeploy with the corrective migration.

---

## 15. File Upload Loss Caveat (Pilot Communication)

**Tell pilot users this before they start:**

> "During the pilot, any photos, drawings, or file attachments you upload are stored temporarily. If the app is updated (which may happen several times during the pilot), uploaded files may be deleted. The records themselves (delivery details, instruction text, drawing metadata) are always saved permanently. Only the attached files are at risk. We recommend keeping your own copies of important photos during the pilot."

When a file is missing after a redeploy, the API returns the URL from the database record but the file itself is gone — the browser or mobile app will show a broken image or download error. This is not a bug; it is the expected behavior of the local disk storage used during the pilot.

---

## 16. Test Account Strategy

### Recommended pilot setup

1. Register one **admin test account** (e.g. `pilot-admin@yourcompany.com`) before handing off to users. Use this account to verify the system is working after each deploy.
2. Invite pilot users through the Members section — they each register with their own email.
3. Do not use the admin test account for real pilot data — keep it clean for troubleshooting.

### Account isolation

All data is scoped to a `companyId`. Pilot users all share one company and can see each other's projects/sites/data within that company. This is expected behavior for the multi-user construction management use case.

---

## 17. Pilot Onboarding Checklist

Complete this before handing off to pilot users:

**Infrastructure**
- [ ] `GET https://<api-url>/health` returns `{"status":"ok"}`
- [ ] Web app loads at the Railway URL and redirects to `/login`
- [ ] EAS mobile build is distributed (TestFlight / internal track)
- [ ] All Railway environment variables verified (JWT secrets ≥ 32 chars, `CORS_ORIGIN` correct, `NODE_ENV=production`)

**Admin setup**
- [ ] Admin account registered via web app `/register`
- [ ] Admin can log in to web app and reach `/dashboard`
- [ ] Admin can log in to mobile app
- [ ] At least one project and one site created
- [ ] Admin has invited or briefed pilot users on how to register/join

**Communication to users**
- [ ] File upload limitation communicated (photos lost on redeploy)
- [ ] Offline queue scope communicated (attendance + labour only)
- [ ] Reporting channel established (how users report issues to you)

**Operator readiness**
- [ ] Railway CLI installed and logged in (`railway login`)
- [ ] Prisma Studio tested (`cd packages/api && npx prisma studio`)
- [ ] Smoke test completed (see §18)
- [ ] Manual database backup taken

---

## 18. Smoke Test After Every Deploy

Run this sequence after every production deploy.

### 1. API health
```
curl https://<api-url>/health
# Expected: {"status":"ok","timestamp":"..."}
```

### 2. Auth round-trip (curl or Postman)
```
# Register (only on first deploy)
POST /api/v1/auth/register
{ "email": "smoke@test.com", "password": "Smoke1234", "firstName": "Smoke",
  "lastName": "Test", "companyName": "Smoke Co" }

# Login
POST /api/v1/auth/login
{ "email": "smoke@test.com", "password": "Smoke1234" }
# → save the accessToken

# Me
GET /api/v1/auth/me
Authorization: Bearer <accessToken>
# Expected: user object with role, companyId
```

### 3. Core data endpoints
```
GET /api/v1/projects       → 200, array (may be empty)
GET /api/v1/dashboard      → 200, stats object
GET /api/v1/workers        → 200, array (may be empty)
GET /api/v1/notifications/count → 200, { count: N }
```

### 4. Web app
- [ ] Load the Railway web URL → redirects to `/login`
- [ ] Login with the admin account → reaches `/dashboard`
- [ ] Dashboard card values load (no spinner stuck forever)
- [ ] Open Notification bell → "All caught up!" or a list
- [ ] Browser console: zero red errors

### 5. Mobile (EAS build)
- [ ] App launches → Login screen
- [ ] Login → reaches Home tab
- [ ] Dashboard stats load
- [ ] Profile tab shows user name and role

---

## 19. Support-Facing Error Messages

These are the error messages users will see and what they mean:

| Error message / code | Meaning | User-facing response |
|----------------------|---------|----------------------|
| `"Invalid credentials"` | Wrong email or password | "Please check your email and password. If you've forgotten your password, contact support." |
| `"UNAUTHORIZED"` | Session expired | "Your session has expired. Please log in again." |
| `"FORBIDDEN"` | Role doesn't allow this action | "Your account doesn't have permission for this action. Contact your company admin." |
| `"NOT_FOUND"` | The record was deleted or ID is wrong | "This item no longer exists. It may have been deleted." |
| `"CONFLICT"` | Duplicate submission | "This record already exists. Refresh the page and try again." |
| `"VALIDATION_ERROR"` | Form data failed validation | The specific field errors are shown in the UI. |
| Network error / no response | Can't reach server | "Check your internet connection. If the issue persists, contact support." |
| 503 from `/health` | Database down | Internal only — check Railway PostgreSQL service. |

---

## 20. When to Escalate vs. Self-Recover

| Situation | Action |
|-----------|--------|
| User can't log in, password needs reset | Self-recover via Prisma Studio (§6) |
| Wrong data in a record | Self-recover via Prisma Studio |
| File/photo missing after redeploy | Expected — communicate the pilot caveat (§15) |
| Offline action didn't sync | Ask user to restart app; check logs (§4) |
| Deploy failed, old version still running | Fix migration or code issue, redeploy |
| Database unreachable (503) | Check Railway PostgreSQL service; Railway support if service is down |
| All data lost / catastrophic failure | Restore from backup (§13); Railway support if database itself is gone |
| Railway service down | Railway status page: status.railway.app |
