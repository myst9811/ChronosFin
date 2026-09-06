# Deployment Guide

**Status: live.** Deployed 2026-08-08. Project (and Vercel projects/repo) renamed from FinanceFlow to ChronosFin the same day, after the initial deploy — see the renaming gotchas below if you're ever doing this again.

| | URL |
|---|---|
| Backend (`chronosfin-api`) | https://chronosfin-api.vercel.app |
| Frontend (`chronosfin-web`) | https://chronosfin-web.vercel.app, custom domain `chronosfin.shannensaikia.in` (added 2026-08-08, pending DNS — see below) |

Both projects are connected to this GitHub repo (`myst9811/ChronosFin`) — pushes to `main` trigger automatic production deploys. Database is Neon (`neon-citron-lantern`), provisioned via Vercel's Marketplace integration.

## Custom domain: `chronosfin.shannensaikia.in`

Added to `chronosfin-web` as a project domain via the API (`POST /v10/projects/chronosfin-web/domains`, same reason as the `.vercel.app` short names above — a real tracked domain, not `vercel alias set`). `shannensaikia.in` is registered/DNS-hosted at GoDaddy (`ns03`/`ns04.domaincontrol.com` nameservers, not delegated to Vercel), so DNS has to be added manually rather than via `vercel dns`:

| Type | Name | Value |
|---|---|---|
| CNAME | `chronosfin` | `cname.vercel-dns.com` |

Same pattern as the already-working `project-exogenesis.shannensaikia.in`. Vercel auto-issues SSL once DNS resolves — no separate cert step. Check status any time with `GET https://api.vercel.com/v6/domains/chronosfin.shannensaikia.in/config?slug=shannen-saikias-projects` (`"misconfigured": false` once the CNAME has propagated and verified).

`CORS_ORIGIN` on the backend already includes this domain (comma-separated alongside `chronosfin-web.vercel.app`) and the backend has been redeployed — no further backend changes needed once DNS resolves.

## Topology

Two separate Vercel projects from this one repo, under the `shannen-saikias-projects` scope:
- **`chronosfin-api`** — Root Directory `backend`. Deploys `backend/src/server.ts` as a single Vercel Function.
- **`chronosfin-web`** — Root Directory `frontend`. Deploys the Vite build as a static site.

Both hold their plain `<name>.vercel.app` name, added as a real tracked project domain (not a one-off alias — see the gotchas below for why that distinction matters).

## Real gotchas hit during setup (not in the original plan)

These are corrections to what the original design assumed, discovered only once actual provisioning happened — worth reading before touching deploy config again:

