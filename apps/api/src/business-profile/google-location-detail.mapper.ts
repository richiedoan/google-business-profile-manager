import { z } from "zod";
import type { LocationDetail, LocationHoursPeriod } from "@gbp/contracts";

const text = z.string().optional();
const flag = z.boolean().optional();
const date = z.object({
  year: z.number().int().min(0).max(9999).optional(),
  month: z.number().int().min(0).max(12).optional(),
  day: z.number().int().min(0).max(31).optional(),
});
const time = z.object({
  hours: z.number().int().min(0).max(24).optional(),
  minutes: z.number().int().min(0).max(59).optional(),
  seconds: z.number().int().min(0).max(60).optional(),
  nanos: z.number().int().min(0).max(999999999).optional(),
});
const day = z
  .enum([
    "DAY_OF_WEEK_UNSPECIFIED",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
  ])
  .optional();
const period = z.object({
  openDay: day,
  openTime: time.optional(),
  closeDay: day,
  closeTime: time.optional(),
});
const category = z.object({
  name: text,
  displayName: text,
  serviceTypes: z
    .array(z.object({ serviceTypeId: text, displayName: text }))
    .optional(),
  moreHoursTypes: z
    .array(
      z.object({
        hoursTypeId: text,
        displayName: text,
        localizedDisplayName: text,
      }),
    )
    .optional(),
});
const metadataLabels = {
  hasGoogleUpdated: "Provider updates available",
  hasPendingEdits: "Pending edits",
  canDelete: "Can delete",
  canOperateLocalPost: "Can manage posts",
  canModifyServiceList: "Can modify services",
  canHaveFoodMenus: "Food menus available",
  canOperateHealthData: "Health data available",
  canOperateLodgingData: "Lodging data available",
  canHaveBusinessCalls: "Business calls available",
  hasVoiceOfMerchant: "Merchant control confirmed",
} as const;
export const googleLocationDetailFieldsSchema = z.object({
  languageCode: text,
  categories: z
    .object({
      primaryCategory: category.optional(),
      additionalCategories: z.array(category).optional(),
    })
    .optional(),
  phoneNumbers: z
    .object({
      primaryPhone: text,
      additionalPhones: z.array(z.string()).optional(),
    })
    .optional(),
  serviceArea: z
    .object({
      businessType: z
        .enum([
          "BUSINESS_TYPE_UNSPECIFIED",
          "CUSTOMER_LOCATION_ONLY",
          "CUSTOMER_AND_BUSINESS_LOCATION",
        ])
        .optional(),
      regionCode: text,
      places: z
        .object({
          placeInfos: z
            .array(z.object({ placeName: text, placeId: text }))
            .optional(),
        })
        .optional(),
    })
    .optional(),
  latlng: z
    .object({
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
    })
    .optional(),
  regularHours: z.object({ periods: z.array(period).optional() }).optional(),
  specialHours: z
    .object({
      specialHourPeriods: z
        .array(
          z.object({
            startDate: date.optional(),
            endDate: date.optional(),
            closed: flag,
            openTime: time.optional(),
            closeTime: time.optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  moreHours: z
    .array(z.object({ hoursTypeId: text, periods: z.array(period).optional() }))
    .optional(),
  openInfo: z
    .object({
      status: z
        .enum([
          "OPEN",
          "CLOSED_TEMPORARILY",
          "CLOSED_PERMANENTLY",
          "OPEN_FOR_BUSINESS_UNSPECIFIED",
        ])
        .optional(),
      canReopen: flag,
      openingDate: date.optional(),
    })
    .optional(),
  metadata: z
    .object({
      hasGoogleUpdated: flag,
      hasPendingEdits: flag,
      canDelete: flag,
      canOperateLocalPost: flag,
      canModifyServiceList: flag,
      canHaveFoodMenus: flag,
      canOperateHealthData: flag,
      canOperateLodgingData: flag,
      canHaveBusinessCalls: flag,
      hasVoiceOfMerchant: flag,
      placeId: text,
      duplicateLocation: text,
      mapsUri: text,
      newReviewUri: text,
    })
    .optional(),
  profile: z.object({ description: text }).optional(),
  labels: z.array(z.string()).optional(),
  serviceItems: z
    .array(
      z.object({
        structuredServiceItem: z
          .object({ serviceTypeId: text, description: text })
          .optional(),
        freeFormServiceItem: z
          .object({
            category: text,
            label: z
              .object({
                displayName: text,
                description: text,
                languageCode: text,
              })
              .optional(),
          })
          .optional(),
        price: z
          .object({
            currencyCode: text,
            units: z
              .string()
              .regex(/^-?\d+$/)
              .optional(),
            nanos: z.number().int().min(-999999999).max(999999999).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});
type GoogleFields = z.infer<typeof googleLocationDetailFieldsSchema>;
const pad = (value: number, width = 2) => String(value).padStart(width, "0");
function formatDate(value?: z.infer<typeof date>): string | null {
  if (!value || !(value.year || value.month || value.day)) return null;
  // Preserve partial dates without adding a day, month or year.
  return [
    value.year ? pad(value.year, 4) : "—",
    value.month ? pad(value.month) : "—",
    value.day ? pad(value.day) : "—",
  ].join("-");
}
function formatTime(value?: z.infer<typeof time>): string | null {
  if (!value) return null;
  // Protobuf numeric fields omitted within a present TimeOfDay represent zero.
  let result = `${pad(value.hours ?? 0)}:${pad(value.minutes ?? 0)}`;
  if (value.seconds || value.nanos) result += `:${pad(value.seconds ?? 0)}`;
  if (value.nanos) result += `.${pad(value.nanos, 9).replace(/0+$/, "")}`;
  return result;
}
function formatDay(value?: string): string | null {
  return !value || value === "DAY_OF_WEEK_UNSPECIFIED"
    ? null
    : value[0] + value.slice(1).toLowerCase();
}
function mapPeriod(value: z.infer<typeof period>): LocationHoursPeriod {
  return {
    openDay: formatDay(value.openDay),
    openTime: formatTime(value.openTime),
    closeDay: formatDay(value.closeDay),
    closeTime: formatTime(value.closeTime),
  };
}
function formatPrice(
  price: NonNullable<GoogleFields["serviceItems"]>[number]["price"],
): string | null {
  if (!price || (price.units === undefined && price.nanos === undefined))
    return null;
  const total =
    BigInt(price.units ?? "0") * 1_000_000_000n + BigInt(price.nanos ?? 0);
  const magnitude = total < 0n ? -total : total;
  const fraction = String(magnitude % 1_000_000_000n)
    .padStart(9, "0")
    .replace(/0+$/, "");
  const amount = `${total < 0n ? "-" : ""}${magnitude / 1_000_000_000n}${fraction ? `.${fraction}` : ""}`;
  return [price.currencyCode, amount].filter(Boolean).join(" ");
}
export function mapGoogleDetailFields(
  row: GoogleFields,
): z.infer<typeof import("@gbp/contracts").LocationDetailFieldsSchema> {
  const categories = [
    row.categories?.primaryCategory,
    ...(row.categories?.additionalCategories ?? []),
  ].filter((category) => category !== undefined);
  const categoryName = (id?: string) =>
    id
      ? (categories.find((category) => category.name === id)?.displayName ?? id)
      : null;
  const metadata: NonNullable<LocationDetail["metadata"]> = [];
  for (const [key, label] of Object.entries(metadataLabels)) {
    const value = row.metadata?.[key as keyof typeof metadataLabels];
    if (value !== undefined) metadata.push({ label, value });
  }
  for (const [label, value] of [
    ["Duplicate location", row.metadata?.duplicateLocation],
    ["Maps URL", row.metadata?.mapsUri],
    ["Review URL", row.metadata?.newReviewUri],
    ["Opening date", formatDate(row.openInfo?.openingDate)],
  ] as const) {
    if (value) metadata.push({ label, value });
  }
  if (row.openInfo?.canReopen !== undefined)
    metadata.push({ label: "Can reopen", value: row.openInfo.canReopen });
  return {
    additionalCategories: (row.categories?.additionalCategories ?? [])
      .map((category) => category.displayName ?? category.name)
      .filter((value): value is string => value !== undefined),
    languageCode: row.languageCode ?? null,
    additionalPhones: row.phoneNumbers?.additionalPhones ?? [],
    serviceArea: row.serviceArea
      ? {
          businessType:
            row.serviceArea.businessType === "CUSTOMER_LOCATION_ONLY"
              ? "Customer locations only"
              : row.serviceArea.businessType ===
                  "CUSTOMER_AND_BUSINESS_LOCATION"
                ? "Business and customer locations"
                : null,
          regionCode: row.serviceArea.regionCode ?? null,
          places: (row.serviceArea.places?.placeInfos ?? []).map((place) => ({
            name: place.placeName ?? null,
            placeId: place.placeId ?? null,
          })),
        }
      : null,
    coordinates: row.latlng
      ? {
          latitude: row.latlng.latitude ?? null,
          longitude: row.latlng.longitude ?? null,
        }
      : null,
    regularHours: (row.regularHours?.periods ?? []).map(mapPeriod),
    specialHours: (row.specialHours?.specialHourPeriods ?? []).map(
      (period) => ({
        startDate: formatDate(period.startDate),
        endDate: period.closed ? null : formatDate(period.endDate),
        closed: period.closed ?? null,
        openTime: period.closed ? null : formatTime(period.openTime),
        closeTime: period.closed ? null : formatTime(period.closeTime),
      }),
    ),
    moreHours: (row.moreHours ?? []).map((hours) => ({
      type:
        categories
          .flatMap((category) => category.moreHoursTypes ?? [])
          .find(
            (type) =>
              hours.hoursTypeId !== undefined &&
              type.hoursTypeId === hours.hoursTypeId,
          )?.localizedDisplayName ??
        categories
          .flatMap((category) => category.moreHoursTypes ?? [])
          .find(
            (type) =>
              hours.hoursTypeId !== undefined &&
              type.hoursTypeId === hours.hoursTypeId,
          )?.displayName ??
        hours.hoursTypeId ??
        null,
      periods: (hours.periods ?? []).map(mapPeriod),
    })),
    openStatus:
      row.openInfo?.status === "OPEN"
        ? "OPEN"
        : row.openInfo?.status === "CLOSED_TEMPORARILY"
          ? "TEMPORARILY_CLOSED"
          : row.openInfo?.status === "CLOSED_PERMANENTLY"
            ? "PERMANENTLY_CLOSED"
            : null,
    lastSyncedAt: null,
    placeId: row.metadata?.placeId ?? null,
    metadata,
    description: row.profile?.description ?? null,
    labels: row.labels ?? [],
    serviceItems: (row.serviceItems ?? []).map((item) => ({
      name:
        item.freeFormServiceItem?.label?.displayName ??
        categories
          .flatMap((category) => category.serviceTypes ?? [])
          .find(
            (type) =>
              item.structuredServiceItem?.serviceTypeId !== undefined &&
              type.serviceTypeId === item.structuredServiceItem.serviceTypeId,
          )?.displayName ??
        item.structuredServiceItem?.serviceTypeId ??
        null,
      description:
        item.freeFormServiceItem?.label?.description ??
        item.structuredServiceItem?.description ??
        null,
      category: categoryName(item.freeFormServiceItem?.category),
      languageCode: item.freeFormServiceItem?.label?.languageCode ?? null,
      price: formatPrice(item.price),
    })),
  };
}
