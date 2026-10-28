"use client";
import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  OVERVIEW_METRICS,
  PerformanceRangeSchema,
  type OverviewMetric,
  type PerformanceRange,
  type AccountPerformancePage,
} from "@gbp/contracts";
import { useLanguage } from "../lib/i18n";
import { useMe } from "../lib/auth";
import {
  accountPerformanceOptions,
  aggregateAccountPerformance,
  overviewRange,
  overviewSeries,
  sortOverviewRows,
} from "../lib/account-performance";
import { withConnection } from "../lib/google-connections";
import { ErrorState, EmptyState } from "./data-states";
import { TruncatedText } from "./truncated-text";
const metricLabels: Record<OverviewMetric, string> = {
  interactions: "Total interactions",
  searchViews: "Search views",
  mapsViews: "Maps views",
  calls: "Calls",
  directions: "Direction requests",
  websiteClicks: "Website clicks",
  bookings: "Bookings",
};
const errors: Record<string, string> = {
  PROVIDER_RATE_LIMITED: "Rate limited",
  PERMISSION_DENIED: "Access denied",
  UNAUTHENTICATED: "Reconnect required",
  RESOURCE_NOT_FOUND: "Location unavailable",
  PROVIDER_ERROR: "Unable to load performance",
  INTERNAL_ERROR: "Unable to load performance",
  SESSION_EXPIRED: "Session expired",
  VALIDATION_FAILED: "Invalid performance data",
};
export function AccountPerformanceOverview({
  accountId,
  connectionId,
}: {
  accountId: string;
  connectionId?: string;
}) {
  const { t } = useLanguage();
  const me = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const [initialRange] = useState(() => overviewRange());
  const parsed = PerformanceRangeSchema.safeParse({
    startDate: params.get("startDate"),
    endDate: params.get("endDate"),
  });
  const range = parsed.success ? parsed.data : initialRange;
  const [draft, setDraft] = useState(range);
  useEffect(() => {
    setDraft({ startDate: range.startDate, endDate: range.endDate });
  }, [range.startDate, range.endDate]);
  const query = useInfiniteQuery(
    accountPerformanceOptions(
      me.data?.id ?? "",
      connectionId,
      accountId,
      range,
    ),
  );
  const pages = query.data?.pages ?? [];
  const limited = pages.some((page) =>
    page.rows.some((row) => row.errorCode === "PROVIDER_RATE_LIMITED"),
  );
  useEffect(() => {
    if (query.hasNextPage && !query.isFetching && !query.isError && !limited)
      void query.fetchNextPage({ cancelRefetch: false });
  }, [
    query.hasNextPage,
    query.isFetching,
    query.isError,
    limited,
    query.fetchNextPage,
  ]);
  function apply(next: PerformanceRange) {
    if (!PerformanceRangeSchema.safeParse(next).success) return;
    setDraft(next);
    const search = new URLSearchParams(params.toString());
    search.set("view", "overview");
    search.set("startDate", next.startDate);
    search.set("endDate", next.endDate);
    router.replace(`?${search}`, { scroll: false });
  }
  const valid = PerformanceRangeSchema.safeParse(draft).success;
  return (
    <section
      className="account-overview"
      aria-label={t("Account performance overview")}
    >
      <form
        key={`${range.startDate}:${range.endDate}`}
        className="overview-controls card"
        onSubmit={(event) => {
          event.preventDefault();
          apply(draft);
        }}
      >
        <div className="overview-control-heading">
          <div>
            <h2>{t("Performance overview")}</h2>
            <p>{t("All locations in this management account")}</p>
          </div>
          <button
            type="button"
            disabled={query.isFetching || !query.data}
            onClick={() => {
              void query.refetch();
            }}
          >
            {t("Refresh data")}
          </button>
        </div>
        <div className="overview-date-controls">
          <div
            className="overview-presets"
            role="group"
            aria-label={t("Date range")}
          >
            {[7, 28, 90].map((days) => {
              const preset = overviewRange(days);
              return (
                <button
                  type="button"
                  key={days}
                  aria-pressed={
                    range.startDate === preset.startDate &&
                    range.endDate === preset.endDate
                  }
                  onClick={() => apply(preset)}
                >
                  {t(days === 90 ? "3 months" : "{count} days", {
                    count: days,
                  })}
                </button>
              );
            })}
          </div>
          <label>
            {t("Start date")}
            <input
              type="date"
              required
              value={draft.startDate}
              onChange={(event) =>
                setDraft({ ...draft, startDate: event.target.value })
              }
            />
          </label>
          <label>
            {t("End date")}
            <input
              type="date"
              required
              value={draft.endDate}
              onChange={(event) =>
                setDraft({ ...draft, endDate: event.target.value })
              }
            />
          </label>
          <button type="submit" disabled={!valid}>
            {t("Apply")}
          </button>
        </div>
        {!valid && (
          <p role="alert">
            {t("Select an ordered range of at most 367 days.")}
          </p>
        )}
      </form>
      {me.isError ? (
        <ErrorState error={me.error} />
      ) : query.isPending ? (
        <OverviewSkeleton />
      ) : (
        <>
          {query.isError && (
            <ErrorState
              error={query.error}
              onRetry={() => {
                void (query.isFetchNextPageError
                  ? query.fetchNextPage({ cancelRefetch: false })
                  : query.refetch());
              }}
            />
          )}
          {query.data && (
            <AccountOverviewReport
              key={`${range.startDate}:${range.endDate}`}
              pages={pages}
              range={range}
              connectionId={connectionId}
              loading={query.isFetching}
              complete={!pages.at(-1)?.nextPage}
            />
          )}
          {limited && (
            <div className="overview-incomplete" role="status">
              <p>
                {t(
                  "Google temporarily limited requests. Loaded results are preserved; refresh later to retry missing locations.",
                )}
              </p>
            </div>
          )}
          {query.data &&
            pages.at(-1)?.nextPage &&
            !query.hasNextPage &&
            !query.isFetching && (
              <p role="alert">
                {t(
                  "Location pagination could not continue. Refresh to retry; totals are incomplete.",
                )}
              </p>
            )}
        </>
      )}
    </section>
  );
}
export function AccountOverviewReport({
  pages,
  range,
  connectionId,
  loading = false,
  complete = true,
}: {
  pages: AccountPerformancePage[];
  range: PerformanceRange;
  connectionId?: string;
  loading?: boolean;
  complete?: boolean;
}) {
  const { t, language } = useLanguage();
  const aggregate = useMemo(() => aggregateAccountPerformance(pages), [pages]);
  const [metric, setMetric] = useState<OverviewMetric>("interactions");
  const [group, setGroup] = useState<"day" | "week" | "month">("day");
  const [sort, setSort] = useState<{
    key: OverviewMetric | "name";
    ascending: boolean;
  }>({ key: "interactions", ascending: false });
  const rows = sortOverviewRows(aggregate.rows, sort.key, sort.ascending);
  const points = overviewSeries(aggregate.daily, range, metric, group);
  const total = pages.at(-1)?.totalLocations ?? aggregate.rows.length;
  const lastFetched = pages.at(-1)?.fetchedAt;
  const format = (value: number | null) =>
    value === null
      ? "—"
      : value.toLocaleString(language === "vi" ? "vi-VN" : "en-US");
  function sortBy(key: typeof sort.key) {
    setSort({
      key,
      ascending: sort.key === key ? !sort.ascending : key === "name",
    });
  }
  if (!rows.length && complete && !loading)
    return (
      <EmptyState
        title={t("No locations yet")}
        message={t(
          "This Business account has no locations to display. Try choosing another account.",
        )}
      />
    );
  return (
    <div className="overview-report">
      <div className="overview-coverage" role="status">
        <div>
          <strong>
            {t("{ready} of {total} locations with data", {
              ready: aggregate.ready,
              total,
            })}
          </strong>
          <p>
            {t("{empty} without data · {failed} failed", {
              empty: aggregate.empty,
              failed: aggregate.failed,
            })}
            {!complete && ` · ${t("Partial results")}`}
            {loading && ` · ${t("Loading...")}`}
          </p>
        </div>
        {lastFetched && (
          <span>
            {t("Fetched at")}{" "}
            <time dateTime={lastFetched}>
              {new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-US", {
                dateStyle: "short",
                timeStyle: "short",
              }).format(new Date(lastFetched))}
            </time>
          </span>
        )}
      </div>
      <div
        className="overview-metric-grid"
        role="group"
        aria-label={t("Choose a chart metric")}
      >
        {OVERVIEW_METRICS.map((key) => (
          <button
            className="overview-metric card"
            type="button"
            key={key}
            aria-pressed={metric === key}
            onClick={() => setMetric(key)}
          >
            <span>{t(metricLabels[key])}</span>
            <strong>{format(aggregate.totals[key])}</strong>
            <small>
              {t("{count}/{total} locations reporting", {
                count: aggregate.coverage[key],
                total,
              })}
            </small>
          </button>
        ))}
      </div>
      <section
        className="overview-chart-card card"
        aria-label={t("Performance trend")}
      >
        <div className="overview-chart-heading">
          <div>
            <h3>{t(metricLabels[metric])}</h3>
            <p>
              {range.startDate} – {range.endDate}
            </p>
          </div>
          <label>
            <span className="sr-only">{t("Chart grouping")}</span>
            <select
              value={group}
              onChange={(event) => setGroup(event.target.value as typeof group)}
            >
              <option value="day">{t("Daily")}</option>
              <option value="week">{t("Weekly")}</option>
              <option value="month">{t("Monthly")}</option>
            </select>
          </label>
        </div>
        {points.some((point) => point.value !== null) ? (
          <>
            <OverviewChart
              points={points}
              label={t(metricLabels[metric])}
              group={group}
            />
            <details className="overview-chart-values">
              <summary>{t("View chart values")}</summary>
              <table>
                <thead>
                  <tr>
                    <th>{t("Date")}</th>
                    <th>{t(metricLabels[metric])}</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((point) => (
                    <tr key={point.date}>
                      <td>{point.date}</td>
                      <td>{format(point.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        ) : (
          <p className="overview-chart-empty">
            {t("No daily data available for this metric.")}
          </p>
        )}
        <p className="overview-note">
          {t(
            "Only reported data is included. Missing values are not counted as zero. Views are summed across locations and are not unique customers.",
          )}
        </p>
      </section>
      <section
        className="overview-location-card card"
        aria-label={t("Performance by location")}
      >
        <h3>{t("Performance by location")}</h3>
        <div
          className="overview-table-scroll"
          role="region"
          tabIndex={0}
          aria-label={t("Performance by location")}
        >
          <table className="overview-table">
            <thead>
              <tr>
                <th
                  scope="col"
                  aria-sort={
                    sort.key === "name"
                      ? sort.ascending
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    className="overview-sort"
                    type="button"
                    onClick={() => sortBy("name")}
                  >
                    {t("Location")}
                    {sort.key === "name" ? (sort.ascending ? " ↑" : " ↓") : ""}
                  </button>
                </th>
                {OVERVIEW_METRICS.map((key) => (
                  <th
                    scope="col"
                    key={key}
                    aria-sort={
                      sort.key === key
                        ? sort.ascending
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      className="overview-sort"
                      type="button"
                      onClick={() => sortBy(key)}
                    >
                      {t(metricLabels[key])}
                      {sort.key === key ? (sort.ascending ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
                <th scope="col">{t("Data status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    <Link
                      href={withConnection(
                        `/app/locations/${encodeURIComponent(row.id)}`,
                        connectionId,
                      )}
                    >
                      <TruncatedText text={row.name} />
                    </Link>
                  </th>
                  {OVERVIEW_METRICS.map((key) => (
                    <td key={key}>{format(row.metrics[key])}</td>
                  ))}
                  <td className="overview-row-status" data-status={row.status}>
                    {t(
                      row.status === "READY"
                        ? "Data available"
                        : row.status === "EMPTY"
                          ? "No performance data"
                          : (errors[row.errorCode ?? ""] ??
                            "Unable to load performance"),
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
function OverviewChart({
  points,
  label,
  group,
}: {
  points: { date: string; value: number | null }[];
  label: string;
  group: "day" | "week" | "month";
}) {
  const { language } = useLanguage();
  const width = Math.max(
    760,
    points.length * (group === "month" ? 80 : 48) + 80,
  );
  const maximum = Math.max(1, ...points.map((point) => point.value ?? 0));
  const x = (index: number) =>
    points.length === 1
      ? width / 2
      : 60 + (index * (width - 90)) / (points.length - 1);
  const y = (value: number) => 230 - (value * 190) / maximum;
  const segments: string[][] = [];
  let segment: string[] = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (point.value === null) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else segment.push(`${x(index)},${y(point.value)}`);
  }
  if (segment.length) segments.push(segment);
  return (
    <div
      className="performance-chart-scroll"
      role="region"
      tabIndex={0}
      aria-label={label}
    >
      <svg
        className="performance-chart"
        style={{ minWidth: width }}
        viewBox={`0 0 ${width} 280`}
        role="img"
        aria-label={label}
      >
        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1="60"
              x2={width - 30}
              y1={230 - fraction * 190}
              y2={230 - fraction * 190}
              stroke="var(--chart-grid)"
            />
            <text
              x="4"
              y={234 - fraction * 190}
              fontSize="12"
              fill="var(--text)"
            >
              {Math.round(maximum * fraction).toLocaleString(
                language === "vi" ? "vi-VN" : "en-US",
                { notation: "compact" },
              )}
            </text>
          </g>
        ))}
        {segments
          .filter((values) => values.length > 1)
          .map((values, index) => (
            <polyline
              key={index}
              points={values.join(" ")}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="3"
            />
          ))}
        {points.map((point, index) => (
          <g key={point.date}>
            {point.value !== null && (
              <circle
                cx={x(index)}
                cy={y(point.value)}
                r="4"
                fill="var(--accent)"
              >
                <title>{`${point.date}: ${point.value}`}</title>
              </circle>
            )}
            <line
              x1={x(index)}
              x2={x(index)}
              y1="230"
              y2="237"
              stroke="var(--chart-grid)"
            />
            <text
              x={x(index)}
              y="261"
              textAnchor="middle"
              fontSize="12"
              fill="var(--text)"
            >
              <title>{point.date}</title>
              {group === "month"
                ? `${point.date.slice(5, 7)}/${point.date.slice(0, 4)}`
                : `${point.date.slice(8, 10)}/${point.date.slice(5, 7)}`}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
function OverviewSkeleton() {
  const { t } = useLanguage();
  return (
    <div
      className="overview-loading"
      role="status"
      aria-label={t("Loading performance…")}
    >
      <span className="sr-only">{t("Loading performance…")}</span>
      <div className="overview-metric-grid" aria-hidden="true">
        {OVERVIEW_METRICS.map((metric) => (
          <div className="overview-metric card" key={metric}>
            <span className="skeleton skeleton-line" />
            <span className="skeleton performance-skeleton-value" />
          </div>
        ))}
      </div>
      <div className="card overview-chart-card" aria-hidden="true">
        <span className="skeleton performance-skeleton-chart" />
      </div>
    </div>
  );
}
