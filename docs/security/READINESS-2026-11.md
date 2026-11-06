# ConstructOS security and infrastructure readiness, November 2026

- **Audit date:** 2026-11-06.
- **Base:** `main` @ `149b484` ("Harden Daily Reports and enforce scoped read access").
- **Scope:** API (`packages/api`). I read the source, not older docs. Every `file:line` below points at `main` @ `149b484`.
- **Excluded:** web and mobile client storage and UI were not audited, except where an API decision depends on them.

## 1. Executive summary

The API's tenant isolation is generally sound:

- Nearly every query is bound to `request.user.companyId`, either directly or through a parent row that was already checked against it.
- `requireProjectAccess` checks the project, the membership and that the site belongs to the project.
- Signed file URLs are HMAC-SHA256 with a timing-safe compare and a short lifetime.
- The legacy `/uploads/*` route is guarded against path traversal and checks the owning record.
- Secrets are required and long enough in production.
- Query strings are stripped from logs.

Previous hardening work shows.

The audit found **no Critical issues**. What remains falls into four groups.

1. **Two production-infrastructure gaps that will break things on Railway.**
   - **F-01:** without `TRUST_PROXY`, every client shares one rate-limit bucket.
   - **F-02:** legacy uploads are always written to the local, ephemeral disk.
   - Neither is a code bug. Both need an owner or infra decision.
2. **One configuration trap that turns into account takeover.**
   - **F-03:** any internet-reachable deployment that is not `NODE_ENV=production` returns password-reset links in the HTTP response.
3. **Policy-level data exposure inside a tenant.**
   - **F-05, F-06:** the dashboard and the SSE stream ignore project and site scope.
   - **F-07:** viewers and consultants with a site-scoped membership still see every site of the project.
   - These need an owner decision, not a quick patch. Section 3 gives the recommended policy.
4. **Small, concrete bugs.**
   - Fixed in this wave: two cross-tenant link gaps, a reset-token race, an enumeration oracle when SMTP fails, login timing enumeration, upload extensions taken from the client's filename, and missing production configuration warnings.
   - Fixed but awaiting owner approval, because they change who can access what: `authenticate` now rejects inactive users, refresh rotation is atomic, and removed finance officers no longer read drawings or instructions.

### Fix status

