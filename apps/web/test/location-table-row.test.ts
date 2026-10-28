import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocationTableRow } from "../components/location-table-row";
import { decodeSummary } from "../lib/business-profile";

const location = decodeSummary({
  id: "shop/1",
  accountId: "account",
  name: "Corner Cafe",
  storeCode: "CAFE-01",
  primaryCategory: "Cafe",
  formattedAddress: "12 Main Street, City",
  status: "TEMPORARILY_CLOSED",
  providerState: "READ",
  editable: false,
});
const render = (row = location, canSelect = true) =>
  renderToStaticMarkup(
    createElement(LocationTableRow, {
      location: row,
      connectionId: "gmail-a",
      selected: true,
      canSelect,
      onSelect: () => {},
    }),
  );

test("location rows keep selection in five cells and show normalized fields with honest read state", () => {
  const markup = render();
  assert.equal((markup.match(/<td>/g) ?? []).length, 5);
  for (const value of [
    "Corner Cafe",
    "Store code: CAFE-01",
    "12 Main Street, City",
    "Cafe",
    "Temporarily closed",
    "Google read",
    "No sync timestamp",
  ])
    assert.ok(markup.includes(value));
  assert.ok(markup.includes('type="checkbox"'));
  assert.ok(markup.includes('data-selected="true"'));
  assert.ok(markup.includes("/app/locations/shop%2F1?connectionId=gmail-a"));
  assert.ok(!markup.includes(">Edit<"));
  assert.ok(!markup.includes("<time"));
});

test("location names are plain text with one compact detail link and tooltips; missing fields use placeholders", () => {
  const markup = render({
    ...location,
    storeCode: null,
    primaryCategory: null,
    providerState: "MOCK",
  });
  assert.ok(!markup.includes(">Edit<"));
  assert.equal((markup.match(/<a /g) ?? []).length, 1);
  assert.ok(markup.includes('class="location-name"'));
  assert.ok(markup.includes('title="View details for Corner Cafe"'));
  assert.ok(markup.includes('title="Deselect Corner Cafe"'));
  assert.ok(markup.includes('class="location-detail-button"'));
  assert.ok(markup.includes('aria-label="View details for Corner Cafe"'));
  assert.equal((markup.match(/<td>/g) ?? []).length, 5);
  assert.ok(markup.includes("/app/locations/shop%2F1?connectionId=gmail-a"));
  assert.ok(markup.includes("Not provided"));
  assert.ok(markup.includes("Mock provider"));
  assert.ok(!markup.includes("Store code:"));
  assert.ok(
    render({ ...location, providerState: undefined }).includes(
      "Provider state unavailable",
    ),
  );
});

test("viewers can open details without selection controls or selected styling", () => {
  const markup = render(location, false);
  assert.ok(!markup.includes('type="checkbox"'));
  assert.ok(markup.includes('data-selected="false"'));
  assert.ok(markup.includes("/app/locations/shop%2F1?connectionId=gmail-a"));
});

test("new optional provider fields are validated and provider text is escaped", () => {
  for (const patch of [
    { primaryCategory: {} },
    { storeCode: 12 },
    { providerState: "synced" },
    { editable: "true" },
  ])
    assert.throws(() => decodeSummary({ ...location, ...patch }));
  const markup = render({
    ...location,
    storeCode: "<script>alert(1)</script>",
    primaryCategory: "<img src=x onerror=alert(1)>",
  });
  assert.ok(markup.includes("&lt;script&gt;"));
  assert.ok(markup.includes("&lt;img"));
  assert.ok(!markup.includes("<script>"));
  assert.ok(!markup.includes("<img"));
});
