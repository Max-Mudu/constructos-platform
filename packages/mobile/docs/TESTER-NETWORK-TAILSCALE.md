# Private tester network with Tailscale Serve

Last reviewed: 2026-11-07 (re-checked for the physical-device build plan). Nothing in it has been installed, signed in to or started. Tailscale is **not installed** on the owner's PC (`where tailscale` finds nothing; there is no `C:\Program Files\Tailscale`).

## 0. Minimum owner step (owner-only; everything else follows from it)

Only these three steps need the owner, because they install system software and sign in to an account:

1. Install the Tailscale client for Windows from <https://tailscale.com/download/windows> (administrator install).
2. Run `tailscale up` and sign in in the browser window it opens.
3. In the admin console at <https://login.tailscale.com/admin/dns>, confirm MagicDNS is on and click **Enable HTTPS** under HTTPS Certificates.

Then tell Claude it is done. This is enough for testing on the **owner's own** phone: signed in to the same Tailscale account, every device is the owner's, and the default policy covers them. (At test time the phone also needs the Tailscale app, signed in to that account with the VPN on.) The policy, the `tag:qa-api` tag and tester invitations (§4, §8 steps 3, 4 and 8) are needed only before **someone else's** device joins.

**What Claude can do afterwards, without further owner steps:**

- Read the machine's tailnet name (`tailscale status --json` → `Self.DNSName`). Nothing secret is printed or committed.
- Start the dev API against the **QA** database with `TRUST_PROXY=loopback` and `ALLOW_PUBLIC_REGISTRATION=false` (§5.1).
- Run `tailscale serve --bg --https=443 http://127.0.0.1:3001`, then `tailscale serve status`. Confirm it is tailnet-only and **Funnel is off**. Claude never runs `tailscale funnel`.
- Run the §6 checks: `curl.exe -v https://<machine>.<tailnet>.ts.net/health` must show certificate verification passing and return 200; `/api/v1/auth/me` must return 401; never with `-k`. Only then does Claude report the URL as working.
- Build the arm64 phone APK with `EXPO_PUBLIC_API_URL=https://<machine>.<tailnet>.ts.net/api/v1` and no cleartext exception, verify it with `aapt2` and `apksigner`, and install it with `adb` once the phone is connected over USB ([ANDROID-LOCAL-BUILD.md](ANDROID-LOCAL-BUILD.md), "Physical Android phone build plan").
- After a sign-in from the phone, check that the audit-log IP is the phone's `100.x.y.z` address, not `127.0.0.1`.
- With the owner's approval of the credit, set the EAS `preview` variable to the same URL and start the iOS simulator build ([IOS-READINESS.md](IOS-READINESS.md), section 10, milestone 1).
- Turn it off afterwards with `tailscale serve reset`.

If Windows refuses `tailscale serve` for a non-elevated user, running it in an Administrator PowerShell is one more owner action. That has not been tested, because Tailscale is not installed.

It expands option 2 of [DEV-API-ACCESS.md](DEV-API-ACCESS.md): give tester phones an HTTPS dev/QA API without exposing anything to the public internet.

## 1. What Tailscale Serve does, and why not Funnel

- Tailscale joins your devices into a private WireGuard network (a *tailnet*). Each device gets a `100.x.y.z` address and a MagicDNS name, `<machine>.<tailnet>.ts.net`.
- `tailscale serve` runs a small reverse proxy inside the Tailscale client. It accepts HTTPS on the machine's tailnet address with a **valid, publicly trusted certificate for `<machine>.<tailnet>.ts.net`**, which Tailscale obtains automatically, and forwards the requests to a local port such as `http://localhost:3001`.
- **Only devices in the tailnet can connect**, and only if the tailnet policy (§4) allows them. Nothing listens on the public internet.
- Because the certificate is publicly trusted, a normal release or preview build works on Android and iOS with **no cleartext or App Transport Security exception**. Long-lived responses (Server-Sent Events at `/api/v1/events`) pass through.
- Serve adds `Tailscale-User-Login`, `Tailscale-User-Name` and `Tailscale-User-Profile-Pic` headers (and strips incoming copies). The API ignores them. Authentication is still the app's normal login.

