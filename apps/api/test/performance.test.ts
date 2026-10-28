import { test } from "node:test";
import { strict as assert } from "node:assert";
import { GoogleBusinessProfileProvider } from "../src/business-profile/google-business-profile.provider";
import { AppException } from "../src/errors/app.exception";
import { PerformanceRangeSchema } from "@gbp/contracts";
const context = {
  userId: "user",
  role: "VIEWER" as const,
  accountIds: ["123"],
};
const range = { startDate: "2026-09-01", endDate: "2026-09-02" };
function setup(status = 200, empty = false) {
  const calls: URL[] = [];
  const provider = new GoogleBusinessProfileProvider(
    {
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
      userId: "user",
      accountIds: ["123"],
    },
    (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url);
      const json = (body: unknown, code = 200) =>
        new Response(JSON.stringify(body), { status: code });
      if (url.hostname === "oauth2.googleapis.com")
        return json({
          access_token: "token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      if (url.hostname !== "businessprofileperformance.googleapis.com")
        return json(
          url.pathname.includes("accounts")
            ? { locations: [{ name: "locations/456", title: "Shop" }] }
            : { name: "locations/456", title: "Shop" },
        );
      if (status !== 200) return json({ error: "private upstream" }, status);
      if (empty) return json({});
      if (url.pathname.includes("searchkeywords"))
        return json(
          url.searchParams.has("pageToken")
            ? {
                searchKeywordsCounts: [
                  { searchKeyword: "coffee", insightsValue: { value: "90" } },
                ],
              }
            : {
                searchKeywordsCounts: [
                  { searchKeyword: "rare", insightsValue: { threshold: "15" } },
                ],
                nextPageToken: "next",
              },
        );
      return json({
        multiDailyMetricTimeSeries: [
          {
            dailyMetricTimeSeries: [
              {
                dailyMetric: "CALL_CLICKS",
                timeSeries: {
                  datedValues: [
                    { date: { year: 2026, month: 9, day: 1 }, value: "3" },
                    { date: { year: 2026, month: 9, day: 2 } },
                  ],
                },
              },
              {
                dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
                timeSeries: {
                  datedValues: [
                    { date: { year: 2026, month: 9, day: 1 }, value: "25" },
                  ],
                },
              },
            ],
          },
        ],
      });
    }) as typeof fetch,
  );
  return { provider, calls };
}
test("normalizes daily values, omits unavailable metrics and paginates monthly keywords", async () => {
  const { provider, calls } = setup();
  await provider.listLocations("123", { page: 1, pageSize: 25 }, context);
  const result = await provider.getPerformance("456", range, context);
  assert.equal(result.totalInteractions, 3);
  assert.equal(result.calls, 3);
  assert.equal(result.bookings, undefined);
  assert.deepEqual(result.impressions, { searchMobile: 25 });
  assert.deepEqual(result.daily, [
    { date: "2026-09-01", interactions: 3 },
    { date: "2026-09-02", interactions: 0 },
  ]);
  assert.deepEqual(result.searchKeywords, [
    { keyword: "coffee", impressions: 90 },
    { keyword: "rare", threshold: 15 },
  ]);
  const daily = calls.find((u) =>
    u.pathname.endsWith(":fetchMultiDailyMetricsTimeSeries"),
  )!;
  assert.equal(daily.searchParams.getAll("dailyMetrics").length, 8);
  assert.equal(daily.searchParams.get("dailyRange.end_date.day"), "2");
  assert.equal(
    calls.at(-1)?.searchParams.get("monthlyRange.start_month.month"),
    "9",
  );
  assert.ok(!JSON.stringify(result).includes("token"));
});
for (const [status, expected] of [
  [429, "PROVIDER_RATE_LIMITED"],
  [500, "PROVIDER_ERROR"],
  [403, "PERMISSION_DENIED"],
  [401, "UNAUTHENTICATED"],
  [404, "RESOURCE_NOT_FOUND"],
] as const)
  test(`performance maps ${status}`, async () => {
    const { provider } = setup(status);
    await provider.listLocations("123", { page: 1, pageSize: 25 }, context);
    await assert.rejects(
      provider.getPerformance("456", range, context),
      (e: unknown) => e instanceof AppException && e.code === expected,
    );
  });
test("empty response and connection/location authorization", async () => {
  const { provider, calls } = setup(200, true);
  const cold = await provider.getPerformance("456", range, context);
  assert.deepEqual(cold.daily, []);
  assert.ok(calls.some((url) => url.searchParams.get("readMask") === "name"));
  const before = calls.length;
  await assert.rejects(
    provider.getPerformance("456", range, { ...context, userId: "other" }),
  );
  await assert.rejects(
    provider.getPerformance("456", range, { ...context, accountIds: [] }),
  );
  assert.equal(calls.length, before);
  const result = await provider.getPerformance("456", range, context);
  assert.deepEqual(result.daily, []);
  assert.deepEqual(result.impressions, {});
});
test("validates actual calendar dates and ordered bounded ranges", () => {
  for (const input of [
    { startDate: "2026-02-30", endDate: "2026-03-01" },
    { startDate: range.endDate, endDate: range.startDate },
    { startDate: "2020-01-01", endDate: range.endDate },
  ])
    assert.equal(PerformanceRangeSchema.safeParse(input).success, false);
});

test("account overview requests daily metrics without monthly keyword calls", async () => {
  const { provider, calls } = setup();
  const result = await provider.getDailyPerformance("456", range, context);
  assert.equal(result.calls, 3);
  assert.ok(
    result.dailyMetrics?.some(
      (day) => day.date === range.startDate && day.calls === 3,
    ),
  );
  assert.deepEqual(result.searchKeywords, []);
  assert.equal(
    calls.filter(
      (url) => url.hostname === "businessprofileperformance.googleapis.com",
    ).length,
    1,
  );
  assert.ok(!calls.some((url) => url.pathname.includes("searchkeywords")));
});
