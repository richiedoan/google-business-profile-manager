import type { GoogleIdentity } from "./google/google-identity";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { UserView } from "@gbp/contracts";
import { AppException } from "../errors/app.exception";
import { AUTH_SETTINGS, AuthSettings } from "./auth-settings";
import { SESSION_REPOSITORY, SessionRepository } from "./session.repository";
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
@Injectable()
export class SessionService {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly repository: SessionRepository,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings,
  ) {}
  async devLogin(previousToken?: string) {
    if (!this.settings.devLoginEnabled)
      throw new AppException("RESOURCE_NOT_FOUND");
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const user = await this.repository.createLocalSession(
      hashSessionToken(token),
      expiresAt,
      previousToken ? hashSessionToken(previousToken) : undefined,
    );
    return { token, expiresAt, user };
  }
  async googleLogin(identity: GoogleIdentity, previousToken?: string) {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const user = await this.repository.createGoogleSession(
      identity,
      hashSessionToken(token),
      expiresAt,
      previousToken ? hashSessionToken(previousToken) : undefined,
    );
    return { token, expiresAt, user };
  }
  async authenticate(token?: string): Promise<UserView> {
    if (!token) throw new AppException("UNAUTHENTICATED");
    const session = await this.repository.find(hashSessionToken(token));
    if (!session) throw new AppException("UNAUTHENTICATED");
    if (session.expiresAt.getTime() <= Date.now())
      throw new AppException("SESSION_EXPIRED");
    if (!session.user) throw new AppException("PERMISSION_DENIED");
    return session.user;
  }
  async updateLanguage(userId: string, language: "en" | "vi") {
    await this.repository.updateLanguage(userId, language);
  }
  async updateTheme(userId: string, theme: "light" | "dark" | "system") {
    await this.repository.updateTheme(userId, theme);
  }
  async logout(token?: string): Promise<void> {
    if (token) await this.repository.remove(hashSessionToken(token));
  }
}

export function sessionCsrfToken(token: string): string {
  return createHmac("sha256", token)
    .update("gbp-session-csrf-v1")
    .digest("hex");
}
