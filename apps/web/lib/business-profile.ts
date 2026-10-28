import { LocationDetailFieldsSchema } from "@gbp/contracts";
import { withConnection } from "./google-connections";
import type {
  UpdateLocationInput,
  Account,
  LocationDetail,
  LocationQuery,
  LocationStatus,
  LocationSummary,
  PaginatedResult,
} from "@gbp/contracts";
import {
  useMutation,
  useQueryClient,
  useQuery,
  useInfiniteQuery,
  infiniteQueryOptions,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { bffClient } from "./bff-client";
import { queryKeys } from "./query-keys";
import { businessReadCacheOptions } from "./query-client";
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid profile response");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid profile text");
  return value;
}
export function decodeAccounts(value: unknown): Account[] {
  if (!Array.isArray(value)) throw new Error("Invalid accounts");
  return value.map((item) => {
    const row = record(item);
    return { id: text(row.id), name: text(row.name) };
  });
}
export function decodeSummary(value: unknown): LocationSummary {
  const row = record(value);
  if (
    row.status !== "OPEN" &&
    row.status !== "TEMPORARILY_CLOSED" &&
    row.status !== "PERMANENTLY_CLOSED"
  )
    throw new Error("Invalid status");
  if (
    row.verificationStatus !== undefined &&
    row.verificationStatus !== "VERIFIED" &&
    row.verificationStatus !== "PENDING" &&
    row.verificationStatus !== "UNKNOWN"
  )
    throw new Error("Invalid verification");
  if (
    row.providerState !== undefined &&
    row.providerState !== "READ" &&
    row.providerState !== "MOCK"
  )
    throw new Error("Invalid provider state");
  if (row.editable !== undefined && typeof row.editable !== "boolean")
    throw new Error("Invalid edit capability");
  return {
    ...(row.storeCode !== undefined
      ? { storeCode: row.storeCode === null ? null : text(row.storeCode) }
      : {}),
    ...(row.primaryCategory !== undefined
      ? {
          primaryCategory:
            row.primaryCategory === null ? null : text(row.primaryCategory),
        }
      : {}),
    ...(row.providerState !== undefined
      ? { providerState: row.providerState }
      : {}),
    ...(typeof row.editable === "boolean" ? { editable: row.editable } : {}),
    id: text(row.id),
    accountId: text(row.accountId),
    name: text(row.name),
    formattedAddress: text(row.formattedAddress),
    status: row.status,
    ...(row.verificationStatus !== undefined
      ? { verificationStatus: row.verificationStatus }
      : {}),
  };
}
export function decodeLocations(
  value: unknown,
): PaginatedResult<LocationSummary> {
  const row = record(value);
  if (
    !Array.isArray(row.items) ||
    (row.total !== null &&
      (typeof row.total !== "number" ||
        !Number.isSafeInteger(row.total) ||
        row.total < 0)) ||
    (row.nextPageToken !== undefined &&
      row.nextPageToken !== null &&
      (typeof row.nextPageToken !== "string" ||
        !row.nextPageToken ||
        row.nextPageToken.length > 4096)) ||
    typeof row.page !== "number" ||
    !Number.isSafeInteger(row.page) ||
    row.page < 1 ||
    typeof row.pageSize !== "number" ||
    !Number.isInteger(row.pageSize) ||
    row.pageSize < 1 ||
    row.pageSize > 100 ||
    row.items.length > row.pageSize
  )
    throw new Error("Invalid page");
  return {
    items: row.items.map(decodeSummary),
    total: row.total as number | null,
    ...(row.nextPageToken !== undefined
      ? { nextPageToken: row.nextPageToken as string | null }
      : {}),
    page: row.page,
    pageSize: row.pageSize,
  };
}
export function decodeLocation(value: unknown): LocationDetail {
  const row = record(value);
  return {
    ...decodeSummary(row),
    ...LocationDetailFieldsSchema.parse(row),
    verificationStatus: decodeSummary(row).verificationStatus ?? "UNKNOWN",
    websiteUrl: row.websiteUrl === null ? null : text(row.websiteUrl),
    primaryPhone: row.primaryPhone === null ? null : text(row.primaryPhone),
  };
}
export const statusLabels: Record<LocationStatus, string> = {
  OPEN: "Open",
  TEMPORARILY_CLOSED: "Temporarily closed",
  PERMANENTLY_CLOSED: "Permanently closed",
};
export function locationsPath(accountId: string, query: LocationQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.pageToken) params.set("pageToken", query.pageToken);
  if (query.search) params.set("search", query.search);
  if (query.status) params.set("status", query.status);
  return `/api/accounts/${encodeURIComponent(accountId)}/locations?${params}`;
}
export function useAccounts(connectionId?: string, enabled = true) {
  return useQuery({
    queryKey: connectionId
      ? [...queryKeys.accounts, connectionId]
      : queryKeys.accounts,
    enabled,
    queryFn: ({ signal }) =>
      bffClient.get(
        withConnection("/api/accounts", connectionId),
        decodeAccounts,
        signal,
      ),
    ...businessReadCacheOptions,
  });
}
export function useLocations(
  accountId: string,
  query: LocationQuery,
  connectionId?: string,
) {
  return useQuery({
    queryKey: connectionId
      ? [...queryKeys.locations(accountId, query), connectionId]
      : queryKeys.locations(accountId, query),
    queryFn: ({ signal }) =>
      bffClient.get(
        withConnection(locationsPath(accountId, query), connectionId),
        decodeLocations,
        signal,
      ),
    ...businessReadCacheOptions,
  });
}
type LocationPageParam = Pick<LocationQuery, "page" | "pageToken">;
export function infiniteLocationsOptions(
  accountId: string,
  query: LocationQuery,
  connectionId?: string,
) {
  return infiniteQueryOptions({
    queryKey: [
      "locations-infinite",
      accountId,
      { pageSize: query.pageSize, search: query.search, status: query.status },
      ...(connectionId ? [connectionId] : []),
    ],
    initialPageParam: { page: 1 } as LocationPageParam,
    queryFn: ({ signal, pageParam }) =>
      bffClient.get(
        withConnection(
          locationsPath(accountId, {
            ...query,
            pageToken: undefined,
            ...pageParam,
          }),
          connectionId,
        ),
        decodeLocations,
        signal,
      ),
    getNextPageParam: (
      lastPage,
      _pages,
      lastParam,
      pageParams,
    ): LocationPageParam | undefined => {
      if (lastPage.nextPageToken !== undefined) {
        const token = lastPage.nextPageToken;
        if (!token || pageParams.some((param) => param.pageToken === token))
          return undefined;
        return { page: lastParam.page + 1, pageToken: token };
      }
      if (
        lastPage.total === null ||
        lastParam.page * query.pageSize >= lastPage.total ||
        !lastPage.items.length
      )
        return undefined;
      return { page: lastParam.page + 1 };
    },
    ...businessReadCacheOptions,
  });
}
export function useInfiniteLocations(
  accountId: string,
  query: LocationQuery,
  connectionId?: string,
) {
  return useInfiniteQuery(
    infiniteLocationsOptions(accountId, query, connectionId),
  );
}
export function useLocation(id: string, connectionId?: string) {
  return useQuery({
    queryKey: connectionId
      ? [...queryKeys.location(id), connectionId]
      : queryKeys.location(id),
    queryFn: ({ signal }) =>
      bffClient.get(
        withConnection(
          `/api/locations/${encodeURIComponent(id)}`,
          connectionId,
        ),
        decodeLocation,
        signal,
      ),
    ...businessReadCacheOptions,
  });
}

