import { z } from "zod";
import {
  PerformanceSummarySchema,
  type PerformanceRange,
  type PerformanceSummary,
} from "@gbp/contracts";
import { AppException } from "../errors/app.exception";
const metrics = {
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "searchMobile",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "searchDesktop",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "mapsMobile",
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "mapsDesktop",
  CALL_CLICKS: "calls",
  WEBSITE_CLICKS: "websiteClicks",
  BUSINESS_DIRECTION_REQUESTS: "directions",
  BUSINESS_BOOKINGS: "bookings",
} as const;
const integer = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().nonnegative().safe());
const dailyDto = z.object({
  multiDailyMetricTimeSeries: z
    .array(
      z.object({
        dailyMetricTimeSeries: z
          .array(
            z.object({
              dailyMetric: z.enum(
                Object.keys(metrics) as [
                  keyof typeof metrics,
                  ...Array<keyof typeof metrics>,
                ],
              ),
              timeSeries: z
                .object({
                  datedValues: z
                    .array(
                      z.object({
                        date: z.object({
                          year: z.number().int(),
                          month: z.number().int(),
                          day: z.number().int(),
                        }),
                        value: integer.optional(),
                      }),
                    )
                    .optional(),
                })
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});
const keywordsDto = z.object({
  searchKeywordsCounts: z
    .array(
      z.object({
        searchKeyword: z.string(),
        insightsValue: z
          .object({ value: integer.optional(), threshold: integer.optional() })
          .refine(
            (v) => (v.value !== undefined) !== (v.threshold !== undefined),
          ),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
});
type Reader = <T>(url: URL, schema: z.ZodType<T>) => Promise<T>;
export class GooglePerformanceProvider {
  constructor(private readonly get: Reader) {}
  async getPerformance(
    id: string,
    range: PerformanceRange,
    includeKeywords = true,
  ): Promise<PerformanceSummary> {
    const base = `https://businessprofileperformance.googleapis.com/v1/locations/${id}`;
    const url = new URL(`${base}:fetchMultiDailyMetricsTimeSeries`);
    for (const metric of Object.keys(metrics))
      url.searchParams.append("dailyMetrics", metric);
    for (const [side, date] of [
      ["start_date", range.startDate],
      ["end_date", range.endDate],
    ]) {
      const parts = date.split("-");
      ["year", "month", "day"].forEach((part, i) =>
        url.searchParams.set(
          `dailyRange.${side}.${part}`,
          String(Number(parts[i])),
        ),
      );
    }
    const body = await this.get(url, dailyDto);
    const result: PerformanceSummary = {
      ...range,
      totalInteractions: 0,
      daily: [],
      dailyMetrics: [],
      impressions: {},
      searchKeywords: [],
      keywordStartMonth: range.startDate.slice(0, 7),
      keywordEndMonth: range.endDate.slice(0, 7),
    };
    const days = new Map<string, number>();
    const breakdown = new Map<
      string,
      NonNullable<PerformanceSummary["dailyMetrics"]>[number]
    >();
    const seen = new Set<string>();
    for (const group of body.multiDailyMetricTimeSeries ?? [])
      for (const series of group.dailyMetricTimeSeries ?? []) {
        if (seen.has(series.dailyMetric))
          throw new AppException("PROVIDER_ERROR");
        seen.add(series.dailyMetric);
        const key = metrics[series.dailyMetric];
        const impression =
          key === "searchMobile" ||
          key === "searchDesktop" ||
          key === "mapsMobile" ||
          key === "mapsDesktop";
        let total = 0;
        let hasInRangeValues = false;
        const dates = new Set<string>();
        for (const point of series.timeSeries?.datedValues ?? []) {
          const date = `${point.date.year}-${String(point.date.month).padStart(2, "0")}-${String(point.date.day).padStart(2, "0")}`;
          if (
            Number.isNaN(Date.parse(date)) ||
            new Date(date).toISOString().slice(0, 10) !== date ||
            dates.has(date)
          )
            throw new AppException("PROVIDER_ERROR");
          dates.add(date);
          if (date < range.startDate || date > range.endDate) continue;
          hasInRangeValues = true;
          const value = point.value ?? 0;
          const day = breakdown.get(date) ?? { date };
          day[key] = value;
          breakdown.set(date, day);
          total += value;
          if (!impression) days.set(date, (days.get(date) ?? 0) + value);
        }
        if (!hasInRangeValues) continue;
        if (impression) result.impressions[key] = total;
        else {
          result[key] = total;
          result.totalInteractions += total;
        }
      }
    result.daily = [...days]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, interactions]) => ({ date, interactions }));
    result.dailyMetrics = [...breakdown.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    if (!includeKeywords) {
      const parsed = PerformanceSummarySchema.safeParse(result);
      if (!parsed.success) throw new AppException("PROVIDER_ERROR");
      return parsed.data;
    }
    const keywordUrl = new URL(`${base}/searchkeywords/impressions/monthly`);
    for (const [side, date] of [
      ["start_month", range.startDate],
      ["end_month", range.endDate],
    ]) {
      const [year, month] = date.split("-");
      keywordUrl.searchParams.set(
        `monthlyRange.${side}.year`,
        String(Number(year)),
      );
      keywordUrl.searchParams.set(
        `monthlyRange.${side}.month`,
        String(Number(month)),
      );
    }
    keywordUrl.searchParams.set("pageSize", "100");
    const tokens = new Set<string>();
    for (let page = 0; ; page++) {
      if (page >= 1000) throw new AppException("PROVIDER_ERROR");
      const keywords = await this.get(keywordUrl, keywordsDto);
      result.searchKeywords.push(
        ...(keywords.searchKeywordsCounts ?? []).map((row) => ({
          keyword: row.searchKeyword,
          ...(row.insightsValue.value !== undefined
            ? { impressions: row.insightsValue.value }
            : { threshold: row.insightsValue.threshold }),
        })),
      );
      if (!keywords.nextPageToken) break;
      if (tokens.has(keywords.nextPageToken))
        throw new AppException("PROVIDER_ERROR");
      tokens.add(keywords.nextPageToken);
      keywordUrl.searchParams.set("pageToken", keywords.nextPageToken);
    }
    result.searchKeywords.sort(
      (a, b) =>
        (b.impressions ?? -1) - (a.impressions ?? -1) ||
        a.keyword.localeCompare(b.keyword),
    );
    const parsed = PerformanceSummarySchema.safeParse(result);
    if (!parsed.success) throw new AppException("PROVIDER_ERROR");
    return parsed.data;
  }
}
