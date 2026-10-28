import { AUTH_SETTINGS, readAuthSettings } from "../src/auth/auth-settings";
import "reflect-metadata";
import { PrismaService } from "../src/database/prisma.service";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { BusinessProfileModule } from "../src/business-profile/business-profile.module";
import {
  BUSINESS_PROFILE_PROVIDER,
  BusinessProfileProvider,
} from "../src/business-profile/business-profile.provider";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { ApiErrorCode } from "@gbp/contracts";
import { AppException } from "../src/errors/app.exception";
import { mapError } from "../src/errors/map-error";
import {
  MockBusinessProfileProvider,
  MockScenario,
} from "../src/business-profile/mock-business-profile.provider";
import {
  mapMockDetail,
  MockLocationRecord,
} from "../src/business-profile/mock-location.mapper";
import { BusinessProfileService } from "../src/business-profile/business-profile.service";
import type { UserContext } from "../src/business-profile/business-profile.provider";
const manager: UserContext = {
  userId: "user-1",
  role: "MANAGER",
  accountIds: ["account-1", "account-2"],
};
const viewer: UserContext = { ...manager, role: "VIEWER" };
const isCode = (code: ApiErrorCode) => (error: unknown) =>
  error instanceof AppException && error.code === code;
const query = { page: 1, pageSize: 100 };
test("fixtures are deterministic and support 1000 through 10000 locations across two accounts", async () => {
  for (const count of [1000, 1001, 10000]) {
    const provider = new MockBusinessProfileProvider({ locationCount: count });
    const accounts = await provider.listAccounts(manager);
    assert.equal(accounts.length, 2);
    let total = 0;
    for (const account of accounts)
      total += (await provider.listLocations(account.id, query)).total;
    assert.equal(total, count);
    assert.deepEqual(
      await provider.getLocation("location-00001", manager),
      await new MockBusinessProfileProvider({
        locationCount: count,
      }).getLocation("location-00001", manager),
    );
  }
  for (const locationCount of [999, 10001, 1.5, NaN])
    assert.throws(() => new MockBusinessProfileProvider({ locationCount }));
});
test("pages have stable order, no overlaps, correct totals and empty out-of-range pages", async () => {
  const provider = new MockBusinessProfileProvider();
  const ids: string[] = [];
  for (let page = 1; page <= 5; page++) {
    const result = await provider.listLocations("account-1", {
      ...query,
      page,
    });
    assert.equal(result.total, 500);
    assert.equal(result.page, page);
    assert.equal(result.pageSize, 100);
    assert.equal(result.items.length, 100);
    assert.ok(result.items.every((item) => item.accountId === "account-1"));
    ids.push(...result.items.map((item) => item.id));
  }
  assert.equal(new Set(ids).size, 500);
  assert.equal(ids[0], "location-00001");
  assert.equal(ids.at(-1), "location-00999");
  assert.deepEqual(
    (await provider.listLocations("account-1", { ...query, page: 6 })).items,
    [],
  );
});
test("search and status filtering happen before pagination", async () => {
  const provider = new MockBusinessProfileProvider();
  const closed = await provider.listLocations("account-2", {
    ...query,
    status: "PERMANENTLY_CLOSED",
    pageSize: 7,
  });
  assert.equal(closed.total, 100);
  assert.equal(closed.items.length, 7);
  assert.ok(closed.items.every((item) => item.status === "PERMANENTLY_CLOSED"));
  const searched = await provider.listLocations("account-2", {
    ...query,
    search: "  MOCK LOCATION 00010  ",
    status: "PERMANENTLY_CLOSED",
  });
  assert.equal(searched.total, 1);
  assert.equal(searched.items[0]?.id, "location-00010");
  assert.equal(
    (
      await provider.listLocations("account-1", {
        ...query,
        search: "missing-text",
      })
    ).total,
    0,
  );
  assert.equal(
    (
      await provider.listLocations("account-1", {
        ...query,
        search: "1 example street",
      })
    ).items[0]?.id,
    "location-00001",
  );
  for (const invalid of [
    { ...query, page: 0 },
    { ...query, pageSize: 101 },
    { ...query, page: 1.1 },
  ])
    await assert.rejects(
      provider.listLocations("account-1", invalid),
      isCode("VALIDATION_FAILED"),
    );
  await assert.rejects(
    provider.listLocations("missing", query),
    isCode("RESOURCE_NOT_FOUND"),
  );
});
test("mapper returns only normalized fields and separates verification from operating status", () => {
  const record: MockLocationRecord = {
    id: "l",
    accountId: "a",
    title: "Title",
    address: "Address",
    operatingState: "paused",
    verification: "pending",
    website: null,
    phone: null,
  };
  assert.deepEqual(mapMockDetail(record), {
    id: "l",
    accountId: "a",
    name: "Title",
    storeCode: null,
    primaryCategory: null,
    providerState: "MOCK",
    editable: true,
    formattedAddress: "Address",
    status: "TEMPORARILY_CLOSED",
    verificationStatus: "PENDING",
    websiteUrl: null,
    primaryPhone: null,
  });
  assert.equal(
    mapMockDetail({ ...record, operatingState: "closed" }).status,
    "PERMANENTLY_CLOSED",
  );
  assert.equal(
    mapMockDetail({
      ...record,
      operatingState: "active",
      verification: "confirmed",
    }).verificationStatus,
    "VERIFIED",
  );
});
test("updates persist, snapshots cannot mutate fixture, separate fixtures remain isolated", async () => {
  const provider = new MockBusinessProfileProvider();
  const before = await provider.getLocation("location-00001", manager);
  const updated = await provider.updateLocation(
    before.id,
    { websiteUrl: "https://new.example", primaryPhone: "+1 555 123 4567" },
    manager,
  );
  assert.equal(updated.websiteUrl, "https://new.example");
  assert.deepEqual(await provider.getLocation(before.id, manager), updated);
  updated.websiteUrl = "https://mutated.example";
  assert.equal(
    (await provider.getLocation(before.id, manager)).websiteUrl,
    "https://new.example",
  );
  assert.deepEqual(
    await new MockBusinessProfileProvider().getLocation(before.id, manager),
    before,
  );
  assert.equal(
    (await provider.updateLocation(before.id, { websiteUrl: null }, manager))
      .websiteUrl,
    null,
  );
  const snapshot = await provider.getLocation(before.id, manager);
  await assert.rejects(
    provider.updateLocation(
      before.id,
      { websiteUrl: "https://valid.example", primaryPhone: "INVALID" },
      manager,
    ),
    isCode("VALIDATION_FAILED"),
  );
  assert.deepEqual(await provider.getLocation(before.id, manager), snapshot);
  await assert.rejects(
    provider.updateLocation(
      before.id,
      { websiteUrl: "javascript:alert(1)" },
      manager,
    ),
    isCode("VALIDATION_FAILED"),
  );
  await assert.rejects(
    provider.updateLocation(before.id, {}, manager),
    isCode("VALIDATION_FAILED"),
  );
});
test("mock and service enforce role/account scope without HTTP auth shortcuts", async () => {
  const provider = new MockBusinessProfileProvider();
  const service = new BusinessProfileService(provider, undefined, false);
  const restricted = { ...manager, accountIds: ["account-2"] };
  assert.equal((await service.listAccounts(restricted)).length, 1);
  await assert.rejects(
    service.listLocations("account-1", query, restricted),
    isCode("PERMISSION_DENIED"),
  );
  await assert.rejects(
    service.getLocation("location-00001", restricted),
    isCode("PERMISSION_DENIED"),
  );
  await assert.rejects(
    service.updateLocation("location-00001", { websiteUrl: null }, viewer),
    isCode("PERMISSION_DENIED"),
  );
  await assert.rejects(
    provider.updateLocation("location-00001", { websiteUrl: null }, viewer),
    isCode("PERMISSION_DENIED"),
  );
  await assert.rejects(
    service.listAccounts({ ...manager, userId: "" }),
    isCode("UNAUTHENTICATED"),
  );
  await assert.rejects(
    provider.getLocation("missing", manager),
    isCode("RESOURCE_NOT_FOUND"),
  );
});
for (const [scenario, code, status] of [
  ["unauthenticated", "UNAUTHENTICATED", 401],
  ["forbidden", "PERMISSION_DENIED", 403],
  ["notFound", "RESOURCE_NOT_FOUND", 404],
  ["rateLimited", "PROVIDER_RATE_LIMITED", 429],
  ["providerError", "PROVIDER_ERROR", 502],
  ["networkError", "PROVIDER_ERROR", 502],
] satisfies Array<[MockScenario, ApiErrorCode, number]>) {
  test(`scenario ${scenario} consistently maps errors for all operations`, async () => {
    const provider = new MockBusinessProfileProvider({ scenario });
    for (const operation of [
      () => provider.listAccounts(manager),
      () => provider.listLocations("account-1", query),
      () => provider.getLocation("location-00001", manager),
      () =>
        provider.updateLocation(
          "location-00001",
          { websiteUrl: null },
          manager,
        ),
    ]) {
      await assert.rejects(operation(), (error) => {
        assert.ok(isCode(code)(error));
        assert.equal(mapError(error, "request").status, status);
        return true;
      });
    }
  });
}
test("verification scenario produces pending verification while leaving status filters useful", async () => {
  const provider = new MockBusinessProfileProvider({
    scenario: "pendingVerification",
  });
  const result = await provider.listLocations("account-1", {
    ...query,
    status: "OPEN",
  });
  assert.ok(
    result.items.every(
      (item) => item.verificationStatus === "PENDING" && item.status === "OPEN",
    ),
  );
  assert.equal(
    (await provider.getLocation("location-00001", manager)).verificationStatus,
    "PENDING",
  );
});

