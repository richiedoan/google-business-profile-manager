# Google Business Profile Manager

## Local setup

Requires Node.js 22.12+ (Node.js 24 recommended), npm, and Docker Compose.

1. Run `npm install`.
2. Copy `.env.example` to `.env` and replace the placeholder database values.
3. Copy `apps/api/.env.example` to `apps/api/.env`. Set `DATABASE_URL` to match
   the Compose credentials and database. URL-encode special characters in credentials.
4. Run `docker compose up -d --wait`.
5. Run `npm run db:migrate` to apply the initial identity migration, then
   `npm run db:generate` and `npm run dev`.

Open http://localhost:3000. Check the API with `curl http://localhost:3001/health`;
expect `{ "status": "ok" }`. The API requires an available database at startup.
For this separate-port setup, set `NEXT_PUBLIC_BFF_ORIGIN=http://localhost:3001`
in `apps/web/.env.local`. Visit `/login` for the public
sign-in page and `/app` for the shell with a live API health check.
The application shell checks `/api/me`; unauthenticated visitors go to `/login`.
To enable local login, set `LOCAL_DEV_LOGIN_ENABLED=true` in both `apps/api/.env`
and `apps/web/.env.local` (copy the web example if needed), then restart dev.
This creates an initial VIEWER fixture and a PostgreSQL-backed session. The flag
is off by default and cannot enable local login in production.

## Vercel deployment

Import the repository as one Vercel project with its root at the repository root.
The root `vercel.json` builds the NestJS `api` and Next.js `web` services independently,
including their shared contracts. API routes retain their existing `/api/*` prefix;
`/auth/*` also reaches NestJS for Google sign-in and callbacks. Other paths reach
Next.js. `/health` is a Next.js runtime route that checks NestJS through the
`web` service's `API_URL` binding. Do not set `API_URL` yourself or put it in a
`NEXT_PUBLIC_*` variable. Leave `NEXT_PUBLIC_BFF_ORIGIN` unset on Vercel.

Set `DATABASE_URL` to an accessible PostgreSQL database and `WEB_ORIGIN` to your
public HTTPS origin in the project's environment variables. For Google login,
set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and
`GOOGLE_OAUTH_REDIRECT_URI=https://<your-domain>/auth/google/callback`; register
that exact callback with Google. Configure preview environments separately.
Apply committed migrations before serving traffic with
`npm exec -w @gbp/api -- prisma migrate deploy` against the deployment database.
Keep local login and local lab flags disabled. Compose supplies local PostgreSQL
only; it is not a Vercel service. The mock provider's edits are held in memory
and are not durable across function instances.

Test the services from the repository root with `npx vercel dev` (or
`npx vercel dev -L` without cloud authentication). Remove any local
`NEXT_PUBLIC_BFF_ORIGIN` override and set `WEB_ORIGIN` to the origin printed by
the CLI. Vercel injects `API_URL` automatically. Check `/health`, `/login`, and
`/api/me`; the latter returns 401 without a session. Google sign-in requires
the matching callback and database configuration.

## Workspace commands

| Command                | Purpose                          |
| ---------------------- | -------------------------------- |
| `npm run dev`          | Run web and API together         |
| `npm run build`        | Build contracts, API, and web    |
| `npm run lint`         | Lint workspace source            |
| `npm run typecheck`    | Check all workspace types        |
| `npm test`             | Run deterministic API HTTP tests |
| `npm run format`       | Format repository files          |
| `npm run format:check` | Check formatting                 |
| `npm run db:generate`  | Generate Prisma client           |
| `npm run db:migrate`   | Create/apply schema migrations   |

The schema includes User, OAuthConnection, Membership, and Session. HTTP tests run without a
live database; startup against PostgreSQL is a separate manual smoke check.
Stop PostgreSQL with `docker compose down`; its named volume preserves data.

CORS permits only the local web origin, `http://localhost:3000`. To verify,
run `curl -i -H 'Origin: http://localhost:3000' http://localhost:3001/health`,
then repeat with `Origin: https://untrusted.example`; only the local origin
receives an `Access-Control-Allow-Origin` header.

Real `.env` files are ignored. Example files contain placeholders only.
The API uses a deterministic mock provider with 1,000 locations across two accounts.
Optionally set `MOCK_LOCATION_COUNT=10000` in `apps/api/.env` for a larger dataset.
Run `npm test` to exercise pagination, updates, access checks, and error scenarios.
Session login/me/logout and server-side Google OIDC login are implemented.
Account selection, paginated location reads, filters, and location detail are available
at `/app` after sign-in. See [read-flow and bulk-selection testing](docs/read-flows.md).
See [architecture](docs/architecture.md) for boundaries and deferred work.

See [rendering security and the local XSS lab](docs/security-notes.md) for the
controlled `/labs/xss` comparison and HttpOnly limitations.

## Location authorization and local comparison lab

`VIEWER` receives `location:read`; `MANAGER` also receives `location:write`.
The UI reads these permissions from `/api/me`. Direct API requests still pass
session/CSRF checks, the NestJS permission guard, and service/resource policy.
The server-owned mock entitlement lookup grants `account-1`; `account-2` is
out of scope for both roles. `location-00001` belongs to account-1 and
`location-00002` belongs to account-2.

