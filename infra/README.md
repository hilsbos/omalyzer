# Cloud / infra moved → `../+shushu`

The omalyzer cloud-infrastructure setup and analysis (nine.ch provisioning, Caddy, mail
plan, strategy docs, backup, Supabase self-host runbook) now live in the umbrella ops
repo **`../+shushu`** (single source of truth for the whole shushu self-hosted cloud):

- Runbook & setup scripts: `../+shushu/setup/` (provision.sh, Caddyfile, backup.sh) and
  `../+shushu/setup/omalyzer/` (Supabase env, OTP email templates).
- Analysis & decisions: `../+shushu/knowledge/` (start at `../+shushu/AGENTS.md`).
- omalyzer→nine migration runbook: `../+shushu/knowledge/analysis/omalyzer-nine-runbook.md`.

This repo keeps only the **app** and its deploy (`../deploy.sh`, `../DEPLOY.md`).
