import { strict as assert } from "node:assert";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { invalidateBulkLocationQueries } from "../lib/business-profile";
test("bulk refresh targets successful details and affected lists, isolating accounts, connections and other queries", async () => {
  const client = new QueryClient();
  const keys = [
    ["location", "ok", "c1"],
    ["location", "failed", "c1"],
    ["location", "ok", "c2"],
    ["locations", "a", {}, "c1"],
    ["locations", "a", { search: "other" }, "c1"],
    ["locations", "b", {}, "c1"],
    ["locations", "a", {}, "c2"],
    ["locations-infinite", "a", {}, "c1"],
    ["performance", "ok"],
  ];
  keys.forEach((key, i) =>
    client.setQueryData(
      key,
      key[0] === "locations-infinite"
        ? { pages: [{ items: [{ id: "failed" }] }, { items: [{ id: "ok" }] }] }
        : key[0] === "locations"
          ? { items: [{ id: i === 4 ? "other" : "ok" }] }
          : {},
    ),
  );
  try {
    await invalidateBulkLocationQueries(client, "a", [], "c1");
    assert.ok(keys.every((key) => !client.getQueryState(key)?.isInvalidated));
    await invalidateBulkLocationQueries(client, "a", ["ok"], "c1");
    keys.forEach((key, i) =>
      assert.equal(
        client.getQueryState(key)?.isInvalidated,
        [0, 3, 7].includes(i),
        JSON.stringify(key),
      ),
    );
  } finally {
    client.clear();
  }
});
