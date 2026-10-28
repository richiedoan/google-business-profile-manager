import { strict as assert } from "node:assert";
import { test } from "node:test";
import { LocationDetailFieldsSchema } from "@gbp/contracts";
import {
  googleLocationDetailFieldsSchema,
  mapGoogleDetailFields,
} from "../src/business-profile/google-location-detail.mapper";

const normalize = (value: unknown) =>
  mapGoogleDetailFields(googleLocationDetailFieldsSchema.parse(value));
test("Google detail maps nested provider data to normalized contracts without leaking raw fields", () => {
  const detail = normalize({
    languageCode: "en",
    categories: {
      primaryCategory: {
        name: "categories/cafe",
        displayName: "Cafe",
        serviceTypes: [{ serviceTypeId: "coffee", displayName: "Coffee" }],
        moreHoursTypes: [
          { hoursTypeId: "DELIVERY", localizedDisplayName: "Delivery" },
        ],
      },
      additionalCategories: [
        { name: "categories/bakery", displayName: "Bakery" },
      ],
    },
    phoneNumbers: { additionalPhones: ["+1 555 456", "+1 555 789"] },
    serviceArea: {
      businessType: "CUSTOMER_AND_BUSINESS_LOCATION",
      regionCode: "US",
      places: { placeInfos: [{ placeName: "City", placeId: "area-id" }] },
    },
    latlng: { latitude: 0, longitude: -75.2 },
    regularHours: {
      periods: [
        {
          openDay: "MONDAY",
          openTime: { hours: 22 },
          closeDay: "TUESDAY",
          closeTime: { hours: 2, minutes: 30 },
        },
        {
          openDay: "FRIDAY",
          openTime: {},
          closeDay: "FRIDAY",
          closeTime: { hours: 24 },
        },
      ],
    },
    specialHours: {
      specialHourPeriods: [
        { startDate: { year: 2026, month: 12, day: 25 }, closed: true },
        {
          startDate: { year: 2026, month: 12, day: 31 },
          endDate: { year: 2027, month: 1, day: 1 },
          openTime: { hours: 22 },
          closeTime: { hours: 2 },
        },
      ],
    },
    moreHours: [
      {
        hoursTypeId: "DELIVERY",
        periods: [
          {
            openDay: "MONDAY",
            openTime: { hours: 9 },
            closeDay: "MONDAY",
            closeTime: { hours: 17 },
          },
        ],
      },
    ],
    openInfo: {
      status: "CLOSED_TEMPORARILY",
      canReopen: false,
      openingDate: { year: 2020, month: 6 },
    },
    metadata: {
      placeId: "place-id",
      hasPendingEdits: false,
      hasGoogleUpdated: true,
      mapsUri: "https://maps.example",
      secret: "discard",
    },
    profile: { description: "Coffee and pastries" },
    labels: ["Downtown"],
    serviceItems: [
      {
        structuredServiceItem: {
          serviceTypeId: "coffee",
          description: "Fresh coffee",
        },
        price: { currencyCode: "USD", units: "3", nanos: 500000000 },
      },
      {
        freeFormServiceItem: {
          category: "categories/bakery",
          label: {
            displayName: "Cake",
            description: "Custom cakes",
            languageCode: "en",
          },
        },
      },
    ],
  });
  assert.deepEqual(LocationDetailFieldsSchema.parse(detail), detail);
  assert.deepEqual(detail.additionalCategories, ["Bakery"]);
  assert.deepEqual(detail.additionalPhones, ["+1 555 456", "+1 555 789"]);
  assert.equal(
    detail.serviceArea?.businessType,
    "Business and customer locations",
  );
  assert.deepEqual(detail.serviceArea?.places, [
    { name: "City", placeId: "area-id" },
  ]);
  assert.deepEqual(detail.coordinates, { latitude: 0, longitude: -75.2 });
  assert.equal(detail.regularHours?.[0].closeDay, "Tuesday");
  assert.equal(detail.regularHours?.[1].openTime, "00:00");
  assert.equal(detail.regularHours?.[1].closeTime, "24:00");
  assert.equal(detail.specialHours?.[0].closed, true);
  assert.equal(detail.specialHours?.[0].openTime, null);
  assert.equal(detail.specialHours?.[1].endDate, "2027-01-01");
  assert.equal(detail.moreHours?.[0].type, "Delivery");
  assert.equal(detail.openStatus, "TEMPORARILY_CLOSED");
  assert.equal(detail.lastSyncedAt, null);
  assert.equal(detail.placeId, "place-id");
  assert.ok(
    detail.metadata?.some(
      (entry) => entry.label === "Pending edits" && entry.value === false,
    ),
  );
  assert.ok(
    detail.metadata?.some(
      (entry) => entry.label === "Can reopen" && entry.value === false,
    ),
  );
  assert.ok(
    detail.metadata?.some(
      (entry) => entry.label === "Opening date" && entry.value === "2020-06-—",
    ),
  );
  assert.equal(detail.serviceItems?.[0].name, "Coffee");
  assert.equal(detail.serviceItems?.[0].price, "USD 3.5");
  assert.equal(detail.serviceItems?.[1].category, "Bakery");
  assert.equal(detail.description, "Coffee and pastries");
  assert.deepEqual(detail.labels, ["Downtown"]);
  assert.ok(!JSON.stringify(detail).includes("secret"));
  assert.equal("latlng" in detail, false);
  assert.equal("profile" in detail, false);
});
test("absent Google detail values stay empty; unspecified states and missing coordinates are not invented", () => {
  const absent = normalize({});
  for (const field of [
    "languageCode",
    "serviceArea",
    "coordinates",
    "openStatus",
    "lastSyncedAt",
    "placeId",
    "description",
  ] as const)
    assert.equal(absent[field], null);
  for (const field of [
    "additionalCategories",
    "additionalPhones",
    "regularHours",
    "specialHours",
    "moreHours",
    "metadata",
    "labels",
    "serviceItems",
  ] as const)
    assert.deepEqual(absent[field], []);
  const partial = normalize({
    latlng: { longitude: 0 },
    openInfo: { status: "OPEN_FOR_BUSINESS_UNSPECIFIED" },
    regularHours: { periods: [{}] },
    serviceItems: [
      { structuredServiceItem: { serviceTypeId: "service-id" }, price: {} },
    ],
  });
  assert.deepEqual(partial.coordinates, { latitude: null, longitude: 0 });
  assert.equal(partial.openStatus, null);
  assert.equal(partial.regularHours?.[0].openTime, null);
  assert.equal(partial.serviceItems?.[0].name, "service-id");
  assert.equal(partial.serviceItems?.[0].price, null);
  const incomplete = normalize({
    categories: {
      primaryCategory: {
        displayName: "Cafe",
        serviceTypes: [{ displayName: "Coffee" }],
        moreHoursTypes: [{ displayName: "Delivery" }],
      },
    },
    serviceItems: [{}],
    moreHours: [{}],
  });
  assert.equal(incomplete.serviceItems?.[0].name, null);
  assert.equal(incomplete.serviceItems?.[0].category, null);
  assert.equal(incomplete.moreHours?.[0].type, null);
});
test("detail parsing rejects malformed provider fields and preserves exact large prices", () => {
  for (const invalid of [
    { latlng: { latitude: 91 } },
    { regularHours: { periods: [{ openTime: { hours: 25 } }] } },
    { phoneNumbers: { additionalPhones: [42] } },
    { metadata: { hasPendingEdits: "yes" } },
  ])
    assert.throws(() => normalize(invalid));
  const detail = normalize({
    serviceItems: [
      { price: { currencyCode: "USD", units: "9007199254740993", nanos: 1 } },
    ],
  });
  assert.equal(
    detail.serviceItems?.[0].price,
    "USD 9007199254740993.000000001",
  );
});
