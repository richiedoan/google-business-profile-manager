import { strict as assert } from "node:assert";
import { test } from "node:test";
import { BulkLocationCommandSchema } from "@gbp/contracts";
import { BusinessProfileService } from "../src/business-profile/business-profile.service";
import { MockBusinessProfileProvider } from "../src/business-profile/mock-business-profile.provider";
import { GoogleBusinessProfileProvider } from "../src/business-profile/google-business-profile.provider";
import { AppException } from "../src/errors/app.exception";
const context = {
  userId: "manager",
  role: "MANAGER" as const,
  accountIds: ["account-1", "account-2"],
};
const base = {
  accountId: "account-1",
  selection: {
    kind: "EXPLICIT_IDS" as const,
    locationIds: ["location-00001", "location-00003"],
  },
};
const regularHours = [
  {
    openDay: "MONDAY",
    closeDay: "MONDAY",
    openTime: "09:00",
    closeTime: "12:00",
  },
  {
    openDay: "MONDAY",
    closeDay: "MONDAY",
    openTime: "13:00",
    closeTime: "17:00",
  },
];
const specialHours = [
  {
    startDate: "2026-12-25",
    endDate: "2026-12-25",
    closed: true,
    openTime: null,
    closeTime: null,
  },
  {
    startDate: "2026-12-26",
    endDate: "2026-12-26",
    closed: false,
    openTime: "10:00",
    closeTime: "14:00",
  },
];
const serviceItems = [
  {
    name: "Consultation",
    description: "Advice",
    category: "Consulting",
    languageCode: "en",
    price: "100 USD",
  },
  {
    name: "Installation",
    description: null,
    category: null,
    languageCode: null,
    price: null,
  },
];
const cases = [
  { operation: "SET_WEBSITE", websiteUrl: "https://new.example" },
  { operation: "SET_WEBSITE", websiteUrl: null },
  {
    operation: "SET_PHONE",
    primaryPhone: "+1 555 1234",
    additionalPhones: ["+1 555 5678", "+1 555 9012"],
  },
  { operation: "SET_REGULAR_HOURS", regularHours },
  { operation: "SET_SPECIAL_HOURS", specialHours },
  { operation: "SET_DESCRIPTION", description: "A business\nwith a profile" },
  { operation: "UPDATE_LABELS", add: ["New", "Local"], remove: ["Old"] },
  { operation: "SET_SERVICE_ITEMS", serviceItems },
];
for (const payload of cases)
  test(`bulk ${payload.operation} persists normalized data on every selected location (${"websiteUrl" in payload ? payload.websiteUrl : ""})`, async () => {
    const provider = new MockBusinessProfileProvider();
    const service = new BusinessProfileService(provider, undefined, false);
    for (const id of base.selection.locationIds)
      await provider.updateLocation(id, { labels: ["Old", "Keep"] }, context);
    const result = await service.bulkUpdateLocations(
      { ...base, ...payload },
      context,
    );
    assert.deepEqual(
      {
        total: result.totalSelected,
        succeeded: result.succeeded,
        failed: result.failed,
      },
      { total: 2, succeeded: 2, failed: 0 },
    );
    for (const id of base.selection.locationIds) {
      const detail = await provider.getLocation(id, context);
      for (const [field, value] of Object.entries(payload))
        if (field !== "operation" && field !== "add" && field !== "remove")
          assert.deepEqual(detail[field as keyof typeof detail], value);
      if (payload.operation === "UPDATE_LABELS")
        assert.deepEqual(detail.labels, ["Keep", "New", "Local"]);
      if (detail.regularHours) detail.regularHours[0].openTime = "00:00";
      if (detail.serviceItems) detail.serviceItems[0].name = "Mutated";
      const again = await provider.getLocation(id, context);
      if (payload.operation === "SET_REGULAR_HOURS")
        assert.deepEqual(again.regularHours, regularHours);
      if (payload.operation === "SET_SERVICE_ITEMS")
        assert.deepEqual(again.serviceItems, serviceItems);
    }
  });

test("every bulk field rejects invalid payloads before writing", async () => {
  const provider = new MockBusinessProfileProvider();
  const service = new BusinessProfileService(provider, undefined, false);
  const before = await provider.getLocation(
    base.selection.locationIds[0],
    context,
  );
  for (const payload of [
    { operation: "SET_WEBSITE", websiteUrl: "javascript:alert(1)" },
    { operation: "SET_PHONE", primaryPhone: "---", additionalPhones: [] },
    {
      operation: "SET_PHONE",
      primaryPhone: null,
      additionalPhones: ["123", "456", "789"],
    },
    {
      operation: "SET_REGULAR_HOURS",
      regularHours: [{ ...regularHours[0], openTime: "25:00" }],
    },
    {
      operation: "SET_REGULAR_HOURS",
      regularHours: [{ ...regularHours[0], closeTime: "08:00" }],
    },
    {
      operation: "SET_SPECIAL_HOURS",
      specialHours: [{ ...specialHours[0], startDate: "2026-02-30" }],
    },
    {
      operation: "SET_SPECIAL_HOURS",
      specialHours: [{ ...specialHours[0], openTime: "12:00" }],
    },
    {
      operation: "SET_REGULAR_HOURS",
      regularHours: [regularHours[0], regularHours[0]],
    },
    {
      operation: "SET_SPECIAL_HOURS",
      specialHours: [specialHours[0], specialHours[0]],
    },
    { operation: "SET_DESCRIPTION", description: "x".repeat(751) },
    { operation: "UPDATE_LABELS", add: ["x".repeat(51)], remove: [] },
    { operation: "UPDATE_LABELS", add: ["same"], remove: ["same"] },
    { operation: "UPDATE_LABELS", add: [], remove: [] },
    {
      operation: "SET_SERVICE_ITEMS",
      serviceItems: [{ ...serviceItems[0], name: "" }],
    },
    {
      operation: "SET_SERVICE_ITEMS",
      serviceItems: [{ structuredServiceItem: { serviceTypeId: "google" } }],
    },
    {
      operation: "SET_DESCRIPTION",
      description: "ok",
      name: "Forbidden field",
    },
    { operation: "SET_STATUS", status: "OPEN" },
  ]) {
    await assert.rejects(
      service.bulkUpdateLocations({ ...base, ...payload }, context),
      (e) => e instanceof AppException && e.code === "VALIDATION_FAILED",
    );
    assert.deepEqual(await provider.getLocation(before.id, context), before);
  }
});