- **"Zero-config Express" did not auto-detect.** Creating the project via `vercel project add` (CLI) rather than the dashboard's git-import flow left the Framework Preset at the default "Other", which expects a static `public/` output directory and fails the build (`No Output Directory named "public" found`) for a plain Express + `tsc` app. Fixed with `vercel project update <name> --framework express`. The frontend hit a milder version of the same risk (Framework Preset defaulted to "Other" too, though its first CLI-triggered build happened to succeed anyway) — set explicitly to `vercel project update <name> --framework vite` as a precaution, since an "Other"-preset git-triggered build could fail the same way the backend's did.
- **Root Directory isn't settable via the `vercel` CLI or visible in the dashboard's obvious spot.** `vercel project update` has no `--root-directory` flag, and this project's Vercel dashboard didn't show one in Settings → General. Set directly via the REST API instead: `PATCH https://api.vercel.com/v9/projects/{name}?slug={team-slug}` with body `{"rootDirectory": "backend"}` (or `"frontend"`), using the CLI's own stored token (`~/Library/Application Support/com.vercel.cli/auth.json`, `.token` field) as the bearer token. This setting survives a `vercel project rename` — confirmed when renaming to `chronosfin-*`, no need to redo it.
- **Once `rootDirectory` is set on a project, CLI deploys must run from the actual repo root, not the subdirectory.** `vercel deploy --cwd .../backend` (which worked fine *before* `rootDirectory` was set) starts double-applying the path afterward — `--cwd` is treated as the repo root and `rootDirectory` gets appended to it, so `--cwd backend` resolves to `backend/backend` and fails. Deploy from the actual repo root instead, with the project named explicitly: `vercel deploy --prod --cwd <repo-root> --project <name> --yes`. This uploads the whole monorepo per deploy (slightly wasteful) but is the only invocation that works consistently once `rootDirectory` is set.
- **`vercel redeploy` doesn't work across this transition.** Redeploying an old deployment that was created *before* `rootDirectory` was set fails with `The specified Root Directory "backend" does not exist` — that old deployment's uploaded source tree doesn't have a nested `backend/` folder (it was uploaded as `backend/`'s contents directly). Use a fresh `vercel deploy` (repo-root form above) instead of `vercel redeploy` after changing `rootDirectory`.
- **`vercel git connect` worked without any browser OAuth step** — the GitHub App was already authorized on the account from unrelated prior projects, so `vercel git connect <repo-url> --cwd <dir>` connected both projects non-interactively.
- **`vercel project rename` doesn't touch aliases.** Renaming `financeflow-api` → `chronosfin-api` kept the old `financeflow-api-snowy.vercel.app` alias live and didn't create a `chronosfin-api.vercel.app` one automatically — a fresh deploy picked up the project's *other* auto-generated aliases (`chronosfin-api-<team>.vercel.app` etc.) but not the clean short name.
- **`vercel alias set` is a one-off static pointer, not a tracked project domain — do not use it for a URL meant to survive future deploys.** First attempt: `vercel alias set <deployment-url> chronosfin-api.vercel.app`. This "worked" for that one deployment, but the *next* `vercel deploy --prod` didn't move it — it only auto-updates a project's actual tracked domains (the auto-generated `<name>-<team>.vercel.app` ones, confirmed by checking `vercel inspect <domain>` after a later deploy and seeing the short alias still pointing at the old deployment while the long ones had moved). This would have silently broken the clean URL on every future git-triggered auto-deploy. Fixed by adding it as a real project domain instead — `POST https://api.vercel.com/v10/projects/{name}/domains?slug={team}` with `{"name": "chronosfin-api.vercel.app"}` (no CLI equivalent found; `vercel domains add` is for domains you own via a registrar, not claiming a bare `.vercel.app` subdomain as a project domain). Once added this way it auto-tracks production deploys like any other project domain.
- **The old `financeflow-*` names were real project domains too, not just aliases — `vercel alias remove` alone didn't fully remove them.** Running `vercel alias remove financeflow-api-snowy.vercel.app` appeared to succeed, but the name resurfaced as an auto-managed alias on the next deploy, because it was still an attached project domain (created automatically at the project's first-ever deploy) — removing an alias doesn't detach the underlying domain resource. Had to `DELETE https://api.vercel.com/v9/projects/{name}/domains/{old-domain}?slug={team}` to actually detach it. Verify with `GET /v9/projects/{name}/domains` — should list only the current name's domain(s) once done.
- **Renaming the project also means updating anything that references the old name by value**, not just the alias: `CORS_ORIGIN`/`VITE_API_URL` (cross-referenced each other's old URLs), the local `docker-compose.yml`/`.env*` naming for parity, and the GitHub repo name/remote itself if renaming the whole product, not just the Vercel side.
- **After changing local Postgres credentials in `docker-compose.yml`, `docker compose down -v` only tears down containers under the compose project name it's invoked with** — an old container from before a `name:` field was added (or before a rename) can be left running and holding the port, causing the new container's port-bind to fail silently-ish (`Bind for 0.0.0.0:5433 failed: port is already allocated`) or, if the port conflict resolves but the container was created stale, come up with no port mapping at all. Check `docker ps -a --filter name=<old-name>` and manually `docker stop`/`rm`/`docker volume rm` anything left over from the old naming, then `docker compose up -d --force-recreate` to be sure.
- **`ssoProtection` can end up enabled (`"all_except_custom_domains"`) and silently gate every `*.vercel.app` URL behind a Vercel login** — hit this after the rename's redeploys: `/health` started returning a `302` to `vercel.com/sso-api` instead of `200`, for both projects, even though the very first deploy earlier the same day was confirmed publicly reachable with no auth. Cause wasn't pinned down (not something this session's commands obviously toggled), but the fix is: `vercel project protection disable <name> --sso` per project. **Worth actively checking after any deploy** (`curl -i <url>/health`, look for a clean `200` not a `302` to `vercel.com/sso-api`) since there's no custom domain on this project yet, so `all_except_custom_domains` protection would block literally every real user, not just previews — a check-list step, not a one-time fix.

## Database

Neon, provisioned via Vercel's Marketplace integration (`vercel integration add neon`), which auto-populated `DATABASE_URL` (pooled) directly and required manually mirroring `DATABASE_URL_UNPOOLED`'s value into a `DIRECT_URL` var (Prisma's schema expects that exact name; Neon's integration doesn't create it under that name itself):

- **Pooled** (via PgBouncer) → `DATABASE_URL`, used by the app at runtime. Required because many warm Vercel Fluid Compute instances would otherwise each hold their own direct Postgres connection and exhaust the connection limit.
- **Direct/unpooled** → `DIRECT_URL`, used only by `prisma migrate deploy`, since migrations need session-level features PgBouncer's transaction-pooling mode doesn't support.

Locally these are identical (same docker-compose instance) — this distinction only matters against real Neon. The Neon database itself was not renamed as part of the FinanceFlow → ChronosFin rename (project ID `neon-citron-lantern`, internal `neondb` database name) — only the app-facing names changed; there was no reason to touch the already-provisioned database.

### Security-hardening release checklist (issue #27)

Complete these environment and Neon-console steps with deployment access; they cannot be safely performed from source control:

1. Generate a fresh account-number key with `openssl rand -base64 32` and set it as `ACCOUNT_NUMBER_ENCRYPTION_KEY` for every backend environment. Do not reuse `JWT_SECRET`, put it in source control, or print it in command output. During a key rotation, set the old key in `ACCOUNT_NUMBER_ENCRYPTION_PREVIOUS_KEYS`, deploy, run the rotation command below, then remove the old key and deploy again.
2. Confirm both production Neon URLs include `sslmode=require`. The backend now refuses to start with a non-local URL that does not explicitly require TLS. `DATABASE_URL` stays pooled for runtime traffic; `DIRECT_URL` stays unpooled and is reserved for migrations.
3. Apply `prisma migrate deploy` through a schema/migration role, deploy the backend with its runtime role, then run `npm run data:encrypt-account-numbers` in an environment that has the primary key and the production database URLs. The command writes only a row count, encrypts legacy plaintext rows in batches, and records `SYSTEM` audit events. Use `npm run data:encrypt-account-numbers -- --rotate` after staging a new primary key; it re-encrypts values that are not already decryptable by that primary key.
4. In Neon, use separate credentials for migrations and the deployed API. The runtime role needs normal CRUD on the application tables but no schema-owner privileges. It needs `INSERT` plus column-level `SELECT` on the generated audit ID (Prisma uses `INSERT ... RETURNING`), but no broad audit reads, `UPDATE`, or `DELETE`. A migration role owns schema changes and can be used for a separate audited/read-only support role as needed. Example grants (replace role names and review after each schema change):

```sql
GRANT CONNECT ON DATABASE neondb TO chronosfin_app;
GRANT USAGE ON SCHEMA public TO chronosfin_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  users, accounts, transactions, goals, insights TO chronosfin_app;
REVOKE ALL ON TABLE audit_logs FROM chronosfin_app;
GRANT INSERT ON TABLE audit_logs TO chronosfin_app;
GRANT SELECT (id) ON TABLE audit_logs TO chronosfin_app;
```

5. In the Neon console, record the enabled backup/PITR retention period and an owner for restore tests. Create and validate a branch/restore procedure before relying on it, then review the retention and successful restore evidence at least annually. This is a deployment-account control, not something the application can infer from a connection string.

The listed SQL is a grant template, not an instruction to run it unchanged: validate the database/role names and Neon role-management workflow first. The migration role must remain separate from the runtime `chronosfin_app` role.

## Environment variables

Backend project (`chronosfin-api`) — all set, values never displayed during setup (piped directly from source to `vercel env add` without echoing):

| Var | Source |
|---|---|
| `DATABASE_URL` | Auto-set by the Neon integration (pooled) |
| `DIRECT_URL` | Manually mirrored from the integration's `DATABASE_URL_UNPOOLED` |
| `JWT_SECRET` | Generated fresh via `openssl rand -base64 32` (separate values for Production/Preview vs. Development, since Vercel doesn't allow a "sensitive" value on Development) |
| `JWT_EXPIRES_IN` | `7d` |
| `CORS_ORIGIN` | `https://chronosfin-web.vercel.app,https://chronosfin.shannensaikia.in` |
| `SENTRY_DSN` | Not set — observability's Sentry integration remains opt-in/inactive until a Sentry project is created |
| `ACCOUNT_NUMBER_ENCRYPTION_KEY` | Fresh base64-encoded 32-byte secret, unique per environment |
| `ACCOUNT_NUMBER_ENCRYPTION_PREVIOUS_KEYS` | Unset normally; temporary comma-separated prior key ring during rotation |

`server.ts`'s CORS config also allows any `*.vercel.app` origin automatically, so preview deployments (one per PR/branch, unpredictable subdomains) work without needing `CORS_ORIGIN` updated per-PR.

Frontend project (`chronosfin-web`):

| Var | Value |
|---|---|
| `VITE_API_URL` | `https://chronosfin-api.vercel.app/api` |

## Smoke test performed

Full flow run directly against production after the first correctly-configured deploy: `GET /health` (200, DB check passing), `POST /api/auth/register` with the real frontend's `Origin` header (201, `access-control-allow-origin` echoed correctly), `POST /api/accounts` (created), `POST /api/transactions` (created, balance-affecting logic ran correctly). The smoke-test user and its data were deleted from production afterward. Re-run after the rename to confirm the new URLs work end to end, same result.

## Redeploying / rollback

Pushes to `main` auto-deploy both projects now that git is connected — no CLI needed for routine deploys. For a manual deploy (e.g. before a git push, or to pick up an env var change immediately), use the repo-root form documented above, not the subdirectory form. Rollback: Vercel's standard model (instant rollback to any previous deployment via the dashboard or `vercel rollback`) applies now that a deployment history exists.
