import { z } from "zod";
import {
  PerformanceRangeSchema,
  PerformanceSummarySchema,
} from "./performance";
export const OVERVIEW_METRICS = [
  "interactions",
  "searchViews",
  "mapsViews",
  "calls",
  "directions",
  "websiteClicks",
  "bookings",
] as const;
export type OverviewMetric = (typeof OVERVIEW_METRICS)[number];
const metric = z.number().int().nonnegative().safe().nullable();
export const OverviewMetricsSchema = z.object({
  interactions: metric,
  searchViews: metric,
  mapsViews: metric,
  calls: metric,
  directions: metric,
  websiteClicks: metric,
  bookings: metric,
});
export type OverviewMetrics = z.infer<typeof OverviewMetricsSchema>;
export const AccountPerformanceRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["READY", "EMPTY", "ERROR"]),
  errorCode: z
    .enum([
      "UNAUTHENTICATED",
      "SESSION_EXPIRED",
      "PERMISSION_DENIED",
      "VALIDATION_FAILED",
      "PROVIDER_RATE_LIMITED",
      "PROVIDER_ERROR",
      "RESOURCE_NOT_FOUND",
      "INTERNAL_ERROR",
    ])
    .nullable(),
  metrics: OverviewMetricsSchema,
  daily: z.array(OverviewMetricsSchema.extend({ date: z.iso.date() })).max(367),
});
export type AccountPerformanceRow = z.infer<typeof AccountPerformanceRowSchema>;
const page = z.object({
  page: z.number().int().positive(),
  pageToken: z.string().min(1).max(4096).optional(),
});
export const AccountPerformancePageSchema = z.object({
  accountId: z.string(),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  rows: z.array(AccountPerformanceRowSchema).max(10),
  totalLocations: z.number().int().nonnegative().nullable(),
  nextPage: page.nullable(),
  fetchedAt: z.iso.datetime(),
});
export type AccountPerformancePage = z.infer<
  typeof AccountPerformancePageSchema
>;
export type AccountPerformancePageParam = z.infer<typeof page>;
export const AccountPerformanceQuerySchema = z
  .object({
    startDate: z.string(),
    endDate: z.string(),
    page: z
      .preprocess(
        (value) =>
          typeof value === "string" && /^\d+$/.test(value)
            ? Number(value)
            : value,
        z.number().int().min(1).max(10000),
      )
      .default(1),
    pageToken: z.string().min(1).max(4096).optional(),
  })
  .strict()
  .refine(
    (value) =>
      PerformanceRangeSchema.safeParse({
        startDate: value.startDate,
        endDate: value.endDate,
      }).success,
    "Invalid date range",
  );
export const emptyOverviewMetrics = (): OverviewMetrics => ({
  interactions: null,
  searchViews: null,
  mapsViews: null,
  calls: null,
  directions: null,
  websiteClicks: null,
  bookings: null,
});
const sumAvailable = (...values: (number | undefined)[]) => {
  const available = values.filter(
    (value): value is number => value !== undefined,
  );
  return available.length
    ? available.reduce((sum, value) => sum + value, 0)
    : null;
};
export function overviewMetrics(
  summary: z.infer<typeof PerformanceSummarySchema>,
): OverviewMetrics {
  return {
    interactions: summary.daily.length
      ? summary.totalInteractions
      : sumAvailable(
          summary.calls,
          summary.directions,
          summary.websiteClicks,
          summary.bookings,
        ),
    searchViews: sumAvailable(
      summary.impressions.searchMobile,
      summary.impressions.searchDesktop,
    ),
    mapsViews: sumAvailable(
      summary.impressions.mapsMobile,
      summary.impressions.mapsDesktop,
    ),
    calls: summary.calls ?? null,
    directions: summary.directions ?? null,
    websiteClicks: summary.websiteClicks ?? null,
    bookings: summary.bookings ?? null,
  };
}
export function overviewDaily(
  summary: z.infer<typeof PerformanceSummarySchema>,
): AccountPerformanceRow["daily"] {
  if (!summary.dailyMetrics)
    return summary.daily.map((day) => ({
      ...emptyOverviewMetrics(),
      date: day.date,
      interactions: day.interactions,
    }));
  return summary.dailyMetrics.map((day) => ({
    date: day.date,
    interactions: sumAvailable(
      day.calls,
      day.directions,
      day.websiteClicks,
      day.bookings,
    ),
    searchViews: sumAvailable(day.searchMobile, day.searchDesktop),
    mapsViews: sumAvailable(day.mapsMobile, day.mapsDesktop),
    calls: day.calls ?? null,
    directions: day.directions ?? null,
    websiteClicks: day.websiteClicks ?? null,
    bookings: day.bookings ?? null,
  }));
}
