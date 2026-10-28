import { test } from "node:test";
import { strict as assert } from "node:assert";
import { PerformanceSummarySchema } from "@gbp/contracts";
import { MockBusinessProfileProvider } from "../src/business-profile/mock-business-profile.provider";
import type { UserContext } from "../src/business-profile/business-profile.provider";
const context: UserContext = {
  userId: "viewer",
  role: "VIEWER",
  accountIds: ["account-1", "account-2"],
  connectionId: "mock-a",
};
const range = { startDate: "2026-09-01", endDate: "2026-09-30" };
const provider = new MockBusinessProfileProvider();

test("performance is deterministic across instances and varies by connection and location", async () => {
  const result = await provider.getPerformance(
    "location-00001",
    range,
    context,
  );
  assert.deepEqual(
    await provider.getPerformance("location-00001", range, context),
    result,
  );
  assert.deepEqual(
    await new MockBusinessProfileProvider().getPerformance(
      "location-00001",
      range,
      context,
    ),
    result,
  );
  assert.notDeepEqual(
    await provider.getPerformance("location-00001", range, {
      ...context,
      connectionId: "mock-b",
    }),
    result,
  );
  assert.notDeepEqual(
    await provider.getPerformance("location-01000", range, context),
    result,
  );
});

test("inclusive varied daily series, consistent totals, impressions and ranked local keywords", async () => {
  for (const id of [
    "location-00001",
    "location-00002",
    "location-00004",
    "location-01000",
  ]) {
    const result = await provider.getPerformance(id, range, context);
    assert.ok(PerformanceSummarySchema.safeParse(result).success);
    assert.equal(result.daily.length, 30);
    assert.equal(result.daily[0].date, range.startDate);
    assert.equal(result.daily.at(-1)?.date, range.endDate);
    assert.ok(new Set(result.daily.map((d) => d.interactions)).size > 1);
    assert.equal(
      result.totalInteractions,
      result.daily.reduce((sum, d) => sum + d.interactions, 0),
    );
    assert.equal(
      result.totalInteractions,
      result.calls! +
        result.directions! +
        result.websiteClicks! +
        (result.bookings ?? 0),
    );
    assert.equal(Object.keys(result.impressions).length, 4);
    assert.ok(
      Object.values(result.impressions).reduce((sum, v) => sum + v!, 0) >
        result.totalInteractions,
    );
    result.searchKeywords.forEach((k, i) => {
      assert.ok(k.impressions! > 0);
      if (i)
        assert.ok(result.searchKeywords[i - 1].impressions! > k.impressions!);
    });
  }
  const normal = await provider.getPerformance(
    "location-00001",
    range,
    context,
  );
  for (const keyword of [
    "mock location 00001",
    "cafe near me",
    "cafe mock city",
  ])
    assert.ok(normal.searchKeywords.some((k) => k.keyword === keyword));
});

test("range changes return exact days and preserve overlapping values across leap days", async () => {
  const full = await provider.getPerformance("location-00001", range, context);
  const subset = await provider.getPerformance(
    "location-00001",
    { startDate: "2026-09-10", endDate: "2026-09-12" },
    context,
  );
  assert.deepEqual(subset.daily, full.daily.slice(9, 12));
  assert.notEqual(subset.totalInteractions, full.totalInteractions);
  const leap = await provider.getPerformance(
    "location-00001",
    { startDate: "2024-02-28", endDate: "2024-03-01" },
    context,
  );
  assert.deepEqual(
    leap.daily.map((d) => d.date),
    ["2024-02-28", "2024-02-29", "2024-03-01"],
  );
  assert.equal(
    (
      await provider.getPerformance(
        "location-00001",
        { startDate: range.startDate, endDate: range.startDate },
        context,
      )
    ).daily.length,
    1,
  );
});

test("dedicated high, empty and low traffic fixtures", async () => {
  const [normal, high, empty, low] = await Promise.all(
    [1, 2, 3, 4].map((n) =>
      provider.getPerformance(`location-0000${n}`, range, context),
    ),
  );
  assert.ok(high.totalInteractions > normal.totalInteractions * 3);
  assert.ok(low.totalInteractions < normal.totalInteractions / 10);
  assert.equal(low.bookings, undefined);
  assert.deepEqual(empty, {
    ...range,
    totalInteractions: 0,
    daily: [],
    dailyMetrics: [],
    impressions: {},
    searchKeywords: [],
    keywordStartMonth: "2026-09",
    keywordEndMonth: "2026-09",
  });
});

test("authorization, validation and scenario errors still apply", async () => {
  await assert.rejects(
    provider.getPerformance("location-00001", range, {
      ...context,
      accountIds: [],
    }),
  );
  await assert.rejects(
    provider.getPerformance("location-99999", range, context),
  );
  await assert.rejects(
    provider.getPerformance(
      "location-00001",
      { ...range, endDate: "2026-08-01" },
      context,
    ),
  );
  await assert.rejects(
    new MockBusinessProfileProvider({
      scenario: "providerError",
    }).getPerformance("location-00001", range, context),
  );
});
