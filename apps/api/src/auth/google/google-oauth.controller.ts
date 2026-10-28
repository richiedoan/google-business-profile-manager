import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AppException } from "../../errors/app.exception";
import { AUTH_SETTINGS, AuthSettings } from "../auth-settings";
import { readSessionToken, sessionCookieOptions } from "../session-cookie";
import { GoogleOAuthService } from "./google-oauth.service";
@Controller("auth/google")
export class GoogleOAuthController {
  constructor(
    @Inject(GoogleOAuthService) private readonly oauth: GoogleOAuthService,
    @Inject(AUTH_SETTINGS) private readonly auth: AuthSettings,
  ) {}
  private cookieName(): string {
    return this.auth.secureCookie ? "__Host-gbp_oauth" : "gbp_oauth";
  }
  private protectResponse(response: Response): void {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
  }
  @Get()
  async begin(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    this.protectResponse(response);
    if (
      Object.keys(request.query).length ||
      (request.headers.origin && request.headers.origin !== this.auth.webOrigin)
    )
      throw new AppException("VALIDATION_FAILED");
    const result = await this.oauth.begin(
      readSessionToken(request.headers.cookie, this.cookieName()),
    );
    response.cookie(this.cookieName(), result.browserToken, {
      ...sessionCookieOptions(this.auth),
      maxAge: 10 * 60 * 1000,
    });
    response.redirect(302, result.url);
  }
  @Get("callback")
  async callback(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    this.protectResponse(response);
    response.clearCookie(this.cookieName(), sessionCookieOptions(this.auth));
    try {
      const session = await this.oauth.callback(
        request.query,
        readSessionToken(request.headers.cookie, this.cookieName()),
        readSessionToken(request.headers.cookie, this.auth.cookieName),
      );
      response.cookie(this.auth.cookieName, session.token, {
        ...sessionCookieOptions(this.auth),
        expires: session.expiresAt,
      });
      response.redirect(303, `${this.auth.webOrigin}/app`);
    } catch {
      // Never render/log callback parameters, provider errors, or exceptions; remove the sensitive URL.
      response.redirect(303, `${this.auth.webOrigin}/login`);
    }
  }
}
