import { LocationPolicy } from "../src/auth/location-policy";
import { PermissionsGuard } from "../src/auth/permissions.guard";
import "reflect-metadata";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  BusinessProfileController,
  BUSINESS_PROFILE_SCOPE,
} from "../src/business-profile/business-profile.controller";
import { BusinessProfileService } from "../src/business-profile/business-profile.service";
import {
  MockBusinessProfileProvider,
  MockScenario,
} from "../src/business-profile/mock-business-profile.provider";
import { SessionGuard } from "../src/auth/session.guard";
import { sessionCsrfToken, SessionService } from "../src/auth/session.service";
import { AUTH_SETTINGS, readAuthSettings } from "../src/auth/auth-settings";
import { AppException } from "../src/errors/app.exception";
import { configureApp } from "../src/configure-app";
const token = "a".repeat(64);
async function fixture(
  scenario: MockScenario = "normal",
  role: "VIEWER" | "MANAGER" = "VIEWER",
  lab = false,
) {
  const settings = readAuthSettings({
    NODE_ENV: "test",
    LOCAL_LAB_ONLY: lab ? "true" : undefined,
    LOCAL_LAB_BROKEN_AUTHORIZATION: lab ? "true" : undefined,
  });
  const policy = new LocationPolicy(settings);
  const provider = new MockBusinessProfileProvider({
    locationCount: 10000,
    scenario,
  });
  @Module({
    controllers: [BusinessProfileController],
    providers: [
      {
        provide: BusinessProfileService,
        useValue: new BusinessProfileService(provider, policy, false),
      },
      {
        provide: BUSINESS_PROFILE_SCOPE,
        useValue: async (userId: string) => ({
          accountIds: userId ? ["account-1"] : [],
        }),
      },
      { provide: AUTH_SETTINGS, useValue: settings },
      {
        provide: SessionService,
        useValue: {
          authenticate: async (value?: string) => {
            if (value === "b".repeat(64))
              throw new AppException("SESSION_EXPIRED");
            if (value !== token) throw new AppException("UNAUTHENTICATED");
            return { id: "user", role };
          },
        },
      },
      { provide: LocationPolicy, useValue: policy },
      PermissionsGuard,
      SessionGuard,
    ],
  })
  class ReadFixtureModule {}
  const app = await NestFactory.create(ReadFixtureModule, { logger: false });
  configureApp(app, settings);
  await app.listen(0, "127.0.0.1");
  const url = await app.getUrl();
  const get = (path: string, cookie = token) =>
    fetch(url + path, {
      headers: cookie ? { Cookie: `${settings.cookieName}=${cookie}` } : {},
    });
  const patch = (
    input: unknown,
    id = "location-00001",
    proof = sessionCsrfToken(token),
  ) =>
    fetch(url + "/api/locations/" + id, {
      method: "PATCH",
      headers: {
        Cookie: `${settings.cookieName}=${token}`,
        Origin: settings.webOrigin,
        "X-CSRF-Token": proof,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
  return { app, get, patch, provider };
}
test("read HTTP routes enforce sessions and account scope; return only bounded normalized pages", async () => {
  const { app, get } = await fixture();
  try {
    for (const path of [
      "/api/accounts",
      "/api/accounts/account-1/locations",
      "/api/locations/location-00001",
    ]) {
      assert.equal((await get(path, "")).status, 401);
      const expired = await get(path, "b".repeat(64));
      assert.equal(expired.status, 401);
      assert.equal((await expired.json()).code, "SESSION_EXPIRED");
    }
    assert.deepEqual(await (await get("/api/accounts")).json(), [
      { id: "account-1", name: "Mock North" },
    ]);
    const first = await (
      await get("/api/accounts/account-1/locations?pageSize=25")
    ).json();
    const second = await (
      await get("/api/accounts/account-1/locations?page=2&pageSize=25")
    ).json();
    assert.equal(first.total, 5000);
    assert.equal(first.items.length, 25);
    assert.equal(second.page, 2);
    assert.ok(
      second.items.every(
        (row: { id: string }) =>
          !first.items.some((other: { id: string }) => other.id === row.id),
      ),
    );
    const filtered = await (
      await get(
        "/api/accounts/account-1/locations?search=00005&status=TEMPORARILY_CLOSED",
      )
    ).json();
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].id, "location-00005");
    assert.equal((await get("/api/accounts/account-2/locations")).status, 403);
    assert.equal((await get("/api/locations/location-00002")).status, 403);
    assert.equal((await get("/api/locations/missing")).status, 404);
    const detail = await (await get("/api/locations/location-00001")).json();
    assert.equal(detail.websiteUrl, "https://location-1.example");
    assert.equal(detail.title, undefined);
    for (const query of [
      "page=0",
      "pageSize=101",
      "page=1.5",
      "page=1&page=2",
      "status=INVALID",
      "search=" + "x".repeat(201),
    ])
      assert.equal(
        (await get("/api/accounts/account-1/locations?" + query)).status,
        400,
      );
    assert.equal(
      (
        await (
          await get("/api/accounts/account-1/locations?search=does-not-exist")
        ).json()
      ).total,
      0,
    );
  } finally {
    await app.close();
  }
});
for (const [scenario, status, code] of [
  ["rateLimited", 429, "PROVIDER_RATE_LIMITED"],
  ["networkError", 502, "PROVIDER_ERROR"],
  ["forbidden", 403, "PERMISSION_DENIED"],
] as const) {
  test(`HTTP normalizes ${scenario}`, async () => {
    const { app, get } = await fixture(scenario);
    try {
      const response = await get("/api/accounts");
      assert.equal(response.status, status);
      const body = await response.json();
      assert.equal(body.code, code);
      assert.equal(typeof body.requestId, "string");
      assert.equal(body.stack, undefined);
    } finally {
      await app.close();
    }
  });
}

test("PATCH enforces role, scope, CSRF and strict fields; edits persist atomically", async () => {
  const viewer = await fixture();
  try {
    assert.equal((await viewer.patch({ websiteUrl: null })).status, 403);
  } finally {
    await viewer.app.close();
  }
  const { app, get, patch } = await fixture("normal", "MANAGER");
  try {
    assert.equal(
      (await patch({ primaryPhone: null }, "location-00002")).status,
      403,
    );
    assert.equal((await patch({ primaryPhone: null }, "missing")).status, 404);
    assert.equal(
      (await patch({ primaryPhone: null }, "location-00001", "")).status,
      403,
    );
    const before = await (await get("/api/locations/location-00001")).json();
    for (const input of [
      {},
      { title: "SECRET" },
      { websiteUrl: "javascript:alert(1)" },
      { websiteUrl: "https://valid.example", primaryPhone: "INVALID" },
      { websiteUrl: "https://user:SECRET@example.com" },
    ]) {
      const response = await patch(input);
      assert.equal(response.status, 400);
      const error = await response.json();
      assert.equal(error.code, "VALIDATION_FAILED");
      assert.ok(!JSON.stringify(error).includes("SECRET"));
      assert.deepEqual(
        await (await get("/api/locations/location-00001")).json(),
        before,
      );
    }
    const saved = await patch({
      websiteUrl: null,
      primaryPhone: "+1 555 123 4567",
    });
    assert.equal(saved.status, 200);
    const detail = await saved.json();
    assert.equal(detail.websiteUrl, null);
    assert.equal(detail.primaryPhone, "+1 555 123 4567");
    assert.equal(detail.name, before.name);
    assert.deepEqual(
      await (await get("/api/locations/location-00001")).json(),
      detail,
    );
  } finally {
    await app.close();
  }
});

test("direct HTTP cannot bypass Viewer write permission or account scope by forging input", async () => {
  const { app, get, patch } = await fixture();
  try {
    for (const id of ["location-00001", "location-00002"]) {
      assert.equal((await patch({ websiteUrl: null }, id)).status, 403);
      assert.equal(
        (
          await patch(
            {
              websiteUrl: null,
              role: "MANAGER",
              permissions: ["location:write"],
              accountId: "account-1",
            },
            id,
          )
        ).status,
        403,
      );
    }
    assert.equal((await get("/api/locations/location-00002")).status, 403);
    assert.equal((await get("/api/accounts/account-2/locations")).status, 403);
  } finally {
    await app.close();
  }
});
test("LOCAL LAB ONLY demonstrates IDOR and Viewer write bypass with authentication and validation intact", async () => {
  const { app, get, patch } = await fixture("normal", "VIEWER", true);
  try {
    assert.equal((await get("/api/locations/location-00002")).status, 200);
    assert.equal((await get("/api/accounts/account-2/locations")).status, 200);
    const saved = await patch(
      { websiteUrl: "https://lab.example" },
      "location-00002",
    );
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).websiteUrl, "https://lab.example");
    assert.equal(
      (await patch({ websiteUrl: "javascript:alert(1)" }, "location-00002"))
        .status,
      400,
    );
    assert.equal(
      (await patch({ websiteUrl: null }, "location-00002", "")).status,
      403,
    );
    assert.equal((await get("/api/locations/location-00002", "")).status, 401);
  } finally {
    await app.close();
  }
});
test("broken authorization lab defaults off and rejects production, nonlocal and incomplete opt-in", () => {
  assert.equal(readAuthSettings({ NODE_ENV: "test" }).labAuthorization, false);
  for (const env of [
    {
      NODE_ENV: "production",
      WEB_ORIGIN: "https://localhost:3000",
      LOCAL_LAB_ONLY: "true",
    },
    {
      NODE_ENV: "development",
      WEB_ORIGIN: "https://shared.example",
      LOCAL_LAB_ONLY: "true",
    },
    { NODE_ENV: "test" },
    { LOCAL_LAB_ONLY: "true" },
  ])
    assert.throws(
      () =>
        readAuthSettings({ ...env, LOCAL_LAB_BROKEN_AUTHORIZATION: "true" }),
      /Broken authorization lab/,
    );
});

