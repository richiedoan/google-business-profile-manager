import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocationDetailSections } from "../components/location-detail-sections";
import { decodeLocation } from "../lib/business-profile";
const base = {
  id: "location",
  accountId: "account",
  name: "Corner Cafe",
  formattedAddress: "1 Main Street",
  status: "OPEN",
  verificationStatus: "UNKNOWN",
  primaryPhone: null,
  websiteUrl: null,
};
const render = (data: unknown) =>
  renderToStaticMarkup(
    createElement(LocationDetailSections, { data: decodeLocation(data) }),
  );
test("detail hides empty fields, unknown verification and technical information", () => {
  const markup = render({ ...base, openStatus: null });
  assert.equal((markup.match(/<section /g) ?? []).length, 2);
  for (const title of ["Basic information", "Address / Service area"])
    assert.ok(markup.includes(`<h2>${title}</h2>`));
  for (const text of [
    "No sync timestamp",
    "Technical information",
    "Verification",
    "Primary phone",
    "Regular hours",
    "Store code",
    "—",
  ])
    assert.ok(!markup.includes(text), text);
  assert.ok(markup.includes("View on Google Maps"));
});
test("detail keeps business information and omits technical fields", () => {
  const markup = render({
    ...base,
    storeCode: "CAFE-01",
    primaryCategory: "Cafe",
    additionalCategories: ["Bakery"],
    languageCode: "en",
    additionalPhones: ["+1 555 123"],
    coordinates: { latitude: 0, longitude: 0 },
    serviceArea: {
      businessType: "CUSTOMER_LOCATION_ONLY",
      regionCode: "US",
      places: [{ name: "City", placeId: "area-id" }],
    },
    regularHours: [
      {
        openDay: "Monday",
        openTime: "22:00",
        closeDay: "Tuesday",
        closeTime: "02:00",
      },
    ],
    specialHours: [
      {
        startDate: "2026-12-25",
        endDate: null,
        closed: true,
        openTime: null,
        closeTime: null,
      },
    ],
    moreHours: [
      {
        type: "Delivery",
        periods: [
          {
            openDay: "Monday",
            openTime: "09:00",
            closeDay: "Monday",
            closeTime: "17:00",
          },
        ],
      },
    ],
    openStatus: "TEMPORARILY_CLOSED",
    providerState: "READ",
    lastSyncedAt: "2026-10-05T03:00:00Z",
    placeId: "place-id",
    metadata: [{ label: "Pending edits", value: false }],
    description: "Coffee and pastries",
    labels: ["Downtown"],
    serviceItems: [
      {
        name: "Coffee",
        price: "USD 3.5",
        description: "Fresh coffee",
        category: "Cafe",
        languageCode: "en",
      },
    ],
  });
  for (const value of [
    "CAFE-01",
    "Serves customers at their locations",
    "Bakery",
    "+1 555 123",
    "Monday",
    "Tuesday",
    "22:00",
    "02:00",
    "Closed",
    "Delivery",
    "Temporarily closed",
    "Coffee and pastries",
    "Downtown",
    "USD 3.5",
    "Fresh coffee",
  ])
    assert.ok(markup.includes(value), value);
  for (const text of [
    "Latitude / longitude",
    "Language code",
    "Relevant metadata",
    "Google read",
    "area-id",
    "Region:",
    "Language:",
    "<time",
  ])
    assert.ok(!markup.includes(text), text);
  assert.ok(markup.includes("query_place_id=place-id"));
  assert.equal((markup.match(/<h3>Cafe<\/h3>/g) ?? []).length, 1);
});
test("provider-controlled detail strings remain escaped and raw Google fields are ignored", () => {
  const hostile = "<img src=x onerror=alert(1)>";
  const markup = render({
    ...base,
    description: hostile,
    labels: [hostile],
    metadata: [{ label: hostile, value: hostile }],
    profile: { description: "RAW FIELD" },
  });
  assert.ok(markup.includes("&lt;img"));
  assert.ok(!markup.includes("<img"));
  assert.ok(!markup.includes("RAW FIELD"));
  const linked = render({
    ...base,
    websiteUrl: "https://example.com",
    description: "Visit https://example.com/about. Or www.example.com/help",
  });
  assert.ok(
    linked.includes(
      'href="https://example.com/" target="_blank" rel="noopener noreferrer"',
    ),
  );
  assert.ok(linked.includes('href="https://example.com/about"'));
  assert.ok(linked.includes('href="https://www.example.com/help"'));
  for (const websiteUrl of [
    "javascript:alert(1)",
    "data:text/html,bad",
    "https://user:password@example.com",
  ]) {
    const unsafe = render({ ...base, websiteUrl });
    assert.ok(!unsafe.includes(`href="${websiteUrl}`));
  }
  for (const invalid of [
    { regularHours: [{ openTime: 42 }] },
    { coordinates: { latitude: 91, longitude: 0 } },
    { lastSyncedAt: "yesterday" },
    { metadata: [{ label: "Pending edits", value: {} }] },
  ])
    assert.throws(() => decodeLocation({ ...base, ...invalid }));
});

test("edit actions appear only for supported fields when editing is permitted", () => {
  const data = decodeLocation(base);
  const markup = renderToStaticMarkup(
    createElement(LocationDetailSections, { data, onEdit: () => {} }),
  );
  for (const field of [
    "Primary phone",
    "Website",
    "Regular hours",
    "Special hours",
    "Description",
    "Labels",
    "Service items",
  ])
    assert.ok(markup.includes(`aria-label="Edit ${field}"`));
  assert.equal((markup.match(/class="detail-edit"/g) ?? []).length, 7);
  assert.ok(!markup.includes('aria-label="Edit Location title"'));
  assert.ok(!markup.includes('aria-label="Edit More hours"'));
  assert.ok(!render(base).includes('class="detail-edit"'));
});
