import { strict as assert } from "node:assert";
import { test } from "node:test";
import { locationVirtualRange } from "../lib/location-virtualization";

test("large tables keep only a visible range and bounded overscan mounted", () => {
  const indices = locationVirtualRange(
    { startIndex: 4000, endIndex: 4010, overscan: 8, count: 10000 },
    -1,
  );
  assert.equal(indices.length, 27);
  assert.equal(indices[0], 3992);
  assert.equal(indices.at(-1), 4018);
});

test("scrolling away from keyboard focus retains its row and adjacent tab targets", () => {
  const indices = locationVirtualRange(
    { startIndex: 4000, endIndex: 4010, overscan: 8, count: 10000 },
    24,
  );
  assert.deepEqual(indices.slice(0, 3), [23, 24, 25]);
  assert.equal(indices.length, 30);
  assert.equal(new Set(indices).size, indices.length);
  assert.deepEqual(
    indices,
    [...indices].sort((a, b) => a - b),
  );
  for (const focusedIndex of [0, 9999]) {
    const edge = locationVirtualRange(
      { startIndex: 4000, endIndex: 4010, overscan: 8, count: 10000 },
      focusedIndex,
    );
    assert.ok(edge.includes(focusedIndex));
    assert.ok(edge.every((index) => index >= 0 && index < 10000));
  }
});
