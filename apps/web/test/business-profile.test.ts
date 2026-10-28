import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  decodeAccounts,
  decodeLocations,
  decodeLocation,
  locationsPath,
} from "../lib/business-profile";
import { queryKeys } from "../lib/query-keys";
import { createQueryClient } from "../lib/query-client";
const summary = {
  id: "l",
  accountId: "a",
  name: "Example",
  formattedAddress: "Address",
  status: "OPEN",
  verificationStatus: "PENDING",
};
test("profile decoders expose normalized contracts and reject malformed/unbounded payloads", () => {
  assert.deepEqual(
    decodeAccounts([{ id: "a", name: "Account", secret: "discard" }]),
    [{ id: "a", name: "Account" }],
  );
  assert.deepEqual(
    decodeLocations({ items: [summary], total: 10000, page: 1, pageSize: 25 })
      .items,
    [summary],
  );
  assert.deepEqual(
    decodeLocation({
      ...summary,
      websiteUrl: null,
      primaryPhone: null,
      raw: "discard",
    }),
    { ...summary, websiteUrl: null, primaryPhone: null },
  );
  for (const invalid of [
    { items: [summary], total: -1, page: 1, pageSize: 25 },
    { items: Array(26).fill(summary), total: 26, page: 1, pageSize: 25 },
    {
      items: [{ ...summary, status: "raw-google-status" }],
      total: 1,
      page: 1,
      pageSize: 25,
    },
  ])
    assert.throws(() => decodeLocations(invalid));
});
test("filtered page requests encode identifiers and query data; equal keys deduplicate concurrent reads", async () => {
  const query = {
    page: 2,
    pageSize: 25,
    search: "Main & North",
    status: "OPEN",
  } as const;
  assert.equal(
    locationsPath("account/1", query),
    "/api/accounts/account%2F1/locations?page=2&pageSize=25&search=Main+%26+North&status=OPEN",
  );
  const client = createQueryClient();
  let calls = 0;
  const queryFn = async () => {
    calls++;
    return summary;
  };
  try {
    await Promise.all([
      client.fetchQuery({ queryKey: queryKeys.locations("a", query), queryFn }),
      client.fetchQuery({
        queryKey: queryKeys.locations("a", { ...query }),
        queryFn,
      }),
    ]);
    assert.equal(calls, 1);
  } finally {
    client.clear();
  }
});

test("saved details invalidate only cached account pages containing the edited location", async () => {
  const { updateLocationCache } = await import("../lib/business-profile");
  const client = createQueryClient();
  const detail = {
    id: "l1",
    accountId: "a1",
    name: "Shop",
    formattedAddress: "Address",
    status: "OPEN" as const,
    verificationStatus: "VERIFIED" as const,
    websiteUrl: null,
    primaryPhone: "12345",
  };
  const affected = queryKeys.locations("a1", { page: 1, pageSize: 25 });
  const otherPage = queryKeys.locations("a1", { page: 2, pageSize: 25 });
  const otherAccount = queryKeys.locations("a2", { page: 1, pageSize: 25 });
  client.setQueryData(affected, { items: [detail] });
  client.setQueryData(otherPage, { items: [{ ...detail, id: "l2" }] });
  client.setQueryData(otherAccount, { items: [detail] });
  client.setQueryData(queryKeys.accounts, []);
  await updateLocationCache(client, detail);
  assert.deepEqual(client.getQueryData(queryKeys.location("l1")), detail);
  assert.equal(client.getQueryState(affected)?.isInvalidated, true);
  for (const key of [otherPage, otherAccount, queryKeys.accounts])
    assert.equal(client.getQueryState(key)?.isInvalidated, false);
  client.clear();
});

test("the same Business and location in different Gmail connections use separate cache entries", async () => {
  const { updateLocationCache } = await import("../lib/business-profile");
  const client = createQueryClient();
  const detail = decodeLocation({
    ...summary,
    websiteUrl: null,
    primaryPhone: null,
  });
  const firstPage = [
    ...queryKeys.locations("a", { page: 1, pageSize: 25 }),
    "gmail-a",
  ];
  const secondPage = [
    ...queryKeys.locations("a", { page: 1, pageSize: 25 }),
    "gmail-b",
  ];
  client.setQueryData(firstPage, { items: [detail] });
  client.setQueryData(secondPage, { items: [detail] });
  client.setQueryData([...queryKeys.location("l"), "gmail-b"], {
    ...detail,
    name: "Other grant",
  });
  try {
    await updateLocationCache(client, detail, "gmail-a");
    assert.equal(client.getQueryState(firstPage)?.isInvalidated, true);
    assert.equal(client.getQueryState(secondPage)?.isInvalidated, false);
    assert.deepEqual(
      client.getQueryData([...queryKeys.location("l"), "gmail-a"]),
      detail,
    );
    assert.equal(
      (
        client.getQueryData([...queryKeys.location("l"), "gmail-b"]) as {
          name: string;
        }
      ).name,
      "Other grant",
    );
  } finally {
    client.clear();
  }
});

test("cursor responses accept unknown totals and omit verification; requests and cache keys carry cursors", () => {
  const { verificationStatus: _, ...row } = summary;
  void _;
  const decoded = decodeLocations({
    items: [row],
    total: null,
    page: 1,
    pageSize: 25,
    nextPageToken: "next+/=",
  });
  assert.equal(decoded.total, null);
  assert.equal(decoded.nextPageToken, "next+/=");
  assert.equal("verificationStatus" in decoded.items[0], false);
  assert.equal(
    decodeLocations({
      items: [],
      total: null,
      page: 2,
      pageSize: 25,
      nextPageToken: null,
    }).nextPageToken,
    null,
  );
  const query = { page: 2, pageSize: 25, pageToken: "next+/=" };
  assert.equal(
    new URL(locationsPath("a", query), "https://example.com").searchParams.get(
      "pageToken",
    ),
    query.pageToken,
  );
  assert.notDeepEqual(
    queryKeys.locations("a", query),
    queryKeys.locations("a", { ...query, pageToken: "other" }),
  );
  assert.throws(() =>
    decodeLocations({
      items: [],
      total: null,
      page: 1,
      pageSize: 25,
      nextPageToken: 12,
    }),
  );
});
