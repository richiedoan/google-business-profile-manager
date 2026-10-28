import "reflect-metadata";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { generateKeyPairSync, createSign } from "node:crypto";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { OAuth2Client } from "google-auth-library";
import type { UserView } from "@gbp/contracts";
import { AppException } from "../src/errors/app.exception";
import { configureApp } from "../src/configure-app";
import { AuthController } from "../src/auth/auth.controller";
import { AUTH_SETTINGS, readAuthSettings } from "../src/auth/auth-settings";
import { SessionGuard } from "../src/auth/session.guard";
import {
  SessionRepository,
  SESSION_REPOSITORY,
  StoredSession,
} from "../src/auth/session.repository";
import { SessionService, hashSessionToken } from "../src/auth/session.service";
import {
  GOOGLE_SETTINGS,
  readGoogleSettings,
  GoogleSettings,
} from "../src/auth/google/google-settings";
import {
  GOOGLE_IDENTITY_CLIENT,
  GoogleIdentityClient,
  GoogleOidcClient,
} from "../src/auth/google/google-identity.client";
import {
  GoogleIdentity,
  validateGoogleIdentity,
} from "../src/auth/google/google-identity";
import {
  OAUTH_TRANSACTION_REPOSITORY,
  OAuthTransaction,
  OAuthTransactionRepository,
} from "../src/auth/google/oauth-transaction.repository";
import {
  GoogleOAuthService,
  pkceChallenge,
  pkceVerifier,
} from "../src/auth/google/google-oauth.service";
import { GoogleOAuthController } from "../src/auth/google/google-oauth.controller";
const auth = readAuthSettings({ NODE_ENV: "test" });
const settings: GoogleSettings = {
  clientId: "test-client",
  clientSecret: "test-only-client-secret",
  redirectUri: "http://localhost:3001/auth/google/callback",
};
const user: UserView = {
  id: "test-user",
  email: "user@example.test",
  displayName: "Test User",
  role: "VIEWER",
  permissions: ["location:read"],
};
class TestSessions implements SessionRepository {
  async updateLanguage() {}
  async updateTheme() {}

  records = new Map<string, StoredSession>();
  async createLocalSession(): Promise<UserView> {
    throw new Error("Not used in Google fixtures");
  }
  async createGoogleSession(
    _identity: GoogleIdentity,
    hash: string,
    expiresAt: Date,
    previousHash?: string,
  ) {
    if (previousHash) this.records.delete(previousHash);
    this.records.set(hash, { user, expiresAt });
    return user;
  }
  async find(hash: string) {
    return this.records.get(hash) ?? null;
  }
  async remove(hash: string) {
    this.records.delete(hash);
  }
}
class TestTransactions implements OAuthTransactionRepository {
  records = new Map<string, OAuthTransaction>();
  async create(record: OAuthTransaction, previousHash?: string) {
    for (const [key, existing] of this.records)
      if (existing.browserHash === previousHash) this.records.delete(key);
    this.records.set(record.stateHash, record);
  }
  async consume(stateHash: string, browserHash: string) {
    const record = this.records.get(stateHash);
    if (
      !record ||
      record.browserHash !== browserHash ||
      record.expiresAt.getTime() <= Date.now()
    )
      return null;
    this.records.delete(stateHash);
    return record;
  }
}
class TestGoogle implements GoogleIdentityClient {
  calls = 0;
  failure = false;
  expectedChallenge = "";
  expectedNonceHash = "";
  authorizationUrl(
    config: GoogleSettings,
    state: string,
    nonce: string,
    challenge: string,
  ) {
    this.expectedChallenge = challenge;
    this.expectedNonceHash = hashSessionToken(nonce);
    return new GoogleOidcClient().authorizationUrl(
      config,
      state,
      nonce,
      challenge,
    );
  }
  async exchange(
    _config: GoogleSettings,
    _code: string,
    verifier: string,
    nonceHash: string,
  ) {
    this.calls++;
    assert.ok(pkceChallenge(verifier) === this.expectedChallenge);
    assert.ok(nonceHash === this.expectedNonceHash);
    if (this.failure) throw new Error("FAKE_PROVIDER_SECRET");
    return {
      subject: "google-subject",
      email: user.email,
      displayName: user.displayName,
      scopes: ["openid", "email", "profile"],
    };
  }
}
function fixture(config: GoogleSettings | null = settings) {
  const transactions = new TestTransactions();
  const google = new TestGoogle();
  const sessions = new TestSessions();
  return {
    transactions,
    google,
    sessions,
    service: new GoogleOAuthService(
      config,
      google,
      transactions,
      new SessionService(sessions, auth),
    ),
  };
}
function stateOf(url: string) {
  const state = new URL(url).searchParams.get("state");
  assert.ok(state);
  return state;
}
const rejected = (code: string) => (error: unknown) =>
  error instanceof AppException && error.code === code;
