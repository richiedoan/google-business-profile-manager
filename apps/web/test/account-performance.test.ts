import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  emptyOverviewMetrics,
  type AccountPerformancePage,
  type AccountPerformanceRow,
} from "@gbp/contracts";
import {
  accountPerformanceOptions,
  aggregateAccountPerformance,
  overviewSeries,
  sortOverviewRows,
  overviewRange,
} from "../lib/account-performance";
import { AccountOverviewReport } from "../components/account-performance-overview";
import { createQueryClient } from "../lib/query-client";
const range = { startDate: "2026-09-01", endDate: "2026-09-03" };
const row = (id: string, value: number | null = 3): AccountPerformanceRow => ({
  id,
  name: `Salon ${id}`,
  status: value === null ? "EMPTY" : "READY",
  errorCode: null,
  metrics: { ...emptyOverviewMetrics(), interactions: value, calls: value },
  daily:
    value === null
      ? []
      : [
          {
            ...emptyOverviewMetrics(),
            date: range.startDate,
            interactions: value,
            calls: value,
          },
        ],
});
const page = (
  rows: AccountPerformanceRow[],
  nextPage: AccountPerformancePage["nextPage"] = null,
): AccountPerformancePage => ({
  accountId: "a",
  ...range,
  rows,
  nextPage,
  totalLocations: rows.length,
  fetchedAt: "2026-10-15T03:00:00Z",
});
test("overview aggregates unique locations without treating unavailable or failed metrics as zero", () => {
  const a = row("a");
  const b = row("b", 0);
  const missing = row("c", null);
  const failed = {
    ...row("d", null),
    status: "ERROR" as const,
    errorCode: "PERMISSION_DENIED" as const,
  };
  const aggregate = aggregateAccountPerformance([
    page([a, b]),
    page([a, missing, failed]),
  ]);
  assert.equal(aggregate.rows.length, 4);
  assert.equal(aggregate.totals.interactions, 3);
  assert.equal(aggregate.coverage.calls, 2);
  assert.equal(aggregate.totals.bookings, null);
  assert.equal(aggregate.ready, 2);
  assert.equal(aggregate.empty, 1);
  assert.equal(aggregate.failed, 1);
  assert.equal(aggregate.daily[0].calls, 3);
  assert.equal(aggregate.daily[0].mapsViews, null);
});
test("daily charts keep missing dates as gaps and aggregate weeks/months without fabricating zero", () => {
  const daily = [
    { ...emptyOverviewMetrics(), date: range.startDate, calls: 3 },
    { ...emptyOverviewMetrics(), date: range.endDate, calls: 0 },
  ];
  assert.deepEqual(
    overviewSeries(daily, range, "calls", "day").map((point) => point.value),
    [3, null, 0],
  );
  assert.deepEqual(overviewSeries(daily, range, "calls", "week"), [
    { date: "2026-08-31", value: 3 },
  ]);
  assert.deepEqual(overviewSeries(daily, range, "calls", "month"), [
    { date: "2026-09-01", value: 3 },
  ]);
  assert.equal(
    overviewSeries(daily, range, "bookings", "month")[0].value,
    null,
  );
});
test("location sorting keeps missing metrics last in both directions", () => {
  const rows = [row("unknown", null), row("large", 9), row("zero", 0)];
  assert.deepEqual(
    sortOverviewRows(rows, "calls", false).map((item) => item.id),
    ["large", "zero", "unknown"],
  );
  assert.deepEqual(
    sortOverviewRows(rows, "calls", true).map((item) => item.id),
    ["zero", "large", "unknown"],
  );
});
test("overview query scope isolates account, user, connection and dates and detects cursor loops", () => {
  const a = accountPerformanceOptions("user", "conn", "a", range);
  for (const options of [
    accountPerformanceOptions("other", "conn", "a", range),
    accountPerformanceOptions("user", "other", "a", range),
    accountPerformanceOptions("user", "conn", "other", range),
    accountPerformanceOptions("user", "conn", "a", {
      ...range,
      startDate: "2026-08-01",
    }),
  ])
    assert.notDeepEqual(a.queryKey, options.queryKey);
  const next = a.getNextPageParam!;
  assert.equal(
    next(
      page([], { page: 3, pageToken: "repeat" }),
      [],
      { page: 2, pageToken: "other" },
      [{ page: 1 }, { page: 2, pageToken: "repeat" }],
    ),
    undefined,
  );
  assert.deepEqual(
    next(page([], { page: 2 }), [], { page: 1 }, [{ page: 1 }]),
    { page: 2 },
  );
});
test("cached overview batches survive back navigation and explicit invalidation refreshes them", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const client = createQueryClient();
  let calls = 0;
  const options = {
    ...accountPerformanceOptions("user", "conn", "a", range),
    queryFn: async () => {
      calls++;
      return page([row("a")]);
    },
  };
  try {
    await client.fetchInfiniteQuery(options);
    now += 60_000;
    await client.fetchInfiniteQuery(options);
    assert.equal(calls, 1);
    await client.invalidateQueries({ queryKey: options.queryKey });
    await client.fetchInfiniteQuery(options);
    assert.equal(calls, 2);
  } finally {
    client.clear();
  }
});
test("overview report renders partial coverage and escaped names with detailed links", () => {
  const hostile = "<img src=x onerror=alert(1)>";
  const first = { ...row("a"), name: hostile };
  const failed = {
    ...row("bad", null),
    status: "ERROR" as const,
    errorCode: "PERMISSION_DENIED" as const,
  };
  const markup = renderToStaticMarkup(
    createElement(AccountOverviewReport, {
      pages: [page([first, failed], { page: 2 })],
      range,
      connectionId: "conn",
      complete: false,
      loading: true,
    }),
  );
  for (const text of [
    "Performance by location",
    "Partial results",
    "Access denied",
    "Search views",
    "0 without data",
    "1 failed",
  ])
    assert.ok(markup.includes(text), text);
  assert.ok(markup.includes("&lt;img"));
  assert.ok(!markup.includes("<img"));
  assert.ok(markup.includes("/app/locations/a?connectionId=conn"));
  assert.ok(markup.includes("View chart values"));
});
test("presets end yesterday and cover the requested inclusive calendar range", () => {
  assert.deepEqual(overviewRange(7, new Date("2026-10-15T10:00:00Z")), {
    startDate: "2026-10-08",
    endDate: "2026-10-14",
  });
  assert.deepEqual(overviewRange(28, new Date("2026-03-01T10:00:00Z")), {
    startDate: "2026-02-01",
    endDate: "2026-02-28",
  });
});
