import { z } from "zod";
import {
  ContentPageSchema,
  PostDraftSchema,
  PublicUrlSchema,
  type ContentCommand,
  type ContentKind,
  type ContentPage,
  type PostDraft,
} from "@gbp/contracts";
import { AppException } from "../errors/app.exception";
export type GoogleContentRequest = <T>(
  url: URL,
  schema: z.ZodType<T>,
  init?: RequestInit,
) => Promise<T>;
const optionalText = z.string().optional();
const mediaDto = z.object({
  name: z.string(),
  googleUrl: optionalText,
  thumbnailUrl: optionalText,
  sourceUrl: optionalText,
  mediaFormat: optionalText,
  insights: z
    .object({ viewCount: z.string().regex(/^\d+$/).optional() })
    .optional(),
  createTime: optionalText,
  attribution: z
    .object({
      profileName: optionalText,
      profilePhotoUrl: optionalText,
      profileUrl: optionalText,
      takedownUrl: optionalText,
    })
    .optional(),
  locationAssociation: z.object({ category: optionalText }).optional(),
});
const dateDto = z.object({
  year: z.number().optional(),
  month: z.number().optional(),
  day: z.number().optional(),
});
const timeDto = z.object({
  hours: z.number().optional(),
  minutes: z.number().optional(),
});
const postDto = z.object({
  name: z.string(),
  summary: optionalText,
  languageCode: optionalText,
  topicType: optionalText,
  state: optionalText,
  createTime: optionalText,
  searchUrl: optionalText,
  media: z
    .array(
      z.object({
        sourceUrl: optionalText,
        googleUrl: optionalText,
        thumbnailUrl: optionalText,
        mediaFormat: optionalText,
      }),
    )
    .optional(),
  callToAction: z
    .object({ actionType: optionalText, url: optionalText })
    .optional(),
  event: z
    .object({
      title: optionalText,
      schedule: z
        .object({
          startDate: dateDto.optional(),
          endDate: dateDto.optional(),
          startTime: timeDto.optional(),
          endTime: timeDto.optional(),
        })
        .optional(),
      recurrenceInfo: z.unknown().optional(),
    })
    .optional(),
  offer: z
    .object({
      couponCode: optionalText,
      redeemOnlineUrl: optionalText,
      termsConditions: optionalText,
    })
    .optional(),
});
const reviewDto = z.object({
  name: z.string(),
  reviewId: optionalText,
  reviewer: z
    .object({
      displayName: optionalText,
      profilePhotoUrl: optionalText,
      isAnonymous: z.boolean().optional(),
    })
    .optional(),
  starRating: optionalText,
  comment: optionalText,
  updateTime: optionalText,
  reviewReply: z
    .object({ comment: optionalText, updateTime: optionalText })
    .optional(),
});
const urlOrNull = (value?: string) => {
  const parsed = PublicUrlSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};
function idFor(name: string, parent: string, collection: string) {
  const prefix = `${parent}/${collection}/`;
  const id = name.startsWith(prefix) ? name.slice(prefix.length) : "";
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new AppException("PROVIDER_ERROR");
  return id;
}
const dateString = (value?: z.infer<typeof dateDto>) =>
  value
    ? `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`
    : "";
const timeString = (value?: z.infer<typeof timeDto>) =>
  `${String(value?.hours ?? 0).padStart(2, "0")}:${String(value?.minutes ?? 0).padStart(2, "0")}`;