export function useUpdateLocation(id: string, connectionId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateLocationInput) =>
      bffClient.patch(
        withConnection(
          `/api/locations/${encodeURIComponent(id)}`,
          connectionId,
        ),
        decodeLocation,
        undefined,
        input,
      ),
    onSuccess: (detail) => updateLocationCache(client, detail, connectionId),
  });
}

export async function updateLocationCache(
  client: QueryClient,
  detail: LocationDetail,
  connectionId?: string,
) {
  const id = detail.id;
  await client.cancelQueries({
    queryKey: connectionId
      ? [...queryKeys.location(id), connectionId]
      : queryKeys.location(id),
    exact: true,
  });
  client.setQueryData(
    connectionId
      ? [...queryKeys.location(id), connectionId]
      : queryKeys.location(id),
    detail,
  );
  await client.invalidateQueries({
    predicate: (query) =>
      (query.queryKey[0] === "locations" ||
        query.queryKey[0] === "locations-infinite") &&
      query.queryKey[1] === detail.accountId &&
      (connectionId
        ? query.queryKey[3] === connectionId
        : query.queryKey.length === 3) &&
      !!(query.queryKey[0] === "locations-infinite"
        ? (
            query.state.data as
              InfiniteData<PaginatedResult<LocationSummary>> | undefined
          )?.pages.some((page) => page.items.some((item) => item.id === id))
        : (
            query.state.data as PaginatedResult<LocationSummary> | undefined
          )?.items.some((item) => item.id === id)),
  });
}

/** Refresh only successful details and cached lists containing a changed location. */
export async function invalidateBulkLocationQueries(
  client: QueryClient,
  accountId: string,
  ids: readonly string[],
  connectionId?: string,
) {
  const affected = new Set(ids);
  if (!affected.size) return;
  await client.invalidateQueries({
    predicate: (query) => {
      const [kind, resource] = query.queryKey;
      if (kind === "location")
        return (
          affected.has(String(resource)) &&
          (connectionId
            ? query.queryKey[2] === connectionId
            : query.queryKey.length === 2)
        );
      if (
        (kind !== "locations" && kind !== "locations-infinite") ||
        resource !== accountId ||
        (connectionId
          ? query.queryKey[3] !== connectionId
          : query.queryKey.length !== 3)
      )
        return false;
      const data = query.state.data;
      return kind === "locations-infinite"
        ? !!(
            data as InfiniteData<PaginatedResult<LocationSummary>> | undefined
          )?.pages.some((page) =>
            page.items.some((item) => affected.has(item.id)),
          )
        : !!(data as PaginatedResult<LocationSummary> | undefined)?.items.some(
            (item) => affected.has(item.id),
          );
    },
  });
}
