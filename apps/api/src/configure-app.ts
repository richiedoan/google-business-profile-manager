import type { Request } from "express";
import { AppException } from "./errors/app.exception";
import { readAuthSettings, AuthSettings } from "./auth/auth-settings";
import { randomUUID } from "node:crypto";
import { ApiErrorFilter } from "./errors/api-error.filter";
import type { INestApplication } from "@nestjs/common";
export function configureApp(
  app: INestApplication,
  settings: AuthSettings = readAuthSettings(),
): void {
  app.use(
    (
      request: Request,
      response: { setHeader(name: string, value: string): void },
      next: (error?: unknown) => void,
    ) => {
      response.setHeader("X-Request-Id", randomUUID());
      response.setHeader("Cache-Control", "no-store");
      if (
        request.method === "POST" &&
        request.path === "/auth/dev-login" &&
        request.headers.origin !== settings.webOrigin
      ) {
        next(new AppException("PERMISSION_DENIED"));
        return;
      }
      next();
    },
  );
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableCors(
    (
      request: Request,
      callback: (
        error: Error | null,
        options: import("@nestjs/common/interfaces/external/cors-options.interface").CorsOptions,
      ) => void,
    ) => {
      callback(null, {
        origin: settings.labCors ? true : [settings.webOrigin],
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        credentials: request.path !== "/health",
        allowedHeaders: ["Content-Type", "X-CSRF-Token"],
        exposedHeaders: ["X-Request-Id"],
      });
    },
  );
  app.enableShutdownHooks();
}
