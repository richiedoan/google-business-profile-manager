import "reflect-metadata";
import "dotenv/config";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { GoogleConnectionsService } from "../src/business-profile/google-connections.service";
import { readGoogleConnectionSettings } from "../src/business-profile/google-connection-settings";
import { TokenCipher } from "../src/business-profile/token-cipher";
import { GOOGLE_BUSINESS_SCOPE } from "../src/business-profile/google-business-profile.provider";
import { PrismaService } from "../src/database/prisma.service";
import { AppException } from "../src/errors/app.exception";

const settings = {
  clientId: "test-client",
  clientSecret: "test-secret",
  redirectUri: "http://localhost:3001/auth/google-business/callback",
  encryptionKey: "ab".repeat(32),
};
const rejects = (code: string) => (error: unknown) =>
  error instanceof AppException && error.code === code;

test("Business configuration requires only shared credentials, callback and encryption key", () => {
  assert.equal(readGoogleConnectionSettings({}), null);
  const env = {
    NODE_ENV: "test",
    BUSINESS_PROFILE_PROVIDER: "google",
    GBP_GOOGLE_CLIENT_ID: settings.clientId,
    GBP_GOOGLE_CLIENT_SECRET: settings.clientSecret,
    GBP_GOOGLE_REDIRECT_URI: settings.redirectUri,
    GBP_TOKEN_ENCRYPTION_KEY: settings.encryptionKey,
  };
  assert.deepEqual(readGoogleConnectionSettings(env), settings);
  for (const patch of [
    { GBP_TOKEN_ENCRYPTION_KEY: "bad" },
    {
      GBP_GOOGLE_REDIRECT_URI:
        "https://other.example/auth/google-business/callback",
    },
    { GBP_GOOGLE_REDIRECT_URI: settings.redirectUri + "?next=bad" },
    { LOCAL_LAB_BROKEN_AUTHORIZATION: "true" },
  ]) {
    assert.throws(() => readGoogleConnectionSettings({ ...env, ...patch }));
  }
});

test("stored refresh tokens reject tampering and cross-owner decryption", () => {
  const cipher = new TokenCipher(settings.encryptionKey);
  const encrypted = cipher.encrypt("private-refresh", "user:google-subject");
  assert.ok(!encrypted.includes("private-refresh"));
  assert.notEqual(
    encrypted,
    cipher.encrypt("private-refresh", "user:google-subject"),
  );
  assert.equal(
    cipher.decrypt(encrypted, "user:google-subject"),
    "private-refresh",
  );
  assert.throws(() => cipher.decrypt(encrypted, "another:google-subject"));
  const parts = encrypted.split(".");
  parts[2] = Buffer.alloc(16).toString("base64url");
  assert.throws(() => cipher.decrypt(parts.join("."), "user:google-subject"));
});

const skip =
  process.env.RUN_SESSION_DB_TESTS !== "true" ||
  process.env.NODE_ENV !== "test";
