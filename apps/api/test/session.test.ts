import "reflect-metadata";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Module, Controller, Patch, Delete } from "@nestjs/common";
import { NestFactory, APP_GUARD } from "@nestjs/core";
import type { UserView } from "@gbp/contracts";
import { AuthController } from "../src/auth/auth.controller";
import {
  AUTH_SETTINGS,
  readAuthSettings,
  AuthSettings,
} from "../src/auth/auth-settings";
import {
  SESSION_REPOSITORY,
  SessionRepository,
  StoredSession,
} from "../src/auth/session.repository";
import {
  hashSessionToken,
  SessionService,
  sessionCsrfToken,
} from "../src/auth/session.service";
import { SessionGuard, MutationGuard } from "../src/auth/session.guard";
import {
  readSessionToken,
  sessionCookieOptions,
} from "../src/auth/session-cookie";
import { configureApp } from "../src/configure-app";
const local = readAuthSettings({
  NODE_ENV: "test",
  LOCAL_DEV_LOGIN_ENABLED: "true",
});
/** Explicit test-only store. Production wiring always uses PrismaSessionRepository. */
class TestRepository implements SessionRepository {
  async updateLanguage(userId: string, language: "en" | "vi") {
    assert.equal(userId, this.user.id);
    this.user.languagePreference = language;
  }
  async updateTheme(userId: string, theme: "light" | "dark" | "system") {
    assert.equal(userId, this.user.id);
    this.user.themePreference = theme;
  }

