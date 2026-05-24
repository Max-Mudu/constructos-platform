# ConstructOS — Internal Pilot Launch Guide

This document covers two things:
1. **Operator launch execution checklist** — what you do on deploy day.
2. **Pilot user onboarding guide** — what you send/say to the 3–5 pilot users.

---

## Part 1 — Internal Pilot Launch Execution Checklist

Work through this in order on the day of the first real-user deploy. Check off each item before moving to the next section.

---

### T-minus: Before You Start

- [ ] You have Railway CLI installed and are logged in (`railway login` — confirm no error)
- [ ] You can reach Prisma Studio against the production database (`cd packages/api && npx prisma studio` — confirm tables load)
- [ ] You have the pilot user names, emails, and roles written down
- [ ] You have a feedback capture spreadsheet/doc open and ready
- [ ] You have read SUPPORT.md and DEPLOYMENT.md once through this week

---

### Step 1 — Verify Infrastructure

```bash
# 1a. API health
curl https://mellow-acceptance-production-3902.up.railway.app/health
# Expected: {"status":"ok","timestamp":"..."}
# If 503: check Railway → PostgreSQL service is running

# 1b. Web app loads
# Open in browser: https://<your-web-railway-url>
# Expected: redirects to /login (not a blank screen or 500)
```

- [ ] `/health` returns 200 with `"status":"ok"`
- [ ] Web app loads and shows the login page

---

### Step 2 — Verify Environment Variables

In Railway → API service → Variables, confirm:

- [ ] `NODE_ENV` = `production`
- [ ] `JWT_SECRET` is set and ≥ 32 characters (check length — paste into `echo -n "value" | wc -c`)
- [ ] `JWT_REFRESH_SECRET` is set, ≥ 32 characters, and **different** from `JWT_SECRET`
- [ ] `CORS_ORIGIN` = exact URL of the web app (e.g. `https://your-web.up.railway.app`, no trailing slash)
- [ ] `DATABASE_URL` is present (auto-set by Railway if PostgreSQL is linked)

In Railway → Web service → Variables, confirm:

- [ ] `NEXT_PUBLIC_API_URL` = `https://mellow-acceptance-production-3902.up.railway.app` (no trailing slash, no `/api/v1`)

---

### Step 3 — Verify Admin Account

- [ ] You can log in to the web app with the admin account you registered
- [ ] Dashboard loads (may show zeros — that is expected for a new account)
- [ ] At least one Project and one Site exist (auto-created on registration, or create manually)
- [ ] Admin `defaultProjectId` and `defaultSiteId` are set — run:

  ```bash
  # GET /api/v1/auth/me with admin Bearer token
  # Response should include defaultProjectId and defaultSiteId (not null)
  ```

  If null: open Prisma Studio → `users` → find admin → set `defaultProjectId` and `defaultSiteId` from the `projects` and `jobsites` tables.

---

### Step 4 — Take a Pre-Pilot Database Backup

```bash
# From your local terminal with Railway CLI
railway run pg_dump $DATABASE_URL > backup-pilot-start-$(date +%Y%m%d-%H%M%S).sql
```

- [ ] Backup file created and stored somewhere safe (not on Railway)

---

### Step 5 — Run Full Smoke Test

Follow the smoke test procedure in SUPPORT.md §18. Mark each item complete.

- [ ] API health ✓
- [ ] Auth round-trip (login → /me) ✓
- [ ] GET /projects → 200 ✓
- [ ] GET /dashboard → 200 ✓
- [ ] GET /workers → 200 ✓
- [ ] GET /notifications/count → 200 ✓
- [ ] Web login → dashboard ✓
- [ ] Web: no red errors in browser console ✓
- [ ] Mobile: login → home tab ✓ (if EAS preview build is ready)

---

### Step 6 — Distribute Mobile App

If using EAS preview build:

```bash
cd packages/mobile
eas build --profile preview --platform android   # APK for Android pilot users
# or
eas build --profile preview --platform ios       # IPA for iOS pilot users (requires Apple provisioning)
```

- [ ] APK/IPA built successfully
- [ ] Distributed to pilot users via EAS internal distribution link or direct file transfer
- [ ] Each user confirmed they have installed the build (not Expo Go — the EAS build)

---

### Step 7 — Pilot User Invitations

For each pilot user:

1. **Register their account** — either let them self-register via the web app `/register`, or register on their behalf if they're not technical.

   > If self-registering: each user creates their own company. You'll want them all in the **same company** for a realistic multi-user test. Use the Members/invite flow after the first admin registers.

2. **Assign the correct role** — via Prisma Studio → `users` → set `role`:
   - Site supervisor: `site_supervisor`
   - Finance officer: `finance_officer`
   - Project manager: `project_manager`
   - Worker: `worker`

3. **Confirm their `defaultProjectId` / `defaultSiteId`** are set — same check as Step 3.

