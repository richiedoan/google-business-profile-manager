import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClientProvider } from "@tanstack/react-query";
import { LocationContentTab } from "../components/location-content-tab";
import { contentKey, contentOptions } from "../lib/location-content";
import { createQueryClient } from "../lib/query-client";
import { createBffClient } from "../lib/bff-client";
import { ContentPageSchema, type ContentKind } from "@gbp/contracts";
const hostile = '<script>alert("synthetic")</script>';
function render(
  kind: ContentKind,
  canWrite: boolean,
  withMediaMetadata = false,
) {
  const client = createQueryClient();
  client.setQueryData(["me"], {
    id: "owner",
    role: canWrite ? "MANAGER" : "VIEWER",
    permissions: canWrite
      ? ["location:read", "location:write"]
      : ["location:read"],
  });
  const item =
    kind === "media"
      ? {
          kind,
          id: "photo",
          url: "https://example.com/photo",
          thumbnailUrl: "https://example.com/thumbnail",
          format: "PHOTO",
          viewCount: "1234",
          category: "COVER",
          createdAt: withMediaMetadata ? "2026-10-14T10:00:00Z" : null,
          attribution: withMediaMetadata
            ? {
                profileName: hostile,
                profilePhotoUrl: "https://example.com/avatar",
                profileUrl: "https://example.com/profile",
                takedownUrl: "https://example.com/report",
              }
            : null,
        }
      : kind === "posts"
        ? {
            kind,
            id: "post",
            summary: hostile,
            topicType: "STANDARD",
            state: "LIVE",
            createdAt: null,
            url: "https://example.com/post",
            imageUrl: null,
            draft: null,
          }
        : {
            kind,
            id: "review",
            reviewer: hostile,
            avatarUrl: null,
            rating: 5,
            comment: hostile,
            updatedAt: null,
            reply: { comment: hostile, updatedAt: null },
          };
  const page = ContentPageSchema.parse({
    kind,
    available: true,
    items: [item],
    nextPageToken: "next",
    averageRating: 4.9,
    totalReviews: 457,
    ...(kind === "media" && withMediaMetadata ? { totalMediaItems: 120 } : {}),
  });
  client.setQueryData(
    [...contentKey("owner", "connection", "location"), kind],
    { pages: [page], pageParams: [undefined] },
  );
  try {
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(LocationContentTab, {
          locationId: "location",
          connectionId: "connection",
          kind,
          canWrite,
        }),
      ),
    );
  } finally {
    client.clear();
  }
}
test("content tabs render media, posts and review summaries with paging and escaped text", () => {
  const media = render("media", false);
  assert.match(media, /content-media-grid/);
  assert.match(media, /aria-label="View media details on Google"/);
  assert.match(media, /Click to see details/);
  assert.ok(!media.includes("content-media-detail"));
  assert.match(media, /1,234 views/);
  assert.match(
    media,
    /class="content-media-preview" href="https:\/\/example.com\/photo" target="_blank" rel="noopener noreferrer"/,
  );
  assert.ok(!media.includes("Views unavailable"));
  assert.match(media, /Load more/);
  assert.ok(!media.includes(">Delete<"));
  for (const kind of ["posts", "reviews"] as const) {
    const markup = render(kind, false);
    assert.ok(markup.includes("&lt;script&gt;"));
    assert.ok(!markup.includes("<script"));
  }
  assert.match(render("reviews", false), /457 reviews/);
  assert.match(render("reviews", false), /Your reply/);
});
test("write controls appear only with permission and content queries isolate identities", () => {
  assert.match(render("media", true), /Add photo or video/);
  assert.match(render("media", true), /aria-label="Delete media"/);
  assert.match(render("media", true), /content-media-delete/);
  assert.ok(!render("media", false).includes("content-media-delete"));
  assert.match(render("posts", true), /Add post/);
  assert.match(render("reviews", true), /Edit reply/);
  assert.ok(!render("reviews", false).includes(">Edit reply<"));
  const a = contentOptions("owner", "connection", "location", "media");
  for (const b of [
    contentOptions("other", "connection", "location", "media"),
    contentOptions("owner", "other", "location", "media"),
    contentOptions("owner", "connection", "other", "media"),
    contentOptions("owner", "connection", "location", "posts"),
  ])
    assert.notDeepEqual(a.queryKey, b.queryKey);
  assert.equal(
    a.getNextPageParam({ nextPageToken: "loop" } as never, [], undefined, [
      "loop",
    ]),
    undefined,
  );
});
test("multipart upload preserves CSRF and browser boundaries without JSON encoding files", async () => {
  const requests: RequestInit[] = [];
  const client = createBffClient("http://localhost:3001", (async (
    _input,
    init,
  ) => {
    requests.push(init!);
    return Response.json(
      requests.length === 1 ? { csrfToken: "a".repeat(64) } : { status: "ok" },
    );
  }) as typeof fetch);
  const form = new FormData();
  form.set(
    "file",
    new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }),
    "photo.jpg",
  );
  form.set("category", "COVER");
  await client.post(
    "/api/locations/location/photos/upload",
    (value) => value,
    undefined,
    form,
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body, form);
  assert.equal(requests[1].credentials, "include");
  const headers = requests[1].headers as Record<string, string>;
  assert.equal(headers["X-CSRF-Token"], "a".repeat(64));
  assert.equal(headers["Content-Type"], undefined);
});

test("media shows Google totals, dates and contributor attribution when provided", () => {
  const markup = render("media", false, true);
  assert.match(markup, /120 photos and videos/);
  assert.match(markup, /dateTime="2026-10-14T10:00:00Z"/i);
  assert.match(markup, /Contributor/);
  assert.match(
    markup,
    /href="https:\/\/example.com\/profile" target="_blank" rel="noopener noreferrer"/,
  );
  assert.match(markup, /href="https:\/\/example.com\/report"/);
  assert.ok(markup.includes("&lt;script&gt;"));
  assert.ok(!markup.includes("<script"));
  const missing = render("media", false);
  assert.match(missing, /1 media loaded/);
  assert.ok(!missing.includes("content-media-date"));
  assert.ok(!missing.includes("content-media-contributor"));
});
