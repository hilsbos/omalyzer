# Deploying omalyzer.com

The web app (`web/`) is a static Vite/React+WASM bundle. All analysis runs
client-side in WASM; the only backend is Supabase (auth + contribution storage),
which the app talks to directly from the browser.

As of the nine.ch migration, the **whole stack runs on nine.ch in Zürich** (EU/CH
data residency for the raw voice recordings): Caddy serves the static bundle and
reverse-proxies a self-hosted Supabase stack. Full setup, provisioning, data
migration, DNS cutover, and backups live in the umbrella cloud repo
**`../+shushu`** (start at `../+shushu/AGENTS.md`; omalyzer runbook at
`../+shushu/knowledge/analysis/omalyzer-nine-runbook.md`).

## One-command deploy

```sh
NINE_HOST=<cloudvm-ip> ./deploy.sh
```

Builds the WASM core + the Vite bundle and `rsync`s `dist/` to `/srv/omalyzer/web`
on the box. Caddy serves it immediately — `index.html`/`worklet.js` are no-cache,
hashed assets immutable, `.wasm` gets `application/wasm` (see `infra/Caddyfile`).
Requires SSH access as the `deploy` user (created by `infra/provision.sh`).

## Backend (self-hosted Supabase)

The Supabase stack (Postgres + GoTrue auth + PostgREST + Storage + Kong + Studio)
runs via docker compose on the CloudVM, reachable at `https://api.omalyzer.com`.
The app reads `VITE_SUPABASE_URL` (`https://api.omalyzer.com`) and
`VITE_SUPABASE_ANON_KEY` (derived from the box's `JWT_SECRET`) from
`web/.env.local` at build time. Schema lives in `supabase/migrations/0001_init.sql`;
sign-in/OTP and SMTP configuration are in `../+shushu/setup/omalyzer/`.

The public site (landing, science, live analyzer) needs no backend; only sign-in
and saving oms touch Supabase.

## Legacy (AWS) — retired

The previous deploy used a private S3 bucket + CloudFront (us-east-1) for the
static site, Supabase Cloud (US) for the backend, and AWS SES for OTP email. That
recipe — bucket `omalyzer-web-022103836148`, distribution `E27JEVRT6GNQ6O`, the
SES SMTP setup — remains in git history if it's ever needed for rollback.
