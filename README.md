# Google Business Profile Manager

Manage **multiple locations** and **multiple Google accounts** in one workspace. View business profiles, track performance, manage content, and test bulk updates with mock data.

Built with **Next.js**, **NestJS**, **PostgreSQL**, and shared TypeScript contracts in an npm workspace.

**Current scope:** Google data reads and content management are implemented. **Editing Google location profile fields is not supported yet.** See the feature table below for details.

## 1. The problem

Teams managing many branches need to check opening status, contact details, performance, and reviews across locations. When profiles belong to different Google accounts, switching accounts and checking each location makes the work harder to track.

This project brings these tasks into one place:

- **Multiple Google accounts:** choose a connection, business account, and location in the same workspace.
- **Large location lists:** search, filter, and load one page at a time while keeping the correct connection.
- **Performance reporting:** view results for one location or a whole account, with missing data shown separately from zero values.
- **Content management:** manage photos, posts, and review replies based on user permissions.
- **Server-side access checks:** keep Google tokens on the server and check access before each operation.
- **Local testing:** test workflows without changing public Google profiles.

## 2. Possible solutions

These are options for solving the problem. They are not a benchmark of specific products.

| Approach                                          | Good fit                                                           | Trade-off                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| **Google Business Profile UI**                    | Working on individual profiles when Google's tools meet your needs | Review, reporting, and teamwork follow Google's interface          |
| **Spreadsheets and API scripts**                  | Small reports or focused internal tasks                            | You manage OAuth, permissions, errors, and the user interface      |
| **Third-party platform**                          | Using an existing workflow with less custom development            | You need to check pricing, data access, and fit for your team      |
| **Custom web app + BFF + Google APIs**, used here | Controlling workflows, permissions, and reports                    | You maintain hosting, security, operations, and Google API changes |

## 3. Why this project uses a BFF and providers

The design separates the user interface from Google integration. A **Backend for Frontend (BFF)** handles requests from the web app and controls access to data.

- **Server-side authorization:** NestJS checks the session, role, connection owner, and account/location access before calling a provider. The browser calls the app's API.
- **Separate login and Business access:** Google login identifies the app user. A separate consent flow connects Business accounts. One app user can connect several Google accounts without changing their session or role.
- **Swappable providers:** mock and Google use the same `BusinessProfileProvider` interface. Tests can check reads, errors, and permissions with fixed data while Google integration stays on the server.
- **Shared contracts:** TypeScript and Zod define the data passed between web and API. The UI does not depend directly on database models or Google responses.
- **Persistent sessions:** PostgreSQL keeps sessions across API restarts. Business refresh tokens are encrypted before storage.
- **One workspace:** web, API, and contracts can change together, with build and checks run from the repository root.

The trade-off is running a web app, an API, and a database. Google still controls API approval, quotas, and content processing. Large background jobs also need infrastructure that this version does not include.

## 4. Benefits and current features

The main benefits are **one workspace for multiple connections**, **shared data contracts**, **server-side permissions**, and **mock development without Google access**.

The location list uses **infinite scrolling** to load more data and **virtualization** to keep the number of rendered rows small. Production performance has not been benchmarked.

| Feature                                              | Mock                                        | Google                                                         |
| ---------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| Accounts, location lists, and location details       | Yes; 1,000–10,000 test locations            | Yes; through the user's connection                             |
| Search and status filters                            | Name/address and status                     | Title and status, before pagination                            |
| Edit location profile fields                         | Yes; requires MANAGER and editing enabled   | **Not supported**; returns `PERMISSION_DENIED`                 |
| Bulk location profile updates                        | Yes; up to **100 selected IDs** per command | **Not supported**                                              |
| Location performance and account overview            | Empty reports; no invented metrics          | Yes; requires Business Profile Performance API                 |
| Read photos/videos, posts, and reviews               | Reported as unavailable                     | Yes; requires Google My Business v4 API                        |
| Add/delete media, manage posts, and reply to reviews | Not supported                               | Yes; requires MANAGER, editing enabled, and Google permissions |
| Language and theme                                   | English / Vietnamese; light / dark / system | Same interface                                                 |

### Known limits

- **Mock data is temporary.** Changes live in memory and are lost on restart or when another instance handles the request. Users can access `account-1`; `account-2` is a restricted test account.
- **No stored copy of Google locations.** PostgreSQL stores users, memberships, sessions, OAuth transactions, Business connections, and UI preferences. It does not store account/location copies or sync history.
- **Bulk updates can partly fail.** Results are returned for each ID. There is no queue, schedule, select-all-by-filter, or Redis/BullMQ background processing.
- **Reports can be incomplete.** The overview marks partial data while loading or when requests fail. Total impressions are not unique customers. CSV export and previous-period comparisons are not included.
- **Live content writes still need verification.** Content features have tests with simulated responses. The integration notes record no live create, delete, upload, or reply checks. Verify these in an authorized environment before rollout.

