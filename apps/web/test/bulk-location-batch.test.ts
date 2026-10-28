import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { BulkLocationCommand, BulkLocationResult } from "@gbp/contracts";
import { applyBulkLocationBatch } from "../lib/bulk-location-batch";
const selection = { kind: "EXPLICIT_IDS" as const, locationIds: ["a", "b"] };
const commands: BulkLocationCommand[] = [
  {
    accountId: "account",
    selection,
    operation: "SET_WEBSITE",
    websiteUrl: "https://example.com",
  },
  {
    accountId: "account",
    selection,
    operation: "SET_DESCRIPTION",
    description: "New description",
  },
];
const response = (
  results: BulkLocationResult["results"],
): BulkLocationResult => ({
  totalSelected: results.length,
  succeeded: results.filter((result) => result.success).length,
  failed: results.filter((result) => !result.success).length,
  results,
});
test("multiple edited fields aggregate success per location and retry only failed pairs", async () => {
  const sent: BulkLocationCommand[] = [];
  const batch = await applyBulkLocationBatch(commands, async (command) => {
    sent.push(command);
    return response([
      { locationId: "a", success: true },
      command.operation === "SET_WEBSITE"
        ? { locationId: "b", success: false, reason: "Rate limited" }
        : { locationId: "b", success: true },
    ]);
  });
  assert.deepEqual(sent, commands);
  assert.equal(batch.result.succeeded, 1);
  assert.equal(batch.result.failed, 1);
  assert.deepEqual(batch.updatedIds, ["a", "b"]);
  assert.deepEqual(batch.pending, [
    { ...commands[0], selection: { kind: "EXPLICIT_IDS", locationIds: ["b"] } },
  ]);
  const retry = await applyBulkLocationBatch(batch.pending, async (command) => {
    assert.equal(command.operation, "SET_WEBSITE");
    assert.deepEqual(command.selection.locationIds, ["b"]);
    return response([{ locationId: "b", success: true }]);
  });
  assert.equal(retry.result.succeeded, 1);
  assert.deepEqual(retry.pending, []);
});
test("transport failures preserve pending commands and allow other fields to finish", async () => {
  const batch = await applyBulkLocationBatch(commands, async (command) => {
    if (command.operation === "SET_WEBSITE") throw new Error("Network error");
    return response(
      selection.locationIds.map((locationId) => ({
        locationId,
        success: true,
      })),
    );
  });
  assert.equal(batch.result.failed, 2);
  assert.deepEqual(batch.pending, [commands[0]]);
  assert.deepEqual(batch.updatedIds, ["a", "b"]);
});
test("missing location responses are retained for retry", async () => {
  const batch = await applyBulkLocationBatch([commands[0]], async () =>
    response([{ locationId: "a", success: true }]),
  );
  assert.equal(batch.result.failed, 1);
  assert.deepEqual(batch.pending[0].selection.locationIds, ["b"]);
});
