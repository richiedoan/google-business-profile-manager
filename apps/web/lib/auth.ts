"use client";
import { useQuery } from "@tanstack/react-query";
import type { UserView } from "@gbp/contracts";
import { bffClient, BffError, decodeUser } from "./bff-client";
import { queryKeys } from "./query-keys";
export function useMe() {
  return useQuery<UserView | null>({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => bffClient.get("/api/me", decodeUser, signal),
  });
}
export function authFailure(
  error: unknown,
): "expired" | "unauthenticated" | null {
  if (!(error instanceof BffError)) return null;
  return error.apiError.code === "SESSION_EXPIRED"
    ? "expired"
    : error.apiError.code === "UNAUTHENTICATED"
      ? "unauthenticated"
      : null;
}