For local MANAGER testing, sign in locally first, run
`npm exec -w @gbp/api -- prisma studio`, find `local.viewer@example.test` in
User, and change its Membership role to MANAGER. Reload the app after saving.
Change it back to VIEWER for negative write tests.

**LOCAL LAB ONLY:** the intentionally broken comparison requires all of these
API environment settings and an API restart:

```dotenv
NODE_ENV=development
WEB_ORIGIN=http://localhost:3000
LOCAL_LAB_ONLY=true
LOCAL_LAB_BROKEN_AUTHORIZATION=true
```

It defaults off. Startup rejects production, nonlocal web origins, and missing
explicit opt-in. The lab is restricted to the current mock provider's accounts;
it bypasses location permission/account checks while retaining sessions, CSRF,
and writable-field validation. `/api/me` still reports the real user's
permissions, so a Viewer must use a direct request to demonstrate write bypass.

After signing in as Viewer, run this in the browser console at
`http://localhost:3000`:

```javascript
const api = "http://localhost:3001";
const detail = await fetch(`${api}/api/locations/location-00002`, {
  credentials: "include",
});
console.log("Cross-account read:", detail.status);
const { csrfToken } = await (
  await fetch(`${api}/api/csrf`, {
    credentials: "include",
  })
).json();
const write = await fetch(`${api}/api/locations/location-00002`, {
  method: "PATCH",
  credentials: "include",
  headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
  body: JSON.stringify({ websiteUrl: "https://lab.example" }),
});
console.log("Viewer cross-account write:", write.status);
```

Both requests return 403 with the lab off and 200 with it on. Set
`LOCAL_LAB_BROKEN_AUTHORIZATION=false` and restart the API to restore enforcement.
Mock edits reset on API restart. Do not enable this lab on a shared environment.

## Session checks

Run `npm test` for deterministic HTTP and web tests. With migrated local PostgreSQL,
run the optional durable-store test:

```bash
RUN_SESSION_DB_TESTS=true NODE_ENV=test npm exec -w @gbp/api -- tsx --test test/session.database.test.ts
```

This test creates/reuses the local VIEWER user and removes its test session afterward.
It must run against a local/test database. No existing user is deleted.

In the browser, open `/app` without a session: expect a redirect to `/login`. Enable
local login as above, click Sign in locally, and expect `/app` to render. DevTools
should show a host-only HttpOnly, SameSite=Lax cookie for the BFF, and `/api/me`
should return only id, email, displayName, role, permissions. Restart the API and
refresh: the session persists because it is stored in PostgreSQL. Click Sign out:
its database session is deleted, the cookie is cleared, and `/app` requires login.

To exercise expiry locally, use `npm exec -w @gbp/api -- prisma studio` to set the
local fixture's session expiresAt to a past time, then reload `/app`. The UI should
show Session expired. A missing, malformed, unknown, or revoked cookie instead
returns UNAUTHENTICATED. HTTP clients must send `Origin: http://localhost:3000`
for POST /auth/dev-login and POST /api/logout; mismatched/missing origins get 403.
Never copy session cookie values into logs, tickets, or source files.

## Google sign-in

Configure the Google client ID, secret, and exact BFF callback URI in `apps/api/.env`
as described in [auth flow](docs/auth-flow.md), apply migrations, and restart dev.
The web login page navigates to the BFF's Google authorization endpoint. Without
Google configuration, this endpoint returns 404 and local login can still be enabled
explicitly for development. This login flow only establishes identity. For multiple Google Business connections with encrypted offline tokens, follow [Google provider setup](docs/google-provider.md).

Mutation requests, including logout, obtain session-bound proof from `/api/csrf`
and send `X-CSRF-Token` plus the browser Origin. See [CSRF/CORS strategy](docs/csrf-cors.md)
for manual checks and the explicitly disabled LOCAL LAB ONLY CORS demonstration.

Set `LOCATION_UPDATES_DISABLED=true` in both `apps/api/.env` and
`apps/web/.env.local` (or both deployment environments) to disable location
updates. The web hides the editor and the API service rejects updates with
`PERMISSION_DENIED` (HTTP 403). Updates are disabled by default, including when the flag is unset.
Set `LOCATION_UPDATES_DISABLED=false` in both apps to enable editing.
Restart both apps after changing the flag. Location reads remain available.

### Connect multiple Google accounts

The Google provider supports multiple Gmail connections per app user without manually configuring refresh tokens, user IDs, or Business account IDs. Configure the shared OAuth client, Business callback and token encryption key once, apply the database migration, then use **Thêm tài khoản Google** on the dashboard. See [Google provider setup](docs/google-provider.md) for configuration, deployment and reconnect behavior.

The login page and workspace include an English / Tiếng Việt language selector. UI text uses `t(key)` from `useLanguage()`, with Vietnamese translations in `apps/web/lib/translations.ts` and English keys as fallback. Browser choices persist locally; signed-in choices are saved to the user account and restored on later logins. Apply the user language migration with `npm exec -w @gbp/api -- prisma migrate deploy` before starting the updated API.
