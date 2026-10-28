import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { PerformanceState } from "../components/performance-tab";
import { performanceOptions } from "../lib/performance";
import { BffError } from "../lib/bff-client";
const range = { startDate: "2026-09-01", endDate: "2026-09-02" };
test("mock fixtures render metrics, line chart, impressions, keywords and empty state", async () => {
  const { MockBusinessProfileProvider } =
    await import("../../api/src/business-profile/mock-business-profile.provider");
  const provider = new MockBusinessProfileProvider();
  const context = {
    userId: "viewer",
    role: "VIEWER" as const,
    accountIds: ["account-1", "account-2"],
    connectionId: "mock-a",
  };
  for (const id of ["location-00001", "location-00002", "location-00004"]) {
    const result = await provider.getPerformance(id, range, context);
    const markup = renderToStaticMarkup(
      createElement(PerformanceState, { pending: false, data: result }),
    );
    for (const label of [
      "Total interactions",
      "Calls",
      "Direction requests",
      "Website clicks",
      "Daily interactions",
      "Profile impressions",
      "Search keywords",
    ])
      assert.ok(markup.includes(label));
    const chartLabels = [...markup.matchAll(/<text\b[^>]*>/g)];
    assert.ok(chartLabels.length >= 5);
    for (const [label] of chartLabels) {
      assert.match(label, /fill="var\(--text\)"/);
    }
    assert.match(markup, /<polyline/);
    assert.match(markup, /<circle/);
    assert.ok(markup.includes(result.searchKeywords[0].keyword));
    assert.ok(
      markup.includes(result.impressions.searchMobile!.toLocaleString()),
    );
    assert.equal(markup.includes("Bookings"), result.bookings !== undefined);
    assert.ok(!markup.includes("No performance data"));
  }
  const empty = await provider.getPerformance("location-00003", range, context);
  const markup = renderToStaticMarkup(
    createElement(PerformanceState, { pending: false, data: empty }),
  );
  assert.match(markup, /No performance data/);
  assert.ok(!markup.includes("<polyline"));
  assert.ok(!markup.includes("Total interactions"));
});
const data = {
  ...range,
  totalInteractions: 0,
  daily: [],
  impressions: {},
  searchKeywords: [],
  keywordStartMonth: "2026-09",
  keywordEndMonth: "2026-09",
};
test("loading, empty, rate-limited and provider error states", () => {
  const render = (props: Parameters<typeof PerformanceState>[0]) =>
    renderToStaticMarkup(createElement(PerformanceState, props));
  assert.match(render({ pending: true }), /Loading performance/);
  const empty = render({ pending: false, data });
  assert.match(empty, /No performance data/);
  assert.match(empty, /No metrics are available/);
  assert.ok(!empty.includes("Bookings"));
  for (const [status, code, message] of [
    [429, "PROVIDER_RATE_LIMITED", "Wait a moment"],
    [502, "PROVIDER_ERROR", "unavailable"],
  ] as const) {
    assert.match(
      render({
        pending: false,
        error: new BffError(
          {
            code,
            message: "error",
            requestId: "unavailable",
            details: null,
          },
          status,
        ),
      }),
      new RegExp(message),
    );
  }
});
test("date changes refetch and user, connection and location caches stay isolated", async () => {
  const client = new QueryClient();
  let calls = 0;
  const fetchRange = async (
    user: string,
    connection: string,
    location: string,
    dates = range,
  ) => {
    const options = performanceOptions(user, connection, location, dates);
    return client.fetchQuery({
      ...options,
      queryFn: async () => {
        calls++;
        return { ...data, ...dates };
      },
    });
  };
  await fetchRange("user", "connection", "location");
  await fetchRange("user", "connection", "location");
  assert.equal(calls, 1);
  await fetchRange("user", "connection", "location", {
    ...range,
    endDate: "2026-09-03",
  });
  await fetchRange("other", "connection", "location");
  await fetchRange("user", "other", "location");
  await fetchRange("user", "connection", "other");
  assert.equal(calls, 5);
  client.clear();
});
