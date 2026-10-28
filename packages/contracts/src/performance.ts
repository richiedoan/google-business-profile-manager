import { z } from "zod";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
export const PerformanceRangeSchema = z
  .object({ startDate: date, endDate: date })
  .strict()
  .refine(
    (v) =>
      v.startDate <= v.endDate &&
      Date.parse(v.endDate) - Date.parse(v.startDate) <= 366 * 86400000,
    "Select an ordered range of at most 367 days",
  );
const count = z.number().int().nonnegative().safe();
export const PerformanceSummarySchema = z.object({
  startDate: date,
  endDate: date,
  totalInteractions: count,
  daily: z.array(z.object({ date, interactions: count })),
  dailyMetrics: z
    .array(
      z.object({
        date,
        searchMobile: count.optional(),
        searchDesktop: count.optional(),
        mapsMobile: count.optional(),
        mapsDesktop: count.optional(),
        calls: count.optional(),
        directions: count.optional(),
        websiteClicks: count.optional(),
        bookings: count.optional(),
      }),
    )
    .max(367)
    .optional(),
  impressions: z.object({
    searchMobile: count.optional(),
    searchDesktop: count.optional(),
    mapsMobile: count.optional(),
    mapsDesktop: count.optional(),
  }),
  calls: count.optional(),
  directions: count.optional(),
  websiteClicks: count.optional(),
  bookings: count.optional(),
  searchKeywords: z.array(
    z.object({
      keyword: z.string(),
      impressions: count.optional(),
      threshold: count.optional(),
    }),
  ),
  keywordStartMonth: z.string(),
  keywordEndMonth: z.string(),
});
export type PerformanceRange = z.infer<typeof PerformanceRangeSchema>;
export type PerformanceSummary = z.infer<typeof PerformanceSummarySchema>;