  sessions = new Map<string, StoredSession>();
  user: UserView = {
    id: "test-user",
    email: "viewer@example.test",
    displayName: "Viewer",
    role: "VIEWER",
    permissions: ["location:read"],
  };
  async createLocalSession(
    hash: string,
    expiresAt: Date,
    previousHash?: string,
  ) {
    if (previousHash) this.sessions.delete(previousHash);
    this.sessions.set(hash, { user: this.user, expiresAt });
    return this.user;
  }
  async createGoogleSession(): Promise<UserView> {
    throw new Error("Google login is not used by this test fixture.");
  }
  async find(hash: string) {
    return this.sessions.get(hash) ?? null;
  }
  async remove(hash: string) {
    this.sessions.delete(hash);
  }
}
async function fixture(settings: AuthSettings = local) {
  const repository = new TestRepository();
  @Controller("api/probe")
  class ProbeController {
    @Patch() patch() {
      return { status: "ok" };
    }
    @Delete() delete() {
      return { status: "ok" };
    }
  }
  @Module({
    controllers: [AuthController, ProbeController],
    providers: [
      { provide: SESSION_REPOSITORY, useValue: repository },
      { provide: AUTH_SETTINGS, useValue: settings },
      SessionService,
      SessionGuard,
      MutationGuard,
      { provide: APP_GUARD, useExisting: MutationGuard },
    ],
  })
  class TestModule {}
  const app = await NestFactory.create(TestModule, {
    logger: false,
    abortOnError: false,
  });
  configureApp(app, settings);
  await app.listen(0, "127.0.0.1");
  return { app, repository, url: await app.getUrl() };
}
async function code(response: Response) {
  const body: unknown = await response.json();
  assert.ok(typeof body === "object" && body !== null && "code" in body);
  return body.code;
}
test("local login defaults off, never enables in production or nonlocal environments", () => {
  assert.equal(
    readAuthSettings({ NODE_ENV: "development" }).devLoginEnabled,
    false,
  );
  assert.equal(
    readAuthSettings({ LOCAL_DEV_LOGIN_ENABLED: "true" }).devLoginEnabled,
    false,
  );
  assert.equal(
    readAuthSettings({
      NODE_ENV: "production",
      WEB_ORIGIN: "https://app.example",
      LOCAL_DEV_LOGIN_ENABLED: "true",
    }).devLoginEnabled,
    false,
  );
  assert.equal(
    readAuthSettings({
      NODE_ENV: "development",
      WEB_ORIGIN: "https://app.example",
      LOCAL_DEV_LOGIN_ENABLED: "true",
    }).devLoginEnabled,
    false,
  );
  assert.throws(() => readAuthSettings({ NODE_ENV: "production" }));
  assert.deepEqual(sessionCookieOptions(local), {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
  });
  const https = readAuthSettings({
    NODE_ENV: "production",
    WEB_ORIGIN: "https://app.example",
  });
  assert.equal(sessionCookieOptions(https).secure, true);
  assert.equal(https.cookieName, "__Host-gbp_session");
});
test("cookie parsing rejects malformed and duplicate session cookies", () => {
  assert.equal(
    readSessionToken("gbp_session=invalid", "gbp_session"),
    undefined,
  );
  assert.equal(
    readSessionToken(
      `gbp_session=${"a".repeat(64)}; gbp_session=${"b".repeat(64)}`,
      "gbp_session",
    ),
    undefined,
  );
});
test("HTTP login, guarded me, rotation, expiry, and logout", async () => {
  const { app, url, repository } = await fixture();
  const origin = { Origin: local.webOrigin };
  try {
    const missing = await fetch(`${url}/api/me`);
    assert.equal(missing.status, 401);
    assert.equal(await code(missing), "UNAUTHENTICATED");
    const login = await fetch(`${url}/auth/dev-login`, {
      method: "POST",
      headers: origin,
    });
    assert.equal(login.status, 200);
    assert.deepEqual(await login.json(), repository.user);
    const header = login.headers.get("set-cookie") ?? "";
    assert.ok(
      header.includes("HttpOnly") &&
        header.includes("SameSite=Lax") &&
        header.includes("Path=/"),
    );
    assert.ok(!header.includes("Secure"));
    const cookie = header.split(";")[0] ?? "";
    const token = readSessionToken(cookie, local.cookieName);
    assert.ok(token);
    assert.ok(repository.sessions.has(hashSessionToken(token)));
    assert.ok(!repository.sessions.has(token));
    const me = await fetch(`${url}/api/me`, { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    assert.equal(me.headers.get("cache-control"), "no-store");
    assert.deepEqual(await me.json(), repository.user);
    const replacement = await fetch(`${url}/auth/dev-login`, {
      method: "POST",
      headers: { ...origin, Cookie: cookie },
    });
    const nextCookie =
      replacement.headers.get("set-cookie")?.split(";")[0] ?? "";
    assert.ok(nextCookie !== cookie);
    assert.equal(repository.sessions.size, 1);
    assert.equal(
      (await fetch(`${url}/api/me`, { headers: { Cookie: cookie } })).status,
      401,
    );
    const nextToken = readSessionToken(nextCookie, local.cookieName);
    assert.ok(nextToken);
    const stored = repository.sessions.get(hashSessionToken(nextToken));
    assert.ok(stored);
    stored.expiresAt = new Date(0);
    const expired = await fetch(`${url}/api/me`, {
      headers: { Cookie: nextCookie },
    });
    assert.equal(expired.status, 401);
    assert.equal(await code(expired), "SESSION_EXPIRED");
    stored.expiresAt = new Date(Date.now() + 60000);
    const proofResponse = await fetch(`${url}/api/csrf`, {
      headers: { Cookie: nextCookie },
    });
    const proof: unknown = await proofResponse.json();
    assert.ok(
      typeof proof === "object" &&
        proof !== null &&
        "csrfToken" in proof &&
        typeof proof.csrfToken === "string",
    );
    const logout = await fetch(`${url}/api/logout`, {
      method: "POST",
      headers: {
        ...origin,
        Cookie: nextCookie,
        "X-CSRF-Token": proof.csrfToken,
      },
    });
    assert.equal(logout.status, 200);
    assert.equal(repository.sessions.size, 0);
    assert.ok(
      (logout.headers.get("set-cookie") ?? "").includes(
        "Expires=Thu, 01 Jan 1970",
      ),
    );
    assert.equal(
      (await fetch(`${url}/api/me`, { headers: { Cookie: nextCookie } }))
        .status,
      401,
    );
    assert.equal(
      (await fetch(`${url}/api/logout`, { method: "POST", headers: origin }))
        .status,
      401,
    );
  } finally {
    await app.close();
  }
});
test("POST requests reject missing/wrong origin; disabled dev login creates no session", async () => {
  const { app, url, repository } = await fixture({
    ...local,
    devLoginEnabled: false,
  });
  try {
    for (const path of ["/auth/dev-login", "/api/logout"]) {
      for (const headers of [
        new Headers(),
        new Headers({ Origin: "https://untrusted.example" }),
      ])
        assert.equal(
          (await fetch(`${url}${path}`, { method: "POST", headers })).status,
          path === "/auth/dev-login" ? 403 : 401,
        );
    }
    const denied = await fetch(`${url}/auth/dev-login`, {
      method: "POST",
      headers: { Origin: local.webOrigin },
    });
    assert.equal(denied.status, 404);
    assert.equal(repository.sessions.size, 0);
  } finally {
    await app.close();
  }
});
test("missing membership cannot grant access", async () => {
  const repository = new TestRepository();
  const service = new SessionService(repository, local);
  const login = await service.devLogin();
  const stored = repository.sessions.get(hashSessionToken(login.token));
  assert.ok(stored);
  stored.user = null;
  await assert.rejects(
    service.authenticate(login.token),
    (error) => error instanceof Error && error.message === "PERMISSION_DENIED",
  );
});

test("production denies dev login even with an enabled flag", async () => {
  const settings = readAuthSettings({
    NODE_ENV: "production",
    WEB_ORIGIN: "https://localhost:3000",
    LOCAL_DEV_LOGIN_ENABLED: "true",
  });
  const { app, url, repository } = await fixture(settings);
  try {
    const response = await fetch(`${url}/auth/dev-login`, {
      method: "POST",
      headers: { Origin: settings.webOrigin },
    });
    assert.equal(response.status, 404);
    assert.equal(repository.sessions.size, 0);
  } finally {
    await app.close();
  }
});

test("session-bound CSRF proof and exact Origin protect logout", async () => {
  const { app, url, repository } = await fixture();
  try {
    const login = await fetch(`${url}/auth/dev-login`, {
      method: "POST",
      headers: { Origin: local.webOrigin },
    });
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    const token = readSessionToken(cookie, local.cookieName);
    assert.ok(token);
    const proof = sessionCsrfToken(token);
    for (const method of ["PATCH", "DELETE"]) {
      assert.equal(
        (
          await fetch(`${url}/api/probe`, {
            method,
            headers: { Cookie: cookie, Origin: local.webOrigin },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(`${url}/api/probe`, {
            method,
            headers: {
              Cookie: cookie,
              Origin: local.webOrigin,
              "X-CSRF-Token": proof,
            },
          })
        ).status,
        200,
      );
    }
    const deniedRead = await fetch(`${url}/api/me`, {
      headers: { Cookie: cookie, Origin: "https://untrusted.example" },
    });
    assert.equal(deniedRead.headers.get("access-control-allow-origin"), null);
    assert.equal(
      (
        await fetch(`${url}/api/csrf`, {
          headers: { Cookie: cookie, Origin: "https://untrusted.example" },
        })
      ).status,
      403,
    );
    const invalidHeaders: Record<string, string>[] = [
      { Cookie: cookie, Origin: local.webOrigin },
      { Cookie: cookie, Origin: local.webOrigin, "X-CSRF-Token": "invalid" },
      {
        Cookie: cookie,
        Origin: "https://untrusted.example",
        "X-CSRF-Token": proof,
      },
      { Cookie: cookie, "X-CSRF-Token": proof },
      {
        Cookie: cookie,
        Origin: local.webOrigin,
        "X-CSRF-Token": sessionCsrfToken("a".repeat(64)),
      },
    ];
    for (const headers of invalidHeaders) {
      assert.equal(
        (await fetch(`${url}/api/logout`, { method: "POST", headers })).status,
        403,
      );
      assert.equal(repository.sessions.size, 1);
    }
    const stored = repository.sessions.get(hashSessionToken(token));
    assert.ok(stored);
    stored.expiresAt = new Date(0);
    assert.equal(
      (
        await fetch(`${url}/api/logout`, {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: local.webOrigin,
            "X-CSRF-Token": proof,
          },
        })
      ).status,
      401,
    );
    stored.expiresAt = new Date(Date.now() + 60000);
    assert.equal(
      (
        await fetch(`${url}/api/logout`, {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: local.webOrigin,
            "X-CSRF-Token": proof,
          },
        })
      ).status,
      200,
    );
  } finally {
    await app.close();
  }
});
test("CORS lab is explicit, local-only, and forbidden in production", async () => {
  for (const env of [
    {
      NODE_ENV: "production",
      WEB_ORIGIN: "https://localhost:3000",
      LOCAL_LAB_ONLY: "true",
      LOCAL_LAB_CORS_REFLECT: "true",
    },
    { NODE_ENV: "development", LOCAL_LAB_CORS_REFLECT: "true" },
    {
      NODE_ENV: "test",
      WEB_ORIGIN: "https://app.example",
      LOCAL_LAB_ONLY: "true",
      LOCAL_LAB_CORS_REFLECT: "true",
    },
  ])
    assert.throws(() => readAuthSettings(env));
  const lab = readAuthSettings({
    NODE_ENV: "test",
    LOCAL_LAB_ONLY: "true",
    LOCAL_LAB_CORS_REFLECT: "true",
  });
  const { app, url } = await fixture(lab);
  try {
    const response = await fetch(`${url}/api/me`, {
      headers: { Origin: "http://localhost:4000" },
    });
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "http://localhost:4000",
    );
    assert.equal(
      response.headers.get("access-control-allow-credentials"),
      "true",
    );
    assert.equal(
      (
        await fetch(`${url}/auth/dev-login`, {
          method: "POST",
          headers: { Origin: "http://localhost:4000" },
        })
      ).status,
      403,
    );
  } finally {
    await app.close();
  }
});

test("theme preferences belong to the session user, validate input and require CSRF", async () => {
  const { app, url, repository } = await fixture();
  try {
    const login = await fetch(`${url}/auth/dev-login`, {
      method: "POST",
      headers: { Origin: local.webOrigin },
    });
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    const token = readSessionToken(cookie, local.cookieName)!;
    const headers = {
      Cookie: cookie,
      Origin: local.webOrigin,
      "Content-Type": "application/json",
      "X-CSRF-Token": sessionCsrfToken(token),
    };
    for (const themePreference of ["dark", "light", "system"]) {
      const response = await fetch(`${url}/api/me/preferences`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ themePreference }),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).themePreference, themePreference);
      const me = await fetch(`${url}/api/me`, { headers: { Cookie: cookie } });
      assert.equal((await me.json()).themePreference, themePreference);
    }
    for (const body of [
      { themePreference: "blue" },
      { themePreference: "dark", userId: "other" },
      {},
      null,
    ]) {
      const response = await fetch(`${url}/api/me/preferences`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
    }
    const denied = await fetch(`${url}/api/me/preferences`, {
      method: "PATCH",
      headers: {
        Cookie: cookie,
        Origin: local.webOrigin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ themePreference: "dark" }),
    });
    assert.equal(denied.status, 403);
    const anonymous = await fetch(`${url}/api/me/preferences`, {
      method: "PATCH",
      headers: { Origin: local.webOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ themePreference: "dark" }),
    });
    assert.equal(anonymous.status, 401);
    assert.equal(repository.user.themePreference, "system");
  } finally {
    await app.close();
  }
});

