import type { CookieOptions } from "express";
import type { AuthSettings } from "./auth-settings";
export function sessionCookieOptions(settings: AuthSettings): CookieOptions {
  return {
    httpOnly: true,
    secure: settings.secureCookie,
    sameSite: "lax",
    path: "/",
  };
}
export function readSessionToken(
  cookie: string | undefined,
  name: string,
): string | undefined {
  const values = cookie
    ?.split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (!values || values.length !== 1) return undefined;
  const value = values[0]?.slice(name.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}
