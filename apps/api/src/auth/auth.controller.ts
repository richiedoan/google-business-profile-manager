import {
  Controller,
  Patch,
  Body,
  Get,
  Post,
  HttpCode,
  Inject,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { UserView } from "@gbp/contracts";
import { AppException } from "../errors/app.exception";
import { AUTH_SETTINGS, AuthSettings } from "./auth-settings";
import { readSessionToken, sessionCookieOptions } from "./session-cookie";
import { SessionService, sessionCsrfToken } from "./session.service";
import { AuthenticatedRequest, SessionGuard } from "./session.guard";
@Controller()
export class AuthController {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings,
  ) {}
  @Post("auth/dev-login")
  @HttpCode(200)
  async devLogin(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserView> {
    response.setHeader("Cache-Control", "no-store");
    const session = await this.sessions.devLogin(
      readSessionToken(request.headers.cookie, this.settings.cookieName),
    );
    response.cookie(this.settings.cookieName, session.token, {
      ...sessionCookieOptions(this.settings),
      expires: session.expiresAt,
    });
    return session.user;
  }
  @Get("api/me")
  @UseGuards(SessionGuard)
  me(@Req() request: AuthenticatedRequest): UserView {
    if (!request.sessionUser) throw new AppException("UNAUTHENTICATED");
    return request.sessionUser;
  }
  @Patch("api/me/preferences")
  @UseGuards(SessionGuard)
  async preferences(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<UserView> {
    if (!request.sessionUser) throw new AppException("UNAUTHENTICATED");
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppException("VALIDATION_FAILED");
    const preferences = body as Record<string, unknown>;
    const keys = Object.keys(preferences);
    if (
      !keys.length ||
      keys.some(
        (key) => key !== "themePreference" && key !== "languagePreference",
      ) ||
      ("themePreference" in preferences &&
        !["light", "dark", "system"].includes(
          preferences.themePreference as string,
        )) ||
      ("languagePreference" in preferences &&
        !["en", "vi"].includes(preferences.languagePreference as string))
    )
      throw new AppException("VALIDATION_FAILED");
    if ("themePreference" in preferences)
      await this.sessions.updateTheme(
        request.sessionUser.id,
        preferences.themePreference as "light" | "dark" | "system",
      );
    if ("languagePreference" in preferences)
      await this.sessions.updateLanguage(
        request.sessionUser.id,
        preferences.languagePreference as "en" | "vi",
      );
    return { ...request.sessionUser, ...preferences } as UserView;
  }
  @Get("api/csrf")
  @UseGuards(SessionGuard)
  csrf(@Req() request: Request): { csrfToken: string } {
    if (
      request.headers.origin &&
      request.headers.origin !== this.settings.webOrigin
    )
      throw new AppException("PERMISSION_DENIED");
    const token = readSessionToken(
      request.headers.cookie,
      this.settings.cookieName,
    );
    if (!token) throw new AppException("UNAUTHENTICATED");
    return { csrfToken: sessionCsrfToken(token) };
  }
  @Post("api/logout")
  @UseGuards(SessionGuard)
  @HttpCode(200)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ status: "ok" }> {
    response.setHeader("Cache-Control", "no-store");
    await this.sessions.logout(
      readSessionToken(request.headers.cookie, this.settings.cookieName),
    );
    response.clearCookie(
      this.settings.cookieName,
      sessionCookieOptions(this.settings),
    );
    return { status: "ok" };
  }
}
