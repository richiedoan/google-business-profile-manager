"use client";

import { useLanguage } from "../lib/i18n";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PerformanceRangeSchema,
  type PerformanceSummary,
} from "@gbp/contracts";
import { performanceOptions } from "../lib/performance";
import { useMe } from "../lib/auth";
import { EmptyState, ErrorState } from "./data-states";
export function PerformanceTab({
  locationId,
  connectionId,
}: {
  locationId: string;
  connectionId?: string;
}) {
  const { t } = useLanguage();
  const me = useMe();
  const [range, setRange] = useState(() => {
    const end = new Date();
    end.setUTCDate(end.getUTCDate() - 1);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 29);
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    };
  });
  const [draft, setDraft] = useState(range);
  const valid = PerformanceRangeSchema.safeParse(draft).success;
  const query = useQuery(
    performanceOptions(me.data?.id ?? "", connectionId, locationId, range),
  );
  return (
    <section className="performance" aria-label={t("Location performance")}>
      <form
        className="performance-range card"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) setRange({ ...draft });
        }}
      >
        <div className="performance-range-heading">
          <h2>{t("Performance")}</h2>
          <p>
            {t("Explore how customers find and interact with your business.")}
          </p>
        </div>
        <label>
          {" "}
          {t("Start date")}{" "}
          <input
            type="date"
            required
            value={draft.startDate}
            onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
          />
        </label>
        <label>
          {" "}
          {t("End date")}{" "}
          <input
            type="date"
            required
            value={draft.endDate}
            onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
          />
        </label>
        <button type="submit" disabled={!valid}>
          {" "}
          {t("Apply")}{" "}
        </button>
        {!valid && (
          <p role="alert">
            {t("Select an ordered range of at most 367 days.")}
          </p>
        )}
      </form>
      {me.isError ? (
        <ErrorState error={me.error} />
      ) : (
        <PerformanceState
          pending={query.isPending}
          error={query.isError ? query.error : undefined}
          data={query.data}
          onRetry={() => {
            void query.refetch();
          }}
        />
      )}
    </section>
  );
}
export function PerformanceState({
  pending,
  error,
  data,
  onRetry,
}: {
  pending: boolean;
  error?: unknown;
  data?: PerformanceSummary;
  onRetry?: () => void;
}) {
  if (pending) return <PerformanceSkeleton />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!data) return null;
  return (
    <div className="performance-report content-enter">
      <PerformanceReport data={data} />
    </div>
  );
}
export function PerformanceSkeleton() {
  const { t } = useLanguage();
  return (
    <div role="status" aria-label={t("Loading performance…")}>
      <span className="sr-only">{t("Loading performance…")}</span>
      <div
        className="performance-report"
        data-loading="true"
        aria-hidden="true"
      >
        <div className="performance-metrics card">
          {[0, 1, 2, 3, 4].map((metric) => (
            <article
              key={metric}
              className={
                metric === 0 ? "performance-total" : "performance-metric"
              }
            >
              <span className="skeleton skeleton-line" />
              <span className="skeleton performance-skeleton-value" />
              {metric === 0 && <span className="skeleton skeleton-short" />}
            </article>
          ))}
        </div>
        <section className="card performance-trend">
          <div className="detail-card-heading">
            <span className="skeleton skeleton-heading" />
          </div>
          <span className="skeleton performance-skeleton-chart" />
          <span className="skeleton skeleton-short" />
        </section>
        <div className="performance-support">
          {[0, 1].map((section) => (
            <section className="card" key={section}>
              <div className="detail-card-heading">
                <span className="skeleton skeleton-heading" />
              </div>
              {[0, 1, 2].map((row) => (
                <div className="performance-skeleton-row" key={row}>
                  {[0, 1, 2].map((column) => (
                    <span className="skeleton skeleton-line" key={column} />
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
export function PerformanceReport({ data }: { data: PerformanceSummary }) {
  const { t } = useLanguage();
  const metrics = [
    [t("Calls"), data.calls],
    [t("Direction requests"), data.directions],
    [t("Website clicks"), data.websiteClicks],
    ...(data.bookings === undefined ? [] : [[t("Bookings"), data.bookings]]),
  ] as Array<[string, number | undefined]>;
  const empty =
    !data.daily.length &&
    !Object.keys(data.impressions).length &&
    !data.searchKeywords.length;
  const max = Math.max(1, ...data.daily.map((d) => d.interactions));
  const startTime = Date.parse(data.startDate);
  const endTime = Date.parse(data.endDate);
  const dayCount = Math.round((endTime - startTime) / 86400000) + 1;
  const chartWidth = Math.max(640, dayCount * 52 + 80);
  const dateX = (time: number) =>
    dayCount === 1
      ? (chartWidth + 20) / 2
      : 50 + ((time - startTime) * (chartWidth - 80)) / (endTime - startTime);
  const dates = Array.from({ length: dayCount }, (_, index) =>
    new Date(startTime + index * 86400000).toISOString().slice(0, 10),
  );
  const point = (i: number, v: number) =>
    `${dateX(Date.parse(data.daily[i].date))},${250 - (v * 210) / max}`;
  return (
    <>
      {empty && (
        <EmptyState
          title={t("No performance data")}
          message={t(
            "No metrics are available for this location and date range. Try another date range.",
          )}
        />
      )}
      {!empty && (
        <div className="performance-metrics card">
          <article className="performance-total">
            <h2>{t("Total interactions")}</h2>
            <strong data-unavailable={!data.daily.length}>
              {data.daily.length
                ? data.totalInteractions.toLocaleString()
                : t("Unavailable")}
            </strong>
            <p>
              {data.startDate} – {data.endDate}
            </p>
            <small>
              {" "}
              {t(
                "Available calls, directions, website clicks and bookings.",
              )}{" "}
            </small>
          </article>
          {metrics.map(([label, value]) => (
            <article className="performance-metric" key={label}>
              <h3>{label}</h3>
              <strong data-unavailable={value === undefined}>
                {value === undefined
                  ? t("Unavailable")
                  : value.toLocaleString()}
              </strong>
            </article>
          ))}
        </div>
      )}
      {!empty && (
        <section className="card performance-trend">
          <div className="detail-card-heading">
            <div>
              <h2>{t("Daily interactions")}</h2>
              <p>{t("Customer activity over the selected period")}</p>
            </div>
            <span className="chart-legend">
              <i aria-hidden="true" /> {t("Interactions")}{" "}
            </span>
          </div>
          {data.daily.length ? (
            <>
              <div
                className="performance-chart-scroll"
                tabIndex={0}
                role="region"
                aria-label={t("Daily interactions")}
              >
                <svg
                  className="performance-chart"
                  style={{ minWidth: chartWidth }}
                  viewBox={`0 0 ${chartWidth} 290`}
                  role="img"
                  aria-label={t("Daily interactions from {start} to {end}", {
                    start: data.startDate,
                    end: data.endDate,
                  })}
                >
                  {[0, 0.5, 1].map((f) => (
                    <g key={f}>
                      <line
                        x1="50"
                        x2={chartWidth - 30}
                        y1={250 - f * 210}
                        y2={250 - f * 210}
                        stroke="var(--chart-grid)"
                      />
                      <text
                        x="5"
                        y={254 - f * 210}
                        fontSize="14"
                        fill="var(--text)"
                      >
                        {Math.round(max * f)}
                      </text>
                    </g>
                  ))}
                  <polyline
                    points={data.daily
                      .map((d, i) => point(i, d.interactions))
                      .join(" ")}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="4"
                  />
                  {data.daily.map((d, i) => (
                    <circle
                      key={d.date}
                      cx={Number(point(i, d.interactions).split(",")[0])}
                      cy={250 - (d.interactions * 210) / max}
                      r="3"
                      fill="var(--accent)"
                    >
                      <title>{`${d.date}: ${d.interactions}`}</title>
                    </circle>
                  ))}
                  {dates.map((date) => (
                    <g key={date}>
                      <line
                        x1={dateX(Date.parse(date))}
                        x2={dateX(Date.parse(date))}
                        y1="250"
                        y2="258"
                        stroke="var(--chart-grid)"
                      />
                      <text
                        x={dateX(Date.parse(date))}
                        y="282"
                        textAnchor="middle"
                        fontSize="13"
                        fill="var(--text)"
                      >
                        <title>{date}</title>
                        {`${date.slice(8, 10)}/${date.slice(5, 7)}`}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>
              <details className="performance-daily-values">
                <summary>{t("View daily values")}</summary>
                <table className="performance-table">
                  <thead>
                    <tr>
                      <th>{t("Date")}</th>
                      <th>{t("Interactions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.daily.map((d) => (
                      <tr key={d.date}>
                        <td>{d.date}</td>
                        <td>{d.interactions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
              <p className="performance-note">
                {" "}
                {t(
                  "Only reported dates and available interaction metrics are included.",
                )}{" "}
              </p>
            </>
          ) : (
            <p>{t("No daily interaction data available.")}</p>
          )}
        </section>
      )}
      {!empty && (
        <div className="performance-support">
          <section className="card performance-breakdown">
            <div className="detail-card-heading">
              <div>
                <h2>{t("Profile impressions")}</h2>
                <p>{t("By platform and device")}</p>
              </div>
            </div>
            <table className="performance-table">
              <thead>
                <tr>
                  <th>{t("Platform")}</th>
                  <th>{t("Mobile")}</th>
                  <th>{t("Desktop")}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    t("Search"),
                    data.impressions.searchMobile,
                    data.impressions.searchDesktop,
                  ],
                  [
                    t("Maps"),
                    data.impressions.mapsMobile,
                    data.impressions.mapsDesktop,
                  ],
                ].map(([name, mobile, desktop]) => (
                  <tr key={name}>
                    <th scope="row">{name}</th>
                    <td>{mobile?.toLocaleString() ?? t("Unavailable")}</td>
                    <td>{desktop?.toLocaleString() ?? t("Unavailable")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card performance-keywords">
            <div className="detail-card-heading">
              <h2>{t("Search keywords")}</h2>
              <span className="detail-period">
                {data.keywordStartMonth} – {data.keywordEndMonth}
              </span>
            </div>
            <p className="performance-note">
              {" "}
              {t("Monthly impressions:")} {data.keywordStartMonth} –{" "}
              {data.keywordEndMonth}
              {t(
                ". Includes whole months overlapping the selected dates. Thresholds are not exact counts.",
              )}{" "}
            </p>
            {data.searchKeywords.length ? (
              <div className="table-scroll">
                <table className="performance-table">
                  <thead>
                    <tr>
                      <th>{t("Rank")}</th>
                      <th>{t("Keyword")}</th>
                      <th>{t("Impressions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.searchKeywords.map((k, i) => (
                      <tr key={`${k.keyword}-${i}`}>
                        <td>{k.impressions === undefined ? "—" : i + 1}</td>
                        <td>{k.keyword}</td>
                        <td>
                          {k.impressions?.toLocaleString() ??
                            (k.threshold === undefined
                              ? t("Unavailable")
                              : `< ${k.threshold.toLocaleString()}`)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>{t("No search keyword data available.")}</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
