import { z } from "zod";
export type LocationStatus =
  "OPEN" | "TEMPORARILY_CLOSED" | "PERMANENTLY_CLOSED";
export type VerificationStatus = "VERIFIED" | "PENDING" | "UNKNOWN";
export interface LocationSummary {
  id: string;
  accountId: string;
  name: string;
  formattedAddress: string;
  status: LocationStatus;
  storeCode?: string | null;
  primaryCategory?: string | null;
  providerState?: "READ" | "MOCK";
  /** Provider capability; application role and write-disable flag still apply. */
  editable?: boolean;
  verificationStatus?: VerificationStatus;
}
/** Provider-independent detail fields; absent values remain absent or null. */
const nullableText = z.string().nullable();
export const LocationHoursPeriodSchema = z.object({
  openDay: nullableText,
  openTime: nullableText,
  closeDay: nullableText,
  closeTime: nullableText,
});
export type LocationHoursPeriod = z.infer<typeof LocationHoursPeriodSchema>;
export const LocationDetailFieldsSchema = z.object({
  additionalCategories: z.array(z.string()).optional(),
  languageCode: nullableText.optional(),
  additionalPhones: z.array(z.string()).optional(),
  serviceArea: z
    .object({
      businessType: nullableText,
      regionCode: nullableText,
      places: z.array(z.object({ name: nullableText, placeId: nullableText })),
    })
    .nullable()
    .optional(),
  coordinates: z
    .object({
      latitude: z.number().min(-90).max(90).nullable(),
      longitude: z.number().min(-180).max(180).nullable(),
    })
    .nullable()
    .optional(),
  regularHours: z.array(LocationHoursPeriodSchema).optional(),
  specialHours: z
    .array(
      z.object({
        startDate: nullableText,
        endDate: nullableText,
        closed: z.boolean().nullable(),
        openTime: nullableText,
        closeTime: nullableText,
      }),
    )
    .optional(),
  moreHours: z
    .array(
      z.object({
        type: nullableText,
        periods: z.array(LocationHoursPeriodSchema),
      }),
    )
    .optional(),
  /** Unlike the legacy summary status, null means the provider did not specify a state. */
  openStatus: z
    .enum(["OPEN", "TEMPORARILY_CLOSED", "PERMANENTLY_CLOSED"])
    .nullable()
    .optional(),
  lastSyncedAt: z.iso.datetime().nullable().optional(),
  placeId: nullableText.optional(),
  metadata: z
    .array(
      z.object({
        label: z.string(),
        value: z.union([z.string(), z.boolean()]),
      }),
    )
    .optional(),
  description: nullableText.optional(),
  labels: z.array(z.string()).optional(),
  serviceItems: z
    .array(
      z.object({
        name: nullableText,
        description: nullableText,
        category: nullableText,
        languageCode: nullableText,
        price: nullableText,
      }),
    )
    .optional(),
});
export interface LocationDetail
  extends LocationSummary, z.infer<typeof LocationDetailFieldsSchema> {
  verificationStatus: VerificationStatus;
  websiteUrl: string | null;
  primaryPhone: string | null;
}
export interface PaginatedResult<T> {
  items: T[];
  total: number | null;
  nextPageToken?: string | null;
  page: number;
  pageSize: number;
}
/** Pages are one-based; parsing, limits, and validation belong to the API. */
export interface LocationQuery {
  page: number;
  pageSize: number;
  pageToken?: string;
  search?: string;
  status?: LocationStatus;
}
export const WEEK_DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;
const TimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm time.");
const PhoneSchema = z
  .string()
  .trim()
  .regex(/^(?=.*[0-9])\+?[0-9 ()-]{3,30}$/);
export const LabelSchema = z.string().trim().min(1).max(50);
const unique = (values: string[]) => new Set(values).size === values.length;
const RegularPeriodSchema = z
  .strictObject({
    openDay: z.enum(WEEK_DAYS),
    openTime: TimeSchema,
    closeDay: z.enum(WEEK_DAYS),
    closeTime: TimeSchema,
  })
  .refine(
    (p) => p.openDay !== p.closeDay || p.openTime < p.closeTime,
    "Closing time must follow opening time.",
  );
const DateSchema = z.iso.date();
const SpecialPeriodSchema = z
  .strictObject({
    startDate: DateSchema,
    endDate: DateSchema,
    closed: z.boolean(),
    openTime: TimeSchema.nullable(),
    closeTime: TimeSchema.nullable(),
  })
  .refine(
    (p) =>
      p.endDate >= p.startDate &&
      (p.closed
        ? p.openTime === null && p.closeTime === null
        : p.openTime !== null &&
          p.closeTime !== null &&
          (p.endDate > p.startDate || p.openTime < p.closeTime)),
    "Enter a valid date and opening/closing times.",
  );
const minutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};
const noOverlap = (intervals: { start: number; end: number }[]) => {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  return sorted.every(
    (p, index) => index === 0 || sorted[index - 1].end <= p.start,
  );
};
const RegularHoursSchema = z
  .array(RegularPeriodSchema)
  .max(100)
  .refine((periods) => {
    const week = 7 * 1440;
    const intervals = periods.flatMap((p) => {
      const start = WEEK_DAYS.indexOf(p.openDay) * 1440 + minutes(p.openTime);
      let end = WEEK_DAYS.indexOf(p.closeDay) * 1440 + minutes(p.closeTime);
      if (end <= start) end += week;
      return end > week
        ? [
            { start, end: week },
            { start: 0, end: end - week },
          ]
        : [{ start, end }];
    });
    return noOverlap(intervals);
  }, "Regular hours must not overlap.");
const SpecialHoursSchema = z
  .array(SpecialPeriodSchema)
  .max(100)
  .refine(
    (periods) =>
      noOverlap(
        periods.map((p) => ({
          start:
            Date.parse(p.startDate) / 60000 +
            (p.closed ? 0 : minutes(p.openTime ?? "00:00")),
          end:
            Date.parse(p.endDate) / 60000 +
            (p.closed ? 1440 : minutes(p.closeTime ?? "00:00")),
        })),
      ),
    "Special hours must not overlap, including closed-day overrides.",
  );
const ServiceItemSchema = z.strictObject({
  name: z.string().trim().min(1).max(300),
  description: z.string().trim().max(750).nullable(),
  category: z.string().trim().max(300).nullable(),
  languageCode: z.string().trim().max(35).nullable(),
  price: z.string().trim().max(100).nullable(),
});
/** Supported normalized write fields; null clears a scalar value. */
export const UpdateLocationInputSchema = z
  .strictObject({
    websiteUrl: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      }, "Enter an HTTP or HTTPS website without credentials.")
      .nullable()
      .optional(),
    additionalPhones: z.array(PhoneSchema).max(2).optional(),
    regularHours: RegularHoursSchema.optional(),
    specialHours: SpecialHoursSchema.optional(),
    description: z.string().trim().max(750).nullable().optional(),
    labels: z
      .array(LabelSchema)
      .max(10)
      .refine(unique, "Labels must be unique.")
      .optional(),
    serviceItems: z.array(ServiceItemSchema).max(100).optional(),
    primaryPhone: z
      .string()
      .trim()
      .regex(
        /^(?=.*[0-9])\+?[0-9 ()-]{3,30}$/,
        "Enter a phone number using digits, spaces, +, parentheses or hyphens.",
      )
      .nullable()
      .optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    "Provide at least one editable field.",
  );
export type UpdateLocationInput = z.infer<typeof UpdateLocationInputSchema>;