## 5. How the apps work

### Business flow

```mermaid
flowchart TD
  A[Sign in with Google or local dev login] --> B[App session in PostgreSQL]
  B --> C{Provider}
  C -->|Mock| D[Choose account-1]
  C -->|Google| E[Add or choose a Google Business connection]
  E --> F[Choose a business account]
  D --> G[Location list]
  F --> G
  G --> H[Account performance overview]
  G --> I[Location details]
  I --> J[Profile, Performance, Media, Posts, Reviews]
  J --> K[Actions allowed by role and provider]
```

1. **Sign in** at `/login`. The app creates a session and opens `/app`. Signing in does not grant Business access.
2. In Google mode, choose **Add Google account** to grant Business access, then choose a connection and business account. If that permission expires or is revoked, the app asks you to reconnect.
3. Open `/app/accounts/:id/locations` to search, filter, load more locations, or switch to **Overview**. The overview covers the whole account, regardless of the list's filters.
4. Open `/app/locations/:id` for profile details, performance, and content tabs. Navigation and cache keys include `connectionId` to keep data tied to the right connection.
5. **VIEWER** can read. **MANAGER** also has `location:write`. Writes still require CSRF checks, the expected Origin, resource access, editing enabled, and provider support.
6. With mock data, a manager can select up to **100 locations**, preview an update, and confirm. Results show success or failure for each location. Failed IDs can be retried.

### Architecture and tech stack

```mermaid
flowchart LR
  U[Browser] --> W[apps/web: Next.js]
  U -->|Session cookie; CSRF for writes| A[apps/api: NestJS BFF]
  W -. Health check through API_URL on Vercel .-> A
  A --> DB[(PostgreSQL / Prisma)]
  A --> P[BusinessProfileProvider]
  P --> M[In-memory mock]
  P --> G[Google APIs]
  C[packages/contracts: TypeScript + Zod] -.-> W
  C -.-> A
```

| Component                            | Responsibility                                                                           | Main tools                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Web** — `apps/web`                 | Login, connection/account selection, location tables, editors, and reports               | Next.js 16, React 19, TypeScript, TanStack Query, TanStack Virtual, React Hook Form |
| **API** — `apps/api`                 | BFF, sessions/OAuth, permissions, validation, providers, and consistent errors           | NestJS 11, TypeScript, Google Auth Library, Prisma 6, PostgreSQL adapter            |
| **Contracts** — `packages/contracts` | Shared types and schemas for identity, locations, bulk updates, content, and performance | TypeScript, Zod 4                                                                   |
| **Database**                         | Persistent user, session, and connection data                                            | PostgreSQL 17 in local Docker Compose                                               |
| **Development tools**                | Workspace, linting, formatting, and tests                                                | npm workspaces, ESLint, Prettier, Node test runner through `tsx`                    |
| **Deployment**                       | API and web services on one domain                                                       | Vercel Services, configured in `vercel.json`                                        |

**Google tokens stay on the server.** Business refresh tokens use **AES-256-GCM** encryption. The browser uses an opaque `HttpOnly`, `SameSite=Lax` session cookie; the database stores its hash. HTTPS deployments add `Secure`. UI checks control what users see; the API checks what they can access.

## 6. Setup

### Run locally with mock data

You need **Node.js 22.12+**, **npm**, and **Docker Compose**. Run these commands from the repository root. Google credentials are not required for mock mode.

