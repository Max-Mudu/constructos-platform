# ConstructOS mobile: giving test phones a dev/staging API

Last reviewed: 2026-11-07. Nothing in this document has been provisioned or started; it is a
comparison and a recommended setup for when the owner decides to do it.

## The problem

A preview build (APK or TestFlight) needs an API address that the tester's phone can reach.

- The local API runs on a developer machine at `http://<host>:3001/api/v1`.
- `EXPO_PUBLIC_API_URL` is **baked into the JavaScript bundle at build time**. Changing the API
  address means a new build (or a new OTA update), so a stable address matters.
- **Android release builds block cleartext HTTP** (`usesCleartextTraffic` defaults to `false`
  from API 28 onwards) and **iOS App Transport Security blocks plain HTTP** too. A release or
  preview build therefore needs an `https://` API URL, unless the build is explicitly configured
  to allow cleartext (see option 1).
- Expo Go and debug builds allow cleartext, which is why `http://10.0.2.2:3001` works in the
  emulator during development.
- The app uses Server-Sent Events (`/api/v1/events`) for live updates, so the transport must
  support long-lived streaming responses.

Ground rules for every option:

- Point testers only at a database that holds **synthetic QA data**. Never production data, and
  never a copy of it.
- Do not reuse production secrets (`JWT_SECRET`, storage keys, AI keys) on a dev/staging API.
- Anything reachable from the public internet should run with
  `ALLOW_PUBLIC_REGISTRATION=false` and with `CORS_ORIGIN` set to the exact web origin (if any).
- When a proxy or tunnel agent on the same machine forwards requests to the API, every request
  arrives from `127.0.0.1`. Set `TRUST_PROXY=loopback` so per-client rate limiting and audit IPs
  use the forwarded client address (when the agent sends `X-Forwarded-For`) instead of putting
  every tester in one bucket. Check one request in the API log after setting it up.

## Options compared

| # | Option | Cost | Public exposure | Who can reach the API | HTTPS | SSE | Stable URL |
|---|---|---|---|---|---|---|---|
| 1 | LAN-only HTTP + cleartext test build | Free | None (Wi-Fi LAN only) | Devices on the same Wi-Fi | No (HTTP) | Yes | Only while the host keeps its LAN IP |
| 2 | **Tailscale Serve** (tailnet-only) | Free (Personal plan) | **None** | Devices signed in to the tailnet, or shared the machine | Yes, valid `*.ts.net` certificate | Yes | Yes (`<machine>.<tailnet>.ts.net`) |
| 3 | Tailscale Funnel | Free | **Public internet** | Anyone with the URL | Yes | Yes | Yes |
| 4 | Cloudflare Quick Tunnel (`trycloudflare.com`) | Free, no account | **Public internet** | Anyone with the URL | Yes | **No** (documented limitation) | No (new random hostname every run) |
| 5 | Cloudflare named tunnel | Free account; needs a domain on Cloudflare | Public hostname (can be gated with Cloudflare Access) | Anyone with the URL, unless gated | Yes | Yes | Yes |
| 6 | ngrok free | Free account | **Public internet** | Anyone with the URL | Yes | Yes | One free dev domain |
| 7 | Free-tier PaaS + free Postgres (e.g. Render, Koyeb, Neon) | Free tiers, with limits | **Public internet** | Anyone with the URL | Yes | Usually; free instances sleep | Yes |

### 1. LAN-only HTTP with a cleartext test build

- **How:** run the API on the developer machine (it already listens on `0.0.0.0:3001`), find
  the machine's LAN IP, and build with `EXPO_PUBLIC_API_URL=http://<lan-ip>:3001/api/v1`. The
  build must allow cleartext, for example through the `expo-build-properties` config plugin
  (`android.usesCleartextTraffic: true`; iOS needs an ATS exception), or by editing a throwaway
  `npx expo prebuild` output for a local-only build (see `ANDROID-LOCAL-BUILD.md`).
- **Exposure:** nothing leaves the LAN. Windows Firewall must allow inbound TCP 3001 on the
  *Private* network profile only.
- **Auth:** the app's normal login only.
- **Data risk:** low; traffic is unencrypted on the Wi-Fi, so use it only on a trusted network.
- **Downsides:** testers must be on the same Wi-Fi; the LAN IP can change (a DHCP reservation
  helps); a cleartext-enabled build must never be distributed beyond the test group or reused for
  production; iOS builds need extra ATS configuration.

### 2. Tailscale Serve (recommended)

The full runbook (commands, tailnet policy, API environment and TLS checks) is in
[TESTER-NETWORK-TAILSCALE.md](TESTER-NETWORK-TAILSCALE.md).

- **What it is:** Tailscale builds a private WireGuard network ("tailnet"). `tailscale serve`
  publishes a local port as `https://<machine>.<tailnet>.ts.net` with a valid TLS certificate,
  **reachable only from devices in the tailnet** (or devices of people you share the machine
  with). Nothing is published to the internet; Funnel (option 3) is a separate, explicit switch.
