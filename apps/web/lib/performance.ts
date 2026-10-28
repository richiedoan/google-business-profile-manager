import { queryOptions } from "@tanstack/react-query";
import {
  PerformanceSummarySchema,
  type PerformanceRange,
} from "@gbp/contracts";
import { bffClient } from "./bff-client";
import { withConnection } from "./google-connections";
import { businessReadCacheOptions } from "./query-client";
export function performanceOptions(
  userId: string,
  connectionId: string | undefined,
  locationId: string,
  range: PerformanceRange,
) {
  return queryOptions({
    queryKey: [
      "performance",
      userId,
      connectionId ?? null,
      locationId,
      range.startDate,
      range.endDate,
    ],
    enabled: !!userId,
    queryFn: ({ signal }) =>
      bffClient.get(
        withConnection(
          `/api/locations/${encodeURIComponent(locationId)}/performance?${new URLSearchParams(range)}`,
          connectionId,
        ),
        (value) => PerformanceSummarySchema.parse(value),
        signal,
      ),
    ...businessReadCacheOptions,
    retry: false,
  });
}
