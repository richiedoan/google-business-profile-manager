import { z } from "zod";
import {
  UpdateLocationInputSchema,
  LabelSchema,
  type LocationStatus,
} from "./locations";
export const MAX_BULK_LOCATION_IDS = 100;
const base = {
  accountId: z.string().min(1),
  selection: z.strictObject({
    kind: z.literal("EXPLICIT_IDS"),
    locationIds: z
      .array(z.string().min(1))
      .min(1)
      .max(MAX_BULK_LOCATION_IDS)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Location IDs must be unique.",
      ),
  }),
};
const fields = UpdateLocationInputSchema.shape;
export const BulkLocationCommandSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    ...base,
    operation: z.literal("SET_WEBSITE"),
    websiteUrl: fields.websiteUrl.unwrap(),
  }),
  z.strictObject({
    ...base,
    operation: z.literal("SET_PHONE"),
    primaryPhone: fields.primaryPhone.unwrap(),
    additionalPhones: fields.additionalPhones.unwrap(),
  }),
  z.strictObject({
    ...base,
    operation: z.literal("SET_REGULAR_HOURS"),
    regularHours: fields.regularHours.unwrap(),
  }),
  z.strictObject({
    ...base,
    operation: z.literal("SET_SPECIAL_HOURS"),
    specialHours: fields.specialHours.unwrap(),
  }),
  z.strictObject({
    ...base,
    operation: z.literal("SET_DESCRIPTION"),
    description: fields.description.unwrap(),
  }),
  z
    .strictObject({
      ...base,
      operation: z.literal("UPDATE_LABELS"),
      add: z.array(LabelSchema).max(10),
      remove: z.array(LabelSchema).max(10),
    })
    .refine(
      (v) =>
        v.add.length + v.remove.length > 0 &&
        !v.add.some((label) => v.remove.includes(label)),
      "Choose labels to add or remove, without overlap.",
    ),
  z.strictObject({
    ...base,
    operation: z.literal("SET_SERVICE_ITEMS"),
    serviceItems: fields.serviceItems.unwrap(),
  }),
]);
export type BulkLocationCommand = z.infer<typeof BulkLocationCommandSchema>;
export const BulkLocationResultSchema = z.object({
  totalSelected: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  results: z.array(
    z.discriminatedUnion("success", [
      z.object({ locationId: z.string(), success: z.literal(true) }),
      z.object({
        locationId: z.string(),
        success: z.literal(false),
        reason: z.string(),
      }),
    ]),
  ),
});
export type BulkLocationResult = z.infer<typeof BulkLocationResultSchema>;
/** Phase 2 design placeholder; deliberately NOT accepted by BulkLocationCommandSchema.
 * Must define server-side scope, snapshot timing, exclusions, and job semantics before execution.
 */
export interface FutureMatchingLocationSelection {
  kind: "ALL_MATCHING_FILTER";
  filter: { search?: string; status?: LocationStatus };
  excludedLocationIds: string[];
}
