# Accounts and locations read flows

Private BFF endpoints (SessionGuard applies to every route):

- GET /api/accounts returns Account[].
- GET /api/accounts/:id/locations returns PaginatedResult<LocationSummary>.
- GET /api/locations/:id returns LocationDetail.

Pagination defaults to page=1 and pageSize=25; pageSize is capped at 100. The API
rejects repeated/noninteger/out-of-range pagination parameters, search over 200
characters, and unknown statuses with normalized VALIDATION_FAILED (400). Supported
status values are OPEN, TEMPORARILY_CLOSED, and PERMANENTLY_CLOSED. Search is trimmed
and filtering occurs before pagination in the provider. No endpoint sends all 10,000
locations to the browser. Unknown/inaccessible account IDs return 403 to avoid
claiming access; unknown location IDs return 404, inaccessible locations return 403.

Identity and role come from the durable server session. The default mock adapter
grants account-1 through a server-owned entitlement lookup; account-2 is a restricted fixture.
Google OIDC sign-in still displays fictional mock data, not Google business data.
Real Google account entitlement/token integration remains deferred. Mock phone/website writes are implemented.
No browser-provided user, role or account scope can authorize reads.

## Frontend state and freshness

/app is the account selection screen. /app/accounts/:id/locations holds account
selection in the path and page/search/status in query parameters. Apply filters
submits the local form draft and resets page to 1; typing does not issue requests.
Back/Forward and bookmarked URLs restore committed filters. Rows link to
/app/locations/:id for details and permission-gated phone/website editing. The UI uses a fixed page size of 25.

TanStack Query owns server data using the established accounts, locations and
location query keys. Each read has staleTime=30 seconds: navigating back within
that window reuses data, while older data can refresh on mount/window focus.
There is no timer polling or data-fetching effect. Structural hashing of scalar
query-key fields deduplicates equal requests; AbortSignal reaches fetch. A page/key
change displays loading rather than old-account rows. Loading, empty, error, retry,
background refresh, operating status and verification status have explicit UI states.

401 offers sign-in (with a distinct expired-session message), 403 explains lack of
permission, 429 asks the user to wait before retrying, and provider errors offer
retry. Auth/forbidden failures do not show a futile retry button. Existing query
retry defaults avoid automatic retries on 4xx responses; transient server failures
have bounded retries. Raw provider errors and credentials are never rendered.

## Manual verification

1. Start PostgreSQL and `npm run dev` using the existing environment setup.
2. Sign in using enabled local development login or configured Google OIDC.
3. Visit /app and select Mock North (Mock South is out of scope by default). The first request loads 25 rows;
   scroll near the bottom of the table to load the next page, with skeleton rows at the end while loading.
   Loaded rows remain visible, and loading stops when no more data remains. A failed load-more request can be retried.
   The table virtualizes rows with dynamic height measurement and eight overscan rows on each side;
   DOM row count stays bounded as more data is loaded. Selected IDs survive row unmounts, and the focused row
   plus its adjacent keyboard targets remain mounted. The header stays visible while scrolling.
4. Search `00005` in Mock North and apply Temporarily closed.
   Filters reset the infinite list to page 1; bookmark/reload and Back/Forward retain filter state.
5. Search an unmatched value to check the empty state. Open a row to inspect details.
6. Expire/revoke the session to check 401 handling. A missing location shows 404.
   Deterministic HTTP tests exercise restricted-account 403, provider 429/502 and
   invalid query parameters without requiring real Google requests.
7. Optionally restart with MOCK_LOCATION_COUNT=10000; each request still returns at most 25 rows.
   Sign in as a viewer and verify selection checkboxes are hidden while detail links remain usable.

`npm test` covers guarded reads, scope checks, pagination/filtering over 10,000 mock
records, normalized errors, response decoding and concurrent equal-key deduplication.
No new migrations or production provider tokens are required for this step.

## Bulk location updates

Row checkboxes track explicit location IDs with display names, not row indexes.
Selection remains in local React state while changing pages in the same account
and committed search/status scope. Page loading, errors and refreshes retain the
selected IDs. Changing an account or applied filter resets the selection through
a keyed scope; leaving the list or reloading also resets it. No selection is saved
in the URL, database or shared query cache. Names are display snapshots; IDs are
the command targets.

The UI shows the selected count for all pages, the current page and other pages.
A draft supports at most 100 explicit IDs. At the limit, selected rows can still
be deselected. A page action that would exceed the cap is disabled rather than
silently selecting only part of the page.

| Selection                   | Meaning                                                                    | Phase 1 behavior                                                          |
| --------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Explicit selected IDs       | Specific IDs checked by the user, possibly across pages                    | Persist across page changes; commands contain these exact IDs             |
| Select all current page     | Add every visible row on the current page to the explicit set              | Snapshot only the loaded page; existing off-page selection remains        |
| Select all matching filters | Include every server-side result matching a filter, including unseen pages | Disabled; Phase 2 design only, not accepted by the current command schema |

Managers can update Website, Phone (primary and up to two additional numbers),
Regular hours, Special hours, Description / Profile, Labels and Service items in
the existing drawer. Only the chosen field's controls appear. Regular hours
support closed days and split periods Monday–Sunday. Special hours use dated
closed-day or timed overrides. Hours, phone lists and services replace their
respective values; labels add/remove entries while preserving other labels.
Website and description accept null to clear; empty hours/services lists clear
those fields. Description is limited to 750 characters; each location may have
up to ten labels of 50 characters each.

The strict `BulkLocationCommandSchema` requires an account and 1–100 unique,
explicit location IDs. It rejects other fields, page selectors and filter
selectors. `FutureMatchingLocationSelection` remains a design placeholder.
Confirmation previews the actual values, selection count and location names.
Editing the form or changing the selection invalidates confirmation.

`PATCH /api/locations/bulk` validates the whole command before writes. It uses
existing session, CSRF, permission and resource/account checks. The update-disable
flag still applies. Each location resolves through the scoped provider before
writing; a location outside the command account fails even when the user can
access both accounts. Mock changes persist for the provider/process lifetime.
Google writes continue to return `PERMISSION_DENIED`.

The response includes `totalSelected`, `succeeded`, `failed`, and `results`, with
`locationId`, `success` and a safe failure `reason` for each failed item. The drawer
shows totals and lets users inspect failures. Confirmed retries target failed IDs
only and retain overall counts. Successful details and cached lists containing
changed IDs are invalidated within the same account and connection; failed details
and unrelated queries remain untouched. There is no production queue.

**Phase 2** owns large background jobs, queueing, retry/backoff, Redis and BullMQ.
Before enabling all-matching-filter execution, define server-side filter/scope
resolution, snapshot timing, exclusions, job limits, idempotency, progress,
cancellation and per-item outcome reporting.

Manual check: select a row on page 1, select the current page on page 2, then return
to page 1. The original row remains checked, and the count includes page 2. Deselect
page 1 and verify page 2 stays selected. Apply a different filter and verify the
selection clears. As MANAGER, choose each field, inspect the confirmation and
apply it with mock updates enabled. Check the per-location summary and refreshed
detail data. Leave Website blank to verify clearing. Include an unauthorized or
missing ID in an HTTP fixture to verify partial failures, unchanged failed data
and failure inspection. Viewer and missing-CSRF requests must fail.
