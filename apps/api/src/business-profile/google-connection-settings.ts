import type { AuthSettings } from "../auth/auth-settings";
import type { GoogleSettings } from "../auth/google/google-settings";
export interface GoogleConnectionSettings extends GoogleSettings {
  encryptionKey: string;
}
export function readGoogleConnectionSettings(
  env: NodeJS.ProcessEnv = process.env,
  auth?: AuthSettings,
): GoogleConnectionSettings | null {
  const mode = env.BUSINESS_PROFILE_PROVIDER ?? "mock";
  if (mode === "mock") return null;
  if (mode !== "google")
    throw new Error("BUSINESS_PROFILE_PROVIDER must be mock or google.");
  if (env.LOCAL_LAB_BROKEN_AUTHORIZATION === "true")
    throw new Error("Google provider cannot use authorization lab mode.");
  const clientId = env.GBP_GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GBP_GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = env.GBP_GOOGLE_REDIRECT_URI?.trim();
  const encryptionKey = env.GBP_TOKEN_ENCRYPTION_KEY?.trim();
  if (
    !clientId ||
    !clientSecret ||
    !redirectUri ||
    !encryptionKey ||
    !/^[a-fA-F0-9]{64}$/.test(encryptionKey)
  )
    throw new Error(
      "Google provider requires OAuth client, callback and a 32-byte hex GBP_TOKEN_ENCRYPTION_KEY.",
    );
  const callback = new URL(redirectUri);
  const web = new URL(
    auth?.webOrigin ?? env.WEB_ORIGIN ?? "http://localhost:3000",
  );
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(callback.hostname);
  if (
    callback.pathname !== "/auth/google-business/callback" ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password ||
    callback.hostname !== web.hostname ||
    callback.protocol !== web.protocol ||
    (callback.protocol !== "https:" &&
      !(
        callback.protocol === "http:" &&
        local &&
        ["development", "test"].includes(env.NODE_ENV ?? "")
      ))
  )
    throw new Error(
      "Business callback must be a fixed same-site HTTPS URL or local development HTTP URL.",
    );
  return { clientId, clientSecret, redirectUri: callback.href, encryptionKey };
}
