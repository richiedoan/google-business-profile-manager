import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ContentPageSchema,
  ContentResultSchema,
  type ContentCommand,
  type ContentKind,
} from "@gbp/contracts";
import { bffClient } from "./bff-client";
import { withConnection } from "./google-connections";
import { businessReadCacheOptions } from "./query-client";
export const contentKey = (
  userId: string,
  connectionId: string | undefined,
  locationId: string,
) => ["location-content", userId, connectionId ?? null, locationId] as const;
export function contentOptions(
  userId: string,
  connectionId: string | undefined,
  locationId: string,
  kind: ContentKind,
) {
  return {
    queryKey: [...contentKey(userId, connectionId, locationId), kind],
    enabled: !!userId,
    initialPageParam: undefined as string | undefined,
    queryFn: ({
      signal,
      pageParam,
    }: {
      signal: AbortSignal;
      pageParam: string | undefined;
    }) => {
      const params = new URLSearchParams();
      if (connectionId) params.set("connectionId", connectionId);
      if (pageParam) params.set("pageToken", pageParam);
      return bffClient.get(
        `/api/locations/${encodeURIComponent(locationId)}/content/${kind}?${params}`,
        (value) => {
          const page = ContentPageSchema.parse(value);
          if (
            page.kind !== kind ||
            page.items.some((item) => item.kind !== kind)
          )
            throw new Error("Invalid content kind");
          return page;
        },
        signal,
      );
    },
    getNextPageParam: (
      last: import("@gbp/contracts").ContentPage,
      _pages: unknown,
      _lastParam: unknown,
      params: unknown[],
    ) =>
      last.nextPageToken && !params.includes(last.nextPageToken)
        ? last.nextPageToken
        : undefined,
    ...businessReadCacheOptions,
    retry: false,
  };
}
export function useLocationContent(
  userId: string,
  connectionId: string | undefined,
  locationId: string,
  kind: ContentKind,
) {
  return useInfiniteQuery(
    contentOptions(userId, connectionId, locationId, kind),
  );
}
export function useContentMutation(
  userId: string,
  connectionId: string | undefined,
  locationId: string,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ContentCommand | FormData) =>
      bffClient.post(
        withConnection(
          `/api/locations/${encodeURIComponent(locationId)}/${input instanceof FormData ? "photos/upload" : "content"}`,
          connectionId,
        ),
        (value) => ContentResultSchema.parse(value),
        undefined,
        input,
      ),
    retry: false,
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: contentKey(userId, connectionId, locationId),
      });
    },
  });
}