test(
  "PostgreSQL multi-Gmail consent, callback bindings, token isolation, reconnect and disconnect",
  { skip },
  async () => {
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(process.env.DATABASE_URL ?? "").hostname,
      ),
      "Use a loopback test database",
    );
    const prisma = new PrismaService();
    const users: string[] = [];
    const session = "a".repeat(64);
    let nonce = "";
    let subject = "gmail-a";
    let refresh: string | undefined = "refresh-a";
    let grantScope = GOOGLE_BUSINESS_SCOPE;
    let exchanges = 0;
    const realClient = new OAuth2Client();
    const oauth = {
      generateAuthUrl: (
        options: Parameters<OAuth2Client["generateAuthUrl"]>[0],
      ) => {
        nonce = String(options?.nonce ?? "");
        return realClient.generateAuthUrl({
          ...options,
          client_id: settings.clientId,
          redirect_uri: settings.redirectUri,
        });
      },
      getToken: async () => {
        exchanges++;
        return {
          tokens: {
            id_token: "fixture-id-token",
            refresh_token: refresh,
            scope: `openid email ${grantScope}`,
          },
        };
      },
      verifyIdToken: async () => ({
        getPayload: () => ({
          aud: settings.clientId,
          iss: "https://accounts.google.com",
          exp: Date.now() / 1000 + 3600,
          sub: subject,
          email: `${subject}@example.test`,
          email_verified: true,
          nonce,
        }),
      }),
    } as unknown as Pick<
      OAuth2Client,
      "generateAuthUrl" | "getToken" | "verifyIdToken"
    >;
    const refreshCalls: string[] = [];
    const readTokens: string[] = [];
    let revoked = false;
    const fetcher = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (String(input).includes("oauth2.googleapis.com")) {
        const token = (init?.body as URLSearchParams).get("refresh_token")!;
        refreshCalls.push(token);
        return new Response(
          JSON.stringify(
            revoked
              ? { error: "invalid_grant" }
              : { access_token: token, token_type: "Bearer", expires_in: 3600 },
          ),
          { status: revoked ? 400 : 200 },
        );
      }
      const token = (init?.headers as Record<string, string>).Authorization;
      readTokens.push(token);
      return new Response(
        JSON.stringify({
          accounts: [
            {
              name: `accounts/${token.endsWith("a") ? "123" : "456"}`,
              accountName: "Business",
            },
          ],
        }),
      );
    }) as typeof fetch;
    const service = new GoogleConnectionsService(
      prisma,
      settings,
      fetcher,
      () => oauth,
    );
    async function begin(userId: string) {
      const pending = await service.begin(userId, session);
      const url = new URL(pending.url);
      assert.equal(url.searchParams.get("access_type"), "offline");
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      assert.ok(url.searchParams.get("scope")?.includes(GOOGLE_BUSINESS_SCOPE));
      assert.equal(url.searchParams.has("client_secret"), false);
      return {
        pending,
        query: { state: url.searchParams.get("state")!, code: "fixture-code" },
      };
    }
    try {
      await prisma.$connect();
      for (let index = 0; index < 2; index++) {
        const row = await prisma.user.create({
          data: {
            email: `${randomUUID()}@example.test`,
            displayName: "Fixture",
          },
        });
        users.push(row.id);
      }
      const [owner, other] = users;
      const first = await begin(owner);
      await assert.rejects(
        service.callback(owner, session, first.query, "wrong-browser"),
        rejects("VALIDATION_FAILED"),
      );
      await assert.rejects(
        service.callback(
          owner,
          "b".repeat(64),
          first.query,
          first.pending.browserToken,
        ),
        rejects("VALIDATION_FAILED"),
      );
      await assert.rejects(
        service.callback(
          other,
          session,
          first.query,
          first.pending.browserToken,
        ),
        rejects("VALIDATION_FAILED"),
      );
      assert.equal(exchanges, 0);
      const results = await Promise.allSettled([
        service.callback(
          owner,
          session,
          first.query,
          first.pending.browserToken,
        ),
        service.callback(
          owner,
          session,
          first.query,
          first.pending.browserToken,
        ),
      ]);
      assert.equal(
        results.filter((row) => row.status === "fulfilled").length,
        1,
      );
      assert.equal(exchanges, 1);
      const a = (await service.list(owner)).connections[0];
      assert.deepEqual(Object.keys(a).sort(), ["email", "id", "status"]);
      assert.equal((await service.list(other)).connections.length, 0);
      const stored = await prisma.googleBusinessConnection.findUniqueOrThrow({
        where: { id: a.id },
      });
      assert.ok(!stored.encryptedRefreshToken.includes("refresh-a"));
      await assert.rejects(
        service.resolve(other, "VIEWER", a.id),
        rejects("PERMISSION_DENIED"),
      );
      await assert.rejects(
        service.disconnect(other, a.id),
        rejects("RESOURCE_NOT_FOUND"),
      );
      assert.deepEqual(
        (await service.resolve(owner, "VIEWER", a.id))?.accounts.map(
          (row) => row.id,
        ),
        ["123"],
      );
      subject = "gmail-b";
      refresh = "refresh-b";
      const second = await begin(owner);
      await service.callback(
        owner,
        session,
        second.query,
        second.pending.browserToken,
      );
      const b = (await service.list(owner)).connections.find(
        (row) => row.id !== a.id,
      )!;
      assert.deepEqual(
        (await service.resolve(owner, "VIEWER", b.id))?.accounts.map(
          (row) => row.id,
        ),
        ["456"],
      );
      assert.deepEqual(refreshCalls, ["refresh-a", "refresh-b"]);
      assert.deepEqual(readTokens, ["Bearer refresh-a", "Bearer refresh-b"]);
      // Google may omit refresh_token on repeat consent: keep this connection's existing grant.
      refresh = undefined;
      const repeat = await begin(owner);
      await service.callback(
        owner,
        session,
        repeat.query,
        repeat.pending.browserToken,
      );
      assert.equal((await service.list(owner)).connections.length, 2);
      revoked = true;
      await assert.rejects(
        service.resolve(owner, "VIEWER", b.id),
        rejects("UNAUTHENTICATED"),
      );
      assert.equal(
        (await service.list(owner)).connections.find((row) => row.id === b.id)
          ?.status,
        "RECONNECT_REQUIRED",
      );
      const expired = await begin(owner);
      await prisma.googleBusinessOAuthTransaction.update({
        where: {
          stateHash: (
            await import("../src/auth/session.service")
          ).hashSessionToken(expired.query.state),
        },
        data: { expiresAt: new Date(0) },
      });
      await assert.rejects(
        service.callback(
          owner,
          session,
          expired.query,
          expired.pending.browserToken,
        ),
        rejects("VALIDATION_FAILED"),
      );
      grantScope = "";
      const missingScope = await begin(owner);
      await assert.rejects(
        service.callback(
          owner,
          session,
          missingScope.query,
          missingScope.pending.browserToken,
        ),
        rejects("PERMISSION_DENIED"),
      );
      await service.disconnect(owner, a.id);
      await assert.rejects(
        service.resolve(owner, "VIEWER", a.id),
        rejects("PERMISSION_DENIED"),
      );
      assert.equal((await service.list(owner)).connections.length, 1);
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
  },
);

