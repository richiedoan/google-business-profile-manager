import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AUTH_SETTINGS, AuthSettings } from "../auth/auth-settings";
import { AuthenticatedRequest, SessionGuard } from "../auth/session.guard";
import { SessionService } from "../auth/session.service";
import { readSessionToken, sessionCookieOptions } from "../auth/session-cookie";
import { GoogleConnectionsService } from "./google-connections.service";
import { AppException } from "../errors/app.exception";
@Controller()
export class GoogleConnectionsController {
  constructor(
    @Inject(GoogleConnectionsService)
    private readonly connections: GoogleConnectionsService,
    @Inject(AUTH_SETTINGS) private readonly auth: AuthSettings,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}
  private cookieName() {
    return this.auth.secureCookie
      ? "__Host-gbp_business_oauth"
      : "gbp_business_oauth";
  }
  @Get("api/google-connections")
  @UseGuards(SessionGuard)
  list(@Req() request: AuthenticatedRequest) {
    return this.connections.list(request.sessionUser!.id);
  }
  @Post("api/google-connections/connect")
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async begin(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = readSessionToken(
      request.headers.cookie,
      this.auth.cookieName,
    );
    if (!session) throw new AppException("UNAUTHENTICATED");
    const result = await this.connections.begin(
      request.sessionUser!.id,
      session,
      readSessionToken(request.headers.cookie, this.cookieName()),
    );
    response.cookie(this.cookieName(), result.browserToken, {
      ...sessionCookieOptions(this.auth),
      maxAge: 600000,
    });
    return { url: result.url };
  }
  @Delete("api/google-connections/:id")
  @UseGuards(SessionGuard)
  disconnect(@Param("id") id: string, @Req() request: AuthenticatedRequest) {
    return this.connections.disconnect(request.sessionUser!.id, id);
  }
  @Get("auth/google-business/callback")
  async callback(@Req() request: Request, @Res() response: Response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.clearCookie(this.cookieName(), sessionCookieOptions(this.auth));
    try {
      const token = readSessionToken(
        request.headers.cookie,
        this.auth.cookieName,
      );
      const user = await this.sessions.authenticate(token);
      await this.connections.callback(
        user.id,
        token!,
        request.query,
        readSessionToken(request.headers.cookie, this.cookieName()),
      );
      response.redirect(
        303,
        `${this.auth.webOrigin}/app?googleConnection=success`,
      );
    } catch {
      response.redirect(
        303,
        `${this.auth.webOrigin}/app?googleConnection=error`,
      );
    }
  }
}
