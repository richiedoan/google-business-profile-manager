import type {
  Account,
  AppRole,
  LocationDetail,
  LocationQuery,
  LocationSummary,
  PaginatedResult,
  UpdateLocationInput,
} from "@gbp/contracts";
/** Constructed by server-side authentication/authorization, never from request JSON. */
export interface UserContext {
  userId: string;
  role: AppRole;
  accountIds: readonly string[];
  connectionId?: string;
  /** Server-resolved provider for the owned Google connection. */
  scopedProvider?: BusinessProfileProvider;
}
export interface BusinessProfileProvider {
  getDailyPerformance?(
    id: string,
    range: import("@gbp/contracts").PerformanceRange,
    context: UserContext,
  ): Promise<import("@gbp/contracts").PerformanceSummary>;
  listContent?(
    id: string,
    kind: import("@gbp/contracts").ContentKind,
    pageToken: string | undefined,
    context: UserContext,
  ): Promise<import("@gbp/contracts").ContentPage>;
  mutateContent?(
    id: string,
    command: import("@gbp/contracts").ContentCommand,
    context: UserContext,
  ): Promise<{ status: "ok" }>;
  uploadPhoto?(
    id: string,
    file: { buffer: Buffer; mimetype: string },
    category: string,
    context: UserContext,
  ): Promise<{ status: "ok" }>;
  getPerformance?(
    locationId: string,
    range: import("@gbp/contracts").PerformanceRange,
    context: UserContext,
  ): Promise<import("@gbp/contracts").PerformanceSummary>;
  listAccounts(userContext: UserContext): Promise<Account[]>;
  listLocations(
    accountId: string,
    query: LocationQuery,
    userContext?: UserContext,
  ): Promise<PaginatedResult<LocationSummary>>;
  getLocation(
    locationId: string,
    userContext: UserContext,
  ): Promise<LocationDetail>;
  updateLocation(
    locationId: string,
    input: UpdateLocationInput,
    userContext: UserContext,
  ): Promise<LocationDetail>;
}
export const BUSINESS_PROFILE_PROVIDER = Symbol("BusinessProfileProvider");
