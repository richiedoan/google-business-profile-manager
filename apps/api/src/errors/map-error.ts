import { HttpException } from "@nestjs/common";
import type { ApiError, ApiErrorCode } from "@gbp/contracts";
import { AppException } from "./app.exception";
const ERROR_RESPONSES: Record<
  ApiErrorCode,
  { status: number; message: string }
> = {
  UNAUTHENTICATED: { status: 401, message: "Authentication is required." },
  SESSION_EXPIRED: { status: 401, message: "Your session has expired." },
  PERMISSION_DENIED: {
    status: 403,
    message: "You do not have permission to perform this action.",
  },
  VALIDATION_FAILED: { status: 400, message: "The request is invalid." },
  PROVIDER_RATE_LIMITED: {
    status: 429,
    message: "The business profile provider is temporarily rate limited.",
  },
  PROVIDER_ERROR: {
    status: 502,
    message: "The business profile provider is unavailable.",
  },
  RESOURCE_NOT_FOUND: {
    status: 404,
    message: "The requested resource was not found.",
  },
  INTERNAL_ERROR: { status: 500, message: "An unexpected error occurred." },
};
function httpErrorCode(status: number): ApiErrorCode {
  switch (status) {
    case 400:
    case 422:
      return "VALIDATION_FAILED";
    case 401:
      return "UNAUTHENTICATED";
    case 403:
      return "PERMISSION_DENIED";
    case 404:
      return "RESOURCE_NOT_FOUND";
    default:
      return "INTERNAL_ERROR";
  }
}
export function mapError(
  exception: unknown,
  requestId: string,
): { status: number; body: ApiError } {
  const code =
    exception instanceof AppException
      ? exception.code
      : exception instanceof HttpException
        ? httpErrorCode(exception.getStatus())
        : "INTERNAL_ERROR";
  const response = ERROR_RESPONSES[code];
  return {
    status: response.status,
    body: {
      code,
      message: response.message,
      requestId,
      details:
        exception instanceof AppException && code === "VALIDATION_FAILED"
          ? exception.details
          : null,
    },
  };
}
