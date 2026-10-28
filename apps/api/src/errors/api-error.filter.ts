import { randomUUID } from "node:crypto";
import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import type { ApiError } from "@gbp/contracts";
import { mapError } from "./map-error";
import { Prisma } from "../generated/prisma/client";
interface ErrorResponse {
  getHeader(name: string): unknown;
  setHeader(name: string, value: string): void;
  status(status: number): ErrorResponse;
  json(body: ApiError): void;
}
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ErrorResponse>();
    const header = response.getHeader("X-Request-Id");
    const requestId = typeof header === "string" ? header : randomUUID();
    const mapped = mapError(exception, requestId);
    if (mapped.status === 500) {
      // Log diagnostic identifiers only; database messages can contain secrets.
      const prismaCode =
        exception instanceof Prisma.PrismaClientKnownRequestError
          ? exception.code
          : exception instanceof Prisma.PrismaClientInitializationError
            ? exception.errorCode
            : undefined;
      console.error("API request failed", {
        requestId,
        category:
          exception instanceof Prisma.PrismaClientKnownRequestError ||
          exception instanceof Prisma.PrismaClientInitializationError
            ? "prisma"
            : "internal",
        prismaCode,
      });
    }
    response.setHeader("X-Request-Id", requestId);
    response.status(mapped.status).json(mapped.body);
  }
}
