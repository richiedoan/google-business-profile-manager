import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  GoogleBusinessProfileProvider,
  GoogleBusinessTokenService,
  readGoogleProviderSettings,
} from "../src/business-profile/google-business-profile.provider";
import { AppException } from "../src/errors/app.exception";
const settings = {
  clientId: "client",
  clientSecret: "secret",
  refreshToken: "refresh",
  userId: "user",
  accountIds: ["123"],
};
const context = {
  userId: "user",
  role: "VIEWER" as const,
  accountIds: ["123"],
};
const code = (expected: string) => (error: unknown) =>
  error instanceof AppException && error.code === expected;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
test("mock default and explicit complete Google configuration", () => {
  assert.equal(readGoogleProviderSettings({}), null);
  assert.equal(
    readGoogleProviderSettings({ GBP_GOOGLE_REFRESH_TOKEN: "unused" }),
    null,
  );
  assert.throws(() =>
    readGoogleProviderSettings({ BUSINESS_PROFILE_PROVIDER: "google" }),
  );
  assert.throws(() =>
    readGoogleProviderSettings({ BUSINESS_PROFILE_PROVIDER: "typo" }),
  );
});
test("read mapping, cursor pages, filtering, account membership and disabled writes", async () => {
  const calls: URL[] = [];
  const fetcher = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === "oauth2.googleapis.com")
      return json({
        access_token: "access",
        expires_in: 3600,
        token_type: "Bearer",
      });
    assert.equal(init?.method, "GET");
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer access",
    );
    if (url.hostname === "mybusinessaccountmanagement.googleapis.com")
      return json({
        accounts: [
          { name: "accounts/123", accountName: "Business" },
          { name: "accounts/999", accountName: "Other" },
        ],
      });
    assert.equal(
      url.searchParams.get("readMask"),
      url.pathname === "/v1/locations/456"
        ? "name,title,storeCode,categories,languageCode,storefrontAddress,serviceArea,latlng,openInfo,websiteUri,phoneNumbers,regularHours,specialHours,moreHours,metadata,profile,labels,serviceItems"
        : "name,title,storefrontAddress,openInfo,storeCode,categories.primaryCategory",
    );
    const row = {
      name: "locations/456",
      title: "Shop",
      storeCode: "SHOP-001",
      categories: {
        primaryCategory: { name: "categories/gcid:cafe", displayName: "Cafe" },
      },
      storefrontAddress: { addressLines: ["1 Street"], locality: "City" },
      openInfo: { status: "CLOSED_TEMPORARILY" },
      websiteUri: "https://example.com",
    };
    if (url.pathname === "/v1/locations/456") return json(row);
    if (url.searchParams.has("pageToken"))
      return json({ locations: [{ name: "locations/789", title: "Second" }] });
    return json({ locations: [row], nextPageToken: "next" });
  }) as typeof fetch;
  const provider = new GoogleBusinessProfileProvider(settings, fetcher);
  assert.deepEqual(await provider.listAccounts(context), [
    { id: "123", name: "Business" },
  ]);
  const result = await provider.listLocations(
    "123",
    { page: 1, pageSize: 1, search: "Shop" },
    context,
  );
  assert.equal(result.items[0].storeCode, "SHOP-001");
  assert.equal(result.items[0].primaryCategory, "Cafe");
  assert.equal(result.items[0].providerState, "READ");
  assert.equal(result.items[0].editable, false);
  assert.equal(result.total, null);
  assert.equal(result.nextPageToken, "next");
  assert.equal("verificationStatus" in result.items[0], false);
  assert.equal(
    calls.filter((url) => url.pathname === "/v1/accounts/123/locations").length,
    1,
  );
  const beforeDetail = calls.length;
  assert.equal(result.items[0].status, "TEMPORARILY_CLOSED");
  assert.equal(
    (await provider.getLocation("456", context)).websiteUrl,
    "https://example.com",
  );
  assert.equal(calls.length, beforeDetail + 1);
  const second = await provider.listLocations(
    "123",
    { page: 2, pageSize: 1, pageToken: result.nextPageToken! },
    context,
  );
  assert.equal(second.items[0].id, "789");
  assert.equal(second.nextPageToken, null);
  assert.equal(calls.at(-1)?.searchParams.get("pageToken"), "next");
  assert.equal(calls.at(-1)?.searchParams.get("pageSize"), "1");
  const before = calls.length;
  await assert.rejects(
    provider.listAccounts({ ...context, userId: "another" }),
    code("PERMISSION_DENIED"),
  );
  await assert.rejects(
    provider.listLocations("999", { page: 1, pageSize: 25 }, context),
    code("PERMISSION_DENIED"),
  );
  await assert.rejects(
    provider.updateLocation("456", { websiteUrl: null }, context),
    code("PERMISSION_DENIED"),
  );
  assert.equal(calls.length, before);
  assert.equal(
    calls.filter((url) => url.hostname === "oauth2.googleapis.com").length,
    1,
  );
});
for (const [status, expected] of [
  [401, "UNAUTHENTICATED"],
  [403, "PERMISSION_DENIED"],
  [404, "RESOURCE_NOT_FOUND"],
  [429, "PROVIDER_RATE_LIMITED"],
  [500, "PROVIDER_ERROR"],
] as const) {
  test(`Google ${status} maps to ${expected} without leaking response`, async () => {
    const fetcher = (async (input: string | URL | Request) =>
      String(input).includes("oauth2.googleapis.com")
        ? json({
            access_token: "token",
            token_type: "Bearer",
            expires_in: 3600,
          })
        : json(
            { error: { message: "sensitive upstream" } },
            status,
          )) as typeof fetch;
    await assert.rejects(
      new GoogleBusinessProfileProvider(settings, fetcher).listAccounts(
        context,
      ),
      code(expected),
    );
  });
}
test("refresh single flight, expiry, invalid grant and malformed provider response", async () => {
  let refreshes = 0;
  const tokens = new GoogleBusinessTokenService(settings, (async () => {
    refreshes++;
    return json({
      access_token: "token",
      token_type: "Bearer",
      expires_in: 3600,
    });
  }) as typeof fetch);
  await Promise.all([tokens.accessToken(), tokens.accessToken()]);
  assert.equal(refreshes, 1);
  tokens.invalidate();
  await tokens.accessToken();
  assert.equal(refreshes, 2);
  const expired = new GoogleBusinessTokenService(settings, (async () =>
    json({
      access_token: "token",
      token_type: "Bearer",
      expires_in: 1,
    })) as typeof fetch);
  await expired.accessToken();
  await expired.accessToken();
  await assert.rejects(
    new GoogleBusinessTokenService(settings, (async () =>
      json({ error: "invalid_grant" }, 400)) as typeof fetch).accessToken(),
    code("UNAUTHENTICATED"),
  );
  const fetcher = (async (input: string | URL | Request) =>
    String(input).includes("oauth2.googleapis.com")
      ? json({ access_token: "token", token_type: "Bearer", expires_in: 3600 })
      : json({ accounts: [{ name: "bad" }] })) as typeof fetch;
  await assert.rejects(
    new GoogleBusinessProfileProvider(settings, fetcher).listAccounts(context),
    code("PROVIDER_ERROR"),
  );
});
test("401 refreshes once and retries read successfully", async () => {
  let refreshes = 0;
  let reads = 0;
  const fetcher = (async (input: string | URL | Request) => {
    if (String(input).includes("oauth2.googleapis.com")) {
      refreshes++;
      return json({
        access_token: `token-${refreshes}`,
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    reads++;
    return reads === 1
      ? json({}, 401)
      : json({ accounts: [{ name: "accounts/123", accountName: "Business" }] });
  }) as typeof fetch;
  assert.equal(
    (
      await new GoogleBusinessProfileProvider(settings, fetcher).listAccounts(
        context,
      )
    ).length,
    1,
  );
  assert.equal(refreshes, 2);
  assert.equal(reads, 2);
});

test("cold starts and expired memberships recover while warm reads keep one detail request", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const calls: URL[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === "oauth2.googleapis.com")
      return json({
        access_token: "token",
        token_type: "Bearer",
        expires_in: 3600,
      });
    if (url.pathname === "/v1/locations/456")
      return json({ name: "locations/456", title: 'Shop "Central"' });
    assert.equal(url.pathname, "/v1/accounts/123/locations");
    assert.equal(url.searchParams.get("readMask"), "name");
    assert.equal(
      url.searchParams.get("filter"),
      `title=${JSON.stringify('Shop "Central"')}`,
    );
    return json({ locations: [{ name: "locations/456" }] });
  }) as typeof fetch;
  const provider = new GoogleBusinessProfileProvider(settings, fetcher);
  assert.equal((await provider.getLocation("456", context)).accountId, "123");
  assert.equal(calls.length, 3);
  const before = calls.length;
  for (const denied of [
    { ...context, userId: "other" },
    { ...context, accountIds: [] },
    { ...context, role: "NO_ACCESS" as typeof context.role },
  ])
    await assert.rejects(
      provider.getLocation("456", denied),
      code("PERMISSION_DENIED"),
    );
  assert.equal(calls.length, before);
  await provider.getLocation("456", context);
  assert.equal(calls.length, before + 1);
  now += 5 * 60_000;
  await provider.getLocation("456", context);
  assert.equal(calls.length, before + 3);
  await new GoogleBusinessProfileProvider(settings, fetcher).getLocation(
    "456",
    context,
  );
  assert.equal(calls.length, before + 6);
});