test("language preferences persist through logout and login, validate input and require CSRF", async () => {
  const { app, url, repository } = await fixture();
  try {
    const login = await fetch(`${url}/auth/dev-login`, {
      method: "POST",
      headers: { Origin: local.webOrigin },
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const headers = {
      Cookie: cookie,
      Origin: local.webOrigin,
      "Content-Type": "application/json",
      "X-CSRF-Token": sessionCsrfToken(
        readSessionToken(cookie, local.cookieName)!,
      ),
    };
    for (const languagePreference of ["en", "vi"]) {
      const response = await fetch(`${url}/api/me/preferences`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ languagePreference }),
      });
      assert.equal(response.status, 200);
      assert.equal(
        (await response.json()).languagePreference,
        languagePreference,
      );
    }
    for (const body of [
      { languagePreference: "fr" },
      { languagePreference: null },
      { languagePreference: "vi", userId: "other" },
      { languagePreference: "en", themePreference: "bad" },
    ]) {
      assert.equal(
        (
          await fetch(`${url}/api/me/preferences`, {
            method: "PATCH",
            headers,
            body: JSON.stringify(body),
          })
        ).status,
        400,
      );
    }
    assert.equal(repository.user.languagePreference, "vi");
    const deniedHeaders = { ...headers };
    delete (deniedHeaders as Partial<typeof headers>)["X-CSRF-Token"];
    assert.equal(
      (
        await fetch(`${url}/api/me/preferences`, {
          method: "PATCH",
          headers: deniedHeaders,
          body: JSON.stringify({ languagePreference: "en" }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${url}/api/me/preferences`, {
          method: "PATCH",
          headers: {
            Origin: local.webOrigin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ languagePreference: "en" }),
        })
      ).status,
      401,
    );
    const both = await fetch(`${url}/api/me/preferences`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        languagePreference: "vi",
        themePreference: "dark",
      }),
    });
    assert.equal(both.status, 200);
    assert.equal((await both.json()).themePreference, "dark");
    await fetch(`${url}/api/logout`, { method: "POST", headers });
    const again = await fetch(`${url}/auth/dev-login`, {
      method: "POST",
      headers: { Origin: local.webOrigin },
    });
    assert.equal((await again.json()).languagePreference, "vi");
  } finally {
    await app.close();
  }
});
