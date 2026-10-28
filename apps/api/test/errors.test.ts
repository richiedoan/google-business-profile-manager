import "reflect-metadata";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Controller, Get, Module, HttpException } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { ApiErrorCode } from "@gbp/contracts";
import { AppException } from "../src/errors/app.exception";
import { mapError } from "../src/errors/map-error";
import { configureApp } from "../src/configure-app";

const cases: Array<[ApiErrorCode, number]> = [
  ["UNAUTHENTICATED", 401],
  ["SESSION_EXPIRED", 401],
  ["PERMISSION_DENIED", 403],
  ["VALIDATION_FAILED", 400],
  ["PROVIDER_RATE_LIMITED", 429],
  ["PROVIDER_ERROR", 502],
  ["RESOURCE_NOT_FOUND", 404],
  ["INTERNAL_ERROR", 500],
];
for (const [code, status] of cases) {
  test(`maps ${code} with stable status and request ID`, () => {
    const mapped = mapError(new AppException(code), "test-request");
    assert.equal(mapped.status, status);
    assert.equal(mapped.body.code, code);
    assert.equal(mapped.body.requestId, "test-request");
    assert.equal(mapped.body.details, null);
    assert.ok(mapped.body.message.length > 0);
  });
}
test("only explicit validation failures include application-owned details", () => {
  const details = {
    violations: [{ field: "websiteUrl", reason: "INVALID" as const }],
  };
  assert.deepEqual(
    mapError(new AppException("VALIDATION_FAILED", details), "id").body.details,
    details,
  );
  assert.equal(
    mapError(new AppException("PROVIDER_ERROR", details), "id").body.details,
    null,
  );
});
for (const [status, code] of [
  [400, "VALIDATION_FAILED"],
  [401, "UNAUTHENTICATED"],
  [403, "PERMISSION_DENIED"],
  [404, "RESOURCE_NOT_FOUND"],
  [422, "VALIDATION_FAILED"],
  [500, "INTERNAL_ERROR"],
  [503, "INTERNAL_ERROR"],
] as const) {
  test(`sanitizes Nest HTTP ${status}`, () => {
    const mapped = mapError(
      new HttpException(
        { message: "SECRET", stack: "RAW_STACK", details: { token: "TOKEN" } },
        status,
      ),
      "id",
    );
    assert.equal(mapped.body.code, code);
    assert.equal(mapped.body.details, null);
    assert.ok(!JSON.stringify(mapped).includes("SECRET"));
    assert.ok(!JSON.stringify(mapped).includes("TOKEN"));
  });
}
@Controller("failure")
class FailureController {
  @Get()
  fail(): never {
    throw new Error("SECRET_PROVIDER_RESPONSE");
  }
  @Get("expired")
  expired(): never {
    throw new AppException("SESSION_EXPIRED");
  }
}
@Module({ controllers: [FailureController] })
class FailureModule {}
test("global HTTP filter sanitizes failures and generates request IDs", async () => {
  const app = await NestFactory.create(FailureModule, { logger: false });
  configureApp(app);
  await app.listen(0, "127.0.0.1");
  try {
    const url = await app.getUrl();
    const responses = await Promise.all([
      fetch(`${url}/failure`, {
        headers: { "X-Request-Id": "untrusted-input" },
      }),
      fetch(`${url}/missing`),
      fetch(`${url}/failure/expired`),
    ]);
    const seen = new Set<string>();
    for (const [index, response] of responses.entries()) {
      const body: unknown = await response.json();
      const requestId = response.headers.get("x-request-id");
      assert.ok(requestId);
      assert.match(requestId, /^[0-9a-f-]{36}$/);
      assert.notEqual(requestId, "untrusted-input");
      seen.add(requestId);
      assert.deepEqual(
        body,
        index === 0
          ? {
              code: "INTERNAL_ERROR",
              message: "An unexpected error occurred.",
              requestId,
              details: null,
            }
          : index === 1
            ? {
                code: "RESOURCE_NOT_FOUND",
                message: "The requested resource was not found.",
                requestId,
                details: null,
              }
            : {
                code: "SESSION_EXPIRED",
                message: "Your session has expired.",
                requestId,
                details: null,
              },
      );
      assert.equal(response.status, [500, 404, 401][index]);
    }
    assert.equal(seen.size, 3);
  } finally {
    await app.close();
  }
});
