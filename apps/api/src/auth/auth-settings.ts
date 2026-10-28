import { readAuthorizationLabMode } from "../lab/authorization-lab";
import { readCorsLabMode } from "../lab/cors-lab";
export interface AuthSettings {
  webOrigin: string;
  secureCookie: boolean;
  cookieName: string;
  devLoginEnabled: boolean;
  labCors?: boolean;
  labAuthorization?: boolean;
}
export const AUTH_SETTINGS = Symbol("AuthSettings");
export function readAuthSettings(
  env: NodeJS.ProcessEnv = process.env,
): AuthSettings {
  const origin = new URL(env.WEB_ORIGIN ?? "http://localhost:3000");
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("WEB_ORIGIN must be an HTTP(S) origin.");
  const secureCookie = origin.protocol === "https:";
  if (env.NODE_ENV === "production" && !secureCookie)
    throw new Error("Production requires an HTTPS WEB_ORIGIN.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  return {
    labAuthorization: readAuthorizationLabMode(origin.origin, env),
    labCors: readCorsLabMode(origin.origin, env),
    webOrigin: origin.origin,
    secureCookie,
    cookieName: secureCookie ? "__Host-gbp_session" : "gbp_session",
    devLoginEnabled:
      env.LOCAL_DEV_LOGIN_ENABLED === "true" &&
      ["development", "test"].includes(env.NODE_ENV ?? "") &&
      local,
  };
}