| PR | Contents | Mergeable without owner sign-off? |
|---|---|---|
| docs: this report | `docs/security/READINESS-2026-11.md` | Yes |
| Security hardening, [#15](https://github.com/Max-Mudu/constructos-platform/pull/15) (`fix/security-hardening`) | F-08, F-09, F-11, F-12, F-14, F-19, F-20 (warnings) | Yes. Access rules are unchanged; tenant and single-use rules that were already intended are now enforced. |
| NEEDS OWNER APPROVAL, [#13](https://github.com/Max-Mudu/constructos-platform/pull/13) (`fix/security-authz-approval`) | F-04, F-10, F-13 | **No.** These change authentication and authorization behaviour. |

## 2. Findings

Severity reflects impact × likelihood for the current pilot.

In the **Policy?** column, **Y** means an owner decision is needed before code changes. **Infra** means the action is a deployment or configuration change, not code.

| ID | Sev | Where (`main` @ 149b484) | Failure / exploit scenario | Recommendation | Status | Policy? |
|---|---|---|---|---|---|---|
| F-01 | **High** (availability) | `utils/env.ts:151` (`TRUST_PROXY` defaults to false), `server.ts:118`, `server.ts:136-142` (global 100/min keyed by `req.ip`), `routes/auth.routes.ts:204-207` (forgot-password 5 per 15 min) | Behind Railway's reverse proxy without `TRUST_PROXY`, `request.ip` is the proxy's address for every client. **All users together** get 100 requests/min (the API returns 429 under normal pilot load). Forgot-password allows **5 requests per 15 min for the whole platform**. Audit-log IPs are all the proxy's IP. | Set `TRUST_PROXY=1` (or Railway's proxy CIDR) in the Railway environment. Consider a shared rate-limit store (Redis) before running more than one replica, because the in-memory store is per instance. | Boot warning added (F-20). Owner/infra action needed. | Infra |
| F-02 | **High** (data loss) | `services/upload.service.ts:8-14, 110-134` (`storeFile` always writes to `<cwd>/uploads`), `server.ts:227-258` (served from local disk). The guard in `services/storage/index.ts:45-51` covers only the Daily Report driver. | Delivery photos and documents, drawing revisions and instruction attachments are written to the container filesystem whatever `STORAGE_DRIVER` is set to. On Railway that disk is ephemeral: **every redeploy deletes every one of these files**, while their database rows remain (404s everywhere). With more than one replica, each instance sees different files. | Move `storeFile`/`readFile`/`removeFile` onto `StorageDriver` (an S3/R2 adapter already exists: `services/storage/s3.ts`). Serve files through signed URLs (as Daily Report does) and back-fill existing keys. Until then, attach a Railway volume at `/app/packages/api/uploads` or treat uploads as disposable. | Not fixed (cross-module migration). | Y + Infra |
| F-03 | **High** (conditional) | `services/auth.service.ts:481-483` (forgot-password returns `devLink` whenever `!isProduction`), `routes/auth.routes.ts:216-217`; the same pattern exists for setup links in `services/user.service.ts` (workstream A). `server.ts:283` binds `0.0.0.0`. | Any deployment reachable from the internet, or from shared Wi-Fi in dev because of `0.0.0.0`, that runs with `NODE_ENV=development` or `test` lets **anyone reset any account's password**: `POST /auth/forgot-password {email}` → the response contains the link. `env.ts:81-85` only forces NODE_ENV to be one of three values; it does not stop a public host from running in development mode. | Gate `devLink` and setup links behind an explicit opt-in flag (for example `EXPOSE_DEV_AUTH_LINKS`, default false, auto-true only under `test`), or require `NODE_ENV=production` for every hosted environment, including QA and staging, and document it in the deploy checklist. | Not fixed (changes dev UX and touches `user.service`). | Y |
| F-04 | **Medium** | `middleware/authenticate.ts:12-20` builds `request.user` from the JWT alone, with no user lookup. TTL: `utils/env.ts:133` (`JWT_EXPIRES_IN`, default `15m`, not validated). Refresh does check `isActive` (`services/auth.service.ts:304`). | **Confirmed:** a deactivated (`isActive=false`) or deleted user keeps full API access with an unexpired access token for up to 15 minutes, or longer if `JWT_EXPIRES_IN` is raised (nothing caps it). A password reset revokes refresh tokens (`auth.service.ts:521-524`) but not the live access token. `role` and `canViewFinance` claims are equally stale for that window (`middleware/requireRole.ts:15`, `:47`). Only SSE re-checks `isActive` (`routes/events.routes.ts:64-70`). | `authenticate` checks `user {id, companyId, isActive:true}` on every request (one indexed primary-key lookup). Later options: read `role` and `canViewFinance` from the database too; cap `JWT_EXPIRES_IN` at ≤1h in production. | **Fixed in the NEEDS OWNER APPROVAL PR** (inactive, deleted or company-mismatched users get 401). Claims are still taken from the token. | Y |
| F-05 | **Medium** | `services/event-emitter.service.ts:55` (`emitToCompany`). Callers: `delivery.service.ts:311-314`, `labour.service.ts:258-261`, `instruction.service.ts:265-268`, `:354-357`, `invoice.service.ts:454, 483, 512, 541`. | Every SSE client in the company receives every event, whatever its role, project or site. A worker, contractor or viewer sees supplier names and delivery ids for projects they are not members of, plus labour-entry worker ids and invoice ids and status transitions. Invoices are finance data. Mitigation: SSE is off by default in production (`env.ts:157`). | Before enabling SSE in production, route events by audience. Invoice events should go only to finance-scoped users. Project and site events should go to members, using the site policy in Section 3. Alternatively, send only an id-free "refresh" ping and let clients refetch through scoped endpoints. | Not fixed. | Y |
| F-06 | **Medium** | `routes/dashboard.routes.ts:8-10` (authenticate only). `services/dashboard.service.ts:151-162` (5 most recent projects company-wide: name, code, location), `:173-176`, `:179-194`, `:271-296`, `:298-327` (low-stock materials with **site names**), `:364-385`. | Any authenticated user (worker, contractor, viewer, consultant) gets company-wide operational aggregates and names for projects they are not members of: project names and locations, material shortages per site, delivery, attendance and schedule counts. Financial blocks are already gated (`:197-269`). | Scope the non-financial blocks with `resolveReadScope` / `scopeWhere` (`services/report.service.ts:146-232`), as reports already do. Hide project names from non-members. Decide whether workers and contractors get a dashboard at all. | Not fixed. | Y |
| F-07 | **Medium** | `middleware/requireProjectAccess.ts:121-141` (`getAccessibleSiteIds` scopes `site_supervisor` only). Section 3 has the per-module matrix. | A viewer or consultant whose membership is limited to site A can list site B (`jobsite.service.ts:34-46`), read site B's deliveries and delivery photos and documents (`delivery.service.ts:208-232`, `file-access.service.ts:91-96`), and read site B's schedule (consultant: `schedule.service.ts:182-189`). They also see drawings and instructions for every site (`drawing.service.ts:148-189`, `instruction.service.ts:150-190`). Daily Reports already restrict them (`daily-report.service.ts:137-146`), so the platform is inconsistent. Admin-created users always get a site-scoped membership (`user.service.ts:174-181`). | Adopt the Daily Report rule platform-wide (Section 3). | Not fixed (business policy). | **Y** |
| F-08 | **Medium** | `services/instruction.service.ts:132` (revision checked only with `drawingId`), `:245`, `:315-317` (update validates links only when `siteId`, `contractorId` or `drawingId` is sent), `:333-335` | A company A project manager or admin, or a consultant on their own instruction, PATCHes `{milestoneId \| workPackageId \| revisionId: <company B id>}` (or POSTs `revisionId` without `drawingId`). The row stores the foreign id, and every read returns company B's milestone name and status, work-package name, or revision number and status. Foreign-key error vs 200 is also an id-existence oracle. | Validate every link field. The revision must belong to a drawing in this project and company. | **Fixed** (hardening PR), test `security-cross-tenant-links.test.ts`. | N |
| F-09 | **Medium** | `services/targets.service.ts:224` (`workerId` written unchecked; create checks it at `:149-156`) | PATCH a target with company B's `workerId` → the response and later reads show company B's worker first name, last name and trade (personal data). | Apply the same worker check as create. | **Fixed** (hardening PR), same test file. | N |
| F-10 | **Medium** | `services/drawing.service.ts:125-133`, `services/instruction.service.ts:92-98` (`assertProjectMember` omits `removedAt: null`). `requireProjectAccess.ts:7, 48` exempts `finance_officer` from the membership check. | A `finance_officer` removed from a project (`removedAt` set) still lists and reads that project's drawings and instructions, because the service treats the removed row as a membership. `file-access.service.ts:84-86` already requires `removedAt: null`, so the record is readable while its files are 404. Other roles are stopped earlier by `requireProjectAccess`. | Add `removedAt: null`. | **Fixed in the NEEDS OWNER APPROVAL PR** (changes finance-officer access). | Y (confirm) |
| F-11 | **Medium** | `services/auth.service.ts:478-479` (await of `sendPasswordResetEmail` without a catch) | When SMTP fails (outage, bad credentials), forgot-password returns **500 for registered emails and 200 for unknown ones**: an account-enumeration oracle, plus noisy 500s. | Catch the delivery failure, log the user id only, and return the generic 200. | **Fixed** (hardening PR), `security-reset-email-failure.test.ts`. | N |
| F-12 | **Medium** | `services/auth.service.ts:493-514` (checks `usedAt`, ~250 ms bcrypt, then an unconditional update) | Two concurrent `reset-password` requests with the same token **both succeed**, reproduced in the test before the fix. The token is not single-use under concurrency, and the second request silently overwrites the first password. | Claim the token with a conditional `updateMany({usedAt:null, expiresAt>now})` inside the transaction. | **Fixed** (hardening PR), `security-reset-token-single-use.test.ts`. | N |
| F-13 | **Medium** | `services/auth.service.ts:287-314` (find → check `revokedAt` → unconditional revoke → issue) | Two concurrent refreshes with the same refresh token both succeed and mint **two live token families**. An attacker who replays a stolen token at the same moment as the legitimate client evades reuse detection (`:293-300`). | Revoke with a conditional `updateMany({revokedAt:null})`; only the winner gets new tokens and the loser gets 401. Trade-off: a web client that fires two refreshes at once (multi-tab) now has one of them fail, so the client should serialize refresh (workstream E). | **Fixed in the NEEDS OWNER APPROVAL PR**, `security-refresh-rotation.test.ts`. | Y |
| F-14 | **Low** | `services/auth.service.ts:191-193` (unknown or inactive email returns before bcrypt) | Response time (~5 ms vs ~250 ms) reveals which emails have accounts. | Compare against a dummy bcrypt hash on that path. | **Fixed** (hardening PR), `security-login-timing.test.ts`. | N |
| F-15 | **Low** | `services/auth.service.ts:196-200` (locked accounts get a distinctive 403), `:10-11` (10 failures → 15 min lock). `routes/auth.routes.ts:101` has no per-route limit. | Locking an account confirms that it exists. Anyone can lock any known user out for 15 minutes, repeatedly, with 10 bad passwords (lockout DoS). Password spraying is limited only by the global 100/min per IP (and F-01 makes that per-platform). | Add a per-route limit on `/auth/login` keyed by IP + email. Consider returning the generic 401 while locked, and lockout with progressive delay instead of a hard lock. | Not fixed. | Y |
| F-16 | **Medium** | `prisma/schema.prisma` `Company.isActive`; not checked in `services/auth.service.ts:191` (login), `:304` (refresh) or `middleware/authenticate.ts`. `services/company.service.ts:14` does filter on it. | Users of a suspended company (`isActive=false`) can still log in, refresh and use every endpoint. Only `GET /companies/me` treats the company as gone. | Decide what suspension means. If it means "no access", check `company.isActive` at login, refresh and `authenticate`. | Not fixed. | Y |
| F-17 | **Low** | `routes/auth.routes.ts:177` (logout requires a valid **access** token) | After the 15-minute access token expires, a client cannot revoke its refresh token server-side (logout returns 401), so the refresh token stays valid for 7 days on that device. | Allow logout authenticated by the refresh token alone (it is revoke-only). | Not fixed. | N (small auth change, owner may batch with F-13) |
| F-18 | **Low** | `services/push.service.ts:15-19` (upsert by globally unique `token` reassigns the owner) | A user who learns another user's Expo push token, in any company, can re-register it as theirs. The victim's device then receives the attacker's notifications and stops receiving their own. This is also how a shared device legitimately switches users. | Reassign only when the caller proves possession (the device registers on login), or rebind only within the same company and log the takeover. | Not fixed. | Y |
| F-19 | **Low** | `services/upload.service.ts:120-122` (on-disk extension from the client's filename) | `evil.html` uploaded as `image/png` (magic bytes pass) is stored as `<uuid>.html`. Today `/uploads/*` serves it as `application/octet-stream` with `nosniff`, so it is not exploitable. It becomes stored XSS once files move behind a static host, CDN or bucket that infers Content-Type from the extension (the likely F-02 migration path). | Derive the extension from the validated MIME type. | **Fixed** (hardening PR), `security-upload-extension.test.ts`. | N |
| F-20 | **Low** | `utils/env.ts:142` (`APP_URL` defaults to `http://localhost:3000`), `:143-147` (SMTP optional), `services/email.service.ts:94-99` (warns per send only), `:151` (`TRUST_PROXY`), `:133` (`JWT_EXPIRES_IN` unvalidated) | A production deploy that forgets `APP_URL` emails reset and setup links pointing at localhost. Without SMTP, no reset or setup email is ever sent and nothing at boot says so. F-01 is silent too. | Production boot warnings (non-fatal, so no existing deploy breaks). Optionally make `APP_URL` mandatory later. | **Fixed (warnings)** (hardening PR), `security-production-config.test.ts`. | N |
| F-21 | Low | `server.ts:178-184` (logs the full `err`) | Prisma validation and known-request errors embed the call's arguments in their message. An unexpected failure in user or token writes could log `passwordHash` or `tokenHash` values. No such path was observed, but nothing redacts it. | Add pino `redact` paths and/or log only `err.code` + `err.name` for Prisma errors. | Not fixed. | N |
| F-22 | Low | `routes/auth.routes.ts:80-91, 118-129, 156-167` (refresh cookie `sameSite: strict`, `path: '/'`, plus refresh token **also in the JSON body**) | If the web app and API are on different sites (for example vercel.app vs railway.app), the strict cookie is never sent cross-site, so the web client must keep the body token in JS-readable storage, where XSS can exfiltrate a 7-day credential. | Workstream E: confirm the web storage model. Prefer a same-site API host (custom domain) with the cookie only, `path=/api/v1/auth`, and drop the body token for web clients. | Not fixed. | Y |
| F-23 | Low | `server.ts:148-150` (25 MB multipart cap); `toBuffer()` at `routes/delivery.routes.ts:237`, `drawing.routes.ts:154`, `instruction.routes.ts:157`; no `files`/`parts` limits | Concurrent 20 MB uploads are fully buffered in memory. A few authenticated users can exhaust a small Railway instance. | Stream to storage, set `limits.files: 1` and `parts`, and cap concurrent uploads. | Not fixed. | N |
| F-24 | Info | `utils/env.ts:132` (`JWT_REFRESH_SECRET` required but unused), `:134` (`JWT_REFRESH_EXPIRES_IN` unused; the lifetime is hard-coded at `auth.service.ts:12` and `auth.routes.ts:85`), `:138-141` (`AWS_*` unused) | Config drift: operators rotate or tune variables that do nothing. | Remove them or wire them up; document the real knobs. | Not fixed. | N |
| F-25 | Info | `src/dbcheck.ts:1-17` | Dev script that prints every project and company, and is compiled into `dist`. | Move it to `scripts/` or delete it. | Not fixed. | N |
| F-26 | Info | `server.ts:122-124` (CSP only in production; helmet's default `Cross-Origin-Resource-Policy: same-origin`) | With the local storage driver, signed `/api/v1/files/signed` URLs embedded as `<img>` from a different web origin may be blocked by CORP. Not verified in a browser. S3/R2 presigned URLs are unaffected. | Set `crossOriginResourcePolicy: 'same-site'` (or per-route `cross-origin` on `/files/signed`) if the local driver is used in production. | Not fixed. | N |
| F-27 | Info | `services/auth.service.ts:90-93` | `register` reveals that an email exists anywhere on the platform (emails are globally unique by design). `register` is disabled in production by default (`env.ts:153-155`). | Accept. | — | N |

### Verified as sound (no action)

- **Signed file URLs** (`services/storage/signed-url.ts`):
  - HMAC-SHA256 over `['v1', key, expiry, downloadName, contentType]` (`:129-138`).
  - `timingSafeEqual` with a length check (`:203-206`).
  - Default lifetime 300 s (`storage/types.ts:16`), hard maximum 7 days plus 60 s skew (`:20`, `:208-209`).
  - Strict key allow-list: no `..`, absolute paths, backslashes or Windows device names (`:41-58`).
  - `FILE_URL_SECRET` must be 32+ characters in production (`:97-110`), and the derived development key is domain-separated.
  - The URL is not bound to a company or user: it is a 5-minute bearer capability, minted only after the owning record's authorization check. Keys are tenant-prefixed (`daily-reports/{companyId}/…`).
  - The route returns 404 for every failure, enforces a content-type allow-list and `nosniff` (`routes/files.routes.ts:18-31`, `:62-91`).
- **Local storage driver** (`services/storage/local.ts:44-52`): resolves keys strictly inside the root, writes atomically, keeps sidecar metadata in a dot-directory that no valid key can name.
- **Legacy `/uploads/*`:**
  - Requires authentication (`server.ts:227-258`).
  - Path-traversal guard via `path.resolve` + prefix check (`:238-242`).
  - Authorization by **exact** `fileKey` ownership inside the caller's company (`services/file-access.service.ts:30-62`). A request such as `photos/a.jpg/../b.jpg` matches no row and gets 404.
- **Password reset tokens:**
  - 48 random bytes, SHA-256 hashed at rest (`utils/hash.ts:14-20`).
  - 60-minute expiry (`auth.service.ts:441, 460`).
  - Earlier live tokens are invalidated (`:453-456`).
  - Single use (made atomic in F-12).
  - A reset revokes all refresh tokens (`:521-524`).
  - Responses resist enumeration (`routes/auth.routes.ts:209-213`; F-11 and F-14 close the remaining side channels).
  - The email layer never logs the link in production and throws link-free errors (`services/email.service.ts:93-130`).
- **Refresh tokens:**
  - Opaque, 48 random bytes, hashed, rotated on every use.
  - Reuse of a revoked token revokes the user's whole family (`auth.service.ts:292-301`).
  - `isActive` is checked on refresh (`:304`).
- **Secrets:**
  - `JWT_SECRET` / `JWT_REFRESH_SECRET` are required and 32+ characters in production (`utils/env.ts:118-132`).
  - `NODE_ENV` must be valid or boot fails (`:81-85`).
  - The fake AI provider is refused in production (`:191-193`).
  - The local storage driver is refused in production unless explicitly allowed (`services/storage/index.ts:45-51`).
  - S3 must use https in production (`:31-33`).
- **Proxy trust:** `TRUST_PROXY=true` (trust every hop) is refused (`utils/env.ts:50-75`).
- **Logging:** query strings (the SSE `?token=`) are stripped from request logs, error logs and 404 logs (`server.ts:55-95`, `:179-184`, `:272-275`).
- **Errors:** 5xx responses are generic (`server.ts:185-190`).
- **CORS:** a single explicit origin with credentials (`server.ts:127-131`); production warns on localhost (`env.ts:195-202`).
- **Cookies:** `httpOnly`, `secure` in production, `sameSite: strict` (`routes/auth.routes.ts:80-86`).
- **Bind address:** `server.ts:283` binds `0.0.0.0`, which physical mobile devices need in development. See F-03 for the risk this creates together with dev reset links on shared networks.
- **Upload validation:**
  - MIME allow-list plus magic-byte check (`services/upload.service.ts:24-89`).
  - 20 MB service limit (`:22`) under a 25 MB framework cap.
  - Daily Report photos are re-encoded (`services/storage/image.ts`).

## 3. Viewer and consultant site scope: recommended platform policy

### Current state

`ProjectMember.siteId` is either null (the whole project) or one site. Platform-wide, only `site_supervisor` is narrowed by it (`getAccessibleSiteIds`, `requireProjectAccess.ts:121-141`). Daily Report alone narrows `viewer` and `consultant` too (`daily-report.service.ts:137-146`, `policy.ts` `DAILY_REPORT_SITE_SCOPED_ROLES`). New users created by an admin always receive a membership **with** `siteId = defaultSiteId` (`user.service.ts:174-181`). So in practice almost every viewer and consultant is site-scoped in the data, but the platform treats them as project-wide everywhere except Daily Reports.

| Module (route → service) | Viewer can read? | Consultant can read? | Site-scoped today for viewer/consultant? |
|---|---|---|---|
| Sites list/get (`jobsite.routes.ts:28` → `jobsite.service.ts:34-61`) | Yes | Yes | **No** (all sites listed) |
| Deliveries + photos/documents (`delivery.routes.ts:77`, `file-access.service.ts:14-16, 91-96`) | Yes | No | **No** |
| Schedule, tasks, milestones, weekly plans (`schedule.routes.ts:93`, `schedule.service.ts:182-189`) | No | Yes | **No** |
| Drawings + revisions + files (`drawing.routes.ts:44-45`, `drawing.service.ts:148-189`) | Yes | Yes | **No** (project-level, `siteId` optional; no site filter for anyone) |
| Instructions + attachments (`instruction.routes.ts:56-57`, `instruction.service.ts:150-190`) | Yes | Yes | **No** (same) |
| Reports (`report.service.ts:37-47`): "consultants" report | No | Yes | **No** (`resolveReadScope` builds `siteRestrictions` from `getAccessibleSiteIds`, which returns null for consultants) |
| Dashboard (`dashboard.service.ts`) | Yes | Yes | **No**, and not even project-scoped (F-06) |
| SSE (`events.routes.ts`) | Yes | Yes | **No**, company-wide (F-05) |
| Daily Reports | Yes | Yes | **Yes** (reference implementation) |
| Attendance, labour, inventory, targets, workers, mobile labour/deliveries | No | No | n/a (role-gated) |
| Notifications | Own only | Own only | n/a |

### Recommendation

1. **One rule, one helper.** Extend `getAccessibleSiteIds` to cover `site_supervisor`, `viewer` and `consultant` (a shared `SITE_SCOPED_READ_ROLES`, mirroring `DAILY_REPORT_SITE_SCOPED_ROLES`). The semantics match Daily Report exactly:
   - any active membership with `siteId = null` grants the whole project;
   - otherwise the user gets exactly the union of their sites.

   Add `companyId` to its `projectMember` queries while doing this. Project managers stay project-wide, as the Daily Report policy already states.
2. **Site-bound records follow automatically.** Deliveries and their files, the site list and get, schedule, and every report built on `resolveReadScope`/`scopeWhere` already call the helper, so they narrow with no further code.
3. **Project-level documents with an optional site:**
   - **Drawings and instructions:** a site-scoped viewer or consultant sees records whose `siteId` is in their sites **or is null** (project-wide documents such as general arrangement drawings).
   - **Instructions a consultant issued** stay visible to them whatever site they name.
   - This needs a small `where` change in `drawing.service.listDrawings`/`getDrawing` and `instruction.service.listInstructions`/`getInstruction`, plus the matching rule in `file-access.service.ts`.
4. **Write paths:** a site-scoped consultant may issue instructions only for their sites, or with no site. Writes elsewhere get 404 (not 403), as Daily Report does.
5. **Dashboard and SSE:** fix separately (F-06, F-05). Both must at least respect project membership before site scoping means anything.

### Migration impact

- **No schema change and no migration.** `ProjectMember.siteId` already exists.
- **Behaviour change for existing users.** Every admin-created viewer or consultant (all of them since C1 user creation) has `siteId` set, so turning the rule on immediately limits them to their default site in sites, deliveries, schedule, drawings and instructions.
  - Before enabling, run a read-only count of active `project_members` joined to `users.role IN ('viewer','consultant')` with `site_id IS NOT NULL`.
  - Decide per user whether they should be project-wide, and set `siteId = null` through the member API (or add a "whole project" option in the member UI) **before** the switch.
- **UI.**
  - Site pickers will show fewer sites (they already use the scoped site list).
  - Deep links to other sites return 404.
  - Web and mobile need a clear empty state.
  - The member-management UI should show and edit "whole project vs site".
- **Tests.** Existing suites assume viewer and consultant are project-wide (for example the delivery, drawing and instruction viewer cases). Add a matrix test per module, the pattern already used in `daily-report-access.test.ts`.
- **Rollout.** Ship behind a single env flag (`SITE_SCOPED_VIEWERS=true`) for one release so the owner can audit memberships first, then remove the flag.

## 4. Owner actions

1. **Infra:** set `TRUST_PROXY` on Railway (F-01).
2. **Infra:** decide storage for legacy uploads: a volume now, an S3/R2 migration next (F-02).
3. **Infra:** confirm `APP_URL` (https) and SMTP in production (F-20).
4. **Policy:** confirm that no hosted environment runs `NODE_ENV≠production`, or approve an explicit dev-link flag (F-03).
5. **Review/approve:** the NEEDS OWNER APPROVAL PR (F-04, F-10, F-13).
6. **Decide:** the viewer/consultant site policy in Section 3 (F-07), dashboard scope (F-06), SSE audience (F-05), what company suspension means (F-16), login lockout and rate limiting (F-15), and the push-token rebinding rule (F-18).
