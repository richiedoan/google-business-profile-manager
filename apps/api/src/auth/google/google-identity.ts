import { createHash, timingSafeEqual } from "node:crypto";
import { AppException } from "../../errors/app.exception";
export interface GoogleIdentity {
  subject: string;
  email: string;
  displayName: string;
  scopes: string[];
}
export function validateGoogleIdentity(
  payload: unknown,
  clientId: string,
  nonceHash: string,
  scopes: string[],
): GoogleIdentity {
  if (typeof payload !== "object" || payload === null)
    throw new AppException("UNAUTHENTICATED");
  const value: Record<string, unknown> = { ...payload };
  if (
    value.aud !== clientId ||
    (value.iss !== "https://accounts.google.com" &&
      value.iss !== "accounts.google.com") ||
    (value.azp !== undefined && value.azp !== clientId) ||
    typeof value.exp !== "number" ||
    !Number.isFinite(value.exp) ||
    value.exp <= Date.now() / 1000 ||
    typeof value.sub !== "string" ||
    value.sub.length < 1 ||
    value.sub.length > 255 ||
    typeof value.email !== "string" ||
    value.email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) ||
    value.email_verified !== true ||
    typeof value.nonce !== "string"
  )
    throw new AppException("UNAUTHENTICATED");
  const actualNonce = createHash("sha256").update(value.nonce).digest();
  const expectedNonce = Buffer.from(nonceHash, "hex");
  if (
    expectedNonce.length !== actualNonce.length ||
    !timingSafeEqual(actualNonce, expectedNonce)
  )
    throw new AppException("UNAUTHENTICATED");
  return {
    subject: value.sub,
    email: value.email.toLowerCase(),
    displayName:
      typeof value.name === "string" && value.name.trim()
        ? value.name.trim().slice(0, 200)
        : value.email,
    scopes,
  };
}