test("partial success includes failure reasons and leaves failed and unauthorized locations unchanged", async () => {
  const provider = new MockBusinessProfileProvider();
  const service = new BusinessProfileService(provider, undefined, false);
  const failed = await provider.getLocation("location-00003", context);
  const unauthorized = await provider.getLocation("location-00002", context);
  const original = provider.updateLocation.bind(provider);
  provider.updateLocation = async (id, input, scope) => {
    if (id === failed.id) throw new AppException("PROVIDER_ERROR");
    return original(id, input, scope);
  };
  const result = await service.bulkUpdateLocations(
    {
      ...base,
      selection: {
        kind: "EXPLICIT_IDS",
        locationIds: ["location-00001", failed.id, unauthorized.id, "missing"],
      },
      operation: "SET_DESCRIPTION",
      description: "New profile",
    },
    { ...context, accountIds: ["account-1"] },
  );
  assert.equal(result.totalSelected, 4);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 3);
  assert.deepEqual(result.results, [
    { locationId: "location-00001", success: true },
    { locationId: failed.id, success: false, reason: "PROVIDER_ERROR" },
    {
      locationId: unauthorized.id,
      success: false,
      reason: "PERMISSION_DENIED",
    },
    { locationId: "missing", success: false, reason: "RESOURCE_NOT_FOUND" },
  ]);
  assert.equal(
    (await provider.getLocation("location-00001", context)).description,
    "New profile",
  );
  assert.deepEqual(await provider.getLocation(failed.id, context), failed);
  assert.deepEqual(
    await provider.getLocation(unauthorized.id, context),
    unauthorized,
  );
  // Even a user authorized for both accounts cannot smuggle a different account into this command.
  const mismatch = await service.bulkUpdateLocations(
    {
      ...base,
      selection: { kind: "EXPLICIT_IDS", locationIds: [unauthorized.id] },
      operation: "SET_WEBSITE",
      websiteUrl: null,
    },
    context,
  );
  assert.equal(mismatch.results[0].success, false);
  assert.deepEqual(
    await provider.getLocation(unauthorized.id, context),
    unauthorized,
  );
});

test("Viewer, missing sessions and write-disable flag block bulk updates", async () => {
  const provider = new MockBusinessProfileProvider();
  const input = { ...base, operation: "SET_WEBSITE", websiteUrl: null };
  const service = new BusinessProfileService(provider, undefined, false);
  for (const scope of [
    { ...context, role: "VIEWER" as const },
    { ...context, accountIds: [] },
    { ...context, userId: "" },
  ])
    await assert.rejects(
      service.bulkUpdateLocations(input, scope),
      AppException,
    );
  await assert.rejects(
    new BusinessProfileService(provider, undefined, true).bulkUpdateLocations(
      input,
      context,
    ),
    (e) => e instanceof AppException && e.code === "PERMISSION_DENIED",
  );
  assert.equal(
    (await provider.getLocation(base.selection.locationIds[0], context))
      .websiteUrl,
    "https://location-1.example",
  );
});

test("merged labels are validated per location, yielding partial success at provider limit", async () => {
  const provider = new MockBusinessProfileProvider();
  const service = new BusinessProfileService(provider, undefined, false);
  await provider.updateLocation(
    "location-00003",
    { labels: Array.from({ length: 10 }, (_, i) => `Label ${i}`) },
    context,
  );
  const before = await provider.getLocation("location-00003", context);
  const result = await service.bulkUpdateLocations(
    { ...base, operation: "UPDATE_LABELS", add: ["New"], remove: [] },
    context,
  );
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(
    await provider.getLocation("location-00003", context),
    before,
  );
});

test("Google write method denies every supported field without network calls", async () => {
  // Call the read-only method without constructing OAuth credentials or making requests.
  for (const payload of cases) {
    const command = BulkLocationCommandSchema.parse({ ...base, ...payload });
    const { operation, selection, accountId, ...input } = command;
    void operation;
    void selection;
    void accountId;
    await assert.rejects(
      GoogleBusinessProfileProvider.prototype.updateLocation.call(
        {} as GoogleBusinessProfileProvider,
        "locations/google",
        input as unknown as import("@gbp/contracts").UpdateLocationInput,
        context,
      ),
      (e) => e instanceof AppException && e.code === "PERMISSION_DENIED",
    );
  }
});
