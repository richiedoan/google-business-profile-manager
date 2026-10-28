import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  BulkLocationCommandSchema,
  MAX_BULK_LOCATION_IDS,
} from "@gbp/contracts";
import {
  locationSelectionScope,
  toggleLocationSelection,
  selectCurrentLocationPage,
  deselectCurrentLocationPage,
} from "../lib/location-selection";
const first = [
  { id: "l1", name: "First" },
  { id: "l2", name: "Second" },
];
const second = [
  { id: "l3", name: "Third" },
  { id: "l4", name: "Fourth" },
];
test("explicit row and page selection persist across pages without selecting unseen matches", () => {
  let selected = toggleLocationSelection([], first[0], true);
  selected = selectCurrentLocationPage(selected, second);
  assert.deepEqual(
    selected.map((item) => item.id),
    ["l1", "l3", "l4"],
  );
  assert.ok(!selected.some((item) => item.id === "l2"));
  selected = selectCurrentLocationPage(selected, first);
  assert.deepEqual(
    selected.map((item) => item.id),
    ["l1", "l3", "l4", "l2"],
  );
  assert.equal(selectCurrentLocationPage(selected, first).length, 4);
  selected = deselectCurrentLocationPage(selected, second);
  assert.deepEqual(
    selected.map((item) => item.id),
    ["l1", "l2"],
  );
  selected = toggleLocationSelection(selected, first[0], false);
  assert.deepEqual(selected, [first[1]]);
});
test("selection scope survives pagination and resets for account or committed filters", () => {
  const query = {
    page: 1,
    pageSize: 25,
    search: "shop",
    status: "OPEN" as const,
  };
  const scope = locationSelectionScope("a1", query);
  assert.equal(scope, locationSelectionScope("a1", { ...query, page: 2 }));
  assert.notEqual(scope, locationSelectionScope("a2", query));
  assert.notEqual(
    scope,
    locationSelectionScope("a1", { ...query, search: "other" }),
  );
  assert.notEqual(
    scope,
    locationSelectionScope("a1", { ...query, status: "TEMPORARILY_CLOSED" }),
  );
});
test("selection cap is atomic for a page and permits deselection at the limit", () => {
  const selected = Array.from({ length: MAX_BULK_LOCATION_IDS }, (_, i) => ({
    id: String(i),
    name: String(i),
  }));
  assert.deepEqual(toggleLocationSelection(selected, first[0], true), selected);
  assert.deepEqual(
    selectCurrentLocationPage(selected.slice(1), first),
    selected.slice(1),
  );
  assert.equal(
    toggleLocationSelection(selected, selected[0], false).length,
    99,
  );
  assert.equal(selected.length, 100, "inputs are not mutated");
});
test("bulk draft schema accepts bounded explicit IDs and rejects future filter semantics and unsafe websites", () => {
  const command = {
    accountId: "a1",
    operation: "SET_WEBSITE",
    selection: { kind: "EXPLICIT_IDS", locationIds: ["l1", "l3"] },
    websiteUrl: "https://new.example",
  };
  assert.deepEqual(BulkLocationCommandSchema.parse(command), command);
  const cleared = BulkLocationCommandSchema.parse({
    ...command,
    websiteUrl: null,
  });
  assert.equal(cleared.operation, "SET_WEBSITE");
  if (cleared.operation === "SET_WEBSITE")
    assert.equal(cleared.websiteUrl, null);
  for (const invalid of [
    { ...command, selection: { kind: "ALL_MATCHING_FILTER", filter: {} } },
    { ...command, selection: { kind: "CURRENT_PAGE", page: 1 } },
    { ...command, selection: { kind: "EXPLICIT_IDS", locationIds: [] } },
    {
      ...command,
      selection: { kind: "EXPLICIT_IDS", locationIds: ["l1", "l1"] },
    },
    {
      ...command,
      selection: {
        kind: "EXPLICIT_IDS",
        locationIds: Array.from({ length: 101 }, (_, i) => String(i)),
      },
    },
    { ...command, websiteUrl: "javascript:alert(1)" },
    { ...command, websiteUrl: "https://user:password@example.com" },
    { ...command, operation: "DELETE" },
    { ...command, role: "MANAGER" },
  ])
    assert.equal(BulkLocationCommandSchema.safeParse(invalid).success, false);
});
