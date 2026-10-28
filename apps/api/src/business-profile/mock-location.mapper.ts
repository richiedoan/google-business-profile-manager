import type {
  LocationDetail,
  LocationSummary,
  LocationStatus,
} from "@gbp/contracts";
export interface MockLocationRecord {
  id: string;
  accountId: string;
  title: string;
  address: string;
  storeCode?: string;
  primaryCategory?: string;
  operatingState: "active" | "paused" | "closed";
  verification: "confirmed" | "pending";
  website: string | null;
  phone: string | null;
  fields?: Partial<
    Pick<
      LocationDetail,
      | "additionalPhones"
      | "regularHours"
      | "specialHours"
      | "description"
      | "labels"
      | "serviceItems"
    >
  >;
}
const STATUSES: Record<MockLocationRecord["operatingState"], LocationStatus> = {
  active: "OPEN",
  paused: "TEMPORARILY_CLOSED",
  closed: "PERMANENTLY_CLOSED",
};
export function mapMockSummary(
  record: MockLocationRecord,
): LocationSummary & Pick<LocationDetail, "verificationStatus"> {
  return {
    id: record.id,
    accountId: record.accountId,
    name: record.title,
    storeCode: record.storeCode ?? null,
    primaryCategory: record.primaryCategory ?? null,
    providerState: "MOCK",
    editable: true,
    formattedAddress: record.address,
    status: STATUSES[record.operatingState],
    verificationStatus:
      record.verification === "confirmed" ? "VERIFIED" : "PENDING",
  };
}
export function mapMockDetail(record: MockLocationRecord): LocationDetail {
  return {
    ...mapMockSummary(record),
    ...structuredClone(record.fields ?? {}),
    websiteUrl: record.website,
    primaryPhone: record.phone,
  };
}