- **Cost:** free on the Personal plan (small number of users; testers can also be given access by
  sharing the single machine with their own Tailscale accounts).
- **Auth:** two layers: the tester's device must be authorised on the tailnet, then the app's
  normal login. Access can be revoked per device from the Tailscale admin console.
- **Data risk:** low. Only authorised devices can connect; still use the synthetic-data DB only.
- **Setup (owner, one-off):**
  1. Install Tailscale on the machine that runs the dev API and sign in.
  2. In the admin console, enable MagicDNS and HTTPS certificates for the tailnet.
  3. Run the API with `TRUST_PROXY=loopback` and `ALLOW_PUBLIC_REGISTRATION=false`.
  4. `tailscale serve --bg 3001` (serves `https://<machine>.<tailnet>.ts.net/` → `http://127.0.0.1:3001`).
     Check with `tailscale serve status`; turn off with `tailscale serve reset`.
     **Do not run `tailscale funnel`.**
  5. Each tester installs the Tailscale app (Android/iOS), signs in, and is invited to the tailnet
     or given a share of that machine.
  6. Build the preview with `EXPO_PUBLIC_API_URL=https://<machine>.<tailnet>.ts.net/api/v1`.
     Because the certificate is publicly trusted, **no cleartext or ATS exception is needed**, and
     the same build configuration works for Android and iOS.
- **Downsides:** testers install one extra app and keep the VPN toggle on; the API is reachable
  only while the host machine is awake and online; the host name is visible in the certificate
  transparency log (the name only, not the service).

### 3. Tailscale Funnel

Same as option 2 but publicly reachable (beta, ports 443/8443/10000, non-configurable bandwidth
limits). It removes the "testers install Tailscale" step at the cost of exposing the dev API to
the whole internet. Not recommended while option 2 is workable.

### 4. Cloudflare Quick Tunnel

- `cloudflared tunnel --url http://localhost:3001` prints a random `https://*.trycloudflare.com`
  URL; no account is needed.
- Documented limits: up to 200 in-flight requests, **no Server-Sent Events support**, no uptime
  guarantee, and a new hostname each run. Because the URL is baked into the build, every restart
  would need a new build. SSE live updates would not work.
- Public and unauthenticated at the edge. **Not suitable** beyond a one-off demo.

### 5. Cloudflare named tunnel

- Free Cloudflare account, `cloudflared tunnel create`, a DNS route on a domain whose DNS is on
  Cloudflare (a domain is required; registering one is a cost if none exists).
- Stable HTTPS hostname; supports SSE.
- Public by default. Cloudflare Access (free for small teams) can gate it, but an interactive
  Access login does not fit a native app's API calls; service tokens would need app changes to
  send extra headers. Without Access it is a public dev API.
- Reasonable for a longer-lived staging host if a domain already exists.

### 6. ngrok (free)

- Free account; one free dev domain (stable); up to 3 endpoints; **1 GB/month transfer and
  20,000 HTTP requests/month** on the free plan.
- Shows an interstitial warning page to browser traffic; API calls from the app are not browsers,
  but the `ngrok-skip-browser-warning` header is the documented bypass if needed.
- Public. The monthly request cap is easy to hit with polling, offline-queue retries and SSE
  reconnects across several testers.

### 7. Free-tier PaaS with a synthetic-data database

- Deploy `packages/api` to a free web-service tier and use a free Postgres (for example Neon).
  Seed it with synthetic data only (`npm run db:seed` style), never a production dump.
- Pros: independent of the developer's machine; HTTPS; stable URL.
- Cons: public; free instances sleep (first request after idle takes tens of seconds, which looks
  like a login failure on a phone), free databases can expire or be size-limited, and file
  uploads need object storage. This is real infrastructure to maintain and is close to what
  Railway already provides. Free-tier terms change often; re-check them before choosing.

## Recommendation

**Use Tailscale Serve (option 2) for tester phones.** It is the only option that is free, gives
a valid HTTPS URL (so the same preview build works on Android and iOS without cleartext or ATS
exceptions), supports SSE, and exposes **nothing** to the public internet. Access is per device
and revocable.

Keep **option 1 (LAN HTTP + cleartext)** only for local emulator/USB testing by developers, and
never distribute a cleartext-enabled build.

Avoid Cloudflare Quick Tunnels (no SSE, URL changes every run) and avoid anything public
(Funnel, ngrok, named tunnel without Access, free PaaS) unless the owner explicitly accepts a
publicly reachable dev API with `ALLOW_PUBLIC_REGISTRATION=false` and synthetic data only.

## Build-time checklist for a preview build

1. Decide the API URL (for option 2: `https://<machine>.<tailnet>.ts.net/api/v1`).
2. Set it as `EXPO_PUBLIC_API_URL` for the build (EAS environment variable for the `preview`
   profile, or the shell environment for a local `gradlew` build).
3. Confirm the URL in the build log / bundle before handing the build out. A release build
   without the variable refuses every request with a visible configuration error.
4. Sign in on the device with a QA account, check the dashboard and a tab, kill and reopen the
   app (session must be restored), then sign out.