**Do not use `tailscale funnel`.** Funnel publishes the same local port to the **whole internet**, so anyone who learns the URL can reach the dev API. The point of this setup is that only invited, policy-allowed devices can connect. Never run `tailscale funnel` on this machine, and check that `tailscale serve status` never shows "Funnel on".

The `*.ts.net` host name appears in public certificate-transparency logs. That reveals the name only, not access to the service.

Sources: [Tailscale Serve](https://tailscale.com/kb/1312/serve) and the [`tailscale serve` CLI reference](https://tailscale.com/kb/1242/tailscale-serve), checked 2026-11-07.

## 2. Ground rules

- **Dev/QA database only.** The API behind Serve must point at the QA database, which holds synthetic data. Never production data, a production copy, or the production `DATABASE_URL`.
- **Normal login still applies.** Testers sign in with their own QA accounts, created by an admin in the app. **There are no shared admin credentials.** Do not hand out the company-admin login, and do not put any credentials in the tester instructions.
- **Inviting testers is an owner action.** Nobody else and no script adds people to the tailnet.
- **No production secrets** (JWT secrets, storage keys, AI keys) on this API.
- The API is reachable only while the owner's PC is awake, online and signed in to Tailscale.

## 3. Owner's PC: set up and serve the API

Run these on the Windows PC that runs the dev API, in an Administrator PowerShell where noted.

1. **Install Tailscale.** Download the Windows client from <https://tailscale.com/download/windows> and run the installer. This is a system-wide install, so the owner does it.
2. **Sign in and connect:**

   ```powershell
   tailscale up
   ```

   This opens a browser to sign in. The first account to sign in creates the tailnet and is its admin. Check with `tailscale status`.
3. **Enable HTTPS certificates.** In the admin console at <https://login.tailscale.com/admin/dns>:
   - make sure **MagicDNS** is enabled;
   - under **HTTPS Certificates**, click **Enable HTTPS**.

   Note the tailnet name shown there (`<tailnet>.ts.net`). The machine's full name is shown by `tailscale status --json` (`Self.DNSName`) or on the Machines page.
4. **Tag the PC** (needed for the policy in §4). First save the policy in §4, which defines `tag:qa-api`, then run:

   ```powershell
   tailscale up --advertise-tags=tag:qa-api
   ```

   Or, in the admin console: Machines → this PC → ⋯ → Edit ACL tags → `tag:qa-api`. A tagged device is owned by the tag rather than by your user, which is intended here.
5. **Start the API** with the environment in §5 (`npm run dev` in `packages/api`, as usual).
6. **Serve it on the tailnet** (HTTPS 443 → local port 3001, in the background, persists across restarts of the client):

   ```powershell
   tailscale serve --bg --https=443 http://localhost:3001
   ```

   If requests return 502, use `http://127.0.0.1:3001` instead: the API listens on IPv4 only, and `localhost` can resolve to IPv6 first.
7. **Check it:**

   ```powershell
   tailscale serve status
   ```

   It should show `https://<machine>.<tailnet>.ts.net` → `proxy http://localhost:3001`, marked as available within the tailnet, **not** Funnel.
8. **Turn it off** when testing ends:

   ```powershell
   tailscale serve --https=443 off
   # or remove every serve configuration:
   tailscale serve reset
   ```

**Windows Firewall:** testers must reach the API only through Serve (port 443). Do **not** add an inbound allow rule for TCP 3001. If Windows asks whether Node.js may accept connections, allow it only on Private networks or decline it; Serve connects locally and does not need it.

## 4. Tailnet policy: testers reach one port on one device

A new tailnet's default policy lets every device reach every other device on every port. Replace it in the admin console (Access controls → edit the policy file) with a policy like this. Use real tester logins in place of the example addresses.

```json
{
  // Testers: their Tailscale logins (as shown on the Users page).
  "groups": {
    "group:qa-testers": [
      "tester1@example.com",
      "tester2@example.com"
    ]
  },

  // Only tailnet admins (the owner) may apply the API tag.
  "tagOwners": {
    "tag:qa-api": ["autogroup:admin"]
  },

  "grants": [
    // Owner's own devices: full access, as before.
    { "src": ["autogroup:admin"], "dst": ["*"], "ip": ["*"] },

    // Testers: HTTPS 443 on the tagged API PC only. Nothing else, not each other.
    { "src": ["group:qa-testers"], "dst": ["tag:qa-api"], "ip": ["tcp:443"] }
  ],

  // No Tailscale SSH for anyone.
  "ssh": [],

  // The policy is rejected on save if any of these fail.
  "tests": [
    {
      "src":    "tester1@example.com",
      "accept": ["tag:qa-api:443"],
      "deny":   ["tag:qa-api:3001", "tag:qa-api:3000", "tag:qa-api:3389", "tag:qa-api:445", "tag:qa-api:22"]
    }
  ]
}
```

Notes:

- The policy file accepts comments and trailing commas (HuJSON).
- Access rules are deny-by-default once the default allow-all rule is gone, so testers get only what a grant gives them.
- The `deny` tests prove the API's plain-HTTP port 3001, the web dev server, Remote Desktop, file sharing and SSH are closed to testers even though the PC listens on them.
- If the owner later serves the web app too (§5.2), add `"tcp:8443"` to the tester grant and move `tag:qa-api:8443` from `deny` to `accept` in the tests.
- Without tags, the same result is possible with a `hosts` alias for the PC's `100.x.y.z` address as the `dst`. Tags are preferred because they survive address changes.

Reference: [Tailscale policy syntax](https://tailscale.com/kb/1337/policy-syntax).

### Inviting testers (owner only)

1. Admin console → **Users** → **Invite users**. Invite each tester by email. Never post an invite link in a shared channel.
2. Each tester installs the Tailscale app (Google Play or the App Store), signs in with the invited account and turns the VPN on.
3. Add the tester's login to `group:qa-testers` in the policy and save. The tests must pass.
4. In the app, a company admin creates the tester's own QA user account with the least-privileged role needed.
5. To remove a tester: delete their login from `group:qa-testers`, remove the user (or their devices) in the admin console, and deactivate their QA app account.

**Plan check (owner decision):** check the current plan limits and terms on <https://tailscale.com/pricing> before inviting testers. Third-party summaries in November 2026 report that the free Personal plan allows 6 users and is meant for **non-commercial** use, so testing a commercial product may need a paid plan. These figures were not confirmed on Tailscale's own page.

## 5. API and app configuration

### 5.1 API environment (dev/QA API on the owner's PC)

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | the **QA** database (synthetic data) | Ground rule §2. |
| `NODE_ENV` | `development` (as for local dev) | This is a dev/QA API, not production. |
| `TRUST_PROXY` | `loopback` (recommended) or `1` | Serve is a reverse proxy on the same machine, so every request arrives from `127.0.0.1`. Trusting that one hop makes rate limits and audit IPs use the forwarded client address instead of putting every tester in one rate-limit bucket. `loopback` trusts forwarded headers only when the direct peer is the local machine. `1` trusts the direct peer whoever it is, so a device that reached port 3001 directly could choose its own recorded IP. Prefer `loopback`. After setup, sign in from a phone and check that the audit-log IP is the phone's `100.x.y.z` tailnet address, not `127.0.0.1`. |
| `ALLOW_PUBLIC_REGISTRATION` | `false` | Testers get accounts from an admin, not by self-registering. |
| `APP_URL` | `https://<machine>.<tailnet>.ts.net:8443` if the web app is also served (§5.2); otherwise leave it as is | Password-reset and account-setup links are built from it. Mobile-only testing does not use these links. |
| `CORS_ORIGIN` | `https://<machine>.<tailnet>.ts.net:8443` if the web app is also served; otherwise leave it as is | Native mobile apps send no `Origin`, so CORS does not apply to them. The web app fetches `/uploads/...` from the API origin directly, so a web app served on the tailnet needs its exact origin here. Only one origin is supported (§6). |

Leave `STORAGE_DRIVER=local` for this setup. Uploaded test files stay on the owner's PC.

### 5.2 Optional: the web app on the tailnet

Only if testers also need the web app:

```powershell
tailscale serve --bg --https=8443 http://localhost:3000
```

Then, for `packages/web`, set `NEXT_PUBLIC_API_URL=https://<machine>.<tailnet>.ts.net`, and set the API's `CORS_ORIGIN` and `APP_URL` to `https://<machine>.<tailnet>.ts.net:8443` as above. While `CORS_ORIGIN` points at the tailnet origin, the web app on `http://localhost:3000` cannot load uploaded files. That is the single-origin limitation in §6.

### 5.3 Mobile build

Build the preview APK (see [ANDROID-LOCAL-BUILD.md](ANDROID-LOCAL-BUILD.md)) or EAS preview with:

```text
EXPO_PUBLIC_API_URL=https://<machine>.<tailnet>.ts.net/api/v1
```

The value is baked into the bundle at build time, so a different host name needs a new build. No cleartext setting is needed.

## 6. Verify before saying HTTPS works

The health route is **`GET /health`** at the root of the API, not under `/api/v1`. It returns `{"status":"ok",...}` when the database is reachable.

From a device in the tailnet (for example the owner's laptop, or the PC itself):

```powershell
curl.exe -v https://<machine>.<tailnet>.ts.net/health
```

On macOS, Linux or Git Bash:

```sh
curl -v https://<machine>.<tailnet>.ts.net/health
```

Use `curl.exe` in Windows PowerShell 5, where `curl` is an alias for `Invoke-WebRequest`. (`/api/v1/health` does not exist and returns the API's 404 JSON.) Pass only if all of these hold:

- the verbose output shows the TLS handshake succeeding, with **`SSL certificate verify ok`** (or the Schannel equivalent, with no certificate error) and a subject or SAN matching `<machine>.<tailnet>.ts.net`;
- the response is **HTTP 200** with `"status":"ok"`;
- `curl.exe -v https://<machine>.<tailnet>.ts.net/api/v1/auth/me` returns **401** (the API is reachable, and login is still required).

Do not use `-k` / `--insecure`: that skips exactly the check being made. The first request after enabling HTTPS can take a few seconds while the certificate is issued.

**Negative checks:**

- On a phone with the Tailscale VPN **off**, the same URL must fail to connect or resolve.
- From a tester's device, `http://<machine>.<tailnet>.ts.net:3001/health` must fail (blocked by the policy).

Then, on a tester phone with the preview build: sign in with the tester's own QA account, open the dashboard and one tab, kill and reopen the app (the session must be restored), and sign out.

## 7. Possible API change (lead decision; not implemented)

`CORS_ORIGIN` accepts exactly one origin (`server.ts` passes the string to `@fastify/cors`). That is enough for mobile testers, since native apps send no `Origin`. It only matters if the web app must work on both `http://localhost:3000` and the tailnet origin at the same time. A small, opt-in change would parse a comma-separated `CORS_ORIGIN` into an exact-match list, with a single value behaving exactly as today. It touches the CORS policy, so it is left to the lead to schedule as its own reviewed PR. No other API change is needed for Serve: `TRUST_PROXY` already accepts `loopback`, and the API does not depend on the request's host name.

## 8. Full sequence, including other testers

**Owner** marks a step only the owner can do. Steps 1 and 2 are the minimum owner step in §0. Steps 3, 4 and 8 are needed only before someone other than the owner joins. Claude can do the others once steps 1 and 2 are done.

1. **Owner:** install the Tailscale Windows client and run `tailscale up` to sign in.
2. **Owner:** admin console → DNS: confirm MagicDNS and click **Enable HTTPS**.
3. **Owner** (before other testers): replace the policy file with §4 (real tester logins), save, and confirm the tests pass.
4. **Owner** (before other testers): tag the PC `tag:qa-api`.
5. Start the dev API against the **QA** database with `TRUST_PROXY=loopback` and `ALLOW_PUBLIC_REGISTRATION=false`.
6. Run `tailscale serve --bg --https=443 http://127.0.0.1:3001` and check `tailscale serve status` (no Funnel).
7. Run the §6 checks (`curl.exe -v https://<machine>.<tailnet>.ts.net/health`, plus the negative checks).
8. **Owner** (before other testers): check the plan terms, then invite testers and add them to `group:qa-testers`. An admin creates their own QA app accounts.
9. Build with `EXPO_PUBLIC_API_URL=https://<machine>.<tailnet>.ts.net/api/v1` (the local arm64 APK in [ANDROID-LOCAL-BUILD.md](ANDROID-LOCAL-BUILD.md), or an EAS `preview` build once the credit is approved) and install it.
10. When done: `tailscale serve reset`, and remove the testers from the group.
