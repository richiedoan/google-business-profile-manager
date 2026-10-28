import { timingSafeEqual } from "node:crypto";
import { AppException } from "../errors/app.exception";
import { sessionCsrfToken } from "./session.service";
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { UserView } from "@gbp/contracts";
import { AUTH_SETTINGS, AuthSettings } from "./auth-settings";
import { SessionService } from "./session.service";
import { readSessionToken } from "./session-cookie";
export interface AuthenticatedRequest extends Request {
  sessionUser?: UserView;
}
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader("Cache-Control", "no-store");
    const token = readSessionToken(
      request.headers.cookie,
      this.settings.cookieName,
    );
    request.sessionUser = await this.sessions.authenticate(token);
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const proof = request.headers["x-csrf-token"];
      if (
        request.headers.origin !== this.settings.webOrigin ||
        !token ||
        typeof proof !== "string" ||
        !/^[a-f0-9]{64}$/.test(proof) ||
        !timingSafeEqual(
          Buffer.from(proof, "hex"),
          Buffer.from(sessionCsrfToken(token), "hex"),
        )
      )
        throw new AppException("PERMISSION_DENIED");
    }
    return true;
  }
}

@Injectable()
export class MutationGuard implements CanActivate {
  constructor(@Inject(SessionGuard) private readonly sessions: SessionGuard) {}
  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      !["POST", "PUT", "PATCH", "DELETE"].includes(request.method) ||
      (request.method === "POST" && request.path === "/auth/dev-login")
    )
      return true;
    return this.sessions.canActivate(context);
  }
}