function draftFor(row: z.infer<typeof postDto>): PostDraft | null {
  if (row.event?.recurrenceInfo) return null;
  const schedule = row.event?.schedule;
  const parsed = PostDraftSchema.safeParse({
    summary: row.summary ?? "",
    languageCode: row.languageCode ?? "en",
    topicType: row.topicType ?? "STANDARD",
    imageUrl: urlOrNull(row.media?.[0]?.sourceUrl),
    actionType: row.callToAction?.actionType ?? "NONE",
    actionUrl: urlOrNull(row.callToAction?.url),
    event: row.event
      ? {
          title: row.event.title ?? "",
          startDate: dateString(schedule?.startDate),
          endDate: dateString(schedule?.endDate),
          startTime: timeString(schedule?.startTime),
          endTime: timeString(schedule?.endTime),
        }
      : null,
    offer: row.offer
      ? {
          couponCode: row.offer.couponCode ?? "",
          redeemOnlineUrl: urlOrNull(row.offer.redeemOnlineUrl),
          termsConditions: row.offer.termsConditions ?? "",
        }
      : row.topicType === "OFFER"
        ? { couponCode: "", redeemOnlineUrl: null, termsConditions: "" }
        : null,
  });
  return parsed.success ? parsed.data : null;
}
function postBody(draft: PostDraft) {
  const date = (text: string) => {
    const [year, month, day] = text.split("-").map(Number);
    return { year, month, day };
  };
  const time = (text: string) => {
    const [hours, minutes] = text.split(":").map(Number);
    return { hours, minutes, seconds: 0, nanos: 0 };
  };
  return {
    summary: draft.summary,
    languageCode: draft.languageCode,
    topicType: draft.topicType,
    media: draft.imageUrl
      ? [{ mediaFormat: "PHOTO", sourceUrl: draft.imageUrl }]
      : [],
    callToAction:
      draft.actionType !== "NONE" && draft.topicType !== "OFFER"
        ? {
            actionType: draft.actionType,
            ...(draft.actionType === "CALL" ? {} : { url: draft.actionUrl }),
          }
        : null,
    event:
      draft.event && draft.topicType !== "STANDARD"
        ? {
            title: draft.event.title,
            schedule: {
              startDate: date(draft.event.startDate),
              endDate: date(draft.event.endDate),
              startTime: time(draft.event.startTime),
              endTime: time(draft.event.endTime),
            },
          }
        : null,
    offer:
      draft.topicType === "OFFER"
        ? {
            ...draft.offer,
            redeemOnlineUrl: draft.offer?.redeemOnlineUrl ?? undefined,
          }
        : null,
  };
}
export class GoogleLocationContentClient {
  constructor(private readonly request: GoogleContentRequest) {}
  private url(parent: string, path: string) {
    return new URL(`https://mybusiness.googleapis.com/v4/${parent}/${path}`);
  }
  async list(
    parent: string,
    kind: ContentKind,
    pageToken?: string,
  ): Promise<ContentPage> {
    const collection = kind === "posts" ? "localPosts" : kind;
    const url = this.url(parent, collection);
    url.searchParams.set("pageSize", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    if (kind === "reviews") url.searchParams.set("orderBy", "updateTime desc");
    const result: ContentPage = {
      kind,
      available: true,
      items: [],
      nextPageToken: null,
      averageRating: null,
      totalReviews: null,
    };
    if (kind === "media") {
      const body = await this.request(
        url,
        z.object({
          mediaItems: z.array(mediaDto).max(100).optional(),
          totalMediaItemCount: z.number().int().nonnegative().safe().optional(),
          nextPageToken: optionalText,
        }),
      );
      result.items = (body.mediaItems ?? []).map((row) => ({
        kind: "media",
        id: idFor(row.name, parent, collection),
        url: urlOrNull(row.googleUrl ?? row.sourceUrl),
        thumbnailUrl: urlOrNull(row.thumbnailUrl ?? row.googleUrl),
        viewCount: row.insights?.viewCount ?? null,
        attribution: row.attribution
          ? {
              profileName: row.attribution.profileName ?? null,
              profilePhotoUrl: urlOrNull(row.attribution.profilePhotoUrl),
              profileUrl: urlOrNull(row.attribution.profileUrl),
              takedownUrl: urlOrNull(row.attribution.takedownUrl),
            }
          : null,
        format:
          row.mediaFormat === "PHOTO" || row.mediaFormat === "VIDEO"
            ? row.mediaFormat
            : "UNKNOWN",
        category: row.locationAssociation?.category ?? null,
        createdAt:
          row.createTime && !row.createTime.startsWith("1970-")
            ? row.createTime
            : null,
      }));
      result.totalMediaItems = body.totalMediaItemCount ?? null;
      result.nextPageToken = body.nextPageToken || null;
    } else if (kind === "posts") {
      const body = await this.request(
        url,
        z.object({
          localPosts: z.array(postDto).max(100).optional(),
          nextPageToken: optionalText,
        }),
      );
      result.items = (body.localPosts ?? []).map((row) => ({
        kind: "posts",
        id: idFor(row.name, parent, collection),
        summary: row.summary ?? "",
        topicType: row.topicType ?? "STANDARD",
        state: row.state ?? null,
        createdAt: row.createTime ?? null,
        url: urlOrNull(row.searchUrl),
        imageUrl: urlOrNull(
          row.media?.[0]?.thumbnailUrl ??
            row.media?.[0]?.googleUrl ??
            row.media?.[0]?.sourceUrl,
        ),
        draft: draftFor(row),
      }));
      result.nextPageToken = body.nextPageToken || null;
    } else {
      const body = await this.request(
        url,
        z.object({
          reviews: z.array(reviewDto).max(50).optional(),
          nextPageToken: optionalText,
          averageRating: z.number().optional(),
          totalReviewCount: z.number().optional(),
        }),
      );
      result.items = (body.reviews ?? []).map((row) => ({
        kind: "reviews",
        id: idFor(row.name, parent, collection),
        reviewer: row.reviewer?.isAnonymous
          ? ""
          : (row.reviewer?.displayName ?? ""),
        avatarUrl: urlOrNull(row.reviewer?.profilePhotoUrl),
        rating: [
          "STAR_RATING_UNSPECIFIED",
          "ONE",
          "TWO",
          "THREE",
          "FOUR",
          "FIVE",
        ].indexOf(row.starRating ?? "STAR_RATING_UNSPECIFIED"),
        comment: row.comment ?? "",
        updatedAt: row.updateTime ?? null,
        reply: row.reviewReply
          ? {
              comment: row.reviewReply.comment ?? "",
              updatedAt: row.reviewReply.updateTime ?? null,
            }
          : null,
      }));
      result.nextPageToken = body.nextPageToken || null;
      result.averageRating = body.averageRating ?? null;
      result.totalReviews = body.totalReviewCount ?? null;
    }
    const parsed = ContentPageSchema.safeParse(result);
    if (!parsed.success) throw new AppException("PROVIDER_ERROR");
    return parsed.data;
  }
  async mutate(parent: string, command: ContentCommand) {
    let url: URL;
    let method: string;
    let body: unknown;
    switch (command.operation) {
      case "ADD_MEDIA":
        url = this.url(parent, "media");
        method = "POST";
        body = {
          mediaFormat: command.format,
          sourceUrl: command.sourceUrl,
          locationAssociation: { category: command.category },
        };
        break;
      case "DELETE_MEDIA":
        url = this.url(parent, `media/${encodeURIComponent(command.id)}`);
        method = "DELETE";
        break;
      case "CREATE_POST":
        url = this.url(parent, "localPosts");
        method = "POST";
        body = postBody(command.draft);
        break;
      case "UPDATE_POST": {
        url = this.url(parent, `localPosts/${encodeURIComponent(command.id)}`);
        const existing = await this.request(url, postDto);
        if (
          idFor(existing.name, parent, "localPosts") !== command.id ||
          !draftFor(existing)
        )
          throw new AppException("VALIDATION_FAILED");
        const payload = postBody(command.draft);
        const imageChanged =
          command.draft.imageUrl !== urlOrNull(existing.media?.[0]?.sourceUrl);
        // Unchanged media is omitted from the mask, preserving every existing image.
        const { media, ...textFields } = payload;
        method = "PATCH";
        body = imageChanged ? { ...textFields, media } : textFields;
        url.searchParams.set(
          "updateMask",
          [
            "summary",
            "languageCode",
            "topicType",
            "callToAction",
            "event",
            "offer",
            ...(imageChanged ? ["media"] : []),
          ].join(","),
        );
        break;
      }
      case "DELETE_POST":
        url = this.url(parent, `localPosts/${encodeURIComponent(command.id)}`);
        method = "DELETE";
        break;
      case "REPLY_REVIEW":
        url = this.url(
          parent,
          `reviews/${encodeURIComponent(command.id)}/reply`,
        );
        method = "PUT";
        body = { comment: command.comment };
        break;
      case "DELETE_REPLY":
        url = this.url(
          parent,
          `reviews/${encodeURIComponent(command.id)}/reply`,
        );
        method = "DELETE";
        break;
    }
    await this.request(url, z.unknown(), {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    return { status: "ok" as const };
  }
  async upload(parent: string, bytes: Buffer, mime: string, category: string) {
    const ref = await this.request(
      this.url(parent, "media:startUpload"),
      z.object({ resourceName: z.string().min(1).max(1024) }),
      { method: "POST" },
    );
    const url = new URL(
      `https://mybusiness.googleapis.com/upload/v1/media/${encodeURIComponent(ref.resourceName)}`,
    );
    url.searchParams.set("upload_type", "media");
    await this.request(url, z.unknown(), {
      method: "POST",
      headers: { "Content-Type": mime },
      body: new Uint8Array(bytes),
    });
    await this.request(this.url(parent, "media"), z.unknown(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaFormat: "PHOTO",
        locationAssociation: { category },
        dataRef: ref,
      }),
    });
    return { status: "ok" as const };
  }
}