test("connection resolution retains verified memberships and discards them on revision or disconnect", async () => {
  const id = randomUUID();
  const cipher = new TokenCipher(settings.encryptionKey);
  let row: {
    id: string;
    userId: string;
    googleSubject: string;
    status: string;
    encryptedRefreshToken: string;
    updatedAt: Date;
  } | null = {
    id,
    userId: "owner",
    googleSubject: "google",
    status: "ACTIVE",
    encryptedRefreshToken: cipher.encrypt("refresh", "owner:google"),
    updatedAt: new Date("2026-10-05T00:00:00Z"),
  };
  const prisma = {
    googleBusinessConnection: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; id?: string };
      }) =>
        row && row.userId === where.userId && (!where.id || row.id === where.id)
          ? row
          : null,
      deleteMany: async () => {
        row = null;
        return { count: 1 };
      },
    },
  } as unknown as PrismaService;
  const calls: URL[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    const body =
      url.hostname === "oauth2.googleapis.com"
        ? { access_token: "token", token_type: "Bearer", expires_in: 3600 }
        : url.hostname === "mybusinessaccountmanagement.googleapis.com"
          ? { accounts: [{ name: "accounts/123", accountName: "Business" }] }
          : url.pathname === "/v1/locations/456"
            ? { name: "locations/456", title: "Shop" }
            : { locations: [{ name: "locations/456", title: "Shop" }] };
    return new Response(JSON.stringify(body));
  }) as typeof fetch;
  const service = new GoogleConnectionsService(prisma, settings, fetcher);
  const first = (await service.resolve("owner", "VIEWER", id))!;
  await first.provider.listLocations(
    "123",
    { page: 1, pageSize: 25 },
    first.context,
  );
  const count = calls.length;
  const second = (await service.resolve("owner", "VIEWER", id))!;
  assert.equal(second.provider, first.provider);
  await second.provider.getLocation("456", second.context);
  assert.equal(calls.length, count + 1);
  await assert.rejects(
    service.resolve("another", "VIEWER", id),
    rejects("PERMISSION_DENIED"),
  );
  assert.equal(calls.length, count + 1);
  row!.updatedAt = new Date("2026-10-05T00:01:00Z");
  const revised = (await service.resolve("owner", "VIEWER", id))!;
  assert.notEqual(revised.provider, first.provider);
  const afterRevision = calls.length;
  assert.equal(
    (await revised.provider.getLocation("456", revised.context)).accountId,
    "123",
  );
  assert.equal(calls.length, afterRevision + 2);
  await service.disconnect("owner", id);
  await assert.rejects(
    service.resolve("owner", "VIEWER", id),
    rejects("PERMISSION_DENIED"),
  );
  assert.equal(calls.length, afterRevision + 2);
});
