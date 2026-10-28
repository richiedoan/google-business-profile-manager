import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  ContentCommandSchema,
  MAX_PHOTO_BYTES,
  type ContentCommand,
  type PostDraft,
} from "@gbp/contracts";
import { GoogleBusinessProfileProvider } from "../src/business-profile/google-business-profile.provider";
import { BusinessProfileService } from "../src/business-profile/business-profile.service";
import { AppException } from "../src/errors/app.exception";
const context = {
  userId: "owner",
  role: "MANAGER" as const,
  accountIds: ["123"],
};
const parent = "accounts/123/locations/456";
const draft: PostDraft = {
  summary: "New offer",
  languageCode: "en",
  topicType: "STANDARD",
  imageUrl: "https://example.com/photo.jpg",
  actionType: "BOOK",
  actionUrl: "https://example.com/book",
  event: null,
  offer: null,
};
const code = (value: string) => (error: unknown) =>
  error instanceof AppException && error.code === value;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
function setup(
  handler?: (url: URL, init?: RequestInit) => Response | Promise<Response>,
) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const provider = new GoogleBusinessProfileProvider(
    {
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
      userId: "owner",
      accountIds: ["123"],
    },
    (async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      if (url.hostname === "oauth2.googleapis.com")
        return json({
          access_token: "private-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      if (url.hostname === "mybusinessbusinessinformation.googleapis.com")
        return json(
          url.pathname.includes("accounts")
            ? { locations: [{ name: "locations/456" }] }
            : { name: "locations/456", title: "Salon" },
        );
      return handler ? handler(url, init) : json({});
    }) as typeof fetch,
  );
  return {
    provider,
    calls,
    service: new BusinessProfileService(provider, undefined, false),
  };
}
test("content normalizes owned media, posts and reviews and forwards pagination", async () => {
  const { service, calls } = setup((url) => {
    if (url.pathname.endsWith("/media"))
      return json({
        mediaItems: [
          {
            name: `${parent}/media/photo`,
            googleUrl: "https://example.com/photo",
            thumbnailUrl: "javascript:bad",
            mediaFormat: "PHOTO",
            insights: { viewCount: "9007199254740993" },
            createTime: "1970-01-01T00:00:00Z",
            attribution: {
              profileName: "Contributor",
              profilePhotoUrl: "javascript:bad",
              profileUrl: "https://example.com/profile",
              takedownUrl: "https://example.com/report",
            },
            privateToken: "hidden",
          },
        ],
        totalMediaItemCount: 120,
        nextPageToken: "next+/=",
      });
    if (url.pathname.endsWith("/localPosts"))
      return json({
        localPosts: [
          {
            name: `${parent}/localPosts/post`,
            summary: "Hello",
            languageCode: "en",
            topicType: "STANDARD",
          },
        ],
      });
    return json({
      reviews: [
        {
          name: `${parent}/reviews/review`,
          reviewer: { displayName: "Reviewer" },
          starRating: "FIVE",
          comment: "Great",
          reviewReply: { comment: "Thanks" },
        },
      ],
      averageRating: 4.9,
      totalReviewCount: 457,
    });
  });
  const media = await service.listContent("456", "media", "cursor+/=", context);
  assert.equal(media.nextPageToken, "next+/=");
  assert.equal(media.totalMediaItems, 120);
  if (media.items[0].kind === "media") {
    assert.equal(media.items[0].thumbnailUrl, null);
    assert.equal(media.items[0].createdAt, null);
    assert.equal(media.items[0].viewCount, "9007199254740993");
    assert.deepEqual(media.items[0].attribution, {
      profileName: "Contributor",
      profilePhotoUrl: null,
      profileUrl: "https://example.com/profile",
      takedownUrl: "https://example.com/report",
    });
  }
  assert.equal("privateToken" in media.items[0], false);
  assert.equal(calls.at(-1)?.url.searchParams.get("pageToken"), "cursor+/=");
  const posts = await service.listContent("456", "posts", undefined, context);
  if (posts.items[0].kind === "posts")
    assert.equal(posts.items[0].draft?.summary, "Hello");
  const reviews = await service.listContent(
    "456",
    "reviews",
    undefined,
    context,
  );
  assert.equal(reviews.averageRating, 4.9);
  assert.equal(reviews.totalReviews, 457);
  if (reviews.items[0].kind === "reviews") {
    assert.equal(reviews.items[0].rating, 5);
    assert.equal(reviews.items[0].reply?.comment, "Thanks");
  }
});
test("content cannot return resources belonging to another location", async () => {
  const { service } = setup(() =>
    json({ mediaItems: [{ name: "accounts/999/locations/888/media/photo" }] }),
  );
  await assert.rejects(
    service.listContent("456", "media", undefined, context),
    code("PROVIDER_ERROR"),
  );
});
for (const command of [
  {
    operation: "ADD_MEDIA",
    sourceUrl: "https://example.com/image.jpg",
    format: "PHOTO",
    category: "COVER",
  },
  { operation: "CREATE_POST", draft },
  { operation: "DELETE_MEDIA", id: "photo" },
  { operation: "DELETE_POST", id: "post" },
  { operation: "REPLY_REVIEW", id: "review", comment: "Thank you" },
  { operation: "DELETE_REPLY", id: "review" },
] as ContentCommand[]) {
  test(`${command.operation} uses scoped Google resources and never retries writes`, async () => {
    const { service, calls } = setup(() => json({}));
    assert.deepEqual(await service.mutateContent("456", command, context), {
      status: "ok",
    });
    const last = calls.at(-1)!;
    assert.ok(last.url.pathname.startsWith(`/v4/${parent}/`));
    if (command.operation === "REPLY_REVIEW") {
      assert.equal(last.init?.method, "PUT");
      assert.deepEqual(JSON.parse(String(last.init.body)), {
        comment: "Thank you",
      });
    }
    if (command.operation.startsWith("DELETE"))
      assert.equal(last.init?.method, "DELETE");
    const denied = setup(() => json({ error: "secret" }, 401));
    await assert.rejects(
      denied.service.mutateContent("456", command, context),
      code("UNAUTHENTICATED"),
    );
    assert.equal(
      denied.calls.filter(
        (call) => call.url.hostname === "mybusiness.googleapis.com",
      ).length,
      1,
    );
  });
}
test("post updates preserve multiple images and map event and offer fields", async () => {
  const { service, calls } = setup((_url, init) =>
    init?.method === "GET"
      ? json({
          name: `${parent}/localPosts/post`,
          summary: "Before",
          languageCode: "en",
          topicType: "STANDARD",
          media: [
            { sourceUrl: draft.imageUrl },
            { sourceUrl: "https://example.com/second.jpg" },
          ],
        })
      : json({}),
  );
  const offer: PostDraft = {
    ...draft,
    topicType: "OFFER",
    event: {
      title: "Weekend",
      startDate: "2026-11-01",
      endDate: "2026-11-02",
      startTime: "09:00",
      endTime: "17:00",
    },
    offer: {
      couponCode: "SAVE",
      redeemOnlineUrl: null,
      termsConditions: "Terms",
    },
  };
  await service.mutateContent(
    "456",
    { operation: "UPDATE_POST", id: "post", draft: offer },
    context,
  );
  const last = calls.at(-1)!;
  const body = JSON.parse(String(last.init?.body));
  assert.equal(last.init?.method, "PATCH");
  assert.equal(body.media, undefined);
  assert.ok(
    !last.url.searchParams.get("updateMask")?.split(",").includes("media"),
  );
  assert.equal(body.callToAction, null);
  assert.deepEqual(body.event.schedule.startDate, {
    year: 2026,
    month: 11,
    day: 1,
  });
  assert.equal(body.offer.couponCode, "SAVE");
  assert.ok(last.url.searchParams.get("updateMask")?.includes("offer"));
});
test("Viewer, account scope and disabled flag reject writes before contacting Google", async () => {
  const { service, provider, calls } = setup();
  const command = { operation: "DELETE_MEDIA", id: "photo" };
  await assert.rejects(
    service.mutateContent("456", command, { ...context, role: "VIEWER" }),
    code("PERMISSION_DENIED"),
  );
  await assert.rejects(
    new BusinessProfileService(provider, undefined, true).mutateContent(
      "456",
      command,
      context,
    ),
    code("PERMISSION_DENIED"),
  );
  await assert.rejects(
    service.mutateContent("456", command, { ...context, accountIds: [] }),
    code("PERMISSION_DENIED"),
  );
  assert.equal(calls.length, 0);
});
test("validation rejects path traversal, unsafe URLs, bad event dates and empty replies", async () => {
  const { service, calls } = setup();
  for (const command of [
    { operation: "DELETE_MEDIA", id: "../../other" },
    { operation: "REPLY_REVIEW", id: "review", comment: " " },
    {
      operation: "ADD_MEDIA",
      sourceUrl: "javascript:alert(1)",
      category: "ADDITIONAL",
      format: "PHOTO",
    },
    {
      operation: "CREATE_POST",
      draft: { ...draft, topicType: "EVENT", event: null },
    },
    {
      operation: "CREATE_POST",
      draft: {
        ...draft,
        topicType: "EVENT",
        event: {
          title: "bad",
          startDate: "2026-11-02",
          endDate: "2026-11-01",
          startTime: "09:00",
          endTime: "17:00",
        },
      },
    },
  ]) {
    assert.equal(ContentCommandSchema.safeParse(command).success, false);
    await assert.rejects(
      service.mutateContent("456", command, context),
      code("VALIDATION_FAILED"),
    );
  }
  assert.equal(calls.length, 0);
});
test("photo upload completes three Google calls and rejects invalid files", async () => {
  const { service, calls } = setup((url) =>
    url.pathname.endsWith(":startUpload")
      ? json({ resourceName: "resource-key" })
      : new Response(""),
  );
  const file = {
    buffer: Buffer.from([255, 216, 255, 0, 1]),
    mimetype: "image/jpeg",
  };
  await service.uploadPhoto("456", file, "PROFILE", context);
  const writes = calls.filter(
    (call) => call.url.hostname === "mybusiness.googleapis.com",
  );
  assert.equal(writes.length, 3);
  assert.ok(writes[0].url.pathname.endsWith(":startUpload"));
  assert.equal(writes[1].url.pathname, "/upload/v1/media/resource-key");
  assert.deepEqual(
    Array.from(writes[1].init!.body as Uint8Array),
    Array.from(file.buffer),
  );
  assert.equal(
    JSON.parse(String(writes[2].init?.body)).dataRef.resourceName,
    "resource-key",
  );
  const before = calls.length;
  for (const bad of [
    { ...file, mimetype: "text/html" },
    { ...file, buffer: Buffer.from("not a photo") },
    { ...file, buffer: Buffer.alloc(MAX_PHOTO_BYTES + 1) },
  ])
    await assert.rejects(
      service.uploadPhoto("456", bad, "PROFILE", context),
      code("VALIDATION_FAILED"),
    );
  assert.equal(calls.length, before);
});
for (const [status, expected] of [
  [403, "PERMISSION_DENIED"],
  [404, "RESOURCE_NOT_FOUND"],
  [429, "PROVIDER_RATE_LIMITED"],
  [500, "PROVIDER_ERROR"],
] as const)
  test(`Google content ${status} maps without leaking its body`, async () => {
    const { service } = setup(() => json({ error: "PRIVATE" }, status));
    await assert.rejects(
      service.listContent("456", "reviews", undefined, context),
      code(expected),
    );
  });
