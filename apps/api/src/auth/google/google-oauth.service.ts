import { createHash, createHmac, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { AppException } from "../../errors/app.exception";
import { SessionService, hashSessionToken } from "../session.service";
import { GOOGLE_SETTINGS, GoogleSettings } from "./google-settings";
import {
  GOOGLE_IDENTITY_CLIENT,
  GoogleIdentityClient,
} from "./google-identity.client";
import {
  OAUTH_TRANSACTION_REPOSITORY,
  OAuthTransactionRepository,
} from "./oauth-transaction.repository";
export function pkceVerifier(settings: GoogleSettings, state: string): string {
  return createHmac("sha256", settings.clientSecret)
    .update("gbp-oidc-pkce-v1:")
    .update(state)
    .digest("base64url");
}
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
const ALLOWED_CALLBACK_FIELDS = new Set([
  "state",
  "code",
  "error",
  "error_description",
  "error_uri",
  "scope",
  "authuser",
  "prompt",
  "hd",
  "iss",
]);
@Injectable()
export class GoogleOAuthService {
  constructor(
    @Inject(GOOGLE_SETTINGS) private readonly settings: GoogleSettings | null,
    @Inject(GOOGLE_IDENTITY_CLIENT)
    private readonly google: GoogleIdentityClient,
    @Inject(OAUTH_TRANSACTION_REPOSITORY)
    private readonly transactions: OAuthTransactionRepository,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}
  async begin(previousBrowserToken?: string) {
    if (!this.settings) throw new AppException("RESOURCE_NOT_FOUND");
    const state = randomBytes(32).toString("hex");
    const browserToken = randomBytes(32).toString("hex");
    const nonce = randomBytes(32).toString("hex");
    await this.transactions.create(
      {
        stateHash: hashSessionToken(state),
        browserHash: hashSessionToken(browserToken),
        nonceHash: hashSessionToken(nonce),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
      previousBrowserToken ? hashSessionToken(previousBrowserToken) : undefined,
    );
    return {
      browserToken,
      url: this.google.authorizationUrl(
        this.settings,
        state,
        nonce,
        pkceChallenge(pkceVerifier(this.settings, state)),
      ),
    };
  }
  async callback(
    query: Record<string, unknown>,
    browserToken?: string,
    previousSession?: string,
  ) {
    if (!this.settings) throw new AppException("RESOURCE_NOT_FOUND");
    const state = query.state;
    if (
      typeof state !== "string" ||
      !/^[a-f0-9]{64}$/.test(state) ||
      !browserToken ||
      Object.entries(query).some(
        ([key, value]) =>
          !ALLOWED_CALLBACK_FIELDS.has(key) ||
          typeof value !== "string" ||
          value.length > 4096,
      )
    )
      throw new AppException("VALIDATION_FAILED");
    const transaction = await this.transactions.consume(
      hashSessionToken(state),
      hashSessionToken(browserToken),
    );
    if (!transaction) throw new AppException("VALIDATION_FAILED");
    if (
      (query.iss !== undefined &&
        query.iss !== "https://accounts.google.com") ||
      query.error !== undefined ||
      typeof query.code !== "string" ||
      !query.code ||
      query.error_description !== undefined ||
      query.error_uri !== undefined
    )
      throw new AppException("UNAUTHENTICATED");
    const identity = await this.google.exchange(
      this.settings,
      query.code,
      pkceVerifier(this.settings, state),
      transaction.nonceHash,
    );
    return this.sessions.googleLogin(identity, previousSession);
  }
}