test("recovery checks exact membership across authorized accounts and cursor pages", async () => {
  const calls: URL[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === "oauth2.googleapis.com")
      return json({
        access_token: "token",
        token_type: "Bearer",
        expires_in: 3600,
      });
    if (url.pathname === "/v1/locations/456")
      return json({ name: "locations/456", title: "Shared title" });
    if (url.pathname === "/v1/accounts/123/locations")
      return json({ locations: [{ name: "locations/999" }] });
    assert.equal(url.pathname, "/v1/accounts/789/locations");
    return url.searchParams.has("pageToken")
      ? json({ locations: [{ name: "locations/456" }] })
      : json({ locations: [{ name: "locations/888" }], nextPageToken: "next" });
  }) as typeof fetch;
  const provider = new GoogleBusinessProfileProvider(
    { ...settings, accountIds: ["123", "789"] },
    fetcher,
  );
  const result = await provider.getLocation("456", {
    ...context,
    accountIds: ["123", "789", "111"],
  });
  assert.equal(result.accountId, "789");
  assert.equal(
    calls.filter((url) => url.pathname.endsWith("/locations")).length,
    3,
  );
  assert.equal(calls.at(-1)?.searchParams.get("pageToken"), "next");
  assert.ok(!calls.some((url) => url.pathname.includes("111")));
});