test("provider factory defaults to a process-scoped mock", async () => {
  @Module({
    providers: [
      ...Reflect.getMetadata("providers", BusinessProfileModule),
      { provide: PrismaService, useValue: {} },
      {
        provide: BusinessProfileService,
        inject: [BUSINESS_PROFILE_PROVIDER],
        useFactory: (provider: BusinessProfileProvider) =>
          new BusinessProfileService(provider, undefined, false),
      },
      {
        provide: AUTH_SETTINGS,
        useValue: readAuthSettings({ NODE_ENV: "test" }),
      },
    ],
  })
  class ProviderFixtureModule {}
  const app = await NestFactory.create(ProviderFixtureModule, {
    logger: false,
    abortOnError: false,
  });
  await app.listen(0, "127.0.0.1");
  try {
    const provider = app.get<BusinessProfileProvider>(
      BUSINESS_PROFILE_PROVIDER,
    );
    assert.ok(provider instanceof MockBusinessProfileProvider);
    assert.equal(app.get(BUSINESS_PROFILE_PROVIDER), provider);
    const service = app.get(BusinessProfileService);
    await service.updateLocation(
      "location-00001",
      { websiteUrl: null },
      manager,
    );
    assert.equal(
      (await provider.getLocation("location-00001", manager)).websiteUrl,
      null,
    );
    assert.equal((await fetch(`${await app.getUrl()}/locations`)).status, 404);
  } finally {
    await app.close();
  }
});