```bash
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

There is no root `.env.example` yet. Create a root `.env` file for Docker Compose with your own local values, for example:

```dotenv
POSTGRES_USER=gbp_local
POSTGRES_PASSWORD=change_this_local_password
POSTGRES_DB=gbp_local
```

In `apps/api/.env`, match `DATABASE_URL` to those values. URL-encode any special characters in the username or password.

```dotenv
DATABASE_URL=postgresql://gbp_local:change_this_local_password@localhost:5432/gbp_local
WEB_ORIGIN=http://localhost:3000
BUSINESS_PROFILE_PROVIDER=mock
LOCAL_DEV_LOGIN_ENABLED=true
LOCATION_UPDATES_DISABLED=true
```

In `apps/web/.env.local`, set:

```dotenv
NEXT_PUBLIC_BFF_ORIGIN=http://localhost:3001
LOCAL_DEV_LOGIN_ENABLED=true
LOCATION_UPDATES_DISABLED=true
```

The two example files currently use different editing settings. The values above **disable editing in both apps**. Local login is off by default, is for development only, and cannot be enabled in production.

```bash
docker compose up -d --wait
npm exec -w @gbp/api -- prisma migrate deploy
npm run db:generate
npm run build -w @gbp/contracts
npm run dev
```

Use `prisma migrate deploy` to apply committed migrations. When changing the schema during development, use `npm run db:migrate` to create and apply a migration.

Open <http://localhost:3000/login>, choose **Sign in locally**, and open `/app`. The API needs PostgreSQL available at startup. Check the API with:

```bash
curl http://localhost:3001/health
```

Expected result: `{ "status": "ok" }`. This checks whether the API is running; it does not query database readiness on each request. Without a session, `/api/me` returns **401** and `/app` redirects to `/login`.

Stop PostgreSQL with `docker compose down`. Its named volume keeps the data. Real `.env` files are ignored by Git; commit only example configuration.

### Try editing mock locations

Local login creates `local.viewer@example.test` with the **VIEWER** role. Run `npm exec -w @gbp/api -- prisma studio`, find that user's Membership, change the role to **MANAGER**, and reload the app.

Set `LOCATION_UPDATES_DISABLED=false` in **both API and web environment files**, then restart both apps. This enables editing. If the variable is unset, editing is disabled. The flag also controls Google content writes. Set it back to `true` to disable writes.

The MANAGER role and this flag do not enable Google location profile edits; that feature is not implemented.

Set `MOCK_LOCATION_COUNT=10000` in the API environment to try a larger list. See [read flows and bulk selection](docs/read-flows.md) for selection across pages and per-ID failures.

### Set up Google login and real Business data

**Login and Business access are separate OAuth flows.** They use separate callbacks, but can share an OAuth client.

| Purpose                        | API-only variables                                                                  | Local callback                                        |
| ------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **App login (OIDC)**           | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` | `http://localhost:3001/auth/google/callback`          |
| **Google Business connection** | `GBP_GOOGLE_CLIENT_ID`, `GBP_GOOGLE_CLIENT_SECRET`, `GBP_GOOGLE_REDIRECT_URI`       | `http://localhost:3001/auth/google-business/callback` |

