import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LocationDetail, PerformanceSummary } from "@gbp/contracts";
import { BusinessProfileService } from "../src/business-profile/business-profile.service";
import type { BusinessProfileProvider } from "../src/business-profile/business-profile.provider";
import { AppException } from "../src/errors/app.exception";
const context = {
  userId: "user",
  role: "VIEWER" as const,
  accountIds: ["a", "other"],
};
const range = { startDate: "2026-09-01", endDate: "2026-09-02" };
const summary = (empty = false): PerformanceSummary => ({
  ...range,
  totalInteractions: empty ? 0 : 3,
  daily: empty ? [] : [{ date: range.startDate, interactions: 3 }],
  dailyMetrics: empty
    ? []
    : [{ date: range.startDate, calls: 3, searchMobile: 5 }],
  calls: empty ? undefined : 3,
  impressions: empty ? {} : { searchMobile: 5 },
  searchKeywords: [],
  keywordStartMonth: "2026-09",
  keywordEndMonth: "2026-09",
});
function fixture(
  count = 31,
  cursor = true,
  read?: (id: string) => Promise<PerformanceSummary>,
) {
  let inFlight = 0,
    maxInFlight = 0,
    calls = 0,
    lists = 0;
  const provider: BusinessProfileProvider = {
    listAccounts: async () => [{ id: "a", name: "Account" }],
    listLocations: async (accountId, query) => {
      lists++;
      const page = query.pageToken ? Number(query.pageToken) : query.page;
      const end = Math.min(count, page * query.pageSize);
      const items = Array.from(
        { length: Math.max(0, end - (page - 1) * query.pageSize) },
        (_, offset) => ({
          id: `location-${(page - 1) * query.pageSize + offset + 1}`,
          accountId,
          name: `Salon ${(page - 1) * query.pageSize + offset + 1}`,
          formattedAddress: "Address",
          status: "OPEN" as const,
        }),
      );
      return {
        items,
        page,
        pageSize: query.pageSize,
        total: cursor ? null : count,
        ...(cursor
          ? { nextPageToken: end < count ? String(page + 1) : null }
          : {}),
      };
    },
    getLocation: async (id) =>
      ({
        id,
        accountId: "a",
        name: id,
        formattedAddress: "Address",
        status: "OPEN",
        verificationStatus: "UNKNOWN",
        websiteUrl: null,
        primaryPhone: null,
      }) as LocationDetail,
    updateLocation: async () => {
      throw new Error("unused");
    },
    getDailyPerformance: async (id, _range, scope) => {
      assert.deepEqual(scope.accountIds, ["a"]);
      assert.equal(scope.userId, "user");
      calls++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return read ? await read(id) : summary();
      } finally {
        inFlight--;
      }
    },
  };
  return {
    provider,
    service: new BusinessProfileService(provider),
    stats: () => ({ calls, lists, maxInFlight }),
  };
}
for (const cursor of [true, false])
  test(`overview traverses ${cursor ? "cursor" : "numbered"} batches beyond the first 25 locations with three workers`, async () => {
    const f = fixture(31, cursor);
    let next: { page: number; pageToken?: string } | null = { page: 1 };
    const ids: string[] = [];
    while (next) {
      const page = await f.service.getAccountPerformance(
        "a",
        { ...range, ...next },
        context,
      );
      ids.push(...page.rows.map((row) => row.id));
      assert.ok(page.rows.every((row) => row.status === "READY"));
      next = page.nextPage;
    }
    assert.equal(ids.length, 31);
    assert.equal(new Set(ids).size, 31);
    assert.equal(ids.at(-1), "location-31");
    assert.equal(f.stats().calls, 31);
    assert.equal(f.stats().maxInFlight, 3);
  });
test("overview distinguishes missing data, denied locations and explicit zero", async () => {
  const f = fixture(4, true, async (id) => {
    if (id === "location-2") throw new AppException("PERMISSION_DENIED");
    if (id === "location-3") return summary(true);
    if (id === "location-4")
      return {
        ...summary(),
        totalInteractions: 0,
        calls: 0,
        daily: [{ date: range.startDate, interactions: 0 }],
        dailyMetrics: [{ date: range.startDate, calls: 0 }],
      };
    return summary();
  });
  const result = await f.service.getAccountPerformance("a", range, context);
  assert.deepEqual(
    result.rows.map((row) => row.status),
    ["READY", "ERROR", "EMPTY", "READY"],
  );
  assert.equal(result.rows[1].metrics.interactions, null);
  assert.equal(result.rows[1].errorCode, "PERMISSION_DENIED");
  assert.equal(result.rows[2].metrics.searchViews, null);
  assert.equal(result.rows[3].metrics.interactions, 0);
  assert.equal(result.rows[0].metrics.bookings, null);
  assert.equal(result.rows[0].daily[0].mapsViews, null);
});
test("rate limiting stops queued work and preserves explicit partial failures", async () => {
  const f = fixture(10, true, async () => {
    throw new AppException("PROVIDER_RATE_LIMITED");
  });
  const result = await f.service.getAccountPerformance("a", range, context);
  assert.ok(f.stats().calls <= 3);
  assert.equal(result.rows.length, 10);
  assert.ok(
    result.rows.every((row) => row.errorCode === "PROVIDER_RATE_LIMITED"),
  );
});
test("unauthorized accounts and malformed date/page queries fail before provider reads", async () => {
  const f = fixture();
  await assert.rejects(
    f.service.getAccountPerformance("forbidden", range, context),
  );
  for (const input of [
    { ...range, startDate: "2026-02-30" },
    { ...range, page: "-1" },
    { ...range, page: [1] },
    { ...range, pageToken: "" },
    { ...range, locationIds: ["other"] },
  ])
    await assert.rejects(f.service.getAccountPerformance("a", input, context));
  assert.equal(f.stats().lists, 0);
  assert.equal(f.stats().calls, 0);
});
test("legacy providers are checked against actual resource account before performance reads", async () => {
  const f = fixture(1);
  delete f.provider.getDailyPerformance;
  f.provider.getLocation = async () => ({
    ...(await fixture().provider.getLocation("location-1", context)),
    accountId: "other",
  });
  let reads = 0;
  f.provider.getPerformance = async () => {
    reads++;
    return summary();
  };
  const result = await f.service.getAccountPerformance("a", range, context);
  assert.equal(result.rows[0].status, "ERROR");
  assert.equal(result.rows[0].errorCode, "PERMISSION_DENIED");
  assert.equal(reads, 0);
});
test("overview rejects a repeated Google cursor instead of claiming completion", async () => {
  const f = fixture(20);
  f.provider.listLocations = async () => ({
    items: [],
    page: 2,
    pageSize: 10,
    total: null,
    nextPageToken: "loop",
  });
  await assert.rejects(
    f.service.getAccountPerformance(
      "a",
      { ...range, page: 2, pageToken: "loop" },
      context,
    ),
    (error) => error instanceof AppException && error.code === "PROVIDER_ERROR",
  );
});