test("bulk HTTP route requires a session, CSRF and Manager role and returns scoped per-location results", async () => {
  const input = {
    accountId: "account-1",
    operation: "SET_WEBSITE",
    websiteUrl: null,
    selection: {
      kind: "EXPLICIT_IDS",
      locationIds: ["location-00001", "location-00002", "missing"],
    },
  };
  const viewer = await fixture();
  try {
    assert.equal((await viewer.patch(input, "bulk")).status, 403);
  } finally {
    await viewer.app.close();
  }
  const { app, get, patch } = await fixture("normal", "MANAGER");
  try {
    assert.equal((await get("/api/locations/bulk", "")).status, 401);
    assert.equal((await patch(input, "bulk", "")).status, 403);
    assert.equal((await patch({ ...input, extra: true }, "bulk")).status, 400);
    const response = await patch(input, "bulk");
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.totalSelected, 3);
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 2);
    assert.deepEqual(result.results[1], {
      locationId: "location-00002",
      success: false,
      reason: "PERMISSION_DENIED",
    });
    assert.equal(
      (await (await get("/api/locations/location-00001")).json()).websiteUrl,
      null,
    );
  } finally {
    await app.close();
  }
});

test("content and multipart routes require session, CSRF, write role and location scope", async () => {
  const { app, provider } = await fixture("normal", "MANAGER");
  let writes = 0;
  Object.assign(provider, {
    listContent: async () => ({
      kind: "reviews",
      available: true,
      items: [],
      nextPageToken: null,
      averageRating: null,
      totalReviews: 0,
    }),
    mutateContent: async () => {
      writes++;
      return { status: "ok" };
    },
    uploadPhoto: async () => {
      writes++;
      return { status: "ok" };
    },
  });
  const base = await app.getUrl();
  const headers = {
    Cookie: `gbp_session=${token}`,
    Origin: "http://localhost:3000",
    "X-CSRF-Token": sessionCsrfToken(token),
  };
  try {
    assert.equal(
      (await fetch(`${base}/api/locations/location-00001/content/reviews`))
        .status,
      401,
    );
    assert.equal(
      (
        await fetch(`${base}/api/locations/location-00001/content/reviews`, {
          headers,
        })
      ).status,
      200,
    );
    const command = {
      operation: "REPLY_REVIEW",
      id: "review",
      comment: "Thanks",
    };
    const post = (id: string, proof: string, body = command) =>
      fetch(`${base}/api/locations/${id}/content`, {
        method: "POST",
        headers: {
          ...headers,
          "X-CSRF-Token": proof,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    assert.equal((await post("location-00001", "")).status, 403);
    assert.equal(
      (await post("location-00002", headers["X-CSRF-Token"])).status,
      403,
    );
    assert.equal(writes, 0);
    assert.equal(
      (await post("location-00001", headers["X-CSRF-Token"])).status,
      201,
    );
    const file = new Blob([new Uint8Array([255, 216, 255, 1])], {
      type: "image/jpeg",
    });
    const form = () => {
      const value = new FormData();
      value.set("file", file, "photo.jpg");
      value.set("category", "ADDITIONAL");
      return value;
    };
    assert.equal(
      (
        await fetch(`${base}/api/locations/location-00001/photos/upload`, {
          method: "POST",
          headers: { ...headers, "X-CSRF-Token": "" },
          body: form(),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${base}/api/locations/location-00001/photos/upload`, {
          method: "POST",
          headers,
          body: form(),
        })
      ).status,
      201,
    );
    assert.equal(writes, 2);
  } finally {
    await app.close();
  }
  const viewer = await fixture("normal", "VIEWER");
  try {
    const response = await fetch(
      `${await viewer.app.getUrl()}/api/locations/location-00001/content`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "DELETE_MEDIA", id: "photo" }),
      },
    );
    assert.equal(response.status, 403);
  } finally {
    await viewer.app.close();
  }
});

test("account overview HTTP route permits scoped viewers and rejects missing sessions, cross-account and invalid ranges", async () => {
  const { app, get } = await fixture();
  const query = "startDate=2026-09-01&endDate=2026-09-02";
  try {
    assert.equal(
      (await get(`/api/accounts/account-1/performance?${query}`, "")).status,
      401,
    );
    assert.equal(
      (await get(`/api/accounts/account-2/performance?${query}`)).status,
      403,
    );
    assert.equal(
      (
        await get(
          "/api/accounts/account-1/performance?startDate=bad&endDate=bad",
        )
      ).status,
      400,
    );
    const response = await get(`/api/accounts/account-1/performance?${query}`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.rows.length, 10);
    assert.equal(result.totalLocations, 5000);
    assert.deepEqual(result.nextPage, { page: 2 });
    assert.ok(
      result.rows.some((row: { status: string }) => row.status === "EMPTY"),
    );
  } finally {
    await app.close();
  }
});
