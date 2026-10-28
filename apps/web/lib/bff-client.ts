import type {
  ApiError,
  ApiErrorCode,
  HealthResponse,
  UserView,
} from "@gbp/contracts";
const CODES: readonly ApiErrorCode[] = [
  "UNAUTHENTICATED",
  "SESSION_EXPIRED",
  "PERMISSION_DENIED",
  "VALIDATION_FAILED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_ERROR",
  "RESOURCE_NOT_FOUND",
  "INTERNAL_ERROR",
];
function isCode(value: unknown): value is ApiErrorCode {
  return CODES.some((code) => code === value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseError(value: unknown): ApiError | null {
  if (
    !isRecord(value) ||
    !isCode(value.code) ||
    typeof value.message !== "string" ||
    typeof value.requestId !== "string"
  )
    return null;
  const details: ApiError["details"] =
    value.details === null ? null : { violations: [] };
  if (value.details !== null) {
    if (!isRecord(value.details) || !Array.isArray(value.details.violations))
      return null;
    for (const item of value.details.violations) {
      if (
        !isRecord(item) ||
        typeof item.field !== "string" ||
        (item.reason !== "REQUIRED" &&
          item.reason !== "INVALID" &&
          item.reason !== "OUT_OF_RANGE")
      )
        return null;
      details?.violations.push({ field: item.field, reason: item.reason });
    }
  }
  return {
    code: value.code,
    message: value.message,
    requestId: value.requestId,
    details,
  };
}
export class BffError extends Error {
  constructor(
    readonly apiError: ApiError,
    readonly status: number,
  ) {
    super(apiError.message);
    this.name = "BffError";
  }
}
function fallback(status: number, requestId: string): BffError {
  const code: ApiErrorCode =
    status === 401
      ? "UNAUTHENTICATED"
      : status === 403
        ? "PERMISSION_DENIED"
        : status === 404
          ? "RESOURCE_NOT_FOUND"
          : "INTERNAL_ERROR";
  return new BffError(
    {
      code,
      message: "Unable to complete the request. Please try again.",
      requestId,
      details: null,
    },
    status,
  );
}
/** Browser BFF transport; every success payload must pass an explicit decoder. */
export function createBffClient(origin: string, fetcher: typeof fetch = fetch) {
  async function request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    decode: (value: unknown) => T,
    signal?: AbortSignal,
    payload?: unknown,
  ): Promise<T> {
    if (!path.startsWith("/") || path.startsWith("//"))
      throw new Error("BFF path must be relative to the configured origin.");
    const base = origin || window.location.origin;
    const url = new URL(path, base);
    if (url.origin !== new URL(base).origin)
      throw new Error("BFF path must use the configured origin.");
    const mutation = method !== "GET";
    const multipart =
      typeof FormData !== "undefined" && payload instanceof FormData;
    const csrf =
      mutation && url.pathname !== "/auth/dev-login"
        ? await request(
            "GET",
            "/api/csrf",
            (value: unknown) => {
              if (
                !isRecord(value) ||
                typeof value.csrfToken !== "string" ||
                !/^[a-f0-9]{64}$/.test(value.csrfToken)
              )
                throw new Error("Invalid CSRF response");
              return value.csrfToken;
            },
            signal,
          )
        : undefined;
    let response: Response;
    try {
      response = await fetcher(url, {
        method,
        credentials: url.pathname === "/health" ? "omit" : "include",
        headers: {
          Accept: "application/json",
          ...(mutation && !multipart
            ? { "Content-Type": "application/json" }
            : {}),
          ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        },
        body: mutation
          ? multipart
            ? (payload as FormData)
            : JSON.stringify(payload ?? {})
          : undefined,
        signal,
        cache: "no-store",
        redirect: "error",
      });
    } catch (error: unknown) {
      if (signal?.aborted) throw error;
      throw fallback(0, "unavailable");
    }
    const requestId = response.headers.get("X-Request-Id") ?? "unavailable";
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      if (signal?.aborted)
        throw new DOMException("Request aborted", "AbortError");
      throw fallback(response.status, requestId);
    }
    if (!response.ok)
      throw new BffError(
        parseError(body) ?? fallback(response.status, requestId).apiError,
        response.status,
      );
    try {
      return decode(body);
    } catch {
      throw fallback(response.status, requestId);
    }
  }
  return {
    patch: <T>(
      path: string,
      decode: (value: unknown) => T,
      signal?: AbortSignal,
      payload?: unknown,
    ) => request("PATCH", path, decode, signal, payload),
    delete: <T>(
      path: string,
      decode: (value: unknown) => T,
      signal?: AbortSignal,
    ) => request("DELETE", path, decode, signal),
    googleLoginUrl: origin
      ? new URL("/auth/google", origin).href
      : "/auth/google",
    get: <T>(
      path: string,
      decode: (value: unknown) => T,
      signal?: AbortSignal,
    ) => request("GET", path, decode, signal),
    post: <T>(
      path: string,
      decode: (value: unknown) => T,
      signal?: AbortSignal,
      payload?: unknown,
    ) => request("POST", path, decode, signal, payload),
  };
}
export function decodeHealth(value: unknown): HealthResponse {
  if (!isRecord(value) || value.status !== "ok")
    throw new Error("Invalid health response");
  return { status: "ok" };
}
export const bffClient = createBffClient(
  process.env.NEXT_PUBLIC_BFF_ORIGIN ?? "",
);

export function decodeUser(value: unknown): UserView {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.email !== "string" ||
    typeof value.displayName !== "string" ||
    (value.role !== "VIEWER" && value.role !== "MANAGER") ||
    !Array.isArray(value.permissions) ||
    value.permissions.some(
      (permission) =>
        permission !== "location:read" && permission !== "location:write",
    ) ||
    (value.languagePreference !== undefined &&
      value.languagePreference !== null &&
      value.languagePreference !== "en" &&
      value.languagePreference !== "vi") ||
    (value.themePreference !== undefined &&
      value.themePreference !== null &&
      value.themePreference !== "light" &&
      value.themePreference !== "dark" &&
      value.themePreference !== "system") ||
    new Set(value.permissions).size !== value.permissions.length
  )
    throw new Error("Invalid user response");
  return {
    ...(value.languagePreference !== undefined
      ? {
          languagePreference:
            value.languagePreference as UserView["languagePreference"],
        }
      : {}),
    ...(value.themePreference !== undefined
      ? {
          themePreference: value.themePreference as UserView["themePreference"],
        }
      : {}),
    id: value.id,
    email: value.email,
    displayName: value.displayName,
    role: value.role,
    permissions: value.permissions as UserView["permissions"],
  };
}
