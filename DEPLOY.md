# Deploying omalyzer.com

The web app (`web/`) is a static Vite/React bundle served from a private S3 bucket
through CloudFront, on the `omalyzer.com` domain. All analysis runs client-side in
WASM; the only backend is Supabase (auth + contribution storage), which the app
talks to directly from the browser.

## One-command deploy

```sh
./deploy.sh
```

Builds `web/`, syncs `dist/` to S3, fixes the `.wasm` content-type, and invalidates
the CloudFront cache. New version is live within ~1–2 minutes. Requires the `aws`
CLI authenticated for the `hilsbos` profile (`aws login --profile hilsbos`).

## AWS resources (account 022103836148, us-east-1)

| Resource | Value |
| --- | --- |
| S3 bucket (private) | `omalyzer-web-022103836148` |
| CloudFront distribution | `E27JEVRT6GNQ6O` (`d288otg5408l7w.cloudfront.net`) |
| Origin Access Control | `E324B5HC3WU8MD` |
| ACM cert (us-east-1) | covers `omalyzer.com` + `www.omalyzer.com` |
| Route 53 zone | `Z0084732587VTUX52I13` — apex + `www` alias A/AAAA → CloudFront |

Design notes: the bucket is **private** (all public access blocked); only this
distribution can read it (bucket policy scoped to the distribution ARN via OAC).
SPA deep links work because CloudFront maps S3 403/404 → `/index.html` (200).
HTTP redirects to HTTPS; responses are gzip/br compressed.

## Supabase setup required for sign-in / contributions on production

The public site (landing, science, live analyzer) works with no backend. For
auth + saving oms to work on `https://omalyzer.com`:

1. Apply `supabase/migrations/0001_init.sql` to the project (SQL Editor or
   `supabase db push`) — see `supabase/README.md`.
2. Supabase → Authentication → URL Configuration:
   - **Site URL**: `https://omalyzer.com`
   - **Redirect URLs**: add `https://omalyzer.com` and `https://www.omalyzer.com`
     (and `http://localhost:5173` for local dev).
3. The app reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from `web/.env.local`
   at build time (gitignored; the anon key is browser-safe). To rotate, edit that
   file and re-run `./deploy.sh`.