1. Set up a Google Cloud project, OAuth consent screen, and web OAuth client. Register the exact callbacks. GBP access requires API approval and the relevant APIs enabled. See [Google's access requirements](https://developers.google.com/my-business/content/prereqs) and [OAuth guide](https://developers.google.com/my-business/content/implement-oauth).
2. Set the login variables to enable Google sign-in. Without them, the Google login endpoint returns 404. Local login remains available when explicitly enabled.
3. For real data, set `BUSINESS_PROFILE_PROVIDER=google`, the `GBP_GOOGLE_*` variables, and `GBP_TOKEN_ENCRYPTION_KEY` in the API environment. Generate a 32-byte key as 64 hex characters with the command below.
4. **Keep the encryption key stable** across restarts and instances. Changing it requires reconnecting stored accounts. Apply migrations and restart after configuration changes.
5. Sign in, choose **Add Google account**, grant access, and select a business account. You do not need to enter refresh tokens, user IDs, or account IDs by hand.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Enable APIs for the features you need:

- **Account Management + Business Information:** accounts and locations.
- **Business Profile Performance:** performance reports.
- **Google My Business v4:** media, posts, and reviews.

See [Google provider setup](docs/google-provider.md) for environment variables, reconnect steps, scopes, and integration limits.

Keep client secrets, tokens, and encryption keys out of `NEXT_PUBLIC_*` variables. Successful app login does not mean the Cloud project has Business API access.

### Deploy on Vercel

Import the repository as **one Vercel project**, with the repository root as its root directory. `vercel.json` builds the `api` and `web` services separately, including contracts. `/api/*` and `/auth/*` go to NestJS; other paths go to Next.js. See [Vercel Services](https://vercel.com/docs/services).

- Use a PostgreSQL database reachable from the deployment. Docker Compose provides only the local database.
- Set `DATABASE_URL`, `WEB_ORIGIN=https://<your-domain>`, and the required OAuth variables. Production callbacks are `https://<your-domain>/auth/google/callback` and `https://<your-domain>/auth/google-business/callback`.
- For Google mode, set `BUSINESS_PROFILE_PROVIDER=google` and store `GBP_TOKEN_ENCRYPTION_KEY` in secret management. Give preview environments their own matching origin and callbacks.
- Keep local login and local labs disabled. Use matching editing flags in both services.
- Apply migrations before serving traffic: `npm exec -w @gbp/api -- prisma migrate deploy`.
- Leave `NEXT_PUBLIC_BFF_ORIGIN` unset. Vercel injects **`API_URL`** through the web-to-API binding. Do not set it yourself or expose it through a public variable.

After deployment, check `/health`, `/login`, and `/api/me`. Without a session, `/api/me` returns 401. On Vercel, `/health` is a Next.js route that checks NestJS through `API_URL`. Mock edits do not persist across function instances.

To test service routing locally, run `npx vercel dev`, or `npx vercel dev -L` without cloud authentication, from the repository root. Remove the local `NEXT_PUBLIC_BFF_ORIGIN` override and set `WEB_ORIGIN` to the origin printed by the CLI. Vercel injects `API_URL`.

### Development and checks

| Command                                   | Purpose                                    |
| ----------------------------------------- | ------------------------------------------ |
| `npm run dev`                             | Run web and API                            |
| `npm run build`                           | Build contracts, API, then web             |
| `npm run lint`                            | Check lint rules                           |
| `npm run typecheck`                       | Check workspace types                      |
| `npm test`                                | Run API and web tests with fixed test data |
| `npm run format` / `npm run format:check` | Format files / check formatting            |
| `npm run db:generate`                     | Generate the Prisma client                 |
| `npm run db:migrate`                      | Create/apply development migrations        |

Default tests do not need a live database or Google calls. With a migrated local/test PostgreSQL database, run the optional persistent-session test:

```bash
RUN_SESSION_DB_TESTS=true NODE_ENV=test npm exec -w @gbp/api -- tsx --test test/session.database.test.ts
```

This test creates or reuses the local VIEWER user and removes its test session afterward. The integration docs cover extra OAuth/database checks.

### Common setup issues

| Issue                                               | What to check                                                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **API will not start**                              | PostgreSQL is healthy, `DATABASE_URL` matches Compose, and migrations are applied                         |
| **Local login is missing**                          | Set `LOCAL_DEV_LOGIN_ENABLED=true` in both apps, use `npm run dev`, and restart after environment changes |
| **Editor is missing or writes return 403**          | Membership is MANAGER, updates are enabled in both apps, and the provider supports the action             |
| **Google login works but no Business data appears** | Connect Business access separately; check provider settings, consent, and Cloud API approval              |
| **Media/posts/reviews return 403**                  | Check Google My Business v4 API, account/location permissions, and endpoint requirements                  |
| **Google returns 429**                              | Wait before retrying; check quotas and request volume, especially for large account overviews             |
| **Vercel `/health` returns 503**                    | Check the API service and `API_URL` binding                                                               |

## 7. Sources and documentation

### In this repository

- [Architecture and component boundaries](docs/architecture.md).
- [Google login: OIDC, PKCE, state, and nonce](docs/auth-flow.md).
- [Google provider: setup, connections, performance, and content](docs/google-provider.md).
- [Read flows, large lists, and bulk updates](docs/read-flows.md).
- [CSRF/CORS and manual checks](docs/csrf-cors.md).
- [Rendering security and XSS lab](docs/security-notes.md).
- **Source code:** [web](apps/web), [API](apps/api), [contracts](packages/contracts), [database schema](apps/api/prisma/schema.prisma), and [deployment config](vercel.json).

Some architecture/read-flow sections still describe the early bootstrap stage. Check this README's feature table, the Google provider guide, and the implementation for current support.

### Official references

- [Google Business Profile overview](https://developers.google.com/my-business/content/overview): what Business Profile APIs do.
- [API access requirements](https://developers.google.com/my-business/content/prereqs): approval and API setup.
- [Business Profile OAuth](https://developers.google.com/my-business/content/implement-oauth): granting access to Business data.
- [API reference](https://developers.google.com/my-business/ref_overview): APIs by feature. The Google provider guide links to individual endpoints.
- [Business Profile Performance API](https://developers.google.com/my-business/reference/performance/rest): daily metrics and monthly keyword impressions.
- [Vercel Services](https://vercel.com/docs/services): multiple services in one project.

## Appendix: session checks and local authorization lab

The manual checks below cover sessions and access control. The lab deliberately bypasses some checks for comparison. It is **local only**, off by default, and must stay disabled in shared environments.

<details>
<summary>Manual session checks and authorization comparison lab</summary>

### Location authorization and local comparison lab

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

### Session checks

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

</details>
