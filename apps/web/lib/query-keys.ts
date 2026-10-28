import type { LocationQuery } from "@gbp/contracts";
export const queryKeys = {
  me: ["me"] as const,
  accounts: ["accounts"] as const,
  locations: (accountId: string, query: LocationQuery) =>
    [
      "locations",
      accountId,
      {
        page: query.page,
        ...(query.pageToken ? { pageToken: query.pageToken } : {}),
        pageSize: query.pageSize,
        search: query.search,
        status: query.status,
      },
    ] as const,
  location: (locationId: string) => ["location", locationId] as const,
};