- [ ] All pilot users registered and roles assigned
- [ ] All pilot users have non-null `defaultProjectId` and `defaultSiteId`
- [ ] Each user can log in to web or mobile and reach the dashboard

---

### Step 8 — Confirm Pilot Communications

- [ ] Pilot users know how to report issues to you (WhatsApp / email / Slack — whichever you use)
- [ ] You have sent the pilot user onboarding guide (Part 2 of this document) to each user
- [ ] File upload limitation communicated (see Part 2)
- [ ] Offline-only scope communicated: attendance check-in and labour entries work offline; everything else requires connectivity

---

### Step 9 — Confirm Operator Readiness

- [ ] SUPPORT.md is open in a tab or printed
- [ ] Railway logs are accessible (`railway logs --tail` or Railway dashboard Logs tab)
- [ ] Prisma Studio is accessible against production
- [ ] Feedback capture spreadsheet is open
- [ ] You know the rollback steps (DEPLOYMENT.md §Rollback Procedure) by heart or have them open

---

### Step 10 — Go / No-Go Decision

Review:

| Gate | Status |
|------|--------|
| `/health` returns 200 | Must be ✅ |
| Web app loads and login works | Must be ✅ |
| Admin account works on both web and mobile | Must be ✅ |
| Pre-pilot backup taken | Must be ✅ |
| All pilot users registered with correct roles | Must be ✅ |
| `defaultProjectId` / `defaultSiteId` set for all users | Must be ✅ |
| Mobile build distributed | Must be ✅ for mobile pilot users; optional if web-only |
| Smoke test passed | Must be ✅ |

**If all gates pass: GO.**

If any Must-be gate fails: **NO-GO** — resolve before proceeding.

---

### Post-Launch (Day 1 Monitoring)

After handing off to users:

- Check Railway logs every 2 hours for the first day
- Respond to user reports within 1 hour (Critical/High) or by end of day (Medium/Low)
- Take a backup at the end of Day 1

---

## Part 2 — Pilot User Onboarding Guide

*This is what you send to pilot users. Adapt the wording to your relationship with them.*

---

### Welcome to ConstructOS Pilot

Thank you for participating in the ConstructOS internal pilot. This guide tells you everything you need to know to get started.

---

### How to Access

**Web app:**
Open [https://your-web.up.railway.app] in your browser (Chrome or Edge recommended). You do not need to install anything.

**Mobile app:**
Install the ConstructOS app using the link we sent you. Make sure you install the app we sent — do not use Expo Go.

---

### Logging In

1. Go to the login screen.
2. Enter the email and password we set up for you (or that you chose when registering).
3. You'll land on the Dashboard — this is your operational home screen.

If you forget your password, message the pilot coordinator directly — there is no self-service reset yet.

---

### What You Can Do

Your access level depends on your role. Here is what each role can do:

| Role | Capabilities |
|------|-------------|
| Company Admin | Everything — projects, users, budgets, reports |
| Project Manager | Projects, schedules, instructions, drawings, reports |
| Site Supervisor | Daily operations: attendance, deliveries, labour, inventory |
| Finance Officer | Invoices, budgets, financial reports |
| Worker | Attendance self check-in only |

---

### Your Workspace

When you log in, the app already knows your default project and site. You don't need to select a project or site to start working — just tap the module you need.

On the web sidebar, you'll see direct links to:
- Inventory
- Deliveries
- Schedules
- Labour
- Attendance

On mobile, the same modules load your default site automatically.

---

### Important: File Upload Limitation

During the pilot, photos and file attachments you upload (delivery photos, drawings, instruction files) are **stored temporarily**. If the app is updated during the pilot, uploaded files may disappear. **The text records are always permanent — only the files can be lost.**

We recommend keeping your own copies of important site photos until after the pilot.

---

### Working Offline (Mobile Only)

The mobile app supports offline mode for:
- Attendance check-in (your own)
- Attendance recording (supervisor)
- Labour entry creation

Everything else requires an internet connection. When you reconnect, offline actions sync automatically. If they don't sync after 10 minutes, close and reopen the app.

---

### Reporting Issues

If something doesn't work as expected:

1. Note the exact screen you were on and what you were trying to do.
2. Note the exact error message (or take a screenshot).
3. Send it to [pilot coordinator contact] via [WhatsApp/email/Slack].

Please do not try to work around issues by submitting data twice — this can create duplicate records.

---

### What We're Testing

During this pilot, we're focused on:
- Does the core workflow (attendance, deliveries, inventory, labour) work reliably?
- Is the app fast enough for daily use?
- Is anything confusing or missing?

Your feedback on all three areas is valuable. We want to hear both problems and things that work well.

---

### Questions?

Contact [pilot coordinator name] at [contact details].

---

*ConstructOS v1.0 — Internal Pilot*