test("Google config defaults off and rejects partial, cross-site, nonlocal HTTP, query and fragment callbacks", () => {
  assert.equal(readGoogleSettings(auth, {}), null);
  assert.throws(() =>
    readGoogleSettings(auth, { GOOGLE_OAUTH_CLIENT_ID: "test" }),
  );
  for (const redirect of [
    "http://evil.example/auth/google/callback",
    "http://localhost:3001/other",
    "http://localhost:3001/auth/google/callback?next=evil",
    "http://localhost:3001/auth/google/callback#fragment",
  ])
    assert.throws(() =>
      readGoogleSettings(auth, {
        NODE_ENV: "test",
        GOOGLE_OAUTH_CLIENT_ID: "test",
        GOOGLE_OAUTH_CLIENT_SECRET: "test",
        GOOGLE_OAUTH_REDIRECT_URI: redirect,
      }),
    );
  assert.equal(
    readGoogleSettings(auth, {
      NODE_ENV: "test",
      GOOGLE_OAUTH_CLIENT_ID: "test",
      GOOGLE_OAUTH_CLIENT_SECRET: "test",
      GOOGLE_OAUTH_REDIRECT_URI: settings.redirectUri,
    })?.redirectUri,
    settings.redirectUri,
  );
});
test("authorization URL uses code, S256, state, nonce and online identity scopes without a client secret", async () => {
  const f = fixture();
  const start = await f.service.begin();
  const url = new URL(start.url);
  const state = stateOf(start.url);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("access_type"), "online");
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("nonce"));
  assert.equal(url.searchParams.has("client_secret"), false);
  assert.ok(
    url.searchParams.get("code_challenge") ===
      pkceChallenge(pkceVerifier(settings, state)),
  );
  assert.ok(f.transactions.records.has(hashSessionToken(state)));
  assert.ok(!f.transactions.records.has(state));
  const result = await f.service.callback(
    { state, code: "test-code" },
    start.browserToken,
  );
  assert.deepEqual(result.user, user);
  assert.ok(f.sessions.records.has(hashSessionToken(result.token)));
  assert.ok(!f.sessions.records.has(result.token));
  await assert.rejects(
    f.service.callback({ state, code: "test-code" }, start.browserToken),
    rejected("VALIDATION_FAILED"),
  );
  assert.equal(f.google.calls, 1);
});
test("state, browser binding, expiry and unexpected callback parameters reject before code exchange", async () => {
  for (const kind of [
    "missing",
    "wrong",
    "browser",
    "expired",
    "duplicate",
    "redirect",
    "issuer",
    "denied",
    "mixed",
    "noCode",
  ]) {
    const f = fixture();
    const start = await f.service.begin();
    const state = stateOf(start.url);
    const query: Record<string, unknown> = { state, code: "test-code" };
    let binding: string | undefined = start.browserToken;
    if (kind === "missing") delete query.state;
    if (kind === "wrong") query.state = "0".repeat(64);
    if (kind === "browser") binding = undefined;
    if (kind === "expired") {
      const record = f.transactions.records.get(hashSessionToken(state));
      assert.ok(record);
      record.expiresAt = new Date(0);
    }
    if (kind === "duplicate") query.state = [state, state];
    if (kind === "redirect") query.redirect_uri = "https://evil.example";
    if (kind === "issuer") query.iss = "https://evil.example";
    if (kind === "denied") {
      delete query.code;
      query.error = "access_denied";
    }
    if (kind === "mixed") query.error = "access_denied";
    if (kind === "noCode") delete query.code;
    await assert.rejects(f.service.callback(query, binding));
    assert.equal(f.google.calls, 0);
    assert.equal(f.sessions.records.size, 0);
  }
  const f = fixture(null);
  await assert.rejects(f.service.begin(), rejected("RESOURCE_NOT_FOUND"));
});
test("a new pending attempt invalidates the prior browser attempt", async () => {
  const f = fixture();
  const first = await f.service.begin();
  await f.service.begin(first.browserToken);
  await assert.rejects(
    f.service.callback(
      { state: stateOf(first.url), code: "code" },
      first.browserToken,
    ),
    rejected("VALIDATION_FAILED"),
  );
});
const nonce = "test-nonce";
const nonceHash = hashSessionToken(nonce);
const payload = {
  aud: settings.clientId,
  iss: "https://accounts.google.com",
  sub: "google-sub",
  email: "USER@example.test",
  email_verified: true,
  nonce,
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  name: "Test User",
};
test("verified OIDC payload requires audience, issuer, expiry, nonce, subject and verified email", () => {
  assert.equal(
    validateGoogleIdentity(payload, settings.clientId, nonceHash, ["openid"])
      .email,
    "user@example.test",
  );
  for (const invalid of [
    { ...payload, aud: "other" },
    { ...payload, iss: "https://evil.example" },
    { ...payload, exp: 0 },
    { ...payload, nonce: "other" },
    { ...payload, sub: "" },
    { ...payload, email_verified: false },
    { ...payload, azp: "other" },
  ])
    assert.throws(
      () => validateGoogleIdentity(invalid, settings.clientId, nonceHash, []),
      rejected("UNAUTHENTICATED"),
    );
});
test("Google SDK verifies signature, audience and issuer using a signed fixture, not decoded JWT claims", async () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwt = (claims: object) => {
    const input = `${Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
    const sign = createSign("RSA-SHA256");
    sign.update(input);
    return `${input}.${sign.sign(keys.privateKey).toString("base64url")}`;
  };
  const certs = {
    "test-key": keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  };
  const client = new OAuth2Client();
  const ticket = await client.verifySignedJwtWithCertsAsync(
    jwt(payload),
    certs,
    settings.clientId,
    ["https://accounts.google.com"],
  );
  assert.equal(
    validateGoogleIdentity(
      ticket.getPayload(),
      settings.clientId,
      nonceHash,
      [],
    ).subject,
    "google-sub",
  );
  for (const invalid of [
    { ...payload, aud: "wrong" },
    { ...payload, iss: "https://evil.example" },
    { ...payload, exp: 1 },
  ])
    await assert.rejects(
      client.verifySignedJwtWithCertsAsync(
        jwt(invalid),
        certs,
        settings.clientId,
        ["https://accounts.google.com"],
      ),
    );
  const wrongKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await assert.rejects(
    client.verifySignedJwtWithCertsAsync(
      jwt(payload),
      {
        "test-key": wrongKeys.publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
      },
      settings.clientId,
    ),
  );
});
test("HTTP callback creates the same guarded session and all failures redirect to clean fixed routes", async () => {
  const f = fixture();
  @Module({
    controllers: [GoogleOAuthController, AuthController],
    providers: [
      { provide: AUTH_SETTINGS, useValue: auth },
      { provide: GOOGLE_SETTINGS, useValue: settings },
      { provide: GOOGLE_IDENTITY_CLIENT, useValue: f.google },
      { provide: OAUTH_TRANSACTION_REPOSITORY, useValue: f.transactions },
      { provide: SESSION_REPOSITORY, useValue: f.sessions },
      SessionService,
      SessionGuard,
      GoogleOAuthService,
    ],
  })
  class TestModule {}
  const app = await NestFactory.create(TestModule, {
    logger: false,
    abortOnError: false,
  });
  configureApp(app, auth);
  await app.listen(0, "127.0.0.1");
  const url = await app.getUrl();
  try {
    const begin = await fetch(`${url}/auth/google`, { redirect: "manual" });
    assert.equal(begin.status, 302);
    const redirect = begin.headers.get("location");
    assert.ok(redirect);
    const state = stateOf(redirect);
    const binding = begin.headers.get("set-cookie")?.split(";")[0] ?? "";
    assert.ok(binding.startsWith("gbp_oauth="));
    const callback = await fetch(
      `${url}/auth/google/callback?state=${state}&code=test-code`,
      { headers: { Cookie: binding }, redirect: "manual" },
    );
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get("location"), `${auth.webOrigin}/app`);
    assert.equal(callback.headers.get("referrer-policy"), "no-referrer");
    const session =
      callback.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith("gbp_session="))
        ?.split(";")[0] ?? "";
    assert.ok(session);
    const me = await fetch(`${url}/api/me`, { headers: { Cookie: session } });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), user);
    for (const path of [
      `/auth/google/callback?state=${state}&code=test-code`,
      "/auth/google/callback?code=test-code",
    ]) {
      const rejectedResponse = await fetch(url + path, {
        headers: { Cookie: binding },
        redirect: "manual",
      });
      assert.equal(
        rejectedResponse.headers.get("location"),
        `${auth.webOrigin}/login`,
      );
      assert.ok(
        !rejectedResponse.headers
          .getSetCookie()
          .some((cookie) => cookie.startsWith("gbp_session=")),
      );
    }
    const again = await fetch(`${url}/auth/google`, { redirect: "manual" });
    const nextUrl = again.headers.get("location");
    assert.ok(nextUrl);
    f.google.failure = true;
    const failed = await fetch(
      `${url}/auth/google/callback?state=${stateOf(nextUrl)}&code=fake-secret-code`,
      {
        headers: {
          Cookie: again.headers.get("set-cookie")?.split(";")[0] ?? "",
        },
        redirect: "manual",
      },
    );
    assert.equal(failed.headers.get("location"), `${auth.webOrigin}/login`);
    assert.ok(!(await failed.text()).includes("FAKE_PROVIDER_SECRET"));
    assert.equal(f.sessions.records.size, 1);
  } finally {
    await app.close();
  }
});