test("service validates before delegating to a provider", async () => {
  let writes = 0;
  const provider = new MockBusinessProfileProvider();
  provider.updateLocation = async () => {
    writes++;
    throw new Error("should not write");
  };
  const service = new BusinessProfileService(provider, undefined, false);
  for (const input of [
    null,
    [],
    {},
    { name: "renamed" },
    { primaryPhone: "---" },
    { websiteUrl: "ftp://example.com" },
  ])
    await assert.rejects(
      service.updateLocation("location-00001", input, manager),
      isCode("VALIDATION_FAILED"),
    );
  assert.equal(writes, 0);
});

test("service independently checks actual resource account before any write", async () => {
  const provider = new MockBusinessProfileProvider();
  const original = await provider.getLocation("location-00002", manager);
  // Simulate a provider that fails to enforce read scope; service must still deny it.
  provider.getLocation = async () => original;
  let writes = 0;
  provider.updateLocation = async () => {
    writes++;
    return original;
  };
  const service = new BusinessProfileService(provider, undefined, false);
  const restricted = { ...manager, accountIds: ["account-1"] };
  await assert.rejects(
    service.getLocation(original.id, restricted),
    isCode("PERMISSION_DENIED"),
  );
  await assert.rejects(
    service.updateLocation(original.id, { websiteUrl: null }, restricted),
    isCode("PERMISSION_DENIED"),
  );
  assert.equal(writes, 0);
});

test("service blocks location updates when the environment flag is enabled", async () => {
  const previous = process.env.LOCATION_UPDATES_DISABLED;
  process.env.LOCATION_UPDATES_DISABLED = "true";
  try {
    const provider = new MockBusinessProfileProvider();
    let writes = 0;
    const update = provider.updateLocation.bind(provider);
    provider.updateLocation = async (...args) => {
      writes++;
      return update(...args);
    };
    const service = new BusinessProfileService(provider);
    await assert.rejects(
      service.updateLocation("location-00001", { websiteUrl: null }, manager),
      isCode("PERMISSION_DENIED"),
    );
    assert.equal(writes, 0);
    delete process.env.LOCATION_UPDATES_DISABLED;
    await assert.rejects(
      new BusinessProfileService(provider).updateLocation(
        "location-00001",
        { websiteUrl: null },
        manager,
      ),
      isCode("PERMISSION_DENIED"),
    );
    assert.equal(writes, 0);
    assert.ok(await service.getLocation("location-00001", manager));
    process.env.LOCATION_UPDATES_DISABLED = "false";
    await new BusinessProfileService(provider).updateLocation(
      "location-00001",
      { websiteUrl: null },
      manager,
    );
    assert.equal(writes, 1);
  } finally {
    if (previous === undefined) delete process.env.LOCATION_UPDATES_DISABLED;
    else process.env.LOCATION_UPDATES_DISABLED = previous;
  }
});
