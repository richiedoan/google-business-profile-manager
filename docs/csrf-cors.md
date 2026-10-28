# Cookie-session CSRF and CORS

Normal mode allows exactly WEB_ORIGIN (default http://localhost:3000). No wildcard
origin is emitted. Credentialed CORS is enabled for cookie-dependent BFF/auth routes;
public /health has no credential support, and its web request uses credentials: omit.
Preflight allows GET/POST/PUT/PATCH/DELETE and Content-Type/X-CSRF-Token. CORS governs
browser reading; it is not authentication, authorization, or the only CSRF defense.

## Session-bound proof

GET /api/csrf is protected by SessionGuard and returns only `{ csrfToken }`. It
requires a valid, unexpired application session and permits only the configured
origin when Origin is present. No-store applies. The proof is HMAC-SHA256 with the
256-bit opaque session ID as key and the fixed domain-separated message
`gbp-session-csrf-v1`. This produces a stable, unpredictable proof for this session
without revealing the session ID or adding process-local state. The durable session
is still validated in PostgreSQL on each request. Proof changes when login rotates
the session; logout/revocation makes it unusable. No provider credentials are involved.

The typed client obtains fresh proof before each POST/PATCH/DELETE and sends it in
X-CSRF-Token. It neither stores it in browser storage nor sends it in URLs. Failed
proof acquisition stops the mutation. All authenticated state-changing endpoints
(also PUT) are covered by the globally registered MutationGuard. SessionGuard first
validates the durable session, then requires an exact WEB_ORIGIN and a constant-time
match of the session-derived proof. Missing/null/disallowed Origin is rejected for
these browser mutations, including logout. Missing/unknown/expired sessions produce
401; authenticated origin/proof/permission failures produce 403. Neither rejection
performs the mutation. Logout now requires a live session and proof; expired or
already-revoked sessions return 401 instead of the earlier idempotent 200 behavior.

A cross-site form cannot supply the custom header, and an untrusted browser origin
cannot read the token endpoint in normal mode. An attacker cannot guess the proof
or reuse proof from a different session. Exact Origin checks remain a separate
barrier, including in the lab. SameSite=Lax adds defense in depth and still permits
Google's top-level GET callback. CSRF does not protect against trusted-origin XSS.
These choices follow the [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
on session binding, custom-header proof, and origin validation.

## Explicit exceptions

POST /auth/dev-login is the only pre-session mutation exception. It has exact Origin
validation and remains explicitly local-only, disabled by default and unavailable
in production. It cannot require a session proof before creating the first session.
Google GET authorization/callback instead use single-use state, browser binding,
PKCE and OIDC nonce; a session-CSRF token does not replace OAuth state. Future public
mutation exceptions must be designed explicitly rather than added as frontend flags.

## LOCAL LAB ONLY CORS demonstration

The isolated implementation is apps/api/src/lab/cors-lab.ts. Default env flags are
false. To intentionally reflect arbitrary Origin values with credentials on a local
API, set both LOCAL_LAB_ONLY=true and LOCAL_LAB_CORS_REFLECT=true in apps/api/.env
and run npm run dev. It additionally requires NODE_ENV=development/test and a
loopback WEB_ORIGIN. Production or incomplete/nonlocal configuration fails startup
rather than enabling reflection. The API remains bound to loopback. No wildcard
credentialed configuration is used, even in the lab.

From a browser page served at http://localhost:4000, a credentialed fetch to the
local /api/me can read the logged-in UserView in lab mode; normal CORS prevents
reading it. Use only the local fixture for this demonstration. The token endpoint
still rejects that Origin, and mutation origin/CSRF enforcement stays enabled.
Turn both flags back to false and restart afterward. This demonstrates CORS exposure,
not a bypass of all application controls.

## Manual checks

Sign in locally or through Google, then sign out through the UI. DevTools should
show GET /api/csrf before POST /api/logout, with X-CSRF-Token on the POST. Removing
the header from an authenticated request yields 403 and leaves the session intact;
using proof from another session also yields 403. Wrong/missing Origin yields 403
for authenticated mutations, while no/expired session yields 401. Never paste cookie
or proof values into logs, tickets, or committed scripts.

Run npm test for proof, Origin, CORS, PATCH/DELETE, session-expiry, and lab-gating
coverage. No schema migration or new token-storage/key-management service is needed.
Multiple allowed web origins, nonbrowser authentication, cross-site SameSite=None,
and additional public mutation exceptions remain outside this step.
