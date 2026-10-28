export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "SESSION_EXPIRED"
  | "PERMISSION_DENIED"
  | "VALIDATION_FAILED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "RESOURCE_NOT_FOUND"
  | "INTERNAL_ERROR";
/** Fixed validation reasons, never input values or third-party messages. */
export interface ApiErrorDetails {
  violations: Array<{
    field: string;
    reason: "REQUIRED" | "INVALID" | "OUT_OF_RANGE";
  }>;
}
export interface ApiError {
  code: ApiErrorCode;
  message: string;
  requestId: string;
  details: ApiErrorDetails | null;
}
