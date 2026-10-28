import type { ApiErrorCode, ApiErrorDetails } from "@gbp/contracts";
/** Only pass application-owned validation field names, never request values. */
export class AppException extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly details: ApiErrorDetails | null = null,
  ) {
    super(code);
  }
}