for (const scenario of ["not-found", "loop", "rate-limit"] as const) {
  test(`recovery fails closed for ${scenario} and can retry`, async () => {
    let recovered = false;
    const fetcher = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname === "oauth2.googleapis.com")
        return json({
          access_token: "token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      if (url.pathname === "/v1/locations/456")
        return json({ name: "locations/456", title: "Shop" });
      if (recovered) return json({ locations: [{ name: "locations/456" }] });
      return scenario === "rate-limit"
        ? json({}, 429)
        : json({
            locations: [{ name: "locations/999" }],
            ...(scenario === "loop" ? { nextPageToken: "repeated" } : {}),
          });
    }) as typeof fetch;
    const provider = new GoogleBusinessProfileProvider(settings, fetcher);
    await assert.rejects(
      provider.getLocation("456", context),
      code(
        scenario === "not-found"
          ? "RESOURCE_NOT_FOUND"
          : scenario === "loop"
            ? "PROVIDER_ERROR"
            : "PROVIDER_RATE_LIMITED",
      ),
    );
    recovered = true;
    assert.equal((await provider.getLocation("456", context)).accountId, "123");
  });
}

test("concurrent cold detail requests share membership discovery", async () => {
  let lookups = 0;
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === "oauth2.googleapis.com")
      return json({
        access_token: "token",
        token_type: "Bearer",
        expires_in: 3600,
      });
    if (url.pathname === "/v1/locations/456")
      return json({ name: "locations/456", title: "Shop" });
    lookups++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return json({ locations: [{ name: "locations/456" }] });
  }) as typeof fetch;
  const provider = new GoogleBusinessProfileProvider(settings, fetcher);
  const rows = await Promise.all([
    provider.getLocation("456", context),
    provider.getLocation("456", context),
  ]);
  assert.equal(lookups, 1);
  assert.ok(rows.every((row) => row.accountId === "123"));
});

test("Google filters precede pagination and escape search text; missing cursor fails", async () => {
  let request: URL | undefined;
  const provider = new GoogleBusinessProfileProvider(settings, (async (
    input: string | URL | Request,
  ) => {
    const url = new URL(String(input));
    if (url.hostname === "oauth2.googleapis.com")
      return json({
        access_token: "token",
        token_type: "Bearer",
        expires_in: 3600,
      });
    request = url;
    return json({ locations: [], totalSize: 0 });
  }) as typeof fetch);
  const search = 'Shop" OR title:"other';
  const page = await provider.listLocations(
    "123",
    { page: 1, pageSize: 25, search, status: "TEMPORARILY_CLOSED" },
    context,
  );
  assert.equal(
    request?.searchParams.get("filter"),
    `title:${JSON.stringify(search)} AND openInfo.status="CLOSED_TEMPORARILY"`,
  );
  assert.equal(page.total, 0);
  await assert.rejects(
    provider.listLocations("123", { page: 2, pageSize: 25 }, context),
    code("VALIDATION_FAILED"),
  );
});
