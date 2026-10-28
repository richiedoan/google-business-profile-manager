import { strict as assert } from "node:assert";
import { test } from "node:test";
import { InfiniteQueryObserver } from "@tanstack/react-query";
import {
  infiniteLocationsOptions,
  decodeLocation,
  updateLocationCache,
} from "../lib/business-profile";
import { bffClient } from "../lib/bff-client";
import { createQueryClient } from "../lib/query-client";

const row = (id: string) => ({
  id,
  accountId: "a",
  name: id,
  formattedAddress: "Address",
  status: "OPEN" as const,
});

test("infinite locations append cursor pages, preserve rows on failure, and retry the same cursor", async () => {
  const originalGet = bffClient.get;
  const requests: URL[] = [];
  let failNext = true;
  bffClient.get = async (input, decode) => {
    const url = new URL(String(input), "https://example.com");
    requests.push(url);
    if (url.searchParams.has("pageToken") && failNext) {
      failNext = false;
      throw new Error("Network failure");
    }
    const second = url.searchParams.has("pageToken");
    return decode({
      items: [row(second ? "second" : "first")],
      page: second ? 2 : 1,
      pageSize: 25,
      total: null,
      nextPageToken: second ? null : "next+/=",
    });
  };
  const client = createQueryClient();
  const options = {
    ...infiniteLocationsOptions(
      "a",
      {
        page: 9,
        pageToken: "old",
        pageSize: 25,
        search: "Cafe",
        status: "OPEN",
      },
      "gmail-a",
    ),
    retry: false,
  };
  const observer = new InfiniteQueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await observer.refetch();
    assert.equal(observer.getCurrentResult().hasNextPage, true);
    assert.equal(requests[0].searchParams.get("page"), "1");
    assert.equal(requests[0].searchParams.has("pageToken"), false);
    const failed = await observer.fetchNextPage();
    assert.equal(failed.isFetchNextPageError, true);
    assert.deepEqual(
      failed.data?.pages.flatMap((page) => page.items.map((item) => item.id)),
      ["first"],
    );
    const success = await observer.fetchNextPage();
    assert.deepEqual(
      success.data?.pages.flatMap((page) => page.items.map((item) => item.id)),
      ["first", "second"],
    );
    assert.equal(success.hasNextPage, false);
    for (const url of requests.slice(1)) {
      assert.equal(url.searchParams.get("pageToken"), "next+/=");
      assert.equal(url.searchParams.get("page"), "2");
      assert.equal(url.searchParams.get("connectionId"), "gmail-a");
      assert.equal(url.searchParams.get("search"), "Cafe");
      assert.equal(url.searchParams.get("status"), "OPEN");
    }
  } finally {
    unsubscribe();
    client.clear();
    bffClient.get = originalGet;
  }
});

test("next page detection stops at numbered totals and prevents repeated cursor loops", () => {
  const options = infiniteLocationsOptions("a", { page: 1, pageSize: 25 });
  const next = options.getNextPageParam!;
  const first = {
    items: [row("first")],
    total: 26,
    page: 1,
    pageSize: 25,
  } as Parameters<typeof next>[0];
  assert.deepEqual(next(first, [first], { page: 1 }, [{ page: 1 }]), {
    page: 2,
  });
  const last = { ...first, page: 2 };
  assert.equal(
    next(last, [first, last], { page: 2 }, [{ page: 1 }, { page: 2 }]),
    undefined,
  );
  assert.equal(
    next({ ...first, items: [] }, [], { page: 1 }, [{ page: 1 }]),
    undefined,
  );
  assert.equal(
    next(
      { ...first, nextPageToken: "repeat" },
      [],
      { page: 2, pageToken: "repeat" },
      [{ page: 1 }, { page: 2, pageToken: "repeat" }],
    ),
    undefined,
  );
  assert.deepEqual(
    next(
      { ...first, items: [], total: null, nextPageToken: "next" },
      [],
      { page: 1 },
      [{ page: 1 }],
    ),
    { page: 2, pageToken: "next" },
  );
});

test("infinite caches isolate filters and connections and invalidate edited rows on later pages", async () => {
  const client = createQueryClient();
  const query = { page: 1, pageSize: 25 };
  const keyA = infiniteLocationsOptions("a", query, "gmail-a").queryKey;
  const keyB = infiniteLocationsOptions("a", query, "gmail-b").queryKey;
  assert.notDeepEqual(keyA, keyB);
  assert.notDeepEqual(
    keyA,
    infiniteLocationsOptions("a", { ...query, search: "Cafe" }, "gmail-a")
      .queryKey,
  );
  const detail = decodeLocation({
    ...row("second"),
    websiteUrl: null,
    primaryPhone: null,
  });
  const data = {
    pages: [
      { items: [row("first")], total: 2, page: 1, pageSize: 25 },
      { items: [detail], total: 2, page: 2, pageSize: 25 },
    ],
    pageParams: [{ page: 1 }, { page: 2 }],
  };
  client.setQueryData(keyA, data);
  client.setQueryData(keyB, data);
  try {
    await updateLocationCache(client, detail, "gmail-a");
    assert.equal(client.getQueryState(keyA)?.isInvalidated, true);
    assert.equal(client.getQueryState(keyB)?.isInvalidated, false);
  } finally {
    client.clear();
  }
});

test("back navigation keeps loaded pages and only refreshes after the freshness window", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  let requests = 0;
  const originalGet = bffClient.get;
  bffClient.get = async (_input, decode) => {
    requests++;
    return decode({
      items: [row("first")],
      page: 1,
      pageSize: 25,
      total: null,
      nextPageToken: null,
    });
  };
  const client = createQueryClient();
  const options = infiniteLocationsOptions(
    "a",
    { page: 1, pageSize: 25 },
    "gmail-a",
  );
  let unsubscribe = () => {};
  try {
    await client.fetchInfiniteQuery(options);
    assert.equal(requests, 1);
    now += 60_000;
    const back = new InfiniteQueryObserver(client, options);
    unsubscribe = back.subscribe(() => {});
    assert.equal(back.getCurrentResult().isPending, false);
    assert.equal(back.getCurrentResult().isFetching, false);
    assert.equal(back.getCurrentResult().data?.pages[0].items[0].id, "first");
    assert.equal(requests, 1);
    unsubscribe();
    // Stale data stays visible immediately while it refreshes in the background.
    now += 5 * 60_000;
    const later = new InfiniteQueryObserver(client, options);
    unsubscribe = later.subscribe(() => {});
    assert.equal(later.getCurrentResult().isPending, false);
    assert.equal(later.getCurrentResult().isFetching, true);
    assert.equal(later.getCurrentResult().data?.pages[0].items[0].id, "first");
    assert.equal(requests, 2);
    await client.cancelQueries();
  } finally {
    unsubscribe();
    client.clear();
    bffClient.get = originalGet;
  }
});
