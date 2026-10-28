import type { LocationQuery, LocationStatus } from "@gbp/contracts";
import { AppException } from "../errors/app.exception";
export function parseLocationQuery(
  raw: Record<string, unknown>,
): LocationQuery {
  function invalid(field: string): never {
    throw new AppException("VALIDATION_FAILED", {
      violations: [{ field, reason: "INVALID" }],
    });
  }
  function number(field: string, fallback: number, max: number): number {
    const value = raw[field];
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value))
      return invalid(field);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed > max) return invalid(field);
    return parsed;
  }
  const page = number("page", 1, Number.MAX_SAFE_INTEGER);
  const pageSize = number("pageSize", 25, 100);
  const pageToken = raw.pageToken;
  if (
    pageToken !== undefined &&
    (typeof pageToken !== "string" || !pageToken || pageToken.length > 4096)
  )
    invalid("pageToken");
  const search = raw.search;
  if (
    search !== undefined &&
    (typeof search !== "string" || search.length > 200)
  )
    invalid("search");
  const status = raw.status;
  if (
    status !== undefined &&
    status !== "OPEN" &&
    status !== "TEMPORARILY_CLOSED" &&
    status !== "PERMANENTLY_CLOSED"
  )
    invalid("status");
  return {
    page,
    pageSize,
    ...(typeof pageToken === "string" ? { pageToken } : {}),
    ...(typeof search === "string" && search.trim()
      ? { search: search.trim() }
      : {}),
    ...(status ? { status: status as LocationStatus } : {}),
  };
}
