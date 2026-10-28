import "reflect-metadata";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { GoogleConnectionsController } from "../src/business-profile/google-connections.controller";
import { GoogleConnectionsService } from "../src/business-profile/google-connections.service";
import { AUTH_SETTINGS, readAuthSettings } from "../src/auth/auth-settings";
import { SessionGuard } from "../src/auth/session.guard";
import { SessionService, sessionCsrfToken } from "../src/auth/session.service";
import { AppException } from "../src/errors/app.exception";
import { configureApp } from "../src/configure-app";

test("connection HTTP routes protect mutations and return only owned metadata; callback preserves app session", async () => {
  const auth = readAuthSettings({ NODE_ENV: "test" });
  const session = "a".repeat(64);
  const calls: string[] = [];
  const service = {
    list: async (userId: string) => {
      calls.push(`list:${userId}`);
      return {
        enabled: true,
        connections: [
          {
            id: "connection",
            email: "merchant@example.test",
            status: "ACTIVE",
          },
        ],
      };
    },
    begin: async (userId: string, sessionToken: string) => {
      assert.equal(sessionToken, session);
      calls.push(`begin:${userId}`);
      return {
        url: "https://accounts.google.com/o/oauth2/v2/auth?state=fixture",
        browserToken: "b".repeat(64),
      };
    },
    disconnect: async (userId: string, id: string) => {
      calls.push(`disconnect:${userId}:${id}`);
      return { status: "ok" };
    },
    callback: async (
      userId: string,
      sessionToken: string,
      query: Record<string, unknown>,
      browserToken?: string,
    ) => {
      assert.equal(sessionToken, session);
      assert.equal(browserToken, "b".repeat(64));
      if (query.error) throw new AppException("VALIDATION_FAILED");
      calls.push(`callback:${userId}`);
    },
  };
  @Module({
    controllers: [GoogleConnectionsController],
    providers: [
      { provide: GoogleConnectionsService, useValue: service },
      { provide: AUTH_SETTINGS, useValue: auth },
      {
        provide: SessionService,
        useValue: {
          authenticate: async (token?: string) => {
            if (token !== session) throw new AppException("UNAUTHENTICATED");
            return { id: "owner", role: "VIEWER" };
          },
        },
      },
      SessionGuard,
    ],
  })
  class FixtureModule {}
  const app = await NestFactory.create(FixtureModule, { logger: false });
  configureApp(app, auth);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const cookie = `${auth.cookieName}=${session}`;
  try {
    assert.equal((await fetch(base + "/api/google-connections")).status, 401);
    const listed = await fetch(base + "/api/google-connections", {
      headers: { Cookie: cookie },
    });
    assert.equal(listed.headers.get("cache-control"), "no-store");
    assert.deepEqual(await listed.json(), {
      enabled: true,
      connections: [
        { id: "connection", email: "merchant@example.test", status: "ACTIVE" },
      ],
    });
    for (const method of ["POST", "DELETE"]) {
      const path =
        method === "POST"
          ? "/api/google-connections/connect"
          : "/api/google-connections/connection";
      const before = calls.length;
      const invalidHeaders: Record<string, string>[] = [
        { Cookie: cookie },
        {
          Cookie: cookie,
          Origin: "https://attacker.example",
          "X-CSRF-Token": sessionCsrfToken(session),
        },
      ];
      for (const headers of invalidHeaders) {
        assert.equal(
          (await fetch(base + path, { method, headers })).status,
          403,
        );
      }
      assert.equal(calls.length, before);
      const response = await fetch(base + path, {
        method,
        headers: {
          Cookie: cookie,
          Origin: auth.webOrigin,
          "X-CSRF-Token": sessionCsrfToken(session),
        },
      });
      assert.equal(response.status, 200);
      if (method === "POST") {
        assert.match(
          response.headers.get("set-cookie") ?? "",
          /gbp_business_oauth=.*HttpOnly/,
        );
        assert.deepEqual(await response.json(), {
          url: "https://accounts.google.com/o/oauth2/v2/auth?state=fixture",
        });
      }
    }
    const response = await fetch(
      base + "/auth/google-business/callback?state=fixture&code=secret-code",
      {
        redirect: "manual",
        headers: { Cookie: cookie + "; gbp_business_oauth=" + "b".repeat(64) },
      },
    );
    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get("location"),
      auth.webOrigin + "/app?googleConnection=success",
    );
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.ok(
      !(response.headers.get("set-cookie") ?? "").includes(
        auth.cookieName + "=",
      ),
      "Business consent must not rotate or replace the app session",
    );
    const failed = await fetch(
      base + "/auth/google-business/callback?error=access_denied",
      {
        redirect: "manual",
        headers: { Cookie: cookie + "; gbp_business_oauth=" + "b".repeat(64) },
      },
    );
    assert.equal(
      failed.headers.get("location"),
      auth.webOrigin + "/app?googleConnection=error",
    );
    assert.deepEqual(calls, [
      "list:owner",
      "begin:owner",
      "disconnect:owner:connection",
      "callback:owner",
    ]);
  } finally {
    await app.close();
  }
});
