import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { AppException } from "../../errors/app.exception";
import type { GoogleSettings } from "./google-settings";
import { GoogleIdentity, validateGoogleIdentity } from "./google-identity";
export const GOOGLE_IDENTITY_CLIENT = Symbol("GoogleIdentityClient");
export interface GoogleIdentityClient {
  authorizationUrl(
    settings: GoogleSettings,
    state: string,
    nonce: string,
    challenge: string,
  ): string;
  exchange(
    settings: GoogleSettings,
    code: string,
    verifier: string,
    nonceHash: string,
  ): Promise<GoogleIdentity>;
}
export class GoogleOidcClient implements GoogleIdentityClient {
  private client(settings: GoogleSettings): OAuth2Client {
    return new OAuth2Client({
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      redirectUri: settings.redirectUri,
      transporterOptions: { timeout: 10000, retry: false },
    });
  }
  authorizationUrl(
    settings: GoogleSettings,
    state: string,
    nonce: string,
    challenge: string,
  ): string {
    return this.client(settings).generateAuthUrl({
      response_type: "code",
      scope: ["openid", "email", "profile"],
      access_type: "online",
      include_granted_scopes: false,
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
  }
  async exchange(
    settings: GoogleSettings,
    code: string,
    verifier: string,
    nonceHash: string,
  ): Promise<GoogleIdentity> {
    // Per-exchange client: no setCredentials, token-event handlers, logging, or shared credentials cache.
    const client = this.client(settings);
    let idToken: string | undefined;
    let scopes: string[] = [];
    try {
      const { tokens } = await client.getToken({
        code,
        codeVerifier: verifier,
        redirect_uri: settings.redirectUri,
      });
      idToken = tokens.id_token ?? undefined;
      scopes = tokens.scope?.split(/\s+/).filter(Boolean) ?? [];
      // Access/refresh tokens are deliberately discarded; this step is identity login only.
    } catch {
      throw new AppException("PROVIDER_ERROR");
    }
    if (!idToken) throw new AppException("UNAUTHENTICATED");
    let payload: unknown;
    try {
      payload = (
        await client.verifyIdToken({ idToken, audience: settings.clientId })
      ).getPayload();
    } catch {
      throw new AppException("UNAUTHENTICATED");
    }
    return validateGoogleIdentity(
      payload,
      settings.clientId,
      nonceHash,
      scopes,
    );
  }
}
