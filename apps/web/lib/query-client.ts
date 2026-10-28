import { QueryClient } from "@tanstack/react-query";
import { BffError } from "./bff-client";
// Keep completed reads available during back/forward navigation.
// Mutations still invalidate affected queries immediately.
export const businessReadCacheOptions = {
  staleTime: 5 * 60_000,
  gcTime: 30 * 60_000,
} as const;
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) =>
          !(
            error instanceof BffError &&
            error.status >= 400 &&
            error.status < 500
          ) && failureCount < 3,
      },
    },
  });
}
