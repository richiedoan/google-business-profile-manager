import type { AuthSettings } from "../auth-settings";
export interface GoogleSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}
export const GOOGLE_SETTINGS = Symbol("GoogleSettings");
export function readGoogleSettings(
  auth: AuthSettings,
  env: NodeJS.ProcessEnv = process.env,
): GoogleSettings | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (!clientId && !clientSecret && !redirectUri) return null;
  if (!clientId || !clientSecret || !redirectUri)
    throw new Error(
      "Complete server-side Google OAuth configuration is required.",
    );
  const callback = new URL(redirectUri);
  const web = new URL(auth.webOrigin);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(callback.hostname);
  if (
    callback.pathname !== "/auth/google/callback" ||
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
      "Google callback must be a fixed same-site HTTPS URL, or explicit local development HTTP URL.",
    );
  return { clientId, clientSecret, redirectUri: callback.href };
}
