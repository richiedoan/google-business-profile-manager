# Google Business Profile read provider

Official documentation rechecked on October 1, 2026 before implementation:

- [API overview](https://developers.google.com/my-business/ref_overview): Account Management v1 and Business Information v1 are the supported surfaces for this read flow. Deprecated v4 account/location reads are not used.
- [accounts.list](https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts/list): GET `https://mybusinessaccountmanagement.googleapis.com/v1/accounts`, maximum page size 20.
- [accounts.locations.list](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations/list): GET `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/{accountId}/locations`, maximum page size 100, required readMask.
- [locations.get](https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/get): GET `https://mybusinessbusinessinformation.googleapis.com/v1/locations/{locationId}`, required readMask.
- [OAuth setup](https://developers.google.com/my-business/content/implement-oauth) and [offline refresh](https://developers.google.com/identity/protocols/oauth2/web-server): configure the Cloud project, OAuth consent screen, web client and registered redirect URI. Obtain user consent using only `https://www.googleapis.com/auth/business.manage` for this separate GBP grant and `access_type=offline`. Google provides no narrower read-only scope for these endpoints. Consent-screen publishing/verification requirements depend on the configured audience and Google Cloud's scope classification; complete the applicable requirements before external rollout.
- [Approval prerequisites](https://developers.google.com/my-business/content/prereqs): request Basic API Access for the project and enable APIs after approval. Applicants must manage a verified profile active for at least 60 days and have a representative website. Zero QPM means access is not approved.
- [Quotas](https://developers.google.com/my-business/content/limits): Account Management and Business Information default to 300 QPM each. Current Business Information write limits include 300 creates/day, 10,000 updates/day, and 10 edits/minute/profile; this implementation has no Google writes.

## Configuration

Leave `BUSINESS_PROFILE_PROVIDER=mock` for local development and automated tests. To enable real reads, set these API-only settings:

```dotenv
BUSINESS_PROFILE_PROVIDER=google
GBP_GOOGLE_CLIENT_ID=your_shared_oauth_client_id
GBP_GOOGLE_CLIENT_SECRET=your_shared_oauth_client_secret
GBP_GOOGLE_REDIRECT_URI=https://your-app.example/auth/google-business/callback
GBP_TOKEN_ENCRYPTION_KEY=your_stable_64_character_hex_key
```

Generate the encryption key once with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Store it in deployment secret management. Preserve the key across restarts and replicas; replacing it requires reconnecting stored accounts. Register the exact callback URL on the OAuth web client. Local development may use `http://localhost:3001/auth/google-business/callback` with `NODE_ENV=development` and `WEB_ORIGIN=http://localhost:3000`. The OAuth client may be the same client used for login, with both callback URLs registered. Business OAuth remains a separate consent flow.

Apply the checked-in migration before enabling Google: `npm exec -w @gbp/api -- prisma migrate deploy`. The app no longer reads `GBP_GOOGLE_REFRESH_TOKEN`, `GBP_GOOGLE_USER_ID`, or `GBP_GOOGLE_ACCOUNT_IDS`; remove those old variables. Existing manual grants are not imported. Sign into the app and use **Thêm tài khoản Google** on the dashboard to connect each Gmail, then choose the Gmail and its Business account. Adding Gmail accounts requires no configuration changes or restart.

Each app user can store multiple Google Business connections. Refresh tokens are encrypted with AES-256-GCM, bound to the app user and Google subject, and never returned to the browser. Connection ownership is checked before decrypting or contacting Google. Account authorization comes from Google's live account list, rather than a static allowlist. The selected connection ID travels through account, location and detail navigation, and browser cache keys include that connection. Existing OIDC login remains identity-only: connecting another Gmail does not replace the app session or change the user's app role.

Connection endpoints:

- `GET /api/google-connections`: connection IDs, emails and statuses for the session user only.
- `POST /api/google-connections/connect`: authenticated, CSRF-protected consent start; returns the Google URL and sets a browser-binding cookie.
- `GET /auth/google-business/callback`: validates single-use state, original session/user, browser binding, PKCE, verified OIDC identity/nonce and granted Business scope. Redirects to the dashboard with a fixed success/error indicator.
- `DELETE /api/google-connections/:id`: authenticated, CSRF-protected local disconnect; deletes the stored credential and clears the local token cache. It does not revoke the Google-wide app grant, which may be shared by another connection or login. Users can revoke the app in their Google account settings.

A revoked or invalid refresh grant marks the connection `RECONNECT_REQUIRED` during account discovery. Use **Kết nối lại** and select that Gmail again. Repeated consent updates the same user/Google-subject connection; if Google omits a refresh token, only an existing active grant for that same connection can be retained.

Verification: `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. To exercise persisted consent, cross-user rejection, single-use callbacks and separate tokens against a dedicated loopback PostgreSQL database, deploy migrations to that database and run `RUN_SESSION_DB_TESTS=true NODE_ENV=test npm exec -w @gbp/api -- tsx --test test/google-connections.test.ts`. Fixture tests use synthetic Google responses and do not contact Google or create Business profiles.

Tokens refresh on the service with a 60-second expiry margin and concurrent refresh deduplication. API 401 retries once with a refreshed token. Revoked grants mark the connection `RECONNECT_REQUIRED`; the Dashboard offers **Kết nối lại**. 401/403/404/429 map to existing stable domain errors; malformed responses, network failures and other provider errors map to PROVIDER_ERROR. Upstream bodies are never included in domain errors. Requests have ten-second timeouts and reject redirects. Rate limits are surfaced without automatic retries; deployment must pace reads within project quotas.

Location list reads exactly one Google page, using `pageSize` (default 25), `pageToken`, and `readMask=name,title,storefrontAddress,openInfo,storeCode,categories.primaryCategory`. The API forwards `nextPageToken` (null at the end) and uses a nullable total because Google only supplies approximate `totalSize` for filtered requests. The frontend uses infinite scrolling: it appends the next page when the bottom of the table approaches the viewport, shows skeleton rows while loading more, and resets the list on account, connection, or filter changes. It stops when the next cursor is null, or when the mock provider’s numbered pages reach the total. Failed load-more requests retain loaded rows and can be retried. Google filters run before pagination: search matches title and status maps to `openInfo.status`. Google search no longer searches joined addresses. The mock provider retains numbered pagination and local filtering.

Detail reads use `readMask=name,title,storeCode,categories,languageCode,storefrontAddress,serviceArea,latlng,openInfo,websiteUri,phoneNumbers,regularHours,specialHours,moreHours,metadata,profile,labels,serviceItems`. Each connection revision owns a bounded in-memory provider cache: account discovery and verified account/location memberships expire after five minutes. Connection ownership and active status are read from the database on every request; user, role and authorized account scope are checked again before detail GET. Disconnect/reconnect or credential revision changes discard the cached provider. On a missing or expired membership, detail fetches the location with the owned connection token and verifies its exact resource ID against Google's title-filtered location lists within the intersection of the user's authorized accounts and provider account scope. Recovery reads only location names, follows cursor pages with loop/limit checks, and caches only a confirmed match. Concurrent recovery for the same location in one connection revision shares a lookup. No detail is returned until account membership is confirmed; an unconfirmed location still returns RESOURCE_NOT_FOUND, and upstream failures retain their domain errors. Cold starts, cache expiry and requests reaching another replica recover automatically without visiting the location list. Recovery adds Google reads on a cache miss; large deployments should consider a shared, connection-revision-scoped membership cache to reduce these reads.

Verification is omitted from list responses and the table. Detail retains UNKNOWN without calling a verification endpoint. Addresses are joined from structured postal fields; service-area businesses may have an empty address. Unspecified/omitted open state maps to OPEN.

Google updateLocation always fails with PERMISSION_DENIED. No write enable flag exists. Before implementing updates, stabilize real authorized reads and verify the precise current patch fields, updateMask, null/clear behavior and application contract. Tests use deterministic mock listings and injected HTTP fixtures only; never create public GBP listings for tests.

The compact locations table has six columns: Location (optional store code), Address, Category, Status, Last sync / Provider state, and Actions. Selection checkboxes live within Location. Google rows report “Google read” with “No sync timestamp”; mock rows report “Mock provider”. These are read states, not fabricated sync times. Edit is offered only when the app role allows writes, updates are enabled, and the provider supports editing; Google currently remains read-only.

Location detail displays six compact sections using normalized contracts. Google mapping stays in the API provider: categories, service areas, coordinates, phone lists, regular/special/more hours, metadata, description, labels and services are mapped explicitly. Missing values use null/empty lists and display as an em dash. Detail openStatus is null when unspecified (the legacy list status mapping is retained). No sync timestamp is fabricated. Hours retain split periods, overnight days and 24:00; omitted scalar fields within a present protobuf TimeOfDay are zero, while an absent time stays null. Partial dates stay partial. Only returned metadata flags are shown, including explicit false. Service names and hours types use returned category display names when available and returned IDs otherwise; no additional category or service lookup is made.

### Location performance

`GET /api/locations/:id/performance?connectionId=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
returns normalized performance data after the existing session, connection ownership,
location membership, and account policy checks. Dates are inclusive, valid calendar
dates with a maximum span of 367 days. Google tokens and response DTOs stay server-side.
Enable the Business Profile Performance API in the Google project used by the
connection; it uses the existing `business.manage` scope.

The provider calls Google's `fetchMultiDailyMetricsTimeSeries` endpoint for the four
Search/Maps mobile/desktop impression metrics and calls, directions, website clicks,
and bookings. Total interactions sum the available interaction metrics, excluding
impressions. Missing metrics remain absent; absent protobuf values on explicitly
reported dates mean zero. The mock provider returns an empty report without fabricated
performance metrics. Provider failures use the existing domain error mapping.

Keyword impressions come from the paginated monthly endpoint. The report explicitly
labels the whole overlapping months, including when the date range selects partial
months. Exact counts are ranked descending; threshold-only keywords follow them,
display `< threshold`, and are not assigned an exact rank or impression count.

The Performance tab uses TanStack Query with keys containing user ID, connection ID,
location ID, start date and end date, without retaining another range's placeholder
data. Requests support cancellation and rate/provider errors have explicit retry UI.
The chart includes an accessible daily values table. Integration tests use simulated
Google responses; live access requires a Google project with Performance API access.

API reference: https://developers.google.com/my-business/reference/performance/rest

### Media, posts and reviews

Location detail includes **Photos & videos**, **Posts**, and **Reviews** tabs.
These use the separate Google My Business v4 API (`mybusiness.googleapis.com`),
not Business Information or Performance. Enable it in the OAuth client's Cloud
project (current local project: `830300258876`). The existing `business.manage`
grant is sufficient. If the API is not available in the Library, check the
project's Business Profile API access approval. A disabled service currently
surfaces as the existing PERMISSION_DENIED domain error.

- `GET /api/locations/:id/content/:kind` reads one Google page (`media`, `posts`,
  or `reviews`), with optional `pageToken` and the usual `connectionId`.
- `POST /api/locations/:id/content` accepts validated ADD_MEDIA, DELETE_MEDIA,
  CREATE_POST, UPDATE_POST, DELETE_POST, REPLY_REVIEW and DELETE_REPLY commands.
- `POST /api/locations/:id/photos/upload` accepts multipart `file` plus `category`.
  It accepts JPEG/PNG up to 4 MiB, checks MIME/signature, and forwards bytes through
  Google's startUpload → binary upload → media.create flow. Files are not saved
  on the app server. Larger media and videos can be added with a public HTTPS URL.
  Google performs its own image dimension, media policy and processing checks.

All endpoints enforce session and current connection ownership, then verify
location/account membership. Writes additionally require MANAGER / location:write,
CSRF plus the expected Origin, and `LOCATION_UPDATES_DISABLED=false`. The web
uses the same flag to hide write controls. VIEWER can read content. Mock mode
returns `available:false` and does not fabricate content or perform writes.
Mutations are not automatically retried, preventing duplicate public posts or
replies after an uncertain network outcome. A rejected 401 invalidates the
cached access token so a subsequent explicit attempt can refresh it.

The media grid displays business-uploaded items and links to the Google-hosted
asset. Select COVER or PROFILE when adding an image to replace the associated
cover/profile image; LOGO is treated by Google as PROFILE. Google can choose a
different cover for public display. No invented view counts, customer attribution,
or review attachments are shown. A Google video `googleUrl` can be a preview
image, so direct playback is not guaranteed.

Post forms support updates, events and offers, with event dates/times, coupon and
redemption details, an optional public HTTPS image, and supported call-to-action
buttons. Google only supports public source URLs for post media. The first-image
URL is editable; updating text preserves multiple existing media items when the
image is unchanged. Unsupported post types/recurring posts remain readable and
deletable, but the app omits their edit action to avoid silently losing fields.
Newly published media/posts can remain processing or be rejected by Google.

Reviews show the average/count supplied by Google, paginated review text/ratings,
and the business's reply. MANAGER can create, replace or delete their reply;
customer reviews are never deleted by this feature. Replied/unreplied filtering
applies to loaded pages, explicitly noted while more pages are available.
Google requires a verified location for review reads. Google-only UI fields such
as Local Guide badges and review photos are not fabricated.

Content query keys include app user, connection, location and content kind.
Each mutation invalidates only that location/connection's content queries.
Tests use injected Google responses and cover HTTP session/CSRF/role checks,
scoped resource IDs, command validation, pagination, upload sequence and UI
escaping. Live read smoke checks identified SERVICE_DISABLED in the local
Cloud project; no live create, delete, upload or reply was performed.

API references:

- https://developers.google.com/my-business/content/upload-photos
- https://developers.google.com/my-business/reference/rest/v4/accounts.locations.media/create
- https://developers.google.com/my-business/content/posts-data
- https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews

### Account performance overview

The account locations page has **Overview** and **Locations** views. Existing
links continue to open the locations list. `view=overview` opens the overview;
`startDate` and `endDate` are retained in the URL when changing views or using
browser history. The report covers the complete management account, regardless
of the locations table's loaded pages, search or status filters.

`GET /api/accounts/:id/performance?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
uses the same `connectionId`, session and account policy as location reads.
It processes one independent batch of ten locations, with at most three metrics
requests in flight, and returns an opaque Google cursor or the mock provider's
numbered next page. The web automatically requests subsequent batches until
all locations have been enumerated. The query cache includes app user,
connection, account and range and retains the existing five-minute freshness /
thirty-minute inactive lifetime. Automatic pagination stops while the view is unmounted.
Manual refresh rechecks loaded batches; a failure preserves completed results.

Google overview reads use daily metrics only, skipping monthly keyword requests.
The shared detail report now also carries optional daily metric breakdowns for
Search/Maps impressions, calls, directions, website clicks and bookings. Its
existing daily interaction series and monthly keyword report remain available.
The overview sums per-location totals and daily values, with optional week/month
buckets. Views sum reported impression components across locations and are not
a deduplicated customer count. Unreported metrics/dates remain null; explicit
reported zeros remain zero. Charts leave gaps for missing dates and display a
values table. Each card states how many locations reported that metric.

Every location is represented as READY, EMPTY or ERROR. Errors contain a stable
domain code, never Google response text. The UI shows reporting, empty and failed
counts, and marks totals partial until enumeration completes. A rate-limit error
stops queued work in the current batch and pauses automatic pagination; refresh
later retries missing data. Pagination loops fail or stop with an explicit
incomplete-report message. The per-location table sorts metrics with unavailable
values last and links to location detail while retaining `connectionId`.

Overview uses the already enabled Business Profile Performance API and Business
Information API, and does not depend on `mybusiness.googleapis.com`. CSV export
and comparison against the preceding period are not part of this version.
