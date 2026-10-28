import { z } from "zod";

export const ContentKindSchema = z.enum(["media", "posts", "reviews"]);
export type ContentKind = z.infer<typeof ContentKindSchema>;
export const ResourceIdSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);
export const PublicUrlSchema = z
  .url()
  .max(4096)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Use a public HTTPS URL.");
const date = z.iso.date();
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const PhotoCategorySchema = z.enum([
  "ADDITIONAL",
  "COVER",
  "PROFILE",
  "EXTERIOR",
  "INTERIOR",
  "AT_WORK",
  "FOOD_AND_DRINK",
  "MENU",
  "PRODUCT",
  "TEAMS",
]);
export const PostDraftSchema = z
  .object({
    summary: z.string().trim().min(1).max(1500),
    languageCode: z.string().min(2).max(20),
    topicType: z.enum(["STANDARD", "EVENT", "OFFER"]),
    imageUrl: PublicUrlSchema.nullable(),
    actionType: z.enum([
      "NONE",
      "BOOK",
      "ORDER",
      "SHOP",
      "LEARN_MORE",
      "SIGN_UP",
      "CALL",
    ]),
    actionUrl: PublicUrlSchema.nullable(),
    event: z
      .object({
        title: z.string().trim().min(1).max(58),
        startDate: date,
        endDate: date,
        startTime: time,
        endTime: time,
      })
      .strict()
      .nullable(),
    offer: z
      .object({
        couponCode: z.string().max(100),
        redeemOnlineUrl: PublicUrlSchema.nullable(),
        termsConditions: z.string().max(5000),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((draft, ctx) => {
    if (draft.topicType !== "STANDARD" && !draft.event)
      ctx.addIssue({
        code: "custom",
        message: "Event dates are required.",
        path: ["event"],
      });
    if (
      draft.event &&
      `${draft.event.endDate}T${draft.event.endTime}` <
        `${draft.event.startDate}T${draft.event.startTime}`
    )
      ctx.addIssue({
        code: "custom",
        message: "End must follow start.",
        path: ["event"],
      });
    if (draft.topicType === "OFFER" && !draft.offer)
      ctx.addIssue({
        code: "custom",
        message: "Offer details are required.",
        path: ["offer"],
      });
    if (!["NONE", "CALL"].includes(draft.actionType) && !draft.actionUrl)
      ctx.addIssue({
        code: "custom",
        message: "Action URL is required.",
        path: ["actionUrl"],
      });
  });
export type PostDraft = z.infer<typeof PostDraftSchema>;
export const ContentCommandSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("ADD_MEDIA"),
      sourceUrl: PublicUrlSchema,
      category: PhotoCategorySchema,
      format: z.enum(["PHOTO", "VIDEO"]),
    })
    .strict(),
  z
    .object({ operation: z.literal("DELETE_MEDIA"), id: ResourceIdSchema })
    .strict(),
  z
    .object({ operation: z.literal("CREATE_POST"), draft: PostDraftSchema })
    .strict(),
  z
    .object({
      operation: z.literal("UPDATE_POST"),
      id: ResourceIdSchema,
      draft: PostDraftSchema,
    })
    .strict(),
  z
    .object({ operation: z.literal("DELETE_POST"), id: ResourceIdSchema })
    .strict(),
  z
    .object({
      operation: z.literal("REPLY_REVIEW"),
      id: ResourceIdSchema,
      comment: z.string().trim().min(1).max(4096),
    })
    .strict(),
  z
    .object({ operation: z.literal("DELETE_REPLY"), id: ResourceIdSchema })
    .strict(),
]);
export type ContentCommand = z.infer<typeof ContentCommandSchema>;
const outputUrl = PublicUrlSchema.nullable();
export const MediaItemSchema = z.object({
  kind: z.literal("media"),
  id: ResourceIdSchema,
  url: outputUrl,
  thumbnailUrl: outputUrl,
  attribution: z
    .object({
      profileName: z.string().nullable(),
      profilePhotoUrl: outputUrl,
      profileUrl: outputUrl,
      takedownUrl: outputUrl,
    })
    .nullable()
    .optional(),
  viewCount: z.string().regex(/^\d+$/).nullable().default(null),
  format: z.enum(["PHOTO", "VIDEO", "UNKNOWN"]),
  category: z.string().nullable(),
  createdAt: z.string().nullable(),
});
export const LocalPostSchema = z.object({
  kind: z.literal("posts"),
  id: ResourceIdSchema,
  summary: z.string(),
  topicType: z.string(),
  state: z.string().nullable(),
  createdAt: z.string().nullable(),
  url: outputUrl,
  imageUrl: outputUrl,
  draft: PostDraftSchema.nullable(),
});
export const ReviewSchema = z.object({
  kind: z.literal("reviews"),
  id: ResourceIdSchema,
  reviewer: z.string(),
  avatarUrl: outputUrl,
  rating: z.number().int().min(0).max(5),
  comment: z.string(),
  updatedAt: z.string().nullable(),
  reply: z
    .object({ comment: z.string(), updatedAt: z.string().nullable() })
    .nullable(),
});
export const ContentPageSchema = z.object({
  kind: ContentKindSchema,
  available: z.boolean(),
  items: z
    .array(
      z.discriminatedUnion("kind", [
        MediaItemSchema,
        LocalPostSchema,
        ReviewSchema,
      ]),
    )
    .max(100),
  nextPageToken: z.string().max(4096).nullable(),
  averageRating: z.number().min(0).max(5).nullable(),
  totalReviews: z.number().int().nonnegative().nullable(),
  totalMediaItems: z.number().int().nonnegative().safe().nullable().optional(),
});
export type ContentPage = z.infer<typeof ContentPageSchema>;
export type MediaItem = z.infer<typeof MediaItemSchema>;
export type LocalPost = z.infer<typeof LocalPostSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export const ContentResultSchema = z.object({ status: z.literal("ok") });
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
