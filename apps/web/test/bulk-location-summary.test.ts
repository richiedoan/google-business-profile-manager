import { strict as assert } from "node:assert";
import { test } from "node:test";
import { BulkLocationCommandSchema, type LocationDetail } from "@gbp/contracts";
import { bulkLocationSummary } from "../lib/bulk-location-summary";
import { translate } from "../lib/i18n";
const base = {
  accountId: "a",
  selection: { kind: "EXPLICIT_IDS", locationIds: ["l"] },
};
test("phone detail preview omits unchanged values and translates actual deletions", () => {
  const initialData: LocationDetail = {
    id: "l",
    accountId: "a",
    name: "Location",
    formattedAddress: "",
    status: "OPEN",
    verificationStatus: "VERIFIED",
    websiteUrl: null,
    primaryPhone: "123",
    additionalPhones: [],
  };
  const command = BulkLocationCommandSchema.parse({
    ...base,
    operation: "SET_PHONE",
    primaryPhone: "789",
    additionalPhones: [],
  });
  const t = (key: string) => translate("vi", key);
  assert.deepEqual(bulkLocationSummary(command, { initialData, t }), [
    "Số điện thoại chính: 789",
  ]);
  assert.deepEqual(
    bulkLocationSummary(command, {
      initialData: {
        ...initialData,
        primaryPhone: "789",
        additionalPhones: ["456"],
      },
      t,
    }),
    ["Số điện thoại bổ sung: Xóa"],
  );
  assert.deepEqual(bulkLocationSummary(command, { t }), [
    "Số điện thoại chính: 789",
    "Số điện thoại bổ sung: Xóa",
  ]);
});
test("confirmation previews show the selected field's exact values and clearing semantics", () => {
  const cases: [Record<string, unknown>, string[]][] = [
    [{ operation: "SET_WEBSITE", websiteUrl: null }, ["Clear website"]],
    [
      {
        operation: "SET_PHONE",
        primaryPhone: "123",
        additionalPhones: ["456"],
      },
      ["Primary phone: 123", "Additional phones: 456"],
    ],
    [
      { operation: "SET_DESCRIPTION", description: "Line one\nLine two" },
      ["Line one\nLine two"],
    ],
    [
      { operation: "UPDATE_LABELS", add: ["New"], remove: ["Old"] },
      ["Add labels: New", "Remove labels: Old"],
    ],
    [
      {
        operation: "SET_SPECIAL_HOURS",
        specialHours: [
          {
            startDate: "2026-12-25",
            endDate: "2026-12-25",
            closed: true,
            openTime: null,
            closeTime: null,
          },
        ],
      },
      ["2026-12-25: Closed all day"],
    ],
    [
      {
        operation: "SET_SERVICE_ITEMS",
        serviceItems: [
          {
            name: "Service",
            description: "Details",
            category: null,
            languageCode: null,
            price: "100 USD",
          },
        ],
      },
      ["Service · Details · 100 USD"],
    ],
  ];
  for (const [payload, expected] of cases)
    assert.deepEqual(
      bulkLocationSummary(
        BulkLocationCommandSchema.parse({ ...base, ...payload }),
      ),
      expected,
    );
  const regular = bulkLocationSummary(
    BulkLocationCommandSchema.parse({
      ...base,
      operation: "SET_REGULAR_HOURS",
      regularHours: [
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
      ],
    }),
  );
  assert.equal(regular.length, 7);
  assert.equal(regular[0], "MONDAY: 09:00–12:00, 13:00–17:00");
  assert.equal(regular[6], "SUNDAY: Closed");
});
