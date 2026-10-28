import { infiniteQueryOptions } from "@tanstack/react-query";
import {
  AccountPerformancePageSchema,
  OVERVIEW_METRICS,
  emptyOverviewMetrics,
  type AccountPerformancePage,
  type AccountPerformancePageParam,
  type AccountPerformanceRow,
  type OverviewMetric,
  type OverviewMetrics,
  type PerformanceRange,
} from "@gbp/contracts";
import { bffClient } from "./bff-client";
import { businessReadCacheOptions } from "./query-client";
export function accountPerformanceOptions(
  userId: string,
  connectionId: string | undefined,
  accountId: string,
  range: PerformanceRange,
) {
  return infiniteQueryOptions({
    queryKey: [
      "account-performance",
      userId,
      connectionId ?? null,
      accountId,
      range.startDate,
      range.endDate,
    ],
    enabled: !!userId,
    initialPageParam: { page: 1 } as AccountPerformancePageParam,
    queryFn: ({ signal, pageParam }) => {
      const query = new URLSearchParams({
        ...range,
        page: String(pageParam.page),
      });
      if (pageParam.pageToken) query.set("pageToken", pageParam.pageToken);
      if (connectionId) query.set("connectionId", connectionId);
      return bffClient.get(
        `/api/accounts/${encodeURIComponent(accountId)}/performance?${query}`,
        (value) => {
          const result = AccountPerformancePageSchema.parse(value);
          if (
            result.accountId !== accountId ||
            result.startDate !== range.startDate ||
            result.endDate !== range.endDate
          )
            throw new Error("Mismatched overview response");
          return result;
        },
        signal,
      );
    },
    getNextPageParam: (last, _pages, _lastParam, params) => {
      const next = last.nextPage;
      if (
        !next ||
        params.some((param) =>
          next.pageToken
            ? param.pageToken === next.pageToken
            : param.page === next.page,
        )
      )
        return undefined;
      return next;
    },
    ...businessReadCacheOptions,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
export function aggregateAccountPerformance(
  pages: readonly AccountPerformancePage[],
  selected?: ReadonlySet<string>,
) {
  const allRows = Array.from(
    new Map(
      pages.flatMap((page) => page.rows).map((row) => [row.id, row]),
    ).values(),
  );
  const rows = selected
    ? allRows.filter((row) => selected.has(row.id))
    : allRows;
  const totals = emptyOverviewMetrics();
  const coverage = Object.fromEntries(
    OVERVIEW_METRICS.map((metric) => [metric, 0]),
  ) as Record<OverviewMetric, number>;
  const daily = new Map<string, OverviewMetrics & { date: string }>();
  for (const row of rows) {
    if (row.status !== "READY") continue;
    for (const metric of OVERVIEW_METRICS) {
      const value = row.metrics[metric];
      if (value !== null) {
        totals[metric] = (totals[metric] ?? 0) + value;
        coverage[metric]++;
      }
    }
    for (const day of row.daily) {
      const entry = daily.get(day.date) ?? {
        ...emptyOverviewMetrics(),
        date: day.date,
      };
      for (const metric of OVERVIEW_METRICS)
        if (day[metric] !== null)
          entry[metric] = (entry[metric] ?? 0) + day[metric]!;
      daily.set(day.date, entry);
    }
  }
  return {
    allRows,
    rows,
    totals,
    coverage,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    ready: rows.filter((row) => row.status === "READY").length,
    empty: rows.filter((row) => row.status === "EMPTY").length,
    failed: rows.filter((row) => row.status === "ERROR").length,
  };
}
export function overviewSeries(
  daily: (OverviewMetrics & { date: string })[],
  range: PerformanceRange,
  metric: OverviewMetric,
  group: "day" | "week" | "month",
) {
  const points = new Map<string, number | null>();
  const data = new Map(daily.map((day) => [day.date, day[metric]]));
  for (
    let time = Date.parse(range.startDate);
    time <= Date.parse(range.endDate);
    time += 86400000
  ) {
    const date = new Date(time);
    const day = date.toISOString().slice(0, 10);
    if (group === "week")
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    if (group === "month") date.setUTCDate(1);
    const key = date.toISOString().slice(0, 10);
    const value = data.get(day);
    if (!points.has(key)) points.set(key, null);
    if (value != null) points.set(key, (points.get(key) ?? 0) + value);
  }
  return [...points].map(([date, value]) => ({ date, value }));
}
export function sortOverviewRows(
  rows: readonly AccountPerformanceRow[],
  metric: OverviewMetric | "name",
  ascending: boolean,
) {
  return [...rows].sort((a, b) => {
    if (metric === "name")
      return (ascending ? 1 : -1) * a.name.localeCompare(b.name);
    const left = a.metrics[metric];
    const right = b.metrics[metric];
    if (left === null && right === null) return a.name.localeCompare(b.name);
    if (left === null) return 1;
    if (right === null) return -1;
    return (
      (ascending ? 1 : -1) * (left - right) || a.name.localeCompare(b.name)
    );
  });
}
export function overviewRange(days = 28, now = new Date()): PerformanceRange {
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}
