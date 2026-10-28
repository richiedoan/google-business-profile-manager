import {
  hasPermission,
  PerformanceRangeSchema,
  UpdateLocationInputSchema,
} from "@gbp/contracts";
import type {
  Account,
  ApiErrorCode,
  LocationDetail,
  LocationQuery,
  LocationSummary,
  PaginatedResult,
  PerformanceRange,
  PerformanceSummary,
  UpdateLocationInput,
} from "@gbp/contracts";
import { AppException } from "../errors/app.exception";
import { mockPerformance } from "./mock-performance";
import type {
  BusinessProfileProvider,
  UserContext,
} from "./business-profile.provider";
import {
  mapMockDetail,
  mapMockSummary,
  MockLocationRecord,
} from "./mock-location.mapper";
export type MockScenario =
  | "normal"
  | "unauthenticated"
  | "forbidden"
  | "notFound"
  | "rateLimited"
  | "providerError"
  | "networkError"
  | "pendingVerification";
export interface MockProviderOptions {
  locationCount?: number;
  scenario?: MockScenario;
}
const SCENARIO_ERRORS: Partial<Record<MockScenario, ApiErrorCode>> = {
  unauthenticated: "UNAUTHENTICATED",
  forbidden: "PERMISSION_DENIED",
  notFound: "RESOURCE_NOT_FOUND",
  rateLimited: "PROVIDER_RATE_LIMITED",
  providerError: "PROVIDER_ERROR",
  networkError: "PROVIDER_ERROR",
};
export class MockBusinessProfileProvider implements BusinessProfileProvider {
  private readonly accounts: Account[] = [
    { id: "account-1", name: "Mock North" },
    { id: "account-2", name: "Mock South" },
  ];
  private readonly records = new Map<string, MockLocationRecord>();
  private readonly scenario: MockScenario;
  constructor(options: MockProviderOptions = {}) {
    const count = options.locationCount ?? 1000;
    if (!Number.isInteger(count) || count < 1000 || count > 10000)
      throw new Error(
        "Mock location count must be an integer between 1000 and 10000.",
      );
    this.scenario = options.scenario ?? "normal";
    for (let index = 1; index <= count; index++) {
      const id = `location-${String(index).padStart(5, "0")}`;
      this.records.set(id, {
        id,
        accountId: index % 2 === 1 ? "account-1" : "account-2",
        title: `Mock Location ${String(index).padStart(5, "0")}`,
        address: `${index} Example Street, Mock City`,
        primaryCategory: ["Cafe", "Restaurant", "Bakery", "Florist"][
          (index - 1) % 4
        ],
        operatingState:
          index % 10 === 0 ? "closed" : index % 5 === 0 ? "paused" : "active",
        verification:
          this.scenario === "pendingVerification" || index % 7 === 0
            ? "pending"
            : "confirmed",
        website: `https://location-${index}.example`,
        phone: null,
      });
    }
  }
  private checkScenario(): void {
    const code = SCENARIO_ERRORS[this.scenario];
    if (code) throw new AppException(code);
  }
  private checkContext(context: UserContext): void {
    if (!context.userId) throw new AppException("UNAUTHENTICATED");
    if (!hasPermission(context.role, "location:read"))
      throw new AppException("PERMISSION_DENIED");
  }
  async listAccounts(context: UserContext): Promise<Account[]> {
    this.checkScenario();
    this.checkContext(context);
    return this.accounts
      .filter((account) => context.accountIds.includes(account.id))
      .map((account) => ({ ...account }));
  }
  async listLocations(
    accountId: string,
    query: LocationQuery,
  ): Promise<PaginatedResult<LocationSummary> & { total: number }> {
    this.checkScenario();
    if (!this.accounts.some((account) => account.id === accountId))
      throw new AppException("RESOURCE_NOT_FOUND");
    if (
      !Number.isSafeInteger(query.page) ||
      query.page < 1 ||
      !Number.isInteger(query.pageSize) ||
      query.pageSize < 1 ||
      query.pageSize > 100 ||
      (query.search !== undefined && typeof query.search !== "string") ||
      (query.status !== undefined &&
        !["OPEN", "TEMPORARILY_CLOSED", "PERMANENTLY_CLOSED"].includes(
          query.status,
        ))
    )
      throw new AppException("VALIDATION_FAILED");
    const search = query.search?.trim().toLowerCase() ?? "";
    const matches = [...this.records.values()]
      .filter((record) => record.accountId === accountId)
      .map(mapMockSummary)
      .filter(
        (location) =>
          (!query.status || location.status === query.status) &&
          (!search ||
            `${location.name} ${location.formattedAddress}`
              .toLowerCase()
              .includes(search)),
      );
    const start = (query.page - 1) * query.pageSize;
    return {
      items: matches.slice(start, start + query.pageSize),
      total: matches.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  private authorizedRecord(
    id: string,
    context: UserContext,
  ): MockLocationRecord {
    this.checkContext(context);
    const record = this.records.get(id);
    if (!record) throw new AppException("RESOURCE_NOT_FOUND");
    if (!context.accountIds.includes(record.accountId))
      throw new AppException("PERMISSION_DENIED");
    return record;
  }
  async getLocation(id: string, context: UserContext): Promise<LocationDetail> {
    this.checkScenario();
    return mapMockDetail(this.authorizedRecord(id, context));
  }
  async getPerformance(
    id: string,
    range: PerformanceRange,
    context: UserContext,
  ): Promise<PerformanceSummary> {
    this.checkScenario();
    const record = this.authorizedRecord(id, context);
    if (!PerformanceRangeSchema.safeParse(range).success)
      throw new AppException("VALIDATION_FAILED");
    return mockPerformance(record, range, context.connectionId);
  }
  async updateLocation(
    id: string,
    input: UpdateLocationInput,
    context: UserContext,
  ): Promise<LocationDetail> {
    this.checkScenario();
    const record = this.authorizedRecord(id, context);
    if (!hasPermission(context.role, "location:write"))
      throw new AppException("PERMISSION_DENIED");
    const parsed = UpdateLocationInputSchema.safeParse(input);
    if (!parsed.success) throw new AppException("VALIDATION_FAILED");
    const { websiteUrl, primaryPhone, ...fields } = parsed.data;
    if (websiteUrl !== undefined) record.website = websiteUrl;
    if (primaryPhone !== undefined) record.phone = primaryPhone;
    record.fields = { ...record.fields, ...structuredClone(fields) };
    return mapMockDetail(record);
  }
}
